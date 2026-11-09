-- P3 venue model, part 2: book_slot and availability on real pitches.
--
-- - book_slot assigns pitches automatically (pick_pitches): the smallest
--   free pitch that hosts the format, then a combination; staff can move a
--   booking later (move_booking_pitches).
-- - booking_pitches' exclusion constraint makes double-booking a pitch
--   impossible; cancelling a booking releases its pitches.
-- - Prices come from price_rules (peak, off-peak, weekend), per half hour.
-- - Opening hours per weekday, closures and venue blocks. A block stops new
--   bookings only: existing games stay on and their players are notified
--   (venue_closed_new_bookings).
-- - Owner blocks (staff walk-in or phone bookings held as venue_bookings rows)
--   hold real pitches too.
-- Everything P2 enforces stays, in the same order and with the same errors.

-- The slot a booking holds, as a timestamp range in Cyprus wall-clock time.
-- An end of 24:00 is midnight at the end of the day.
create or replace function public.booking_slot_range(p_day date, p_start time, p_end time)
returns tsrange
language sql
immutable
set search_path = ''
as $$
  select tsrange(p_day + p_start, p_day + p_end, '[)');
$$;

-- Is this pitch (or the whole venue) blocked at any time in the slot?
create or replace function public.slot_is_blocked(p_venue_id uuid, p_pitch_ids uuid[], p_day date, p_start time, p_end time)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.venue_blocks b
    where b.venue_id = p_venue_id
      and b.block_day = p_day
      and (b.pitch_id is null or b.pitch_id = any (p_pitch_ids))
      and (b.starts_at is null or (b.starts_at < p_end and b.ends_at > p_start))
  );
$$;

-- The pitch(es) a new game of this format would get, or null if none is
-- free. Single pitches that host the format come first, smallest first (so a
-- 7-a-side pitch isn't used up by a 5-a-side game), then combinations; ties
-- go to the venue's own pitch order. Closed pitches are never used.
-- p_five_a_side_pitches_only is for 6 v 6 on a 5-a-side pitch.
create or replace function public.pick_pitches(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_format text,
  p_five_a_side_pitches_only boolean default false,
  p_ignore_blocks boolean default false
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select array[p.id] as pitch_ids, 0 as kind, public.format_player_count(p.size) as size_rank, p.sort_order as ord
    from public.pitches p
    where p.venue_id = p_venue_id
      and p.is_open
      and p_format = any (p.formats)
      and (not p_five_a_side_pitches_only or p.size = '5-a-side')
    union all
    select c.pitch_ids, 1, 0,
           (select min(p.sort_order) from public.pitches p where p.id = any (c.pitch_ids))
    from public.pitch_combinations c
    where c.venue_id = p_venue_id
      and c.format = p_format
      and not p_five_a_side_pitches_only
      and (select count(*) from public.pitches p
           where p.id = any (c.pitch_ids) and p.venue_id = p_venue_id and p.is_open) = cardinality(c.pitch_ids)
  )
  select c.pitch_ids
  from candidates c
  where not exists (
      select 1 from public.booking_pitches bp
      where bp.pitch_id = any (c.pitch_ids)
        and bp.slot && public.booking_slot_range(p_day, p_start, p_end)
    )
    and (p_ignore_blocks or not public.slot_is_blocked(p_venue_id, c.pitch_ids, p_day, p_start, p_end))
  order by c.kind, c.size_rank, c.ord
  limit 1;
$$;

-- Any p_count pitches free at that time, in the venue's order (owner blocks,
-- and bookings made before P3). Staff decide, so closed pitches and blocks
-- don't stop them. Null if there aren't enough.
create or replace function public.pick_any_pitches(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_count integer,
  p_exclude_booking uuid default null
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = p_count then array_agg(id order by sort_order, name) end
  from (
    select p.id, p.sort_order, p.name
    from public.pitches p
    where p.venue_id = p_venue_id
      and not exists (
        select 1 from public.booking_pitches bp
        where bp.pitch_id = p.id
          and bp.booking_id is distinct from p_exclude_booking
          and bp.slot && public.booking_slot_range(p_day, p_start, p_end)
      )
    order by p.sort_order, p.name
    limit greatest(p_count, 0)
  ) as free;
$$;

-- The pitch price for one game of the format, in cents: each half hour at
-- its own band. Weekend = Saturday and Sunday all day; peak = weekdays from
-- venues.peak_starts until peak_ends (null = closing); otherwise off-peak.
-- Null when the venue has no price for the format. Slots are on the
-- 30-minute grid (book_slot checks that first).
create or replace function public.slot_price_cents(p_venue_id uuid, p_day date, p_start time, p_end time, p_format text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.price_rules;
  v_peak_starts time;
  v_peak_ends time;
  v_weekend boolean := extract(isodow from p_day) in (6, 7);
  v_half_hours integer := 0;
  v_slice timestamp;
  v_total bigint := 0;
begin
  select * into v_rule from public.price_rules where venue_id = p_venue_id and format = p_format;
  if v_rule.venue_id is null then
    return null;
  end if;
  select peak_starts, peak_ends into v_peak_starts, v_peak_ends from public.venues where id = p_venue_id;

  for v_slice in
    select generate_series(p_day + p_start, p_day + p_end - interval '30 minutes', interval '30 minutes')
  loop
    v_half_hours := v_half_hours + 1;
    v_total := v_total + case
      when v_weekend then v_rule.weekend_cents
      when v_slice::time >= v_peak_starts and (v_peak_ends is null or v_slice::time < v_peak_ends) then v_rule.peak_cents
      else v_rule.offpeak_cents
    end;
  end loop;

  -- Each half hour costs half the hourly price.
  return round(v_total / 2.0)::integer;
end;
$$;

-- The venue's opening hours on that day: null when it's shut (no hours for
-- that weekday, or a closure covers the day).
create or replace function public.venue_hours_on(p_venue_id uuid, p_day date, out opens time, out closes time, out closed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select h.opens, h.closes,
         exists (select 1 from public.venue_closures c
                 where c.venue_id = p_venue_id and p_day between c.starts_on and c.ends_on)
  from (select 1) as one
  left join public.opening_hours h on h.venue_id = p_venue_id and h.weekday = extract(isodow from p_day);
$$;

create or replace function public.book_slot(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitches integer,
  p_format text,
  p_players_per_side integer default 5
)
returns public.venue_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_window_days integer;
  v_hours record;
  v_six_on_five boolean;
  v_capacity integer;
  v_pitch_ids uuid[];
  v_amount_cents integer;
  v_status text;
  v_booking public.venue_bookings;
  v_share_cents integer;
  v_booker_share_cents integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Locking the venue serialises bookings there; booking_pitches' exclusion
  -- constraint is the backstop.
  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue.id is null then
    raise exception 'venue_not_found';
  end if;
  if not v_venue.is_live then
    raise exception 'venue_not_live';
  end if;

  -- Cyprus time, not the server's UTC.
  if p_day < v_now::date or (p_day = v_now::date and p_start <= v_now::time) then
    raise exception 'slot_in_past';
  end if;

  -- Day 0 is today in Cyprus. Premium comes only from profiles.is_premium.
  v_window_days := case
    when exists (select 1 from public.profiles where id = auth.uid() and is_premium) then 14
    else 7
  end;
  if p_day - v_now::date > v_window_days then
    raise exception 'beyond_booking_window';
  end if;

  -- The app still sends how many pitches it thinks the format needs. The
  -- server picks the actual pitches below; this only refuses nonsense.
  if p_pitches is null or p_pitches < 1
     or p_pitches > (select count(*) from public.pitches where venue_id = p_venue_id) then
    raise exception 'invalid_pitches';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;

  if extract(minute from p_start) not in (0, 30) or extract(second from p_start) <> 0
     or extract(minute from p_end) not in (0, 30) or extract(second from p_end) <> 0 then
    raise exception 'slot_not_on_grid';
  end if;

  select * into v_hours from public.venue_hours_on(p_venue_id, p_day);
  if v_hours.closed then
    raise exception 'venue_closed';
  end if;
  if v_hours.opens is null or p_start < v_hours.opens or p_end > v_hours.closes then
    raise exception 'outside_opening_hours';
  end if;

  -- A format the venue offers: a pitch that hosts it, or a combination.
  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')
     or not (
       exists (select 1 from public.pitches where venue_id = p_venue_id and p_format = any (formats))
       or exists (select 1 from public.pitch_combinations where venue_id = p_venue_id and format = p_format)
     ) then
    raise exception 'invalid_format';
  end if;

  -- 6 v 6 on a 5-a-side pitch needs the venue's flag. A real 6-a-side pitch
  -- is its own format (12 players either way) and doesn't.
  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    raise exception 'invalid_players_per_side';
  end if;
  v_six_on_five := p_players_per_side = 6 and p_format = '5-a-side';
  if p_players_per_side = 6 and p_format <> '6-a-side' and (p_format <> '5-a-side' or not v_venue.allows_6v6_on_5s) then
    raise exception 'six_a_side_not_allowed';
  end if;
  v_capacity := case when v_six_on_five then 12 else public.format_player_count(p_format) * 2 end;

  -- Prices come from the venue's data on the server, never from the app.
  v_amount_cents := public.slot_price_cents(p_venue_id, p_day, p_start, p_end, p_format);
  if v_amount_cents is null then
    raise exception 'price_not_set';
  end if;

  v_pitch_ids := public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five);
  if v_pitch_ids is null then
    if public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format, v_six_on_five, p_ignore_blocks => true) is not null then
      raise exception 'slot_blocked';
    end if;
    raise exception 'slot_full';
  end if;

  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by,
       amount_cents, service_fee_cents_per_player)
    values
      (p_venue_id, p_day, p_start, p_end, cardinality(v_pitch_ids), v_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.service_fee_cents() end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  begin
    insert into public.booking_pitches (booking_id, pitch_id, slot)
    select v_booking.id, unnest(v_pitch_ids), public.booking_slot_range(p_day, p_start, p_end);
  exception when exclusion_violation then
    raise exception 'slot_full';
  end;

  -- Split the pitch price evenly across everyone on the pitch; the leftover
  -- cents from integer division go to the booker. Every player, booker
  -- included, then adds the service fee. (P4a moves this into the money
  -- module and adds the booking modes.)
  if v_amount_cents > 0 then
    v_share_cents := v_amount_cents / v_capacity;
    v_booker_share_cents := v_amount_cents - v_share_cents * (v_capacity - 1) + public.service_fee_cents();

    insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
    values (v_booking.id, auth.uid(), v_booker_share_cents, true, 'pending');
  end if;

  return v_booking;
end;
$$;

revoke all on function public.book_slot(uuid, date, time, time, integer, text, integer) from public, anon;
grant execute on function public.book_slot(uuid, date, time, time, integer, text, integer) to authenticated, service_role;

-- Owner blocks: the checks that need no pitches stay BEFORE the write; the
-- pitches are assigned AFTER it (sync_booking_pitches), when the row exists.
create or replace function public.check_owner_block_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
begin
  if new.booking_type is distinct from 'owner_block' then
    return new;
  end if;

  select owner_profile_id into v_owner from public.venues where id = new.venue_id for update;
  if not found then
    raise exception 'venue_not_found';
  end if;

  -- Requests from the app carry a user; only the venue's owner may block it.
  -- Service-role jobs (no user) are trusted.
  if auth.uid() is not null and v_owner is distinct from auth.uid() then
    raise exception 'not_your_venue';
  end if;

  if new.status = 'cancelled' or not public.booking_was_moved(tg_op, new, old) then
    return new;
  end if;

  if new.booking_day < v_now::date or (new.booking_day = v_now::date and new.start_time <= v_now::time) then
    raise exception 'slot_in_past';
  end if;
  if new.pitches is null or new.pitches < 1 or new.end_time <= new.start_time then
    raise exception 'invalid_block';
  end if;

  return new;
end;
$$;

-- Did this write put the booking somewhere new (or bring it back)?
create or replace function public.booking_was_moved(p_op text, p_new public.venue_bookings, p_old public.venue_bookings)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_op = 'INSERT'
    or p_new.venue_id is distinct from p_old.venue_id
    or p_new.booking_day is distinct from p_old.booking_day
    or p_new.start_time is distinct from p_old.start_time
    or p_new.end_time is distinct from p_old.end_time
    or p_new.pitches is distinct from p_old.pitches
    or p_old.status = 'cancelled';
$$;

-- Keeps booking_pitches in step with venue_bookings:
-- - cancelled: release the pitches;
-- - owner block placed, moved or reinstated: take any free pitches;
-- - a player's booking reinstated: pitches for its format again;
-- - a player's booking moved in time: same pitches, new time.
-- book_slot assigns a new player's booking itself.
create or replace function public.sync_booking_pitches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pitch_ids uuid[];
begin
  if new.status = 'cancelled' then
    delete from public.booking_pitches where booking_id = new.id;
    return null;
  end if;

  if not public.booking_was_moved(tg_op, new, old) then
    return null;
  end if;

  if new.booking_type = 'owner_block' then
    v_pitch_ids := public.pick_any_pitches(new.venue_id, new.booking_day, new.start_time, new.end_time, new.pitches, new.id);
  elsif tg_op = 'INSERT' then
    return null;
  elsif old.status = 'cancelled' then
    v_pitch_ids := public.pick_pitches(new.venue_id, new.booking_day, new.start_time, new.end_time, new.format,
                                       new.capacity = 12 and new.format = '5-a-side', p_ignore_blocks => true);
  else
    begin
      update public.booking_pitches
      set slot = public.booking_slot_range(new.booking_day, new.start_time, new.end_time)
      where booking_id = new.id;
    exception when exclusion_violation then
      raise exception 'slot_full';
    end;
    return null;
  end if;

  if v_pitch_ids is null then
    raise exception 'slot_full';
  end if;
  delete from public.booking_pitches where booking_id = new.id;
  begin
    insert into public.booking_pitches (booking_id, pitch_id, slot)
    select new.id, unnest(v_pitch_ids), public.booking_slot_range(new.booking_day, new.start_time, new.end_time);
  exception when exclusion_violation then
    raise exception 'slot_full';
  end;
  return null;
end;
$$;

drop trigger if exists on_booking_sync_pitches on public.venue_bookings;
create trigger on_booking_sync_pitches
  after insert or update on public.venue_bookings
  for each row execute function public.sync_booking_pitches();

-- Staff move a booking to other pitches. The new pitches must be the
-- venue's, make a valid layout for the game (one pitch that hosts the
-- format, or a combination for it; an owner block keeps its pitch count)
-- and be free. Staff may use a closed or blocked pitch.
create or replace function public.move_booking_pitches(p_booking_id uuid, p_pitch_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_owner uuid;
  v_valid boolean;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  select owner_profile_id into v_owner from public.venues where id = v_booking.venue_id for update;
  if auth.uid() is not null and v_owner is distinct from auth.uid() then
    raise exception 'not_your_venue';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;

  if p_pitch_ids is null or cardinality(p_pitch_ids) = 0
     or (select count(distinct x) from unnest(p_pitch_ids) as x) <> cardinality(p_pitch_ids)
     or (select count(*) from public.pitches where id = any (p_pitch_ids) and venue_id = v_booking.venue_id)
        <> cardinality(p_pitch_ids) then
    raise exception 'invalid_pitches';
  end if;

  v_valid := case
    when v_booking.booking_type = 'owner_block' then cardinality(p_pitch_ids) = v_booking.pitches
    else (
      cardinality(p_pitch_ids) = 1 and exists (
        select 1 from public.pitches p
        where p.id = p_pitch_ids[1]
          and v_booking.format = any (p.formats)
          -- 6 v 6 on a 5-a-side pitch stays on a 5-a-side pitch.
          and (not (v_booking.capacity = 12 and v_booking.format = '5-a-side') or p.size = '5-a-side')
      )
    ) or (
      not (v_booking.capacity = 12 and v_booking.format = '5-a-side')
      and exists (
        select 1 from public.pitch_combinations c
        where c.venue_id = v_booking.venue_id and c.format = v_booking.format
          and c.pitch_ids @> p_pitch_ids and c.pitch_ids <@ p_pitch_ids
      )
    )
  end;
  if not v_valid then
    raise exception 'invalid_pitches';
  end if;

  delete from public.booking_pitches where booking_id = p_booking_id;
  begin
    insert into public.booking_pitches (booking_id, pitch_id, slot)
    select p_booking_id, unnest(p_pitch_ids),
           public.booking_slot_range(v_booking.booking_day, v_booking.start_time, v_booking.end_time);
  exception when exclusion_violation then
    raise exception 'slot_full';
  end;

  if v_booking.booking_type <> 'owner_block' and v_booking.pitches <> cardinality(p_pitch_ids) then
    update public.venue_bookings set pitches = cardinality(p_pitch_ids) where id = p_booking_id;
  end if;
end;
$$;

-- Venue blocks: the pitch must be the venue's, and only the venue's owner
-- (or Futty, with no user) may write one. RLS says the same; this also
-- covers the service role and catches a pitch from another venue.
create or replace function public.check_venue_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not exists (select 1 from public.venues where id = new.venue_id and owner_profile_id = auth.uid()) then
    raise exception 'not_your_venue';
  end if;
  if new.pitch_id is not null
     and not exists (select 1 from public.pitches where id = new.pitch_id and venue_id = new.venue_id) then
    raise exception 'invalid_pitches';
  end if;
  return new;
end;
$$;

drop trigger if exists on_venue_block_check on public.venue_blocks;
create trigger on_venue_block_check
  before insert or update on public.venue_blocks
  for each row execute function public.check_venue_block();

-- A block stops new bookings only. Games already booked in it stay on, and
-- everyone in them (the booker and every player holding a share) is told
-- once that the venue has closed new bookings.
create or replace function public.notify_venue_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_name text;
  v_row record;
begin
  select name into v_venue_name from public.venues where id = new.venue_id;

  for v_row in
    select distinct on (b.id, player.profile_id) b.id as booking_id, b.booking_day, b.start_time, player.profile_id
    from public.venue_bookings b
    cross join lateral (
      select b.created_by as profile_id
      union
      select s.profile_id from public.booking_payment_shares s where s.booking_id = b.id
    ) as player
    where b.venue_id = new.venue_id
      and b.booking_day = new.block_day
      and b.booking_type = 'user_booking'
      and b.status <> 'cancelled'
      and (new.starts_at is null or (b.start_time < new.ends_at and b.end_time > new.starts_at))
      and (new.pitch_id is null
           or exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id and bp.pitch_id = new.pitch_id))
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
        'venueId', new.venue_id,
        'blockId', new.id
      )
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists on_venue_block_notify on public.venue_blocks;
create trigger on_venue_block_notify
  after insert on public.venue_blocks
  for each row execute function public.notify_venue_block();

-- Bookable slots for a format on a day, with their price: inside that
-- day's hours, not closed, not in the past (Cyprus time), and with a free,
-- unblocked pitch (or combination) for the whole game. Every 30 minutes;
-- p_minutes long. This is the availability the app should show.
create or replace function public.venue_free_slots(
  p_venue_id uuid,
  p_day date,
  p_format text,
  p_minutes integer default 60,
  p_players_per_side integer default 5
)
returns table (start_time time, end_time time, price_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
  v_hours record;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_six_on_five boolean := p_players_per_side = 6 and p_format = '5-a-side';
  v_at timestamp;
  v_end timestamp;
begin
  select * into v_venue from public.venues where id = p_venue_id;
  if v_venue.id is null or not v_venue.is_live or p_minutes is null or p_minutes < 30 or p_minutes % 30 <> 0 then
    return;
  end if;
  if v_six_on_five and not v_venue.allows_6v6_on_5s then
    return;
  end if;
  select * into v_hours from public.venue_hours_on(p_venue_id, p_day);
  if v_hours.closed or v_hours.opens is null then
    return;
  end if;

  v_at := p_day + v_hours.opens;
  while v_at + make_interval(mins => p_minutes) <= p_day + v_hours.closes loop
    v_end := v_at + make_interval(mins => p_minutes);
    start_time := v_at::time;
    end_time := case when v_end = p_day + 1 then time '24:00' else v_end::time end;
    if v_at > v_now
       and public.pick_pitches(p_venue_id, p_day, start_time, end_time, p_format, v_six_on_five) is not null then
      price_cents := public.slot_price_cents(p_venue_id, p_day, start_time, end_time, p_format);
      if price_cents is not null then
        return next;
      end if;
    end if;
    v_at := v_at + interval '30 minutes';
  end loop;
end;
$$;

-- For app builds before P3: time ranges with how many of the venue's
-- pitches are unavailable (bookings, blocks, closed pitches, closures). The
-- old app subtracts these from base_pitches. Still no booker, team or amount.
create or replace function public.venue_day_availability(target_venue uuid, target_day date)
returns table (start_time time, end_time time, pitches integer)
language sql
stable
security definer
set search_path = ''
as $$
  with all_pitches as (
    select count(*)::integer as n from public.pitches where venue_id = target_venue
  )
  select b.start_time, b.end_time, b.pitches
  from public.venue_bookings b
  where b.venue_id = target_venue
    and b.booking_day = target_day
    and coalesce(b.status, '') <> 'cancelled'
  union all
  select coalesce(k.starts_at, time '00:00'), coalesce(k.ends_at, time '24:00'),
         case when k.pitch_id is null then (select n from all_pitches) else 1 end
  from public.venue_blocks k
  where k.venue_id = target_venue and k.block_day = target_day
  union all
  select time '00:00', time '24:00', 1
  from public.pitches p
  where p.venue_id = target_venue and not p.is_open
  union all
  select time '00:00', time '24:00', (select n from all_pitches)
  where exists (select 1 from public.venue_closures c
                where c.venue_id = target_venue and target_day between c.starts_on and c.ends_on);
$$;

-- Internal helpers: only the functions above call them.
revoke all on function public.booking_slot_range(date, time, time) from public, anon;
revoke all on function public.booking_was_moved(text, public.venue_bookings, public.venue_bookings) from public, anon, authenticated;
grant execute on function public.booking_slot_range(date, time, time) to authenticated, service_role;
revoke all on function public.slot_is_blocked(uuid, uuid[], date, time, time) from public, anon, authenticated;
revoke all on function public.pick_pitches(uuid, date, time, time, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.pick_any_pitches(uuid, date, time, time, integer, uuid) from public, anon, authenticated;
revoke all on function public.venue_hours_on(uuid, date) from public, anon, authenticated;
revoke all on function public.check_venue_block() from public, anon, authenticated;
revoke all on function public.notify_venue_block() from public, anon, authenticated;
revoke all on function public.sync_booking_pitches() from public, anon, authenticated;
grant execute on function public.slot_is_blocked(uuid, uuid[], date, time, time) to service_role;
grant execute on function public.pick_pitches(uuid, date, time, time, text, boolean, boolean) to service_role;
grant execute on function public.pick_any_pitches(uuid, date, time, time, integer, uuid) to service_role;
grant execute on function public.venue_hours_on(uuid, date) to service_role;

-- What the app may call.
revoke all on function public.slot_price_cents(uuid, date, time, time, text) from public, anon;
revoke all on function public.venue_free_slots(uuid, date, text, integer, integer) from public, anon;
revoke all on function public.move_booking_pitches(uuid, uuid[]) from public, anon;
grant execute on function public.slot_price_cents(uuid, date, time, time, text) to authenticated, service_role;
grant execute on function public.venue_free_slots(uuid, date, text, integer, integer) to authenticated, service_role;
grant execute on function public.move_booking_pitches(uuid, uuid[]) to authenticated, service_role;

-- Bookings made before P3 that haven't been played yet get pitches, in the
-- order they were made, the same number they held in the pooled model.
-- Any that can't be placed (the pooled model allowed it, the real pitches
-- don't) are reported as warnings in the migration output for the founders
-- to move by hand with move_booking_pitches; nothing is cancelled. Returns
-- how many couldn't be placed. Safe to run again: it skips bookings that
-- already hold pitches.
create or replace function public.assign_legacy_booking_pitches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.venue_bookings;
  v_pitch_ids uuid[];
  v_unplaced integer := 0;
begin
  for v_row in
    select * from public.venue_bookings b
    where coalesce(b.status, '') <> 'cancelled'
      and b.booking_day >= (now() at time zone 'Asia/Nicosia')::date
      and not exists (select 1 from public.booking_pitches bp where bp.booking_id = b.id)
    order by b.created_at, b.id
  loop
    v_pitch_ids := public.pick_any_pitches(v_row.venue_id, v_row.booking_day, v_row.start_time, v_row.end_time,
                                           greatest(v_row.pitches, 1));
    if v_pitch_ids is null then
      v_unplaced := v_unplaced + 1;
      raise warning 'P3 backfill: booking % (venue %, % %-%) could not be given pitches',
        v_row.id, v_row.venue_id, v_row.booking_day, v_row.start_time, v_row.end_time;
    else
      insert into public.booking_pitches (booking_id, pitch_id, slot)
      select v_row.id, unnest(v_pitch_ids), public.booking_slot_range(v_row.booking_day, v_row.start_time, v_row.end_time);
    end if;
  end loop;
  return v_unplaced;
end;
$$;

revoke all on function public.assign_legacy_booking_pitches() from public, anon, authenticated;
grant execute on function public.assign_legacy_booking_pitches() to service_role;

select public.assign_legacy_booking_pitches();
