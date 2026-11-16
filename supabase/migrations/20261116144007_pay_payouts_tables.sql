-- P4d: venue payouts with Stripe Connect (docs/specs/13-payments-bookings.md,
-- "Payouts (decided 7 November)", "Credit sits with the venue", and the
-- decisions of 16 November on P4d):
--   - separate charges and transfers: Futty's account takes every payment;
--     each venue gets one Stripe transfer per booking, once that booking's
--     money is final (after its collection; a pay-all booking when its
--     collection time comes; a cancelled one once its refunds are done);
--   - a transfer is what the ledger says the venue earned on the booking
--     (money_ledger.venue_cents) that no transfer has covered yet, less any
--     negative balance the venue carries (e.g. Stripe's fee on its own
--     cancellation). Nothing is ever pulled back from a venue: a negative
--     balance waits for the venue's next transfer;
--   - money the venue took in person (cash_received, counter_paid,
--     debt_cash_received) is never transferred; credit rows move no money;
--   - late money on a booking already paid out (a debt paid by card, a late
--     top-up) goes in a further transfer on the next run;
--   - no transfer until the venue is live (signed) and its Express account
--     can receive payouts (finished onboarding).
--
-- This file: the tables. 20261116144010_pay_payouts_functions has the rules.

-- ---- Each venue's Stripe Express account ------------------------------------

create table public.venue_stripe_accounts (
  venue_id uuid primary key references public.venues (id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id like 'acct\_%'),
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  -- How many things Stripe still needs from the venue (requirements.currently_due).
  requirements_due integer not null default 0 check (requirements_due >= 0),
  disabled_reason text,
  deauthorized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.venue_stripe_accounts is
  'P4d: a venue''s Stripe Connect Express account and what account.updated last said about it.';

alter table public.venue_stripe_accounts enable row level security;
revoke all on public.venue_stripe_accounts from public, anon, authenticated;
grant select on public.venue_stripe_accounts to authenticated;
grant all on public.venue_stripe_accounts to service_role;
create policy "Venues read their own Stripe account" on public.venue_stripe_accounts
  for select to authenticated
  using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_profile_id = auth.uid()));

-- ---- Payouts: one Stripe transfer each ---------------------------------------

create table public.venue_payouts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  -- The booking whose money made this transfer due (it may also carry
  -- earlier bookings' negative balance, and late money on earlier bookings).
  booking_id uuid not null references public.venue_bookings (id),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'sent', 'reversed')),
  stripe_account_id text not null,
  stripe_transfer_id text unique check (stripe_transfer_id like 'tr\_%'),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  reversed_at timestamptz,
  constraint venue_payouts_sent_check check ((status = 'pending') = (stripe_transfer_id is null) or status = 'reversed')
);
create index venue_payouts_venue_idx on public.venue_payouts (venue_id, created_at desc);
create index venue_payouts_pending_idx on public.venue_payouts (next_attempt_at) where status = 'pending';
comment on table public.venue_payouts is
  'P4d: one Stripe transfer to a venue. Its amount is the sum of venue_payout_items.venue_cents.';

-- Which ledger rows each payout covered: so no row is ever paid twice, and
-- the dashboard can say what each booking paid. A reversed payout's items
-- are released, so their rows are paid again on the next run.
create table public.venue_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.venue_payouts (id) on delete cascade,
  ledger_id uuid not null references public.money_ledger (id),
  booking_id uuid not null references public.venue_bookings (id),
  venue_cents integer not null,
  released_at timestamptz
);
create unique index venue_payout_items_ledger_idx on public.venue_payout_items (ledger_id) where released_at is null;
create index venue_payout_items_payout_idx on public.venue_payout_items (payout_id);
create index venue_payout_items_booking_idx on public.venue_payout_items (booking_id);

alter table public.venue_payouts enable row level security;
alter table public.venue_payout_items enable row level security;
revoke all on public.venue_payouts from public, anon, authenticated;
revoke all on public.venue_payout_items from public, anon, authenticated;
grant select on public.venue_payouts to authenticated;
grant select on public.venue_payout_items to authenticated;
grant all on public.venue_payouts to service_role;
grant all on public.venue_payout_items to service_role;
create policy "Venues read their payouts" on public.venue_payouts
  for select to authenticated
  using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_profile_id = auth.uid()));
create policy "Venues read what their payouts covered" on public.venue_payout_items
  for select to authenticated
  using (exists (select 1 from public.venue_payouts p join public.venues v on v.id = p.venue_id
                 where p.id = payout_id and v.owner_profile_id = auth.uid()));

-- Each run of the payout job: the daily check flags money that was due
-- before the last run started and no transfer covered.
create table public.payout_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.payout_runs enable row level security;
revoke all on public.payout_runs from public, anon, authenticated;
grant all on public.payout_runs to service_role;

-- ---- The ledger: a transfer and its reversal ----------------------------------

-- 'payout' is the Stripe transfer (tr_...) for one booking; 'payout_reversed'
-- a reversal of one (trr_...). They move money between Futty's and the
-- venue's Stripe balances, not between the parties of a booking, so their
-- venue/Futty/Stripe/credit cents are 0 and money_balance is unchanged; the
-- payout tables record what each covered. (The older 'transfer' kind is
-- Futty's fee going to the venue with credit, inside the books.)
alter table public.money_ledger drop constraint money_ledger_kind_check;
alter table public.money_ledger add constraint money_ledger_kind_check check (kind in (
  'hold', 'capture', 'cancel', 'refund', 'credit_issued', 'credit_returned', 'credit_spent', 'credit_expired',
  'venue_payable', 'transfer', 'debt_created', 'debt_settled', 'cash_received', 'counter_paid',
  'debt_cash_received', 'payout', 'payout_reversed'));

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
     and credit_cents = amount_cents and venue_cents = 0 and futty_cents = 0 and stripe_fee_cents = 0)
  or (kind in ('credit_spent', 'credit_expired') and ref is not null and stripe_id is null
     and credit_cents = -amount_cents and venue_cents = 0 and futty_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'venue_payable' and ref is not null and stripe_id is null
     and venue_cents = -amount_cents and futty_cents = amount_cents and credit_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'transfer' and ref is not null and stripe_id is null and amount_cents > 0
     and venue_cents + futty_cents = 0 and abs(futty_cents) = amount_cents and credit_cents = 0 and stripe_fee_cents = 0)
  or (kind in ('debt_created', 'debt_settled') and ref is not null and stripe_id is null and debt_id is not null
     and amount_cents > 0 and venue_cents = 0 and futty_cents = 0 and credit_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'cash_received' and ref is not null and stripe_id is null and stripe_intent_id is null
     and share_id is not null and amount_cents > 0
     and abs(venue_cents) = amount_cents and futty_cents = 0 and credit_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'counter_paid' and ref is not null and stripe_id is null and stripe_intent_id is null
     and share_id is null and amount_cents > 0
     and abs(venue_cents) = amount_cents and futty_cents = 0 and credit_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'debt_cash_received' and ref is not null and stripe_id is null and stripe_intent_id is null
     and share_id is null and debt_id is not null and amount_cents > 0
     and venue_cents = amount_cents and futty_cents = 0 and credit_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'payout' and ref is not null and stripe_id like 'tr\_%' and stripe_intent_id is null
     and share_id is null and amount_cents > 0
     and venue_cents = 0 and futty_cents = 0 and credit_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'payout_reversed' and ref is not null and stripe_id like 'trr\_%' and stripe_intent_id is null
     and share_id is null and amount_cents > 0
     and venue_cents = 0 and futty_cents = 0 and credit_cents = 0 and stripe_fee_cents = 0)
);

-- ---- Alerts for the founders -------------------------------------------------

alter table public.admin_alerts drop constraint admin_alerts_kind_check;
alter table public.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('capture_failing', 'cancellation_failing', 'hold_cancelled', 'collection_failing', 'match_sync_failed',
                  'payout_failing', 'payout_reversed', 'payout_missing', 'books_unbalanced', 'connect_deauthorized'));
