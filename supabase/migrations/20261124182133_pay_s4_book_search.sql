-- S4: Book a pitch (docs/specs/15-design.md section 0, image 02; prompt S4).
--
-- 1. favourite_venues: a player's favourite venues (owner only).
-- 2. venue_requests: "Missing a venue?" (players insert their own, at most 5
--    a Cyprus day; only the service role reads: the founders, in the
--    Supabase dashboard).
-- 3. search_slot_price: the per-player price of one slot, moved out of
--    venues_free_at so book_search and venues_free_at share it and can never
--    disagree. venues_free_at is re-created from its latest definition
--    (20261115190000_pay_app_rules.sql) to call it; nothing else changes.
-- 4. rule_game_lengths: the offered game lengths (spec 13: 60, 90 or 120
--    minutes, 60 by default). booking_search_options is re-created from its
--    latest definition (20261115190000_pay_app_rules.sql) to return them.
-- 5. book_search: the Book a pitch results.
--
-- Cyprus time throughout: (now() at time zone 'Asia/Nicosia').

-- ---- 1. Favourite venues ----------------------------------------------------

create table public.favourite_venues (
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, venue_id)
);

alter table public.favourite_venues enable row level security;

create policy "Players read their own favourite venues" on public.favourite_venues
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "Players add their own favourite venues" on public.favourite_venues
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "Players remove their own favourite venues" on public.favourite_venues
  for delete to authenticated using (profile_id = (select auth.uid()));

revoke all on public.favourite_venues from public, anon, authenticated;
grant select, insert, delete on public.favourite_venues to authenticated;
grant all on public.favourite_venues to service_role;

-- ---- 2. "Missing a venue?" --------------------------------------------------

create table public.venue_requests (
  id bigint generated always as identity primary key,
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  venue_name text not null check (char_length(btrim(venue_name)) between 1 and 100),
  town text not null check (char_length(btrim(town)) between 1 and 60),
  created_at timestamptz not null default now()
);
create index venue_requests_profile_idx on public.venue_requests (profile_id, created_at);

alter table public.venue_requests enable row level security;

-- Players only send; no one but the service role reads.
create policy "Players send their own venue requests" on public.venue_requests
  for insert to authenticated with check (profile_id = (select auth.uid()));

revoke all on public.venue_requests from public, anon, authenticated;
grant insert (venue_name, town, profile_id) on public.venue_requests to authenticated;
grant all on public.venue_requests to service_role;

-- At most 5 requests per player per Cyprus day (prompt S4, 24 November).
create or replace function public.venue_requests_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
begin
  -- One player's requests are counted one at a time.
  perform pg_advisory_xact_lock(hashtext('venue_requests'), hashtext(new.profile_id::text));
  if (select count(*) from public.venue_requests r
      where r.profile_id = new.profile_id
        and (r.created_at at time zone 'Asia/Nicosia')::date = v_today) >= 5 then
    raise exception 'venue_request_limit';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger venue_requests_limit
  before insert on public.venue_requests
  for each row execute function public.venue_requests_limit();

revoke all on function public.venue_requests_limit() from public, anon, authenticated;

-- ---- 3. The per-player price of one slot (shared) --------------------------

-- What venues_free_at did for each venue, unchanged: the slot passes
-- booking_slot_checked (no row when it doesn't), has a price and a free
-- pitch; player_cents is what each player pays by card when each pays their
-- own spot (money_share). Internal: only the search functions call it.
create or replace function public.search_slot_price(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_format text,
  p_players_per_side integer,
  p_premium boolean
)
returns table (pitch_cents integer, player_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_six_on_five boolean := p_players_per_side = 6 and p_format = '5-a-side';
  v_players integer;
  v_price integer;
begin
  begin
    v_players := public.booking_slot_checked(p_venue_id, p_day, p_start, p_end, p_format, p_players_per_side, p_premium);
  exception when others then
    return;
  end;
  v_price := public.slot_price_cents(p_venue_id, p_day, p_start, p_end, p_format);
  if v_price is null or public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five) is null then
    return;
  end if;
  pitch_cents := v_price;
  player_cents := (select m.card_cents
                   from public.money_share(v_price, v_players, 'each_pays_own_spot', false, false, 'card') m);
  return next;
end;
$$;

revoke all on function public.search_slot_price(uuid, date, time, time, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.search_slot_price(uuid, date, time, time, text, integer, boolean) to service_role;

-- venues_free_at, from 20261115190000_pay_app_rules.sql: the loop body moves
-- into search_slot_price. Same signature, output and grants.
create or replace function public.venues_free_at(
  p_day date,
  p_start time,
  p_minutes integer,
  p_format text,
  p_players_per_side integer default 5
)
returns table (
  venue_id uuid,
  name text,
  city text,
  address text,
  photo_path text,
  pitch_cents integer,
  player_cents integer,
  next_starts time[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_premium boolean;
  v_end_at timestamp;
  v_end time;
  v_six_on_five boolean := p_players_per_side = 6 and p_format = '5-a-side';
  v_venue record;
  v_price record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_minutes is null or p_minutes < 30 or p_minutes % 30 <> 0 or p_day is null or p_start is null then
    raise exception 'invalid_time_range';
  end if;
  v_premium := coalesce((select is_premium from public.profiles where id = auth.uid()), false);
  if p_day - v_now::date > public.rule_window_days(v_premium) then
    raise exception 'beyond_booking_window';
  end if;
  v_end_at := p_day + p_start + make_interval(mins => p_minutes);
  if v_end_at > p_day + 1 then
    return;
  end if;
  v_end := case when v_end_at = p_day + 1 then time '24:00' else v_end_at::time end;

  for v_venue in
    select v.id, v.name, v.city, v.address from public.venues v
    where v.is_live and (not v_six_on_five or v.allows_6v6_on_5s)
    order by v.name, v.id
  loop
    -- S4: the checks and the price, as before, now in search_slot_price.
    select * into v_price
    from public.search_slot_price(v_venue.id, p_day, p_start, v_end, p_format, p_players_per_side, v_premium);
    if not found then
      continue;
    end if;
    venue_id := v_venue.id;
    name := v_venue.name;
    city := v_venue.city;
    address := v_venue.address;
    photo_path := (select p.storage_path from public.venue_photos p where p.venue_id = v_venue.id
                   order by p.pitch_id nulls first, p.sort_order, p.storage_path limit 1);
    pitch_cents := v_price.pitch_cents;
    player_cents := v_price.player_cents;
    next_starts := array(select f.start_time
                         from public.venue_free_slots(v_venue.id, p_day, p_format, p_minutes, p_players_per_side) f
                         where f.start_time > p_start order by f.start_time limit 3);
    return next;
  end loop;
end;
$$;

-- ---- 4. The offered game lengths -------------------------------------------

-- Spec 13 "Game length and start times": 60, 90 or 120 minutes, 60 by default.
create or replace function public.rule_game_lengths()
returns integer[]
language sql
immutable
set search_path = ''
as $$ select array[60, 90, 120] $$;

revoke all on function public.rule_game_lengths() from public, anon, authenticated;
grant execute on function public.rule_game_lengths() to service_role;

-- booking_search_options, from 20261115190000_pay_app_rules.sql, plus
-- game_lengths and default_game_length.
create or replace function public.booking_search_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_premium boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  v_premium := coalesce((select is_premium from public.profiles where id = auth.uid()), false);
  return jsonb_build_object(
    'today', (now() at time zone 'Asia/Nicosia')::date,
    'window_days', public.rule_window_days(v_premium),
    'is_premium', v_premium,
    'six_on_five_available', exists (
      select 1 from public.venues v
      where v.is_live and v.allows_6v6_on_5s
        and (exists (select 1 from public.pitches p where p.venue_id = v.id and p.is_open and '5-a-side' = any (p.formats))
             or exists (select 1 from public.pitch_combinations c where c.venue_id = v.id and c.format = '5-a-side'))),
    -- S4: the offered game lengths, 60 by default.
    'game_lengths', to_jsonb(public.rule_game_lengths()),
    'default_game_length', (public.rule_game_lengths())[1]
  );
end;
$$;

-- ---- 5. book_search ---------------------------------------------------------

-- The Book a pitch results: live venues (in a town, every area in it; or one
-- venue; or all), with the free start times on up to 3 days inside the time
-- window [p_from, p_to), 8 at most per venue, each priced by
-- search_slot_price, and the cheapest of those per-player prices. Venues
-- with no free time are left out unless p_include_unavailable. Favourites
-- first, then by name.
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
  p_include_unavailable boolean default false
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

  for v_venue in
    select v.id, v.name, v.city,
           exists (select 1 from public.favourite_venues f where f.profile_id = v_uid and f.venue_id = v.id) as fav
    from public.venues v
    where v.is_live
      and (p_venue_id is null or v.id = p_venue_id)
      and (p_town is null or public.venue_city_part(v.city) = p_town)
      and (not v_six_on_five or v.allows_6v6_on_5s)
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

revoke all on function public.book_search(date[], time, time, integer, text, integer, text, uuid, text[], boolean, boolean)
  from public, anon;
grant execute on function public.book_search(date[], time, time, integer, text, integer, text, uuid, text[], boolean, boolean)
  to authenticated, service_role;
