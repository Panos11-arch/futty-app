-- P6e venue setup: staff edit their venue's opening hours, closures, prices
-- and pitches (docs/specs/05-product.md section 12, launch items 2 and 3;
-- docs/specs/13-payments-bookings.md "Venue setup", decided 17 November,
-- Dimitris; for Panos to confirm).
--
-- The setup tables stay read-only to the app: every change goes through one
-- of the functions below, which checks that the caller is staff of the venue
-- that owns the row (never a venue id sent alongside a row id) and validates
-- the input. Games already booked are never changed:
--   - a new price applies to new bookings and quotes only; a booking keeps
--     the price it was made at (venue_bookings.amount_cents), and so does
--     every player who joins it later. A price is more than €0;
--   - a closure, shorter hours or a closed pitch stop new bookings only; the
--     players still in each game they cover are told, as for a block, that
--     the venue has closed new bookings: once per closure, per hours change
--     and per pitch closure (as a block tells them once per block);
--   - a pitch that holds a game can't be deleted, only closed; its size and
--     formats can't change while it holds a future game. A cancelled game
--     holds no pitch (its booking_pitches rows are removed).

-- Tells every player still in each of these games, once for this event (a
-- closure, an hours change or a pitch closure), that the venue has closed
-- new bookings and their game is still on. Still in = a share pending,
-- authorized, paid or covered, or the booker of a free game (no shares), as
-- flag_conditions counts them. Only app games that aren't cancelled and
-- haven't ended (Cyprus time). Same type and words as notify_venue_block;
-- p_event (closureId or pitchId) goes into the notification's data, as
-- blockId does for a block. Each caller passes each game once per event, so
-- nobody is told twice about the same event.
create or replace function public.notify_closed_new_bookings(p_venue_id uuid, p_booking_ids uuid[], p_event jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_name text;
  v_row record;
begin
  select name into v_venue_name from public.venues where id = p_venue_id;

  for v_row in
    select distinct b.id as booking_id, b.booking_day, b.start_time, player.profile_id
    from public.venue_bookings b
    cross join lateral (
      select s.profile_id from public.booking_payment_shares s
      where s.booking_id = b.id and s.status in ('pending', 'authorized', 'paid', 'covered')
      union
      select b.created_by
      where not exists (select 1 from public.booking_payment_shares s where s.booking_id = b.id)
    ) as player
    where b.id = any (p_booking_ids)
      and b.venue_id = p_venue_id
      and b.booking_type = 'user_booking'
      and b.status <> 'cancelled'
      and b.booking_day + b.end_time > (now() at time zone 'Asia/Nicosia')
      and player.profile_id is not null
  loop
    perform public.send_notification(
      v_row.profile_id,
      'venue_closed_new_bookings',
      jsonb_build_object(
        'title', coalesce(v_venue_name, 'The venue') || ' has closed new bookings',
        'body', 'Your game on ' || to_char(v_row.booking_day, 'FMDay FMDD FMMonth') || ' at '
                || to_char(v_row.start_time, 'HH24:MI') || ' is still on.',
        'bookingId', v_row.booking_id,
        'venueId', p_venue_id
      ) || coalesce(p_event, '{}'::jsonb)
    );
  end loop;
end;
$$;

revoke all on function public.notify_closed_new_bookings(uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.notify_closed_new_bookings(uuid, uuid[], jsonb) to service_role;

-- Whether a pitch holds a game (any time), or one that hasn't ended yet
-- (Cyprus time; booking_pitches.slot is in Cyprus local time).
create or replace function public.pitch_has_bookings(p_pitch_id uuid, p_future_only boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.booking_pitches bp
    where bp.pitch_id = p_pitch_id
      and (not p_future_only or upper(bp.slot) > (now() at time zone 'Asia/Nicosia'))
  );
$$;

revoke all on function public.pitch_has_bookings(uuid, boolean) from public, anon, authenticated;
grant execute on function public.pitch_has_bookings(uuid, boolean) to service_role;

-- Whether the caller is staff of any venue. The functions given only a row
-- id check this first, then look the row up among the caller's own venues,
-- so another venue's row gets the same answer as an id that doesn't exist.
create or replace function public.is_staff_of_any_venue()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (select 1 from public.venues v where public.is_venue_staff(v.id));
$$;

revoke all on function public.is_staff_of_any_venue() from public, anon, authenticated;
grant execute on function public.is_staff_of_any_venue() to service_role;

-- Everything the setup screens edit, for the venue's staff: the week's
-- hours, every closure that hasn't ended yet (Cyprus), prices with
-- their peak and weekend hours, pitches (closed ones too, with whether they
-- hold a game, so the app can grey out what the server would refuse) and
-- which pitches combine. Times are "HH:MM"; a close of midnight is "24:00".
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
               'price_cents', r.price_cents,
               'peak_cents', r.peak_cents,
               'weekend_cents', r.weekend_cents,
               'peak_weekdays', to_jsonb(r.peak_weekdays),
               'peak_starts', left(r.peak_starts::text, 5),
               'peak_ends', left(r.peak_ends::text, 5),
               'weekend_weekdays', to_jsonb(r.weekend_weekdays))
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

-- Replaces the venue's week. p_hours is a list of
-- {"weekday": 1-7 (1 = Monday), "opens": "HH:MM", "closes": "HH:MM"}; a
-- weekday that isn't listed is closed. "24:00" closes at midnight. Games
-- already booked stay on. This change tells the players still in each game
-- it puts outside its day's hours, once: a game that was inside the old hours
-- and is outside the new ones. A game already outside them was told by an
-- earlier change, and saving the same hours again tells nobody.
create or replace function public.set_venue_hours(p_venue_id uuid, p_hours jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day jsonb;
  v_weekday smallint;
  v_opens time;
  v_closes time;
  v_seen smallint[] := array[]::smallint[];
  v_rows jsonb := '[]'::jsonb;
  v_old jsonb;
  v_affected uuid[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  -- One hours change at a time per venue, so two saves can't both read the
  -- same old hours and tell the same players twice.
  perform 1 from public.venues where id = p_venue_id for no key update;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    raise exception 'invalid_hours';
  end if;

  for v_day in select * from jsonb_array_elements(p_hours)
  loop
    begin
      v_weekday := (v_day ->> 'weekday')::smallint;
      v_opens := (v_day ->> 'opens')::time;
      v_closes := (v_day ->> 'closes')::time;
    exception when others then
      raise exception 'invalid_hours';
    end;
    if v_weekday is null or v_weekday not between 1 and 7 or v_weekday = any (v_seen)
       or v_opens is null or v_closes is null or v_opens >= time '24:00' or v_closes <= v_opens then
      raise exception 'invalid_hours';
    end if;
    v_seen := v_seen || v_weekday;
    v_rows := v_rows || jsonb_build_object('weekday', v_weekday, 'opens', v_opens, 'closes', v_closes);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', h.opens, 'closes', h.closes)), '[]'::jsonb)
  into v_old
  from public.opening_hours h where h.venue_id = p_venue_id;

  delete from public.opening_hours where venue_id = p_venue_id;
  insert into public.opening_hours (venue_id, weekday, opens, closes)
  select p_venue_id, (r ->> 'weekday')::smallint, (r ->> 'opens')::time, (r ->> 'closes')::time
  from jsonb_array_elements(v_rows) r;

  -- Games that haven't ended, were inside the old hours and are outside the
  -- new ones.
  select array_agg(b.id) into v_affected
  from public.venue_bookings b
  left join public.opening_hours h on h.venue_id = b.venue_id and h.weekday = extract(isodow from b.booking_day)
  where b.venue_id = p_venue_id
    and b.booking_type = 'user_booking'
    and b.status <> 'cancelled'
    and b.booking_day + b.end_time > (now() at time zone 'Asia/Nicosia')
    and (h.weekday is null or b.start_time < h.opens or b.end_time > h.closes)
    and exists (
      select 1 from jsonb_array_elements(v_old) o
      where (o ->> 'weekday')::smallint = extract(isodow from b.booking_day)
        and b.start_time >= (o ->> 'opens')::time
        and b.end_time <= (o ->> 'closes')::time
    );

  if v_affected is not null then
    perform public.notify_closed_new_bookings(p_venue_id, v_affected, '{}'::jsonb);
  end if;
end;
$$;

-- Closes the venue to new bookings from p_starts_on to p_ends_on (both
-- days included). A closure already running can be added; one that ended
-- before today (Cyprus) can't. Games already booked stay on; the players
-- still in the ones it covers are told once for this closure (closureId),
-- even if another closure or a block already covers their game.
create or replace function public.add_venue_closure(p_venue_id uuid, p_starts_on date, p_ends_on date, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_affected uuid[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'invalid_range';
  end if;
  if p_ends_on < (now() at time zone 'Asia/Nicosia')::date then
    raise exception 'day_in_past';
  end if;

  insert into public.venue_closures (venue_id, starts_on, ends_on, reason)
  values (p_venue_id, p_starts_on, p_ends_on, nullif(btrim(p_reason), ''))
  returning id into v_id;

  select array_agg(b.id) into v_affected
  from public.venue_bookings b
  where b.venue_id = p_venue_id
    and b.booking_day between p_starts_on and p_ends_on
    and b.booking_type = 'user_booking'
    and b.status <> 'cancelled';

  if v_affected is not null then
    perform public.notify_closed_new_bookings(p_venue_id, v_affected, jsonb_build_object('closureId', v_id));
  end if;

  return v_id;
end;
$$;

-- Removes a closure: its days take new bookings again (if nothing else
-- closes them). Games and their players and money are untouched, as when a
-- block is removed. Another venue's closure is closure_not_found, as for an
-- id that doesn't exist.
create or replace function public.remove_venue_closure(p_closure_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.venue_closures;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_of_any_venue() then
    raise exception 'not_venue_staff';
  end if;
  select c.* into v_closure
  from public.venue_closures c
  join public.venues v on v.id = c.venue_id
  where c.id = p_closure_id and public.is_venue_staff(v.id)
  for update of c;
  if v_closure.id is null then
    raise exception 'closure_not_found';
  end if;

  delete from public.venue_closures where id = p_closure_id;
end;
$$;

-- Sets a format's prices per hour, in cents: the one price, and optional
-- peak and weekend prices (null = no such band). Null days and hours take
-- the defaults of 13 "Prices and fees": peak Monday to Friday from 17:00
-- until closing (p_peak_ends null), weekend Saturday and Sunday. These are
-- the venue's own prices, which every amount is computed from on the
-- server; a game already booked keeps the price it was booked at. Every
-- price given is more than €0 (decided 17 November, Dimitris; for Panos to
-- confirm): a €0 price would make free games by mistake.
create or replace function public.set_price_rule(
  p_venue_id uuid,
  p_format text,
  p_price_cents integer,
  p_peak_cents integer,
  p_weekend_cents integer,
  p_peak_weekdays smallint[],
  p_peak_starts time,
  p_peak_ends time,
  p_weekend_weekdays smallint[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_peak_weekdays smallint[] := coalesce(p_peak_weekdays, array[1, 2, 3, 4, 5]::smallint[]);
  v_peak_starts time := coalesce(p_peak_starts, time '17:00');
  v_weekend_weekdays smallint[] := coalesce(p_weekend_weekdays, array[6, 7]::smallint[]);
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
  if p_price_cents is null or p_price_cents <= 0
     or (p_peak_cents is not null and p_peak_cents <= 0)
     or (p_weekend_cents is not null and p_weekend_cents <= 0) then
    raise exception 'invalid_price';
  end if;
  if array_position(v_peak_weekdays, null) is not null
     or array_position(v_weekend_weekdays, null) is not null
     or not (v_peak_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
     or not (v_weekend_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
     or v_peak_weekdays && v_weekend_weekdays
     or (p_peak_ends is not null and p_peak_ends <= v_peak_starts) then
    raise exception 'invalid_peak_hours';
  end if;

  insert into public.price_rules (
    venue_id, format, price_cents, peak_cents, weekend_cents,
    peak_weekdays, peak_starts, peak_ends, weekend_weekdays
  )
  values (
    p_venue_id, p_format, p_price_cents, p_peak_cents, p_weekend_cents,
    v_peak_weekdays, v_peak_starts, p_peak_ends, v_weekend_weekdays
  )
  on conflict (venue_id, format) do update
    set price_cents = excluded.price_cents,
        peak_cents = excluded.peak_cents,
        weekend_cents = excluded.weekend_cents,
        peak_weekdays = excluded.peak_weekdays,
        peak_starts = excluded.peak_starts,
        peak_ends = excluded.peak_ends,
        weekend_weekdays = excluded.weekend_weekdays;
end;
$$;

-- Removes a format's price: that format can't be booked at the venue
-- (price_not_set) until it has one again. Games already booked keep theirs.
create or replace function public.remove_price_rule(p_venue_id uuid, p_format text)
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

  delete from public.price_rules where venue_id = p_venue_id and format = p_format;
  if not found then
    raise exception 'price_rule_not_found';
  end if;
end;
$$;

-- Adds a pitch (p_pitch_id null) or edits one of the venue's pitches. Its
-- size and formats can't change while it holds a game that hasn't ended;
-- everything else can. Returns the pitch id.
--
-- Missing fields: when editing, a null argument keeps the field's saved
-- value, for every field. An empty (or blank) surface or description clears
-- it; a blank name is refused (invalid_pitch). A new pitch needs a name, a
-- size and at least one format; its surface and description default to none,
-- indoor to false and its order to 0.
--
-- Race with book_slot (left as it is): book_slot chooses pitches without
-- locking them. If it has read this pitch's old size and formats just before
-- this function locks the row, its booking_pitches insert waits on that lock
-- and goes ahead once this commits, so a new game can land on a pitch whose
-- size or formats changed a moment earlier. The other order is safe: once a
-- booking_pitches row is in, the lock here waits for it and
-- pitch_has_bookings then sees it. The window is the few milliseconds of one
-- booking, staff change sizes rarely, and the game is kept either way.
create or replace function public.save_pitch(
  p_venue_id uuid,
  p_pitch_id uuid,
  p_name text,
  p_size text,
  p_formats text[],
  p_surface text,
  p_indoor boolean,
  p_description text,
  p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pitch public.pitches;
  v_name text;
  v_size text;
  v_formats text[];
  v_sizes constant text[] := array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'];
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;

  if p_pitch_id is not null then
    select * into v_pitch from public.pitches where id = p_pitch_id and venue_id = p_venue_id for update;
    if v_pitch.id is null then
      raise exception 'pitch_not_found';
    end if;
  end if;

  -- Null keeps the saved value (none for a new pitch).
  v_name := btrim(coalesce(p_name, v_pitch.name));
  v_size := coalesce(p_size, v_pitch.size);
  v_formats := coalesce(p_formats, v_pitch.formats);

  if v_name is null or v_name = '' or v_size is null or not (v_size = any (v_sizes))
     or v_formats is null or cardinality(v_formats) = 0 or array_position(v_formats, null) is not null
     or not (v_formats <@ v_sizes) then
    raise exception 'invalid_pitch';
  end if;
  select array_agg(distinct f order by f) into v_formats from unnest(v_formats) f;

  if v_pitch.id is not null
     and (v_pitch.size <> v_size
          or (select array_agg(distinct f order by f) from unnest(v_pitch.formats) f) <> v_formats)
     and public.pitch_has_bookings(v_pitch.id, true) then
    raise exception 'pitch_has_future_bookings';
  end if;

  begin
    if v_pitch.id is null then
      insert into public.pitches (venue_id, name, size, formats, surface, indoor, description, sort_order)
      values (p_venue_id, v_name, v_size, v_formats, nullif(btrim(p_surface), ''), coalesce(p_indoor, false),
              nullif(btrim(p_description), ''), coalesce(p_sort_order, 0))
      returning id into v_id;
    else
      update public.pitches
      set name = v_name,
          size = v_size,
          formats = v_formats,
          surface = case when p_surface is null then v_pitch.surface else nullif(btrim(p_surface), '') end,
          indoor = coalesce(p_indoor, v_pitch.indoor),
          description = case when p_description is null then v_pitch.description
                             else nullif(btrim(p_description), '') end,
          sort_order = coalesce(p_sort_order, v_pitch.sort_order)
      where id = v_pitch.id
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'pitch_name_taken';
  end;

  return v_id;
end;
$$;

-- Opens or closes a pitch (maintenance). A closed pitch gets no new
-- bookings, alone or in a combination; games already on it stay on, and the
-- players still in those that haven't ended are told once for this closure
-- (pitchId), as for a block. Closing a pitch that is already closed, or
-- opening it, tells nobody; closing it again after reopening tells them
-- again. Another venue's pitch is pitch_not_found, as for an id that
-- doesn't exist.
create or replace function public.set_pitch_open(p_pitch_id uuid, p_open boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pitch public.pitches;
  v_affected uuid[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_of_any_venue() then
    raise exception 'not_venue_staff';
  end if;
  select p.* into v_pitch
  from public.pitches p
  join public.venues v on v.id = p.venue_id
  where p.id = p_pitch_id and public.is_venue_staff(v.id)
  for update of p;
  if v_pitch.id is null then
    raise exception 'pitch_not_found';
  end if;
  if p_open is null then
    raise exception 'invalid_setting';
  end if;
  if v_pitch.is_open = p_open then
    return;
  end if;

  update public.pitches set is_open = p_open where id = p_pitch_id;

  if not p_open then
    select array_agg(distinct bp.booking_id) into v_affected
    from public.booking_pitches bp
    where bp.pitch_id = p_pitch_id
      and upper(bp.slot) > (now() at time zone 'Asia/Nicosia');
    if v_affected is not null then
      perform public.notify_closed_new_bookings(v_pitch.venue_id, v_affected, jsonb_build_object('pitchId', p_pitch_id));
    end if;
  end if;
end;
$$;

-- Deletes a pitch that has never held a game (a cancelled game holds none),
-- with the combinations it is part of. A pitch that holds a game can only be
-- closed. Another venue's pitch is pitch_not_found, as for an id that
-- doesn't exist.
create or replace function public.delete_pitch(p_pitch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pitch public.pitches;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_of_any_venue() then
    raise exception 'not_venue_staff';
  end if;
  select p.* into v_pitch
  from public.pitches p
  join public.venues v on v.id = p.venue_id
  where p.id = p_pitch_id and public.is_venue_staff(v.id)
  for update of p;
  if v_pitch.id is null then
    raise exception 'pitch_not_found';
  end if;
  if public.pitch_has_bookings(p_pitch_id, false) then
    raise exception 'pitch_has_bookings';
  end if;

  delete from public.pitch_combinations where venue_id = v_pitch.venue_id and p_pitch_id = any (pitch_ids);
  delete from public.pitches where id = p_pitch_id;
end;
$$;

-- Says which of the venue's pitches combine for a format: two or more
-- different pitches, all the venue's own. Returns the combination id.
create or replace function public.add_pitch_combination(p_venue_id uuid, p_format text, p_pitch_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
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
  if p_pitch_ids is null or cardinality(p_pitch_ids) < 2
     or (select count(distinct x) from unnest(p_pitch_ids) x) <> cardinality(p_pitch_ids)
     or (select count(*) from public.pitches p where p.venue_id = p_venue_id and p.id = any (p_pitch_ids))
        <> cardinality(p_pitch_ids) then
    raise exception 'invalid_combination';
  end if;

  insert into public.pitch_combinations (venue_id, format, pitch_ids)
  values (p_venue_id, p_format, p_pitch_ids)
  returning id into v_id;
  return v_id;
end;
$$;

-- Removes a combination. Games that used it keep their own pitches. Another
-- venue's combination is combination_not_found, as for an id that doesn't
-- exist.
create or replace function public.remove_pitch_combination(p_combination_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_combination public.pitch_combinations;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_of_any_venue() then
    raise exception 'not_venue_staff';
  end if;
  select c.* into v_combination
  from public.pitch_combinations c
  join public.venues v on v.id = c.venue_id
  where c.id = p_combination_id and public.is_venue_staff(v.id)
  for update of c;
  if v_combination.id is null then
    raise exception 'combination_not_found';
  end if;

  delete from public.pitch_combinations where id = p_combination_id;
end;
$$;

revoke all on function public.venue_setup(uuid) from public, anon;
revoke all on function public.set_venue_hours(uuid, jsonb) from public, anon;
revoke all on function public.add_venue_closure(uuid, date, date, text) from public, anon;
revoke all on function public.remove_venue_closure(uuid) from public, anon;
revoke all on function public.set_price_rule(uuid, text, integer, integer, integer, smallint[], time, time, smallint[]) from public, anon;
revoke all on function public.remove_price_rule(uuid, text) from public, anon;
revoke all on function public.save_pitch(uuid, uuid, text, text, text[], text, boolean, text, integer) from public, anon;
revoke all on function public.set_pitch_open(uuid, boolean) from public, anon;
revoke all on function public.delete_pitch(uuid) from public, anon;
revoke all on function public.add_pitch_combination(uuid, text, uuid[]) from public, anon;
revoke all on function public.remove_pitch_combination(uuid) from public, anon;

grant execute on function public.venue_setup(uuid) to authenticated, service_role;
grant execute on function public.set_venue_hours(uuid, jsonb) to authenticated, service_role;
grant execute on function public.add_venue_closure(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.remove_venue_closure(uuid) to authenticated, service_role;
grant execute on function public.set_price_rule(uuid, text, integer, integer, integer, smallint[], time, time, smallint[]) to authenticated, service_role;
grant execute on function public.remove_price_rule(uuid, text) to authenticated, service_role;
grant execute on function public.save_pitch(uuid, uuid, text, text, text[], text, boolean, text, integer) to authenticated, service_role;
grant execute on function public.set_pitch_open(uuid, boolean) to authenticated, service_role;
grant execute on function public.delete_pitch(uuid) to authenticated, service_role;
grant execute on function public.add_pitch_combination(uuid, text, uuid[]) to authenticated, service_role;
grant execute on function public.remove_pitch_combination(uuid) to authenticated, service_role;
