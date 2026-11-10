-- P4c: collection, top-ups and debt (docs/specs/13-payments-bookings.md,
-- "When money is held and taken" steps 6-9, "Short games, top-ups and
-- 6 v 6", "Cash, debt and venue credit"; 14, P4c). The tables, the new
-- share and guarantee states, the ledger's debt entries, the notification
-- types, and the match_result_confirmed stub (contract 3).

-- Contract 3 (docs/specs/match-record.md section 6.2): exactly these
-- columns, no rows. A2 replaces it with create or replace view.
create view public.match_result_confirmed with (security_invoker = true) as
select
  null::uuid as match_id,
  null::uuid as booking_id,
  null::uuid as venue_id,
  null::uuid as friendly_match_id,
  null::uuid as league_fixture_id,
  null::uuid as side_a_team_id,
  null::uuid as side_b_team_id,
  null::integer as side_a_score,
  null::integer as side_b_score,
  null::text as outcome,
  null::text as result_status,
  null::boolean as disputed,
  null::text as confirmed_via,
  null::text as forfeit_side,
  null::text as forfeit_reason,
  null::timestamptz as kickoff_at,
  null::timestamptz as ends_at,
  null::timestamp as kickoff_local,
  null::timestamp as ends_local,
  null::timestamptz as settled_at
where false;
revoke all on public.match_result_confirmed from public, anon, authenticated;
grant select on public.match_result_confirmed to service_role;

-- Cash at the venue:
--   cash_received_at, cash_received_by  the venue's staff ticked it as paid
--                                       in person (by = null: the player
--                                       paid it by card after the match)
--   cash_prompted_at                    "Pay €6.00 by card now, or remain in
--                                       debt" was sent
--   cash_intent_id                      the card payment of the cash part
alter table public.booking_payment_shares
  add column cash_received_at timestamptz,
  add column cash_received_by uuid,
  add column cash_prompted_at timestamptz,
  add column cash_intent_id text;

--   short_game_warned_at      "You're 8 of 10" was checked (and sent if short)
--   collection_requested_at   the venue's staff asked to collect early
alter table public.venue_bookings
  add column short_game_warned_at timestamptz,
  add column collection_requested_at timestamptz;

-- The booker's guarantee after collection:
--   collected  what was unpaid was taken from it, the rest released
--   released   nothing was owed: all of it released
alter table public.booking_guarantees drop constraint booking_guarantees_status_check;
alter table public.booking_guarantees add constraint booking_guarantees_status_check
  check (status in ('awaiting_card', 'scheduled', 'held', 'failed', 'cancelled', 'collected', 'released'));
alter table public.booking_guarantees add column collected_cents integer check (collected_cents >= 0);

-- One collection per booking, 2 hours after the match (or earlier, when the
-- venue asks). It writes what each player owes (booking_collection_items),
-- charges the top-ups, then settles: in responsible mode from the booker's
-- guarantee; in just-my-spot mode as each player's debt.
--   status          top_ups    charging the top-ups
--                   guarantee  taking from (or releasing) the booker's hold
--                   done
--   joined_players  players holding a spot when it started
--   pitch_due_cents what the joined players owe for the pitch together
--   guarantee_action  capture / release / none, decided when settling;
--                     guarantee_capture_cents of it (guarantee_futty_cents
--                     of that the service fees covered, Futty's)
create table public.booking_collections (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.venue_bookings (id) on delete cascade,
  venue_id uuid not null,
  payment_mode text not null check (payment_mode in ('each_pays_responsible', 'each_pays_own_spot')),
  joined_players integer not null check (joined_players >= 0),
  pitch_due_cents integer not null check (pitch_due_cents >= 0),
  status text not null default 'top_ups' check (status in ('top_ups', 'guarantee', 'done')),
  guarantee_id uuid references public.booking_guarantees (id) on delete set null,
  guarantee_intent_id text,
  guarantee_action text check (guarantee_action in ('capture', 'release', 'none')),
  guarantee_capture_cents integer not null default 0 check (guarantee_capture_cents >= 0),
  guarantee_futty_cents integer not null default 0 check (guarantee_futty_cents >= 0),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  started_at timestamptz not null default now(),
  settled_at timestamptz,
  done_at timestamptz
);
create index booking_collections_open_idx on public.booking_collections (next_attempt_at) where status <> 'done';

-- What one player owed when collection started:
--   top_up        their card share paid less than their pitch part now
--                 (a short game): charged to their saved card, no fee
--   unpaid_share  their share was never paid: pitch part and service fee
--   unpaid_cash   cash the venue never ticked: their pitch part now
-- pitch_cents is the venue's part, fee_cents Futty's.
--   status  pending  a top-up still to charge
--           paid     the top-up was taken
--           unpaid   still owed (an unpaid share, unticked cash, a failed top-up)
--           covered  taken from the booker's guarantee
--           debt     owed as a debt (debt_id): the player's, or the booker's
create table public.booking_collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.booking_collections (id) on delete cascade,
  booking_id uuid not null,
  share_id uuid not null references public.booking_payment_shares (id) on delete cascade,
  profile_id uuid not null,
  kind text not null check (kind in ('top_up', 'unpaid_share', 'unpaid_cash')),
  amount_cents integer not null check (amount_cents > 0),
  pitch_cents integer not null check (pitch_cents >= 0),
  fee_cents integer not null check (fee_cents >= 0),
  status text not null check (status in ('pending', 'paid', 'unpaid', 'covered', 'debt')),
  stripe_payment_intent_id text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  debt_id uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (collection_id, share_id),
  constraint booking_collection_items_adds_up check (pitch_cents + fee_cents = amount_cents),
  constraint booking_collection_items_top_up check (kind <> 'top_up' or fee_cents = 0)
);
create index booking_collection_items_due_idx on public.booking_collection_items (next_attempt_at)
  where status = 'pending';

-- What a player owes: to a venue (venue_id) or to Futty (decided 10
-- November). Any unsettled debt blocks booking, joining and choosing cash
-- everywhere (player_in_debt); paying it adds no fee.
--   venue_cents, futty_cents  whose money it is when paid (the pitch part
--                             is the venue's, a service fee Futty's)
--   reason  unpaid_share        a share never paid (just my spot)
--           cash_unpaid         cash the venue never ticked (just my spot)
--           top_up_failed       a short game's top-up was declined (just my spot)
--           guarantee_not_held  the booker's guarantee hold never succeeded:
--                               what it would have covered (responsible)
--           cancellation_fee    the booker's whole-team cancellation charge,
--                               still unpaid at the original kickoff (Futty's)
--   settled_by  payment (by card in the app) or venue (marked settled by
--               the venue's staff)
--   stripe_payment_intent_id  the payment started for it in the app
create table public.venue_debts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  owed_to text not null check (owed_to in ('venue', 'futty')),
  venue_id uuid references public.venues (id),
  booking_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  venue_cents integer not null check (venue_cents >= 0),
  futty_cents integer not null check (futty_cents >= 0),
  reason text not null check (reason in ('unpaid_share', 'cash_unpaid', 'top_up_failed', 'guarantee_not_held',
                                         'cancellation_fee')),
  collection_id uuid references public.booking_collections (id) on delete set null,
  cancellation_fee_id uuid unique,
  stripe_payment_intent_id text,
  paid_intent_id text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  settled_by text check (settled_by in ('payment', 'venue')),
  settled_by_profile uuid,
  constraint venue_debts_adds_up check (venue_cents + futty_cents = amount_cents),
  constraint venue_debts_owed_to check ((owed_to = 'venue') = (venue_id is not null)),
  constraint venue_debts_futty_only check (owed_to = 'venue' or venue_cents = 0),
  constraint venue_debts_settled check ((settled_at is null) = (settled_by is null))
);
create index venue_debts_open_idx on public.venue_debts (profile_id) where settled_at is null;
create index venue_debts_venue_idx on public.venue_debts (venue_id) where venue_id is not null;

-- RLS: a player reads their own debts; a venue's staff read the debts owed
-- to their venue (spec 13: "The player sees how much they owe and to which
-- venue. The venue sees everyone who owes it."). Collections are read by
-- the booker and the venue. Every write goes through the functions.
alter table public.booking_collections enable row level security;
alter table public.booking_collection_items enable row level security;
alter table public.venue_debts enable row level security;

create policy "Players read their debts; venues the debts owed to them" on public.venue_debts
  for select to authenticated using (
    profile_id = auth.uid()
    or exists (select 1 from public.venues v where v.id = venue_id and v.owner_profile_id = auth.uid())
  );
create policy "Bookers and venues read their collections" on public.booking_collections
  for select to authenticated using (
    exists (select 1 from public.venue_bookings b where b.id = booking_id and b.created_by = auth.uid())
    or exists (select 1 from public.venues v where v.id = venue_id and v.owner_profile_id = auth.uid())
  );
create policy "Players read their items; bookers and venues the booking's" on public.booking_collection_items
  for select to authenticated using (
    profile_id = auth.uid()
    or exists (select 1 from public.venue_bookings b where b.id = booking_id and b.created_by = auth.uid())
    or exists (select 1 from public.venue_bookings b join public.venues v on v.id = b.venue_id
               where b.id = booking_id and v.owner_profile_id = auth.uid())
  );

revoke all on public.booking_collections, public.booking_collection_items, public.venue_debts
  from public, anon, authenticated;
grant select on public.booking_collections, public.booking_collection_items, public.venue_debts to authenticated;
grant all on public.booking_collections, public.booking_collection_items, public.venue_debts to service_role;

-- The ledger records debts as well as money (spec 14, P4c: "Every capture,
-- top-up, release and debt goes into money_ledger"). A debt moves no money
-- until it's paid (a capture) or settled at the venue:
--   debt_created  a player owes amount_cents
--   debt_settled  paid, or marked settled by the venue
-- Both record the amount only, keyed on our own ref, once.
alter table public.money_ledger add column debt_id uuid;
alter table public.money_ledger drop constraint money_ledger_kind_check;
alter table public.money_ledger add constraint money_ledger_kind_check check (kind in (
  'hold', 'capture', 'cancel', 'refund', 'credit_issued', 'credit_returned', 'credit_spent', 'credit_expired',
  'venue_payable', 'transfer', 'debt_created', 'debt_settled'));

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
);

-- Records a debt being created or settled, once (by p_ref).
create or replace function public.record_debt_entry(p_debt public.venue_debts, p_kind text, p_ref text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.money_ledger (booking_id, debt_id, kind, amount_cents, ref, reason)
  values (p_debt.booking_id, p_debt.id, p_kind, p_debt.amount_cents, p_ref, p_reason)
  on conflict (kind, ref) where ref is not null do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;
revoke all on function public.record_debt_entry(public.venue_debts, text, text, text) from public, anon, authenticated;
grant execute on function public.record_debt_entry(public.venue_debts, text, text, text) to service_role;

-- Collection failing again and again: for the founders to look at.
alter table public.admin_alerts drop constraint admin_alerts_kind_check;
alter table public.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('capture_failing', 'cancellation_failing', 'hold_cancelled', 'collection_failing'));

-- Notification types for collection and debt (contract 4, match-record.md
-- section 6.3; all "always sent").
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed', 'match_payment_due',
  'team_invite', 'booking_invite', 'venue_closed_new_bookings', 'guarantee_hold_failed',
  'booking_spot_released', 'cancellation_fee_failed',
  'short_game_warning', 'top_up_charged', 'debt_created', 'debt_settled', 'cash_unpaid_prompt'
]));
