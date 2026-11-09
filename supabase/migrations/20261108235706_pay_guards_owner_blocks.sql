-- P2 rule 8: owner-block inserts AND updates re-check venue ownership and
-- capacity.
--
-- Before: the capacity trigger ran on INSERT only, and the UPDATE policy
-- checked only created_by. So an owner could move a block onto a full slot,
-- reinstate a cancelled block after its slot filled, or move a block to
-- another owner's venue. It also compared against current_date/current_time
-- rather than Cyprus time.

create or replace function public.check_owner_block_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_pitches integer;
  v_owner uuid;
  v_used integer;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_moved boolean;
begin
  if new.booking_type is distinct from 'owner_block' then
    return new;
  end if;

  select base_pitches, owner_profile_id into v_base_pitches, v_owner
  from public.venues where id = new.venue_id for update;
  if v_base_pitches is null then
    raise exception 'venue_not_found';
  end if;

  -- Requests from the app carry a user; only the venue's owner may block it.
  -- Service-role jobs (no user) are trusted.
  if auth.uid() is not null and v_owner is distinct from auth.uid() then
    raise exception 'not_your_venue';
  end if;

  -- Cancelling a block is always allowed.
  if new.status = 'cancelled' then
    return new;
  end if;

  v_moved := tg_op = 'INSERT'
    or new.venue_id is distinct from old.venue_id
    or new.booking_day is distinct from old.booking_day
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time
    or new.pitches is distinct from old.pitches
    or old.status = 'cancelled';
  if not v_moved then
    return new; -- e.g. editing the note
  end if;

  if new.booking_day < v_now::date or (new.booking_day = v_now::date and new.start_time <= v_now::time) then
    raise exception 'slot_in_past';
  end if;
  if new.pitches is null or new.pitches < 1 or new.end_time <= new.start_time then
    raise exception 'invalid_block';
  end if;

  select coalesce(sum(pitches), 0) into v_used
  from public.venue_bookings
  where venue_id = new.venue_id
    and booking_day = new.booking_day
    and status <> 'cancelled'
    and id <> new.id
    and start_time < new.end_time
    and end_time > new.start_time;

  if v_base_pitches - v_used < new.pitches then
    raise exception 'slot_full';
  end if;

  return new;
end;
$$;

drop trigger if exists on_owner_block_capacity_check on public.venue_bookings;
create trigger on_owner_block_capacity_check
  before insert or update on public.venue_bookings
  for each row execute function public.check_owner_block_capacity();

drop policy if exists "Owners can cancel their own blocks" on public.venue_bookings;
create policy "Owners can update their own blocks" on public.venue_bookings
  for update to authenticated
  using (booking_type = 'owner_block' and created_by = auth.uid())
  with check (
    booking_type = 'owner_block'
    and created_by = auth.uid()
    and exists (select 1 from public.venues v where v.id = venue_bookings.venue_id and v.owner_profile_id = auth.uid())
  );
