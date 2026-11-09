-- P2 rules 1-4 in book_slot: a sensible slot, player numbers from the
-- server, the booking window, and live venues only.
--
-- The app no longer sends a capacity. It sends p_players_per_side (5, or 6
-- for 6 v 6 on a 5-a-side pitch) and the server derives everyone on the pitch:
-- 10 / 14 / 18 / 22 per format, 12 for 6 v 6.

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
  v_closes time;
  v_capacity integer;
  v_used integer;
  v_amount_cents integer;
  v_status text;
  v_booking public.venue_bookings;
  v_share_cents integer;
  v_booker_share_cents integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

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

  -- Day 0 is today in Cyprus. Premium comes only from profiles.is_premium,
  -- which the app can't write (set from Apple's verified purchase).
  v_window_days := case
    when exists (select 1 from public.profiles where id = auth.uid() and is_premium) then 14
    else 7
  end;
  if p_day - v_now::date > v_window_days then
    raise exception 'beyond_booking_window';
  end if;

  if p_pitches is null or p_pitches < 1 or p_pitches > v_venue.base_pitches then
    raise exception 'invalid_pitches';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;

  if extract(minute from p_start) not in (0, 30) or extract(second from p_start) <> 0
     or extract(minute from p_end) not in (0, 30) or extract(second from p_end) <> 0 then
    raise exception 'slot_not_on_grid';
  end if;

  -- close_time at or before open_time means the venue closes at midnight
  -- (or later, on the next calendar day). P3 replaces this with per-weekday
  -- opening hours.
  v_closes := case when v_venue.close_time <= v_venue.open_time then time '24:00' else v_venue.close_time end;
  if p_start < v_venue.open_time or p_end > v_closes then
    if not (v_venue.close_time < v_venue.open_time and v_venue.close_time <> time '00:00'
            and p_end <= v_venue.close_time) then
      raise exception 'outside_opening_hours';
    end if;
  end if;

  -- P3 adds which formats each pitch hosts; until then any real format.
  if p_format is null or p_format not in ('5-a-side', '7-a-side', '9-a-side', '11-a-side') then
    raise exception 'invalid_format';
  end if;

  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    raise exception 'invalid_players_per_side';
  end if;
  if p_players_per_side = 6 and (p_format <> '5-a-side' or not v_venue.allows_6v6_on_5s) then
    raise exception 'six_a_side_not_allowed';
  end if;
  v_capacity := case when p_players_per_side = 6 then 12 else public.format_player_count(p_format) * 2 end;

  select coalesce(sum(pitches), 0) into v_used
  from public.venue_bookings
  where venue_id = p_venue_id
    and booking_day = p_day
    and status <> 'cancelled'
    and start_time < p_end
    and end_time > p_start;

  if v_venue.base_pitches - v_used < p_pitches then
    raise exception 'slot_full';
  end if;

  -- Venue price only. The service fee is added per player below.
  v_amount_cents := case
    when v_venue.price_per_pitch_hour is null or v_venue.price_per_pitch_hour = 0 then 0
    else round(v_venue.price_per_pitch_hour * p_pitches * (extract(epoch from (p_end - p_start)) / 3600.0) * 100)::integer
  end;
  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by,
       amount_cents, service_fee_cents_per_player)
    values
      (p_venue_id, p_day, p_start, p_end, p_pitches, v_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.service_fee_cents() end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  -- Split the venue price evenly across everyone on the pitch; the leftover
  -- cents from integer division go to the booker. Every player, booker
  -- included, then adds the service fee.
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

-- App builds released before this change still call the old signature with
-- p_capacity. Keep it working, but never trust the number: it books 5 per
-- side (the only option those builds offered) with everything checked above.
create or replace function public.book_slot(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_pitches integer,
  p_capacity integer,
  p_format text
)
returns public.venue_bookings
language sql
set search_path = ''
as $$
  select public.book_slot(p_venue_id, p_day, p_start, p_end, p_pitches, p_format, 5);
$$;

comment on function public.book_slot(uuid, date, time, time, integer, integer, text) is
  'Deprecated: for app builds before P2. p_capacity is ignored; use the p_players_per_side version.';
