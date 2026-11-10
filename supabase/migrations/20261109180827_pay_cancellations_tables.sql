-- P4b: cancellations and venue credit (docs/specs/13-payments-bookings.md,
-- "Cancellations and refunds", "Venue credit", and the 10 November
-- decisions written into spec 13 with this PR). The tables, the share
-- states and the ledger changes.

-- Share states after a cancellation. 'cancelled' and 'refunded' keep their
-- P4a meaning, "the money went back"; the webhooks and jobs give back any
-- money they find on such a share. Money kept after a cancellation gets its
-- own states, so nothing ever gives it back by mistake:
--   credited    cancelled; the money became venue credit (less what was kept)
--   forfeited   cancelled late; the money is kept
--   refund_due  cancelled by the booker or the venue; the player has 48
--               hours to choose credit, then it's refunded to their card
-- credit_cents is the venue credit that pays part of the share
-- (venue_credit_spends says from which credit).
alter table public.booking_payment_shares drop constraint booking_payment_shares_status_check;
alter table public.booking_payment_shares add constraint booking_payment_shares_status_check
  check (status in ('pending', 'authorized', 'paid', 'refunded', 'cancelled', 'covered', 'credited', 'forfeited',
                    'refund_due'));
alter table public.booking_payment_shares
  add column credit_cents integer not null default 0 check (credit_cents >= 0);

-- Credit a player holds at one venue: spent only there, never cashed out,
-- expiring 12 months after it was issued. Plain source ids, no foreign
-- keys: the record outlives the rows it came from.
--   source             player_cancelled (their own spot, middle window),
--                      booking_cancelled (the booker cancelled the team),
--                      venue_cancelled (the venue cancelled)
--   remaining_cents    what's left to spend
--   expired_at         when the daily job expired what was left
create table public.venue_credits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  remaining_cents integer not null check (remaining_cents >= 0),
  source text not null check (source in ('player_cancelled', 'booking_cancelled', 'venue_cancelled')),
  source_booking_id uuid not null,
  source_share_id uuid,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  expired_at timestamptz,
  constraint venue_credits_remaining_check check (remaining_cents <= amount_cents),
  -- issue_venue_credit sets expires_at = issued_at + 12 months.
  constraint venue_credits_expiry_check check (expires_at > issued_at)
);
create index venue_credits_spendable_idx on public.venue_credits (profile_id, venue_id, expires_at)
  where remaining_cents > 0;
create unique index venue_credits_one_per_share_idx on public.venue_credits (source_share_id, source)
  where source_share_id is not null;

-- Credit set aside for a share (reserved when its payment starts), spent
-- when its money is secured, or returned when it's released.
create table public.venue_credit_spends (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.venue_credits (id) on delete cascade,
  share_id uuid not null references public.booking_payment_shares (id) on delete cascade,
  booking_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'reserved' check (status in ('reserved', 'spent', 'returned')),
  created_at timestamptz not null default now(),
  spent_at timestamptz,
  returned_at timestamptz
);
create index venue_credit_spends_share_idx on public.venue_credit_spends (share_id);

-- What a venue owes Futty, taken off its next payout (P4d): Stripe's real
-- fee on every payment taken in a booking the venue cancelled.
create table public.venue_payables (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  booking_id uuid not null,
  share_id uuid,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null check (reason in ('venue_cancelled_stripe_fee')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (share_id, reason)
);
create index venue_payables_venue_idx on public.venue_payables (venue_id) where settled_at is null;

-- One cancellation: who did it, when, and what was decided (the plan the
-- quote showed, with its hash). my_spot can happen many times on a booking;
-- whole_team and venue once.
create table public.booking_cancellations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.venue_bookings (id) on delete cascade,
  scope text not null check (scope in ('my_spot', 'whole_team', 'venue')),
  cancelled_by uuid not null,
  cancelled_at timestamptz not null default now(),
  quote text not null,
  plan jsonb not null
);
create unique index booking_cancellations_once_idx on public.booking_cancellations (booking_id) where scope <> 'my_spot';

-- What happens to each share (or the booker's guarantee) in a
-- cancellation, and the Stripe work it still needs:
--   action     none             no money on it
--              release          the hold (or a payment taken in the free
--                               hour) goes back in full
--              keep             the money is kept
--              keep_and_credit  kept_cents kept, credit_cents becomes credit
--              refund_choice    refund_cents back, card or credit, the
--                               player's choice within 48 hours
--   window     free / middle / late for the canceller's own share;
--              other (another player when the booker cancels the team);
--              venue (the venue cancelled)
--   value_cents        what the share paid: card + credit used
--   needs_capture      the share is still only held and is taken first
--   work               none / pending / done: the Stripe work left
--   choice, choose_by  refund_choice only
create table public.booking_cancellation_lines (
  id uuid primary key default gen_random_uuid(),
  cancellation_id uuid not null references public.booking_cancellations (id) on delete cascade,
  booking_id uuid not null,
  share_id uuid references public.booking_payment_shares (id) on delete cascade,
  guarantee_id uuid references public.booking_guarantees (id) on delete cascade,
  profile_id uuid not null,
  venue_id uuid not null,
  is_booker boolean not null default false,
  "window" text check ("window" in ('free', 'middle', 'late', 'other', 'venue')),
  action text not null check (action in ('none', 'release', 'keep', 'keep_and_credit', 'refund_choice')),
  paid_cents integer not null default 0 check (paid_cents >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  credit_used_cents integer not null default 0 check (credit_used_cents >= 0),
  value_cents integer not null default 0 check (value_cents >= 0),
  kept_cents integer not null default 0 check (kept_cents >= 0),
  credit_cents integer not null default 0 check (credit_cents >= 0),
  refund_cents integer not null default 0 check (refund_cents >= 0),
  needs_capture boolean not null default false,
  stripe_intent_id text,
  reason text not null,
  work text not null default 'none' check (work in ('none', 'pending', 'done')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  choice text check (choice in ('card', 'credit')),
  choose_by timestamptz,
  chosen_at timestamptz,
  outcome text,
  done_at timestamptz,
  constraint booking_cancellation_lines_one_target check ((share_id is null) <> (guarantee_id is null)),
  constraint booking_cancellation_lines_adds_up check (kept_cents + credit_cents + refund_cents = value_cents)
);
create index booking_cancellation_lines_cancellation_idx on public.booking_cancellation_lines (cancellation_id);
create index booking_cancellation_lines_due_idx on public.booking_cancellation_lines (next_attempt_at) where work = 'pending';
create index booking_cancellation_lines_profile_idx on public.booking_cancellation_lines (profile_id);

-- The booker's charge for cancelling the whole team: 100 per other player
-- whose payment was already taken, one charge, Futty's. Taken on-session
-- when the booker confirms; if that fails, retried off-session every 6
-- hours until the original kickoff (stop_at). What's still unpaid then is
-- a debt to Futty, built in P4c.
--   pending          not tried yet
--   requires_action  the bank asked the booker for 3-D Secure in the app
--   failed           the last try failed; retried at next_attempt_at
--   paid             taken (paid_intent_id)
create table public.booking_cancellation_fees (
  id uuid primary key default gen_random_uuid(),
  cancellation_id uuid not null unique references public.booking_cancellations (id) on delete cascade,
  booking_id uuid not null,
  profile_id uuid not null,
  players integer not null check (players > 0),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'requires_action', 'failed', 'paid')),
  stripe_customer_id text,
  stripe_payment_method_id text,
  stripe_payment_intent_id text,
  paid_intent_id text,
  attempts integer not null default 0,
  api_errors integer not null default 0,
  next_attempt_at timestamptz,
  stop_at timestamptz not null,
  last_error text,
  failure_notified_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index booking_cancellation_fees_due_idx on public.booking_cancellation_fees (next_attempt_at)
  where status <> 'paid';

-- RLS: players read their own credit, lines and charge; a booker reads the
-- lines of their booking; venue staff read their venue's credit and what
-- it owes. Every write goes through service_role functions.
alter table public.venue_credits enable row level security;
alter table public.venue_credit_spends enable row level security;
alter table public.venue_payables enable row level security;
alter table public.booking_cancellations enable row level security;
alter table public.booking_cancellation_lines enable row level security;
alter table public.booking_cancellation_fees enable row level security;

create policy "Players read their credit; venues read credit with them" on public.venue_credits
  for select to authenticated using (
    profile_id = auth.uid()
    or exists (select 1 from public.venues v where v.id = venue_id and v.owner_profile_id = auth.uid())
  );
create policy "Venues read what they owe" on public.venue_payables
  for select to authenticated using (
    exists (select 1 from public.venues v where v.id = venue_id and v.owner_profile_id = auth.uid())
  );
create policy "Players read cancellations of their bookings" on public.booking_cancellations
  for select to authenticated using (
    cancelled_by = auth.uid()
    or exists (select 1 from public.booking_cancellation_lines l where l.cancellation_id = id and l.profile_id = auth.uid())
  );
create policy "Players read their own lines; bookers their booking's" on public.booking_cancellation_lines
  for select to authenticated using (
    profile_id = auth.uid()
    or exists (select 1 from public.venue_bookings b where b.id = booking_id and b.created_by = auth.uid())
  );
create policy "Bookers read their own charge" on public.booking_cancellation_fees
  for select to authenticated using (profile_id = auth.uid());

revoke all on public.venue_credits, public.venue_credit_spends, public.venue_payables, public.booking_cancellations,
  public.booking_cancellation_lines, public.booking_cancellation_fees from public, anon, authenticated;
grant select on public.venue_credits, public.venue_payables, public.booking_cancellations,
  public.booking_cancellation_lines, public.booking_cancellation_fees to authenticated;
grant all on public.venue_credits, public.venue_credit_spends, public.venue_payables, public.booking_cancellations,
  public.booking_cancellation_lines, public.booking_cancellation_fees to service_role;

-- The ledger records credit and what venues owe as well as Stripe's
-- movements. credit_cents is the credit bucket: venue + Futty + Stripe +
-- refunds + credit = taken, for every booking (money_balance).
--   credit_issued    a cancellation turns money into credit: the venue's
--                    part goes, Futty keeps what's kept, credit goes up
--   credit_returned  credit that paid for a share goes back to the player
--   credit_spent     credit pays a share: from credit to the venue
--   credit_expired   credit expires and stays with the venue
--   venue_payable    the venue owes Futty (Stripe's fee on its cancellation)
-- The new kinds move no money at Stripe, so they carry no Stripe ids; ref
-- (our own key) records each exactly once.
alter table public.money_ledger
  alter column stripe_intent_id drop not null,
  alter column stripe_id drop not null,
  add column credit_cents integer not null default 0,
  add column credit_id uuid,
  add column ref text;

alter table public.money_ledger drop constraint money_ledger_kind_check;
alter table public.money_ledger add constraint money_ledger_kind_check check (kind in (
  'hold', 'capture', 'cancel', 'refund', 'credit_issued', 'credit_returned', 'credit_spent', 'credit_expired',
  'venue_payable'));

alter table public.money_ledger drop constraint money_ledger_split_check;
alter table public.money_ledger add constraint money_ledger_split_check check (
  (kind in ('hold', 'cancel') and stripe_intent_id is not null and stripe_id = stripe_intent_id and ref is null
     and venue_cents = 0 and futty_cents = 0 and stripe_fee_cents = 0 and credit_cents = 0)
  or (kind = 'capture' and stripe_intent_id is not null and stripe_id = stripe_intent_id and ref is null
     and venue_cents >= 0 and stripe_fee_cents >= 0 and credit_cents = 0
     and venue_cents + futty_cents + stripe_fee_cents = amount_cents)
  or (kind = 'refund' and stripe_intent_id is not null and stripe_id is not null and ref is null
     and venue_cents <= 0 and stripe_fee_cents = 0 and credit_cents = 0 and venue_cents + futty_cents = -amount_cents)
  or (kind in ('credit_issued', 'credit_returned') and ref is not null and stripe_id is null
     and credit_cents = amount_cents and stripe_fee_cents = 0 and venue_cents + futty_cents + credit_cents = 0)
  or (kind in ('credit_spent', 'credit_expired') and ref is not null and stripe_id is null
     and credit_cents = -amount_cents and venue_cents = amount_cents and futty_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'venue_payable' and ref is not null and stripe_id is null
     and venue_cents = -amount_cents and futty_cents = amount_cents and credit_cents = 0 and stripe_fee_cents = 0)
);
create unique index money_ledger_ref_idx on public.money_ledger (kind, ref) where ref is not null;
create index money_ledger_share_idx on public.money_ledger (share_id) where share_id is not null;

-- Records one movement that isn't a Stripe call, once (by p_ref). Returns
-- false when it was already recorded.
create or replace function public.record_ledger_entry(
  p_booking_id uuid,
  p_share_id uuid,
  p_credit_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_ref text,
  p_reason text,
  p_venue_cents integer,
  p_futty_cents integer,
  p_credit_cents integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.money_ledger (booking_id, share_id, credit_id, kind, amount_cents, ref, reason,
                                   venue_cents, futty_cents, credit_cents)
  values (p_booking_id, p_share_id, p_credit_id, p_kind, p_amount_cents, p_ref, p_reason,
          p_venue_cents, p_futty_cents, p_credit_cents)
  on conflict (kind, ref) where ref is not null do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

-- The books for one booking: venue + Futty + Stripe + refunds + credit =
-- taken (spec 13, "The books always balance").
drop function public.money_balance(uuid);
create function public.money_balance(p_booking_id uuid)
returns table (taken_cents integer, refunded_cents integer, venue_cents integer, futty_cents integer,
               stripe_fee_cents integer, credit_cents integer, balanced boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.taken, t.refunded, t.venue, t.futty, t.stripe, t.credit,
         t.venue + t.futty + t.stripe + t.refunded + t.credit = t.taken
  from (
    select coalesce(sum(amount_cents) filter (where kind = 'capture'), 0)::integer as taken,
           coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::integer as refunded,
           coalesce(sum(l.venue_cents), 0)::integer as venue,
           coalesce(sum(l.futty_cents), 0)::integer as futty,
           coalesce(sum(l.stripe_fee_cents), 0)::integer as stripe,
           coalesce(sum(l.credit_cents), 0)::integer as credit
    from public.money_ledger l
    where l.booking_id = p_booking_id
  ) t;
$$;

-- A cancellation's Stripe work failing for the founders to look at.
alter table public.admin_alerts drop constraint admin_alerts_kind_check;
alter table public.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('capture_failing', 'cancellation_failing'));

-- Notification types for cancellations (contract 4 with A2).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed', 'match_payment_due',
  'team_invite', 'booking_invite', 'venue_closed_new_bookings', 'guarantee_hold_failed',
  'booking_spot_released', 'cancellation_fee_failed'
]));

revoke all on function public.record_ledger_entry(uuid, uuid, uuid, text, integer, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_ledger_entry(uuid, uuid, uuid, text, integer, text, text, integer, integer, integer)
  to service_role;
revoke all on function public.money_balance(uuid) from public, anon, authenticated;
grant execute on function public.money_balance(uuid) to service_role;
