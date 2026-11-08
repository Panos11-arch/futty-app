-- Cyprus time for every "has this already started?" check (7 Nov 2026).
--
-- Run AFTER flat-service-fee.sql, in the Supabase dashboard:
-- SQL Editor > New query > Run. Safe to re-run.
--
-- The problem: Supabase's database clock runs on UTC. Cyprus is UTC+2 in
-- winter and UTC+3 in summer, while venue_bookings.booking_day/start_time
-- are Cyprus wall-clock times. book_slot compared them with current_date /
-- current_time (UTC), so at 19:00 in Nicosia a slot that started at 18:00
-- still looked like it was in the future and could be booked.
--
-- The fix, in two layers:
--   1. The database's default time zone becomes Cyprus, so current_date,
--      current_time and "date + time" comparisons mean Cyprus time
--      everywhere, including functions that live only in the dashboard and
--      aren't in this repo (the owner-block trigger in venue-owners.sql, the
--      league functions, ...). Stored timestamps don't change: timestamptz is
--      one instant, only how it's printed changes (+02 instead of +00).
--      pg_cron schedules are unaffected: they use their own cron.timezone
--      (UTC on Supabase).
--   2. book_slot, the function that takes money, doesn't rely on that
--      setting: it converts now() to Cyprus time explicitly, so it stays
--      right even on a connection opened before step 1.
--
-- Tests: supabase/tests/cyprus-time.test.sql (runs in CI on every PR).

-- ---------------------------------------------------------------------------
-- 1. Cyprus is the database's time zone. New connections pick this up;
--    connections already open keep UTC until they're recycled.
-- ---------------------------------------------------------------------------
-- (current_database() is "postgres" on Supabase; written this way so the
-- same file also works on the test database.)
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Nicosia');
end $$;

-- ---------------------------------------------------------------------------
-- 2. book_slot: the live definition from flat-service-fee.sql, with only
--    the "in the past" check changed to Cyprus time.
-- ---------------------------------------------------------------------------
create or replace function public.book_slot(
  p_venue_id uuid, p_day date, p_start time without time zone, p_end time without time zone,
  p_pitches integer, p_capacity integer, p_format text
)
returns public.venue_bookings
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_base_pitches integer;
  v_price numeric;
  v_used integer;
  v_amount_cents integer;
  v_status text;
  v_booking public.venue_bookings;
  v_players integer;
  v_share_cents integer;
  v_booker_share_cents integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Cyprus time, not the server's UTC (see supabase/legacy/cyprus-time.sql).
  if p_day < (now() at time zone 'Asia/Nicosia')::date
     or (p_day = (now() at time zone 'Asia/Nicosia')::date
         and p_start <= (now() at time zone 'Asia/Nicosia')::time) then
    raise exception 'slot_in_past';
  end if;

  select base_pitches, price_per_pitch_hour into v_base_pitches, v_price
  from public.venues
  where id = p_venue_id
  for update;

  if v_base_pitches is null then
    raise exception 'venue_not_found';
  end if;

  select coalesce(sum(pitches), 0) into v_used
  from public.venue_bookings
  where venue_id = p_venue_id
    and booking_day = p_day
    and status <> 'cancelled'
    and start_time < p_end
    and end_time > p_start;

  if v_base_pitches - v_used < p_pitches then
    raise exception 'slot_full';
  end if;

  -- Venue price only. The service fee is added per player below.
  v_amount_cents := case
    when v_price is null or v_price = 0 then 0
    else round(v_price * p_pitches * (extract(epoch from (p_end - p_start)) / 3600.0) * 100)::integer
  end;
  v_status := case when v_amount_cents = 0 then 'confirmed' else 'pending_payment' end;

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by,
       amount_cents, service_fee_cents_per_player)
    values
      (p_venue_id, p_day, p_start, p_end, p_pitches, p_capacity, p_format, v_status, auth.uid(),
       v_amount_cents, case when v_amount_cents > 0 then public.service_fee_cents() end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  -- Split the venue price evenly across everyone on the pitch (the
  -- booking's capacity: 10 for 5 v 5, and so on); the leftover cents from
  -- integer division go to the booker, per spec. Every player, booker
  -- included, then adds the service fee.
  if v_amount_cents > 0 then
    v_players := coalesce(p_capacity, public.format_player_count(p_format) * 2);
    v_share_cents := v_amount_cents / v_players;
    v_booker_share_cents := v_amount_cents - v_share_cents * (v_players - 1)
                            + public.service_fee_cents();

    insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
    values (v_booking.id, auth.uid(), v_booker_share_cents, true, 'pending');
  end if;

  return v_booking;
end;
$function$;

revoke execute on function public.book_slot(uuid, date, time, time, integer, integer, text) from public, anon;
grant execute on function public.book_slot(uuid, date, time, time, integer, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- VERIFY: open a NEW query tab (this one still has the old setting) and run:
--
--   show timezone;   -- expect Asia/Nicosia
--   select now(), current_date, current_time;   -- expect Cyprus date and time
--
-- Functions that still use current_date / current_time. They're now correct
-- through step 1; this list is just so we know where they are:
--
--   select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.prosrc ~* '\mcurrent_(date|time)\M|localtime'
--   order by 1;
-- ---------------------------------------------------------------------------
