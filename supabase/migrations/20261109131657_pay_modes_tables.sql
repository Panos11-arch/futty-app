-- P4a: booking modes, the share breakdown, the booker's guarantee and the
-- money ledger (docs/specs/13-payments-bookings.md, "Booking modes", "When
-- money is held and taken", "Server-side checks").

-- The mode the booker chose. Null = booked before P4a: those bookings keep
-- the old flow (capture when the roster is full, 3-hour auto-cancel).
alter table public.venue_bookings
  add column payment_mode text
  check (payment_mode in ('pay_all', 'each_pays_responsible', 'each_pays_own_spot'));

-- Each share's breakdown. amount_cents stays "what is charged to the card";
-- for bookings before P4a the new columns are null / their defaults.
--   pitch_cents, fee_cents      the share's pitch part and service fee
--   cash_cents                  paid in cash at the venue (cash players)
--   payment_method              card or cash (each_pays modes only)
--   capture_method              manual = held, taken 60 minutes later;
--                               immediate = paid less than 6 hours before
--                               kickoff, taken at once
--   non_refundable_accepted_at  when the player accepted "This booking is
--                               non-refundable" (immediate shares)
--   held_at, capture_due_at     when the card was held and when it's taken
-- 'covered' = a spot in a booking the booker paid for in full.
alter table public.booking_payment_shares
  add column pitch_cents integer check (pitch_cents >= 0),
  add column fee_cents integer check (fee_cents >= 0),
  add column cash_cents integer not null default 0 check (cash_cents >= 0),
  add column payment_method text not null default 'card' check (payment_method in ('card', 'cash')),
  add column capture_method text check (capture_method in ('manual', 'immediate')),
  add column non_refundable_accepted_at timestamptz,
  add column held_at timestamptz,
  add column capture_due_at timestamptz;

alter table public.booking_payment_shares drop constraint booking_payment_shares_status_check;
alter table public.booking_payment_shares add constraint booking_payment_shares_status_check
  check (status in ('pending', 'authorized', 'paid', 'refunded', 'cancelled', 'covered'));

create index booking_payment_shares_capture_due_idx on public.booking_payment_shares (capture_due_at)
  where status = 'authorized';

-- The booker's guarantee (each_pays_responsible): their saved card, held for
-- the full pitch price at hold_due_at (72 hours before kickoff, or at
-- booking when closer). A failed hold is retried at next_attempt_at and
-- never cancels the booking.
--   awaiting_card  booked, the booker's card isn't saved yet
--   scheduled      card saved, waiting for hold_due_at
--   held           the hold is on the card
--   failed         the last attempt failed; retried at next_attempt_at
--   cancelled      the booking was cancelled; any hold released
create table public.booking_guarantees (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.venue_bookings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  hold_due_at timestamptz not null,
  status text not null default 'awaiting_card'
    check (status in ('awaiting_card', 'scheduled', 'held', 'failed', 'cancelled')),
  stripe_customer_id text,
  stripe_payment_method_id text,
  stripe_payment_intent_id text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  failure_notified_at timestamptz,
  held_at timestamptz,
  created_at timestamptz not null default now()
);

create index booking_guarantees_due_idx on public.booking_guarantees (next_attempt_at)
  where status in ('scheduled', 'failed');

alter table public.booking_guarantees enable row level security;
create policy "Bookers read their own guarantee" on public.booking_guarantees
  for select to authenticated using (profile_id = auth.uid());
revoke all on public.booking_guarantees from public, anon, authenticated;
grant select on public.booking_guarantees to authenticated;
grant all on public.booking_guarantees to service_role;

-- Every hold, capture, cancel and refund, once each, with its reason. Plain
-- ids, no foreign keys: the record outlives the rows it describes. A
-- movement is one kind of action on one Stripe object, so
-- (kind, stripe_id) is unique. Append-only: nobody can update or delete.
create table public.money_ledger (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  share_id uuid,
  guarantee_id uuid,
  kind text not null check (kind in ('hold', 'capture', 'cancel', 'refund')),
  amount_cents integer not null check (amount_cents >= 0),
  stripe_id text not null,
  reason text not null check (reason <> ''),
  created_at timestamptz not null default now(),
  unique (kind, stripe_id)
);

create index money_ledger_booking_idx on public.money_ledger (booking_id);

alter table public.money_ledger enable row level security;
revoke all on public.money_ledger from public, anon, authenticated, service_role;
grant select, insert on public.money_ledger to service_role;

-- Records one money movement. Returns false when it was already recorded
-- (a repeated webhook or retried job), so it's safe to call twice.
create or replace function public.record_money_movement(
  p_booking_id uuid,
  p_share_id uuid,
  p_guarantee_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_stripe_id text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.money_ledger (booking_id, share_id, guarantee_id, kind, amount_cents, stripe_id, reason)
  values (p_booking_id, p_share_id, p_guarantee_id, p_kind, p_amount_cents, p_stripe_id, p_reason)
  on conflict (kind, stripe_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function public.record_money_movement(uuid, uuid, uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_money_movement(uuid, uuid, uuid, text, integer, text, text) to service_role;

-- Notification type for a failed guarantee hold (contract 4; A2 builds the
-- real send_notification, P3 added the stub).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed', 'match_payment_due',
  'team_invite', 'booking_invite', 'venue_closed_new_bookings', 'guarantee_hold_failed'
]));

-- The old 3-hour auto-cancel (cancel-unpaid-bookings) only for bookings made
-- before P4a. Unpaid spots no longer cancel a new booking.
create or replace function public.bookings_needing_share_cancellation()
returns table (booking_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.venue_bookings b
  where b.status = 'confirmed'
    and b.payment_mode is null
    and b.amount_cents > 0
    and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' <= now() + interval '3 hours'
    and (
      select count(*) from public.booking_payment_shares s
      where s.booking_id = b.id and s.status in ('authorized', 'paid')
    ) < public.booking_total_shares_needed(b.id);
$$;
