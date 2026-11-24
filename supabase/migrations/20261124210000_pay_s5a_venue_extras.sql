-- S5A: venue extras (spec 13 "Venue photos, amenities and menu"; the data
-- and rules are unchanged except the amenity list).
--   1. Three new amenities: restaurant, vending_machines and shop. The
--      table's check and set_venue_amenities (re-created from
--      20261117191238_pay_venue_media.sql; only v_kinds changes) take them;
--      import_venue needs no change (the table's check is its only list).
--   2. Book a pitch's Amenities filter: book_search (re-created from
--      20261124182133_pay_s4_book_search.sql) takes p_amenities, the
--      amenities a venue must all have; null or empty is no filter, an
--      unknown kind is invalid_amenity. The old signature is dropped so there
--      is one book_search.
--   3. venue_setup_status: the dashboard's "Set up your venue" checklist,
--      worked out on the server for the venue's own staff.

-- ---- 1. The amenity list ---------------------------------------------------

alter table public.venue_amenities drop constraint venue_amenities_kind_check;
alter table public.venue_amenities add constraint venue_amenities_kind_check check (kind in (
  'parking', 'changing_rooms', 'showers', 'lockers', 'cafe_or_bar', 'floodlights', 'bibs', 'ball_hire', 'first_aid',
  'wifi', 'restaurant', 'vending_machines', 'shop', 'other'));

create or replace function public.set_venue_amenities(p_venue_id uuid, p_amenities jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kinds text[] := array['parking', 'changing_rooms', 'showers', 'lockers', 'cafe_or_bar', 'floodlights',
                          'bibs', 'ball_hire', 'first_aid', 'wifi', 'restaurant', 'vending_machines', 'shop', 'other'];
  v_row jsonb;
  v_seen text[] := '{}';
  v_kind text;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if jsonb_typeof(p_amenities) is distinct from 'array' then
    raise exception 'invalid_amenities';
  end if;

  for v_row in select * from jsonb_array_elements(p_amenities) loop
    if jsonb_typeof(v_row) <> 'object' or jsonb_typeof(v_row -> 'kind') is distinct from 'string'
       or (v_row ? 'note' and jsonb_typeof(v_row -> 'note') not in ('string', 'null')) then
      raise exception 'invalid_amenities';
    end if;
    v_kind := v_row ->> 'kind';
    v_note := nullif(btrim(v_row ->> 'note'), '');
    if not v_kind = any (v_kinds) or v_kind = any (v_seen) or char_length(v_note) > 60
       or (v_kind = 'other' and v_note is null) then
      raise exception 'invalid_amenities';
    end if;
    v_seen := v_seen || v_kind;
  end loop;

  delete from public.venue_amenities where venue_id = p_venue_id;
  insert into public.venue_amenities (venue_id, kind, note)
  select p_venue_id, a ->> 'kind', nullif(btrim(a ->> 'note'), '')
  from jsonb_array_elements(p_amenities) a;
  perform public.venue_media_touch(p_venue_id, 'amenities');
end;
$$;

-- ---- 2. The Amenities filter -------------------------------------------------

drop function public.book_search(date[], time, time, integer, text, integer, text, uuid, text[], boolean, boolean);

create or replace function public.book_search(
  p_days date[],
  p_from time,
  p_to time,
  p_minutes integer,
  p_format text,
  p_players_per_side integer default 5,
  p_town text default null,
  p_venue_id uuid default null,
  p_types text[] default null,
  p_favourites_only boolean default false,
  p_include_unavailable boolean default false,
  p_amenities text[] default null
)
returns table (
  venue_id uuid,
  name text,
  town text,
  area text,
  photo_path text,
  amenities text[],
  is_favourite boolean,
  from_player_cents integer,
  slots jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
  v_premium boolean;
  v_days date[];
  v_day date;
  v_six_on_five boolean := p_players_per_side = 6 and p_format = '5-a-side';
  v_types text[] := nullif(coalesce(p_types, '{}'), '{}');
  -- S5A: the Amenities filter (every amenity picked).
  v_amenities text[] := nullif(coalesce(p_amenities, '{}'), '{}');
  v_venue record;
  v_slot record;
  v_price record;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  v_days := array(select distinct d from unnest(coalesce(p_days, '{}')) d where d is not null order by d);
  if cardinality(v_days) = 0 or cardinality(v_days) > 3 or v_days[1] < v_today then
    raise exception 'invalid_days';
  end if;
  v_premium := coalesce((select p.is_premium from public.profiles p where p.id = v_uid), false);
  if v_days[cardinality(v_days)] - v_today > public.rule_window_days(v_premium) then
    raise exception 'beyond_booking_window';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'invalid_time_range';
  end if;
  if p_minutes is null or not (p_minutes = any (public.rule_game_lengths())) then
    raise exception 'invalid_game_length';
  end if;
  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side') then
    raise exception 'invalid_format';
  end if;
  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    raise exception 'invalid_players_per_side';
  end if;
  if v_types is not null and not (v_types <@ array['indoor', 'outdoor']) then
    raise exception 'invalid_type';
  end if;
  if v_amenities is not null and not (v_amenities <@ array['parking', 'changing_rooms', 'showers', 'lockers', 'cafe_or_bar',
                                                          'floodlights', 'bibs', 'ball_hire', 'first_aid', 'wifi',
                                                          'restaurant', 'vending_machines', 'shop', 'other']) then
    raise exception 'invalid_amenity';
  end if;

  for v_venue in
    select v.id, v.name, v.city,
           exists (select 1 from public.favourite_venues f where f.profile_id = v_uid and f.venue_id = v.id) as fav
    from public.venues v
    where v.is_live
      and (p_venue_id is null or v.id = p_venue_id)
      and (p_town is null or public.venue_city_part(v.city) = p_town)
      and (not v_six_on_five or v.allows_6v6_on_5s)
      -- S5A: every amenity picked.
      and (v_amenities is null or not exists (
            select 1 from unnest(v_amenities) k
            where not exists (select 1 from public.venue_amenities a where a.venue_id = v.id and a.kind = k)))
      and (not p_favourites_only
           or exists (select 1 from public.favourite_venues f where f.profile_id = v_uid and f.venue_id = v.id))
      -- Type: an open pitch for the format (alone or in a combination) that is indoor or outdoor.
      and (v_types is null or exists (
            select 1 from public.pitches p
            where p.venue_id = v.id and p.is_open
              and (case when p.indoor then 'indoor' else 'outdoor' end) = any (v_types)
              and (p_format = any (p.formats)
                   or exists (select 1 from public.pitch_combinations c
                              where c.venue_id = v.id and c.format = p_format and p.id = any (c.pitch_ids)))))
    order by fav desc, v.name, v.id
  loop
    slots := '[]'::jsonb;
    from_player_cents := null;
    v_count := 0;
    foreach v_day in array v_days loop
      exit when v_count >= 8;
      for v_slot in
        select f.start_time, f.end_time
        from public.venue_free_slots(v_venue.id, v_day, p_format, p_minutes, p_players_per_side) f
        where f.start_time >= p_from and f.start_time < p_to
        order by f.start_time
      loop
        exit when v_count >= 8;
        select * into v_price
        from public.search_slot_price(v_venue.id, v_day, v_slot.start_time, v_slot.end_time, p_format,
                                      p_players_per_side, v_premium);
        continue when not found;
        slots := slots || jsonb_build_array(jsonb_build_object(
          'day', v_day, 'start', v_slot.start_time, 'end', v_slot.end_time, 'player_cents', v_price.player_cents));
        from_player_cents := least(from_player_cents, v_price.player_cents);
        v_count := v_count + 1;
      end loop;
    end loop;
    continue when v_count = 0 and not p_include_unavailable;

    venue_id := v_venue.id;
    name := v_venue.name;
    town := public.venue_city_part(v_venue.city);
    area := nullif(btrim(substring(v_venue.city from '\(([^)]*)\)')), '');
    photo_path := (select p.storage_path from public.venue_photos p where p.venue_id = v_venue.id
                   order by p.pitch_id nulls first, p.sort_order, p.storage_path limit 1);
    amenities := array(select a.kind from public.venue_amenities a where a.venue_id = v_venue.id order by a.kind);
    is_favourite := v_venue.fav;
    return next;
  end loop;
end;
$$;

revoke all on function public.book_search(date[], time, time, integer, text, integer, text, uuid, text[], boolean, boolean, text[])
  from public, anon;
grant execute on function public.book_search(date[], time, time, integer, text, integer, text, uuid, text[], boolean, boolean, text[])
  to authenticated, service_role;

-- ---- 3. The setup checklist --------------------------------------------------

-- Each part is done once the venue has entered it: a photo, an amenity, an
-- active food or drink item, opening hours, both a phone and a website, a
-- pitch, and a price (the venue page's own test for bookable). complete
-- when all seven are done. Staff of that venue only.
create or replace function public.venue_setup_status(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  select * into v_venue from public.venues where id = p_venue_id;

  v := jsonb_build_object(
    'photos', exists (select 1 from public.venue_photos p where p.venue_id = p_venue_id),
    'amenities', exists (select 1 from public.venue_amenities a where a.venue_id = p_venue_id),
    'menu', exists (select 1 from public.venue_menu_items i where i.venue_id = p_venue_id and i.active),
    'hours', exists (select 1 from public.opening_hours h where h.venue_id = p_venue_id),
    'contact', v_venue.phone is not null and v_venue.website is not null,
    'pitches', exists (select 1 from public.pitches p where p.venue_id = p_venue_id),
    'prices', exists (select 1 from public.price_rules r where r.venue_id = p_venue_id));
  return v || jsonb_build_object('complete', not exists (select 1 from jsonb_each(v) e where e.value = 'false'::jsonb));
end;
$$;

revoke all on function public.venue_setup_status(uuid) from public, anon;
grant execute on function public.venue_setup_status(uuid) to authenticated, service_role;
