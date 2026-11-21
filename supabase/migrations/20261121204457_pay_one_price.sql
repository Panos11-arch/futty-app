-- One price per format (docs/specs/13-payments-bookings.md, "Pitch prices",
-- decided 19 November, Panos). A venue has one price per format, the same on
-- every day and at every hour: no peak, off-peak or weekend prices. This
-- replaces the optional peak and weekend prices of
-- 20261109124440_pay_venue_model_one_price and the venue setup decision of
-- 17 November (Dimitris) that let staff set them.
--
-- The peak and weekend columns of price_rules are dropped, with the checks
-- that use them (peak_weekdays and weekend_weekdays were NOT NULL with
-- defaults; they go too, not made nullable). Nothing else reads them once
-- the four functions below are re-created, each from its latest definition
-- with only the peak and weekend parts taken out.
--
-- A game already booked keeps its price: bookings and shares store their own
-- amounts, and nothing here touches them.

-- The old setter took peak and weekend prices and hours.
drop function public.set_price_rule(uuid, text, integer, integer, integer, smallint[], time, time, smallint[]);

alter table public.price_rules
  drop column peak_cents,
  drop column weekend_cents,
  drop column peak_weekdays,
  drop column peak_starts,
  drop column peak_ends,
  drop column weekend_weekdays;

-- From 20261109124440_pay_venue_model_one_price. The pitch price for one game
-- of the format, in cents, half hour by half hour: every half hour is half
-- the venue's one price. Null when the venue has no price for the format.
-- Slots are on the 30-minute grid (book_slot checks that first).
create or replace function public.slot_price_cents(p_venue_id uuid, p_day date, p_start time, p_end time, p_format text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.price_rules;
  v_slice timestamp;
  v_total bigint := 0;
begin
  select * into v_rule from public.price_rules where venue_id = p_venue_id and format = p_format;
  if v_rule.venue_id is null then
    return null;
  end if;

  for v_slice in
    select generate_series(p_day + p_start, p_day + p_end - interval '30 minutes', interval '30 minutes')
  loop
    v_total := v_total + v_rule.price_cents;
  end loop;

  -- Each half hour costs half the hourly price.
  return round(v_total / 2.0)::integer;
end;
$$;

revoke all on function public.slot_price_cents(uuid, date, time, time, text) from public, anon;
grant execute on function public.slot_price_cents(uuid, date, time, time, text) to authenticated, service_role;

-- From 20261117120506_pay_venue_setup. Everything the setup screens edit,
-- for the venue's staff: the week's hours, every closure that hasn't ended
-- yet (Cyprus), each format's one price, pitches (closed ones too, with
-- whether they hold a game, so the app can grey out what the server would
-- refuse) and which pitches combine. Times are "HH:MM"; a close of midnight
-- is "24:00".
create or replace function public.venue_setup(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;

  return jsonb_build_object(
    'venue', (
      select jsonb_build_object('id', v.id, 'name', v.name, 'allows_6v6_on_5s', v.allows_6v6_on_5s)
      from public.venues v where v.id = p_venue_id
    ),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday', h.weekday, 'opens', left(h.opens::text, 5), 'closes', left(h.closes::text, 5))
             order by h.weekday)
      from public.opening_hours h where h.venue_id = p_venue_id
    ), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'reason', c.reason)
             order by c.starts_on, c.ends_on, c.id)
      from public.venue_closures c where c.venue_id = p_venue_id and c.ends_on >= v_today
    ), '[]'::jsonb),
    'prices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'format', r.format,
               'price_cents', r.price_cents)
             order by public.format_player_count(r.format))
      from public.price_rules r where r.venue_id = p_venue_id
    ), '[]'::jsonb),
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'size', p.size,
               'formats', to_jsonb(p.formats),
               'surface', p.surface,
               'indoor', p.indoor,
               'description', p.description,
               'is_open', p.is_open,
               'sort_order', p.sort_order,
               'has_bookings', public.pitch_has_bookings(p.id, false),
               'has_future_bookings', public.pitch_has_bookings(p.id, true))
             order by p.sort_order, p.name)
      from public.pitches p where p.venue_id = p_venue_id
    ), '[]'::jsonb),
    'combinations', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'format', c.format, 'pitch_ids', to_jsonb(c.pitch_ids))
             order by public.format_player_count(c.format), c.id)
      from public.pitch_combinations c where c.venue_id = p_venue_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.venue_setup(uuid) from public, anon;
grant execute on function public.venue_setup(uuid) to authenticated, service_role;

-- From 20261117120506_pay_venue_setup. Sets a format's one price per hour, in
-- cents. This is the venue's own price, which every amount is computed from
-- on the server; a game already booked keeps the price it was booked at. The
-- price is more than €0 (decided 17 November, Dimitris; for Panos to
-- confirm): a €0 price would make free games by mistake.
create or replace function public.set_price_rule(
  p_venue_id uuid,
  p_format text,
  p_price_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side') then
    raise exception 'invalid_format';
  end if;
  if p_price_cents is null or p_price_cents <= 0 then
    raise exception 'invalid_price';
  end if;

  insert into public.price_rules (
    venue_id, format, price_cents
  )
  values (
    p_venue_id, p_format, p_price_cents
  )
  on conflict (venue_id, format) do update
    set price_cents = excluded.price_cents;
end;
$$;

revoke all on function public.set_price_rule(uuid, text, integer) from public, anon;
grant execute on function public.set_price_rule(uuid, text, integer) to authenticated, service_role;

-- From 20261117191238_pay_venue_media: "prices" has each format's one price.
create or replace function public.venue_page(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  if not public.venue_visible(p_venue_id) then
    raise exception 'venue_not_found';
  end if;
  select * into v_venue from public.venues where id = p_venue_id;

  return jsonb_build_object(
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address,
      'google_maps_link', v_venue.google_maps_link, 'phone', v_venue.phone, 'website', v_venue.website,
      'instagram', v_venue.instagram, 'is_live', v_venue.is_live, 'allows_6v6_on_5s', v_venue.allows_6v6_on_5s),
    'bookable', v_venue.is_live and exists (select 1 from public.price_rules r where r.venue_id = p_venue_id),
    'cancellation', public.cancellation_terms(),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('storage_path', p.storage_path, 'pitch_id', p.pitch_id)
                                         order by p.pitch_id nulls first, p.sort_order, p.storage_path)
                        from public.venue_photos p where p.venue_id = p_venue_id), '[]'::jsonb),
    'amenities', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'note', a.note) order by a.kind)
                           from public.venue_amenities a where a.venue_id = p_venue_id), '[]'::jsonb),
    'pitches', coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', p.id, 'name', p.name, 'size', p.size, 'formats', to_jsonb(p.formats),
                                  'surface', p.surface, 'indoor', p.indoor, 'description', p.description,
                                  'is_open', p.is_open) order by p.sort_order, p.name)
                         from public.pitches p where p.venue_id = p_venue_id), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(jsonb_build_object(
                                 'format', r.format, 'hour_cents', r.price_cents)
                               order by public.format_player_count(r.format))
                        from public.price_rules r where r.venue_id = p_venue_id), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', h.opens, 'closes', h.closes)
                                        order by h.weekday)
                       from public.opening_hours h where h.venue_id = p_venue_id), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', i.id, 'name', i.name, 'description', i.description, 'price_cents', i.price_cents,
                                 'offer_text', i.offer_text, 'offer_price_cents', i.offer_price_cents,
                                 'photo_path', i.photo_path, 'available_from', i.available_from,
                                 'available_to', i.available_to, 'available_weekdays', to_jsonb(i.available_weekdays))
                               order by i.name)
                        from public.venue_menu_items i
                        where i.venue_id = p_venue_id and i.active and i.is_post_match_offer), '[]'::jsonb),
    -- P6e: the whole menu.
    'menu', coalesce((select jsonb_agg(jsonb_build_object(
                               'id', i.id, 'name', i.name, 'category', i.category, 'description', i.description,
                               'price_cents', i.price_cents, 'offer_price_cents', i.offer_price_cents,
                               'is_post_match_offer', i.is_post_match_offer, 'offer_text', i.offer_text,
                               'photo_path', i.photo_path, 'dietary_tags', to_jsonb(i.dietary_tags))
                             order by i.category nulls last, i.sort_order, i.name)
                      from public.venue_menu_items i
                      where i.venue_id = p_venue_id and i.active), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.venue_page(uuid) from public, anon;
grant execute on function public.venue_page(uuid) to authenticated, service_role;
