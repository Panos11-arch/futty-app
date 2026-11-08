-- Fixes duplicate venue rows (and the duplicate demo bookings that come with
-- them, since seed-venues.sql matched bookings to venues by name).
-- Run in the Supabase dashboard: SQL Editor > New query > Run, top to bottom.
--
-- Nothing here is guesswork about which venues are duplicated — every step
-- finds duplicates dynamically and only touches rows that are genuinely
-- extra copies. Real, distinct venues and bookings are untouched.

-- 1. See what's duplicated before touching anything.
select name, count(*) as copies
from public.venues
group by name
having count(*) > 1
order by name;

-- 2. Point every booking on a duplicate venue at the single row that will
--    survive (the physically oldest copy of each name), before deleting
--    anything — a booking can't be reassigned after its venue is gone.
--
--    NOTE: if this fails with a unique-constraint error, it means a signed-in
--    user made two real bookings for the exact same day/time on two different
--    copies of the same venue. Cancel one of those bookings in the app, then
--    re-run this statement.
with ranked as (
  select id, name, row_number() over (partition by name order by ctid) as rn
  from public.venues
),
dup_map as (
  select dup.id as dup_id, keep.id as keep_id
  from ranked dup
  join ranked keep on keep.name = dup.name and keep.rn = 1
  where dup.rn > 1
)
update public.venue_bookings b
set venue_id = m.keep_id
from dup_map m
where b.venue_id = m.dup_id;

-- 3. The reassignment above just created exact-duplicate rows out of what
--    were the seed script's demo bookings on each duplicated venue (created_by
--    is null for those, so this never touches a real user's booking).
with numbered as (
  select id, row_number() over (
    partition by venue_id, booking_day, start_time, end_time, pitches, format
    order by ctid
  ) as rn
  from public.venue_bookings
  where created_by is null
)
delete from public.venue_bookings
where id in (select id from numbered where rn > 1);

-- 4. Now safe to remove the duplicate venue rows themselves.
with ranked as (
  select id, row_number() over (partition by name order by ctid) as rn
  from public.venues
)
delete from public.venues
where id in (select id from ranked where rn > 1);

-- 5. Stop this from happening again — a second seed run (or any future
--    insert) with a matching name now fails loudly instead of duplicating.
alter table public.venues add constraint venues_name_key unique (name);

-- 6. Confirm: should return zero rows.
select name, count(*) from public.venues group by name having count(*) > 1;
