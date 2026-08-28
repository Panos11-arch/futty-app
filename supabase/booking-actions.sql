-- Booking creation and cancellation.
-- Run AFTER supabase/venues.sql (needs the venues/venue_bookings tables and their
-- RLS already set up). Run in the Supabase dashboard: SQL Editor > New query > Run.
-- Safe to re-run.
--
-- Design note: venue_bookings gets NO insert/update/delete policy for
-- `authenticated` here, so RLS blocks writing to it directly. The only way in
-- is through book_slot() / cancel_booking() below, which run as the table
-- owner (security definer) and enforce the rules atomically:
--   - book_slot re-checks capacity *inside a locked transaction*, so two
--     people tapping the same last-available slot at the same instant can't
--     both succeed and overbook the venue (a plain client-side insert could).
--   - cancel_booking checks created_by = auth.uid(), so you can only cancel
--     your own bookings.

alter table public.venue_bookings add column if not exists created_by uuid references auth.users (id);

create index if not exists venue_bookings_created_by_idx on public.venue_bookings (created_by);

-- One active booking per user per exact (venue, day, start) — matches "book as
-- many different times/venues as you like, just not the exact same pitch, day
-- and time twice." Excludes cancelled rows so a cancelled slot can be rebooked.
create unique index if not exists venue_bookings_active_slot_per_user
  on public.venue_bookings (venue_id, booking_day, start_time, created_by)
  where status <> 'cancelled';

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
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_pitches integer;
  v_used integer;
  v_booking public.venue_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_day < current_date or (p_day = current_date and p_start <= current_time) then
    raise exception 'slot_in_past';
  end if;

  -- Locks the venue row for the rest of this transaction, so a second,
  -- concurrent call for the same venue waits here rather than reading the
  -- same "used" count and double-booking the last free pitch.
  select base_pitches into v_base_pitches
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

  begin
    insert into public.venue_bookings
      (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by)
    values
      (p_venue_id, p_day, p_start, p_end, p_pitches, p_capacity, p_format, 'confirmed', auth.uid())
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'duplicate_booking';
  end;

  return v_booking;
end;
$$;

grant execute on function public.book_slot(uuid, date, time, time, integer, integer, text) to authenticated;

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update public.venue_bookings
  set status = 'cancelled'
  where id = p_booking_id
    and created_by = auth.uid();

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'not_found';
  end if;
end;
$$;

grant execute on function public.cancel_booking(uuid) to authenticated;
