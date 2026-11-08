-- Seed data for the booking screen, taken from the prototype's VENUES array
-- (futty-app_2.jsx lines 63-80) so on-screen numbers match the logic tests.
--
-- Run in the Supabase dashboard: SQL Editor > New query > Run.
-- Safe to re-run: every insert is guarded, so nothing duplicates.

-- 1. The eight venues.
--    Keyed on name because there is no unique constraint to conflict against.
insert into public.venues
  (name, city, surface, base_pitches, open_time, close_time, price_per_pitch_hour)
select v.name, v.city, v.surface, v.base_pitches, v.open_time, v.close_time, v.price
from (values
  ('Nuevo Campo',                          'Nicosia',  'Mini football',      2, time '15:00', time '23:00', 32),
  ('Central Park Fields (English School)',  'Nicosia',  '3G Astro',           3, time '07:00', time '23:00', 28),
  ('Valley Sports Arena',                   'Limassol', '8/9-a-side Astro',   4, time '10:00', time '22:00', 34),
  ('Wembley Ypsonas Mini Football',         'Limassol', '3G (5s & 9s)',       3, time '09:00', time '23:00', 30),
  ('Lanitio Mini Football',                 'Limassol', 'Mini football',      2, time '14:30', time '23:00', 26),
  ('Kamares Futsal',                        'Larnaca',  'Futsal',             2, time '08:00', time '23:00', 30),
  ('Livadia Futsal Club',                   'Larnaca',  'Futsal',             2, time '15:00', time '23:00', 24),
  -- 24:00 is a valid `time` in Postgres and parses to 1440 minutes, which is
  -- what the slot loop needs in order to offer a slot ending at midnight.
  ('Fair Game Sport Center',                'Paphos',   '3G Astro',           4, time '08:00', time '24:00', 33)
) as v(name, city, surface, base_pitches, open_time, close_time, price)
where not exists (
  select 1 from public.venues existing where existing.name = v.name
);

-- 2. The prototype's seven bookings, placed on today so they show up on the
--    day picker's default selection. The prototype had no concept of dates.
insert into public.venue_bookings
  (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status)
select venue.id, current_date, b.start_time, b.end_time, b.pitches, b.capacity, b.format, 'confirmed'
from (values
  ('Nuevo Campo',                          time '18:00', time '19:00', 1, 10, '5-a-side'),
  ('Central Park Fields (English School)',  time '19:00', time '20:30', 2, 14, '7-a-side'),
  ('Valley Sports Arena',                   time '18:00', time '20:00', 2, 14, '7-a-side'),
  ('Lanitio Mini Football',                 time '17:00', time '18:00', 1, 10, '5-a-side'),
  ('Livadia Futsal Club',                   time '20:00', time '21:00', 1, 10, '5-a-side'),
  -- Fair Game gets two overlapping bookings: 4 pitches, 1 then 3 taken, so
  -- 19:00-22:00 is fully booked for anything above 5-a-side.
  ('Fair Game Sport Center',                time '19:00', time '20:00', 1, 10, '5-a-side'),
  ('Fair Game Sport Center',                time '20:00', time '22:00', 3, 18, '9-a-side')
) as b(venue_name, start_time, end_time, pitches, capacity, format)
join public.venues venue on venue.name = b.venue_name
where not exists (
  select 1 from public.venue_bookings existing
  where existing.venue_id = venue.id
    and existing.booking_day = current_date
    and existing.start_time = b.start_time
);

-- 3. A cancelled booking, to prove the status filter works.
--    Kamares has 2 pitches and no other bookings. This would consume both, so
--    if any slot at 19:00-20:00 shows as full, the app is wrongly counting
--    cancelled rows — see IGNORED_BOOKING_STATUSES in lib/use-day-bookings.ts.
insert into public.venue_bookings
  (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status)
select venue.id, current_date, time '19:00', time '20:00', 2, 14, '7-a-side', 'cancelled'
from public.venues venue
where venue.name = 'Kamares Futsal'
  and not exists (
    select 1 from public.venue_bookings existing
    where existing.venue_id = venue.id
      and existing.booking_day = current_date
      and existing.start_time = time '19:00'
  );

-- 4. A different picture tomorrow, so switching days visibly changes the grid.
--    Valley Sports has 4 pitches; this takes 3 of them for most of the evening.
insert into public.venue_bookings
  (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status)
select venue.id, current_date + 1, b.start_time, b.end_time, b.pitches, b.capacity, b.format, 'confirmed'
from (values
  ('Valley Sports Arena', time '17:00', time '21:00', 3, 18, '9-a-side'),
  ('Nuevo Campo',         time '15:00', time '16:00', 2, 14, '7-a-side')
) as b(venue_name, start_time, end_time, pitches, capacity, format)
join public.venues venue on venue.name = b.venue_name
where not exists (
  select 1 from public.venue_bookings existing
  where existing.venue_id = venue.id
    and existing.booking_day = current_date + 1
    and existing.start_time = b.start_time
);

-- 5. Confirm what landed.
select v.name, v.city, v.base_pitches, v.open_time, v.close_time,
       count(b.id) filter (where b.booking_day = current_date)     as bookings_today,
       count(b.id) filter (where b.booking_day = current_date + 1) as bookings_tomorrow
from public.venues v
left join public.venue_bookings b on b.venue_id = v.id
group by v.id, v.name, v.city, v.base_pitches, v.open_time, v.close_time
order by v.city, v.name;
