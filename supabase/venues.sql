-- Read policies for the booking screen.
-- Run in the Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- Both tables already have RLS enabled with no policy that lets the app read
-- them, so the booking screen sees zero venues until this runs.

alter table public.venues enable row level security;
alter table public.venue_bookings enable row level security;

-- 1. Venues are a public catalogue — nothing here is user data.
--    Signed-in users only, since the app requires an account to reach this screen.
drop policy if exists "Signed-in users can read venues" on public.venues;
create policy "Signed-in users can read venues"
  on public.venues for select
  to authenticated
  using (true);

-- 2. Bookings must be readable to compute availability: the client subtracts
--    booked pitches from base_pitches to decide which slots are open.
--
--    NOTE ON PRIVACY: row level security cannot restrict *columns*, so this lets
--    any signed-in user read every column of every booking, including team_id.
--    That is fine if bookings are public information in your product. If not,
--    delete this policy and use the narrowed function in section 3 instead,
--    which exposes only the three fields availability actually needs.
drop policy if exists "Signed-in users can read bookings" on public.venue_bookings;
create policy "Signed-in users can read bookings"
  on public.venue_bookings for select
  to authenticated
  using (true);

-- 3. Optional privacy-preserving alternative to section 2.
--    Returns only the availability-relevant fields, so team_id and any future
--    columns stay hidden. To use it, drop the policy above and change
--    lib/use-day-bookings.ts to call this instead of querying the table.
create or replace function public.venue_day_availability(
  target_venue uuid,
  target_day date
)
returns table (start_time time, end_time time, pitches integer)
language sql
security definer
set search_path = ''
stable
as $$
  select b.start_time, b.end_time, b.pitches
  from public.venue_bookings b
  where b.venue_id = target_venue
    and b.booking_day = target_day
    and coalesce(b.status, '') <> 'cancelled';
$$;

grant execute on function public.venue_day_availability(uuid, date) to authenticated;
