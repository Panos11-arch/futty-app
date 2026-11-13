-- P6a: walk-in and phone bookings (docs/specs/05-product.md section 12,
-- launch item 5; docs/specs/13-payments-bookings.md "Venue dashboard",
-- decided 13 November).
--
-- Staff add a booking at the counter so the app never double-books: it holds
-- real pitches through booking_pitches, like any game. It's a venue_bookings
-- row with booking_type 'counter' (no payment mode, no shares, no match, no
-- collection, no players to notify: every one of those paths requires
-- 'user_booking'), plus its counter details in venue_counter_bookings:
-- walk-in or phone, the customer (venue_contacts), the venue's price for the
-- slot and the amount actually charged (staff may change it, e.g. a regular's
-- discount; this money never goes through Futty or Stripe), and how it was
-- paid at the counter (cash or card). Marking it paid writes one
-- counter_paid ledger row; cancelling a paid one writes the reversal.
-- Only the venue's own staff can do or see any of it.

alter table public.venue_bookings drop constraint venue_bookings_booking_type_check;
alter table public.venue_bookings add constraint venue_bookings_booking_type_check
  check (booking_type in ('user_booking', 'owner_block', 'counter'));

-- One active booking per person per slot start stays the rule for players
-- and owner blocks. Counter bookings are all made by staff for different
-- customers, often several at the same start on different pitches, so they
-- are left out (the pitches themselves still can't be double-booked).
drop index public.venue_bookings_active_slot_per_user;
create unique index venue_bookings_active_slot_per_user on public.venue_bookings
  (venue_id, booking_day, start_time, created_by)
  where status <> 'cancelled' and booking_type <> 'counter';

-- The venue's own customers who booked at the counter. A phone number is
-- one customer per venue; walk-ins without a number get their own row.
create table public.venue_contacts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  phone text check (phone is null or btrim(phone) <> ''),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index venue_contacts_phone_idx on public.venue_contacts (venue_id, phone) where phone is not null;
create index venue_contacts_venue_idx on public.venue_contacts (venue_id, created_at);

create table public.venue_counter_bookings (
  booking_id uuid primary key references public.venue_bookings (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  source text not null check (source in ('walk_in', 'phone')),
  contact_id uuid not null references public.venue_contacts (id),
  -- The venue's price for the slot when it was booked; null if it had none.
  venue_price_cents integer check (venue_price_cents >= 0),
  charged_cents integer not null check (charged_cents >= 0),
  paid_method text check (paid_method in ('cash', 'card')),
  paid_at timestamptz,
  paid_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check ((paid_method is null) = (paid_at is null))
);
create index venue_counter_bookings_venue_idx on public.venue_counter_bookings (venue_id, created_at);
create index venue_counter_bookings_contact_idx on public.venue_counter_bookings (contact_id);

alter table public.venue_contacts enable row level security;
alter table public.venue_counter_bookings enable row level security;

create policy "Venue staff read their contacts" on public.venue_contacts
  for select to authenticated using (public.is_venue_staff(venue_id));
create policy "Venue staff read their counter bookings" on public.venue_counter_bookings
  for select to authenticated using (public.is_venue_staff(venue_id));

revoke all on public.venue_contacts, public.venue_counter_bookings from public, anon, authenticated;
grant select on public.venue_contacts, public.venue_counter_bookings to authenticated;
grant select, insert, update, delete on public.venue_contacts, public.venue_counter_bookings to service_role;

-- Marks a counter booking paid, cash or card at the counter, once. Writes
-- the charged amount to the ledger (nothing for a free one).
create or replace function public.mark_counter_paid(p_booking_id uuid, p_method text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counter public.venue_counter_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_counter from public.venue_counter_bookings where booking_id = p_booking_id for update;
  if v_counter.booking_id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_venue_staff(v_counter.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_method is null or p_method not in ('cash', 'card') then
    raise exception 'invalid_paid_method';
  end if;
  if v_counter.cancelled_at is not null then
    raise exception 'booking_cancelled';
  end if;
  if v_counter.paid_at is not null then
    raise exception 'already_paid';
  end if;

  update public.venue_counter_bookings
  set paid_method = p_method, paid_at = now(), paid_by = auth.uid()
  where booking_id = p_booking_id;

  if v_counter.charged_cents > 0 then
    perform public.record_ledger_entry(p_booking_id, null, null, 'counter_paid', v_counter.charged_cents,
                                       'counter_paid:' || p_booking_id, 'counter_paid_' || p_method,
                                       v_counter.charged_cents, 0, 0);
  end if;
end;
$$;

-- Adds a walk-in or phone booking. The price is prefilled from the venue's
-- price rules for the slot; p_charged_cents overrides it (both are kept).
-- p_pitch_id picks the pitch, otherwise the server picks one like book_slot.
-- p_paid_method marks it paid at once. Returns the booking id.
create or replace function public.add_counter_booking(
  p_venue_id uuid,
  p_day date,
  p_start time,
  p_end time,
  p_format text,
  p_source text,
  p_contact_name text,
  p_contact_phone text,
  p_pitch_id uuid default null,
  p_charged_cents integer default null,
  p_paid_method text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_hours record;
  v_name text := btrim(p_contact_name);
  v_phone text := nullif(btrim(p_contact_phone), '');
  v_pitch_ids uuid[];
  v_price integer;
  v_charged integer;
  v_contact_id uuid;
  v_booking_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if p_source is null or p_source not in ('walk_in', 'phone') then
    raise exception 'invalid_source';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'name_required';
  end if;
  if p_charged_cents < 0 then
    raise exception 'invalid_amount';
  end if;
  if p_paid_method is not null and p_paid_method not in ('cash', 'card') then
    raise exception 'invalid_paid_method';
  end if;
  if p_day is null or p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_time_range';
  end if;
  -- Cyprus time: a game that has already ended can't be added.
  if p_day + p_end <= v_now then
    raise exception 'slot_ended';
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
  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')
     or not (
       exists (select 1 from public.pitches where venue_id = p_venue_id and p_format = any (formats))
       or exists (select 1 from public.pitch_combinations where venue_id = p_venue_id and format = p_format)
     ) then
    raise exception 'invalid_format';
  end if;

  if p_pitch_id is not null then
    if not exists (select 1 from public.pitches p
                   where p.id = p_pitch_id and p.venue_id = p_venue_id and p.is_open and p_format = any (p.formats)) then
      raise exception 'invalid_pitch';
    end if;
    if public.slot_is_blocked(p_venue_id, array[p_pitch_id], p_day, p_start, p_end) then
      raise exception 'slot_blocked';
    end if;
    v_pitch_ids := array[p_pitch_id];
  else
    v_pitch_ids := public.pick_pitches(p_venue_id, p_day, p_start, p_end, p_format);
    if v_pitch_ids is null then
      raise exception 'slot_full';
    end if;
  end if;

  v_price := public.slot_price_cents(p_venue_id, p_day, p_start, p_end, p_format);
  v_charged := coalesce(p_charged_cents, v_price);
  if v_charged is null then
    raise exception 'price_required';
  end if;

  if v_phone is not null then
    insert into public.venue_contacts (venue_id, name, phone, created_by)
    values (p_venue_id, v_name, v_phone, auth.uid())
    on conflict (venue_id, phone) where phone is not null do nothing
    returning id into v_contact_id;
    if v_contact_id is null then
      select id into v_contact_id from public.venue_contacts where venue_id = p_venue_id and phone = v_phone;
    end if;
  else
    insert into public.venue_contacts (venue_id, name, created_by)
    values (p_venue_id, v_name, auth.uid())
    returning id into v_contact_id;
  end if;

  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format,
                                     status, booking_type, created_by, amount_cents)
  values (p_venue_id, p_day, p_start, p_end, cardinality(v_pitch_ids), public.format_player_count(p_format) * 2,
          p_format, 'confirmed', 'counter', auth.uid(), v_charged)
  returning id into v_booking_id;

  begin
    insert into public.booking_pitches (booking_id, pitch_id, slot)
    select v_booking_id, unnest(v_pitch_ids), public.booking_slot_range(p_day, p_start, p_end);
  exception when exclusion_violation then
    raise exception 'slot_full';
  end;

  insert into public.venue_counter_bookings (booking_id, venue_id, source, contact_id, venue_price_cents, charged_cents)
  values (v_booking_id, p_venue_id, p_source, v_contact_id, v_price, v_charged);

  if p_paid_method is not null then
    perform public.mark_counter_paid(v_booking_id, p_paid_method);
  end if;

  return v_booking_id;
end;
$$;

-- Cancels a counter booking up to kickoff (nothing is cancelled once the
-- game has started). Its pitches are released; if it was paid, the money is
-- reversed in the ledger (the venue refunds at the counter).
create or replace function public.cancel_counter_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counter public.venue_counter_bookings;
  v_booking public.venue_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_counter from public.venue_counter_bookings where booking_id = p_booking_id for update;
  if v_counter.booking_id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_venue_staff(v_counter.venue_id) then
    raise exception 'not_venue_staff';
  end if;
  if v_counter.cancelled_at is not null then
    raise exception 'booking_cancelled';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.booking_day + v_booking.start_time <= (now() at time zone 'Asia/Nicosia') then
    raise exception 'game_started';
  end if;

  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  update public.venue_counter_bookings set cancelled_at = now() where booking_id = p_booking_id;

  if v_counter.paid_at is not null and v_counter.charged_cents > 0 then
    perform public.record_ledger_entry(p_booking_id, null, null, 'counter_paid', v_counter.charged_cents,
                                       'counter_cancel:' || p_booking_id, 'counter_booking_cancelled',
                                       -v_counter.charged_cents, 0, 0);
  end if;
end;
$$;

revoke all on function public.add_counter_booking(uuid, date, time, time, text, text, text, text, uuid, integer, text)
  from public, anon;
grant execute on function public.add_counter_booking(uuid, date, time, time, text, text, text, text, uuid, integer, text)
  to authenticated, service_role;
revoke all on function public.mark_counter_paid(uuid, text) from public, anon;
grant execute on function public.mark_counter_paid(uuid, text) to authenticated, service_role;
revoke all on function public.cancel_counter_booking(uuid) from public, anon;
grant execute on function public.cancel_counter_booking(uuid) to authenticated, service_role;
