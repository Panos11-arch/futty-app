-- Venue owner dashboard (item 10): lets a venue owner block out pitches for
-- their own recurring training sessions directly, without going through the
-- paid book_slot() flow (an owner blocking their own pitch isn't a purchase).
-- Run AFTER supabase/legacy/venues.sql and supabase/legacy/booking-payments.sql. Run in the
-- Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.

-- 1. Which profiles are venue owners, and which venue(s) they own.
-- profiles.role already existed in this database (not added by this file)
-- using 'venue_owner' as its owner value, not 'owner' — matching that
-- existing convention rather than introducing a second, incompatible one.
alter table public.profiles add column if not exists role text not null default 'player';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('player', 'venue_owner'));

alter table public.venues add column if not exists owner_profile_id uuid references public.profiles (id);
create index if not exists venues_owner_profile_idx on public.venues (owner_profile_id);

-- 2. What kind of venue_bookings row this is, and an optional free-text note
-- (e.g. "U14 training", "Astro maintenance") — both new, both needed to tell
-- an owner's block apart from a normal paid/free booking.
alter table public.venue_bookings add column if not exists booking_type text not null default 'user_booking';
alter table public.venue_bookings drop constraint if exists venue_bookings_booking_type_check;
alter table public.venue_bookings add constraint venue_bookings_booking_type_check
  check (booking_type in ('user_booking', 'owner_block'));

alter table public.venue_bookings add column if not exists note text;

-- 3. The RLS insert policy: an owner may insert an 'owner_block' row, but
-- only for a venue they own, only pitches they actually have, and never in
-- the past. This is a real client-facing insert path (unlike book_slot,
-- which stays the only way into a paid 'user_booking' row) — an owner
-- blocking their own pitch has no payment/capacity-race to protect against
-- the way a stranger's paid booking does, so a trigger doing the same
-- overlap check book_slot does server-side is enough here, no RPC needed.
drop policy if exists "Owners can block their own venue" on public.venue_bookings;
create policy "Owners can block their own venue"
  on public.venue_bookings for insert
  to authenticated
  with check (
    booking_type = 'owner_block'
    and created_by = auth.uid()
    and status = 'confirmed'
    and amount_cents = 0
    and exists (
      select 1 from public.venues
      where id = venue_bookings.venue_id and owner_profile_id = auth.uid()
    )
  );

-- Owners can also see/cancel their own blocks (separate from the general
-- "everyone can read bookings" policy in venues.sql, which only covers
-- select).
drop policy if exists "Owners can cancel their own blocks" on public.venue_bookings;
create policy "Owners can cancel their own blocks"
  on public.venue_bookings for update
  to authenticated
  using (booking_type = 'owner_block' and created_by = auth.uid())
  with check (booking_type = 'owner_block' and created_by = auth.uid());

create or replace function public.check_owner_block_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_pitches integer;
  v_used integer;
begin
  if new.booking_type <> 'owner_block' then
    return new;
  end if;

  if new.booking_day < current_date or (new.booking_day = current_date and new.start_time <= current_time) then
    raise exception 'slot_in_past';
  end if;

  select base_pitches into v_base_pitches from public.venues where id = new.venue_id for update;

  select coalesce(sum(pitches), 0) into v_used
  from public.venue_bookings
  where venue_id = new.venue_id
    and booking_day = new.booking_day
    and status <> 'cancelled'
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and start_time < new.end_time
    and end_time > new.start_time;

  if v_base_pitches is null or v_base_pitches - v_used < new.pitches then
    raise exception 'slot_full';
  end if;

  return new;
end;
$$;

drop trigger if exists on_owner_block_capacity_check on public.venue_bookings;
create trigger on_owner_block_capacity_check
  before insert on public.venue_bookings
  for each row execute function public.check_owner_block_capacity();
