-- P4a: booking modes, the share breakdown, the booker's guarantee, the
-- money ledger and the retry queue for money that still has to go back
-- (docs/specs/13-payments-bookings.md, "Booking modes", "When money is held
-- and taken", "Server-side checks").

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
--   capture_method              manual = held, taken when the free hour
--                               ends; immediate = taken at once
--   non_refundable_accepted_at  when the player accepted "This booking is
--                               non-refundable"
--   held_at, capture_due_at     when the card was held and when it's taken
--   stripe_payment_method_id    the card saved with this payment
--   stripe_setup_intent_id      the SetupIntent saving a card when nothing
--                               is charged (a Premium cash booker)
-- The breakdown, method and capture method only ever change together with
-- stripe_payment_intent_id (attach_share_intent), so they always describe
-- the intent on the share.
-- 'covered' = a spot in a booking the booker paid for in full.
alter table public.booking_payment_shares
  add column pitch_cents integer check (pitch_cents >= 0),
  add column fee_cents integer check (fee_cents >= 0),
  add column cash_cents integer not null default 0 check (cash_cents >= 0),
  add column payment_method text not null default 'card' check (payment_method in ('card', 'cash')),
  add column capture_method text check (capture_method in ('manual', 'immediate')),
  add column non_refundable_accepted_at timestamptz,
  add column held_at timestamptz,
  add column capture_due_at timestamptz,
  add column stripe_payment_method_id text,
  add column stripe_setup_intent_id text;

alter table public.booking_payment_shares drop constraint booking_payment_shares_status_check;
alter table public.booking_payment_shares add constraint booking_payment_shares_status_check
  check (status in ('pending', 'authorized', 'paid', 'refunded', 'cancelled', 'covered'));

create index booking_payment_shares_capture_due_idx on public.booking_payment_shares (capture_due_at)
  where status = 'authorized';

-- The booker's guarantee (each_pays_responsible): their saved card, held for
-- the full pitch price at hold_due_at (72 hours before kickoff, or at
-- booking when closer). A failed hold is retried at next_attempt_at, until
-- kickoff, and never cancels the booking.
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

-- Every hold, capture, cancel and refund, once each, with its reason and
-- where the money went. Plain ids, no foreign keys: the record outlives the
-- rows it describes. Append-only: nobody can update or delete.
--   stripe_intent_id  the PaymentIntent the movement is on
--   stripe_id         the Stripe object of this movement: the intent for a
--                     hold, capture or cancel; the refund (re_...) for a
--                     refund, so several refunds on one intent are each
--                     recorded once
--   venue_cents, futty_cents, stripe_fee_cents
--                     the split, signed: a capture adds to them (venue =
--                     the pitch part charged, Futty = the service fee less
--                     Stripe's fee, Stripe = its actual fee) and adds up to
--                     the amount; a refund takes from them (the venue's part
--                     first, then Futty's; Stripe keeps its fee) and adds up
--                     to minus the amount; a hold or cancel moves no money.
-- So for every booking, venue + Futty + Stripe + refunds = what was taken
-- (money_balance), the check spec 13 asks for daily.
create table public.money_ledger (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  share_id uuid,
  guarantee_id uuid,
  kind text not null check (kind in ('hold', 'capture', 'cancel', 'refund')),
  amount_cents integer not null check (amount_cents >= 0),
  stripe_intent_id text not null,
  stripe_id text not null,
  venue_cents integer not null default 0,
  futty_cents integer not null default 0,
  stripe_fee_cents integer not null default 0,
  reason text not null check (reason <> ''),
  created_at timestamptz not null default now(),
  unique (kind, stripe_id),
  constraint money_ledger_refund_id_check check (kind <> 'refund' or stripe_id like 're\_%'),
  constraint money_ledger_split_check check (
    (kind in ('hold', 'cancel') and venue_cents = 0 and futty_cents = 0 and stripe_fee_cents = 0
       and stripe_id = stripe_intent_id)
    or (kind = 'capture' and stripe_id = stripe_intent_id and venue_cents >= 0 and stripe_fee_cents >= 0
       and venue_cents + futty_cents + stripe_fee_cents = amount_cents)
    or (kind = 'refund' and venue_cents <= 0 and stripe_fee_cents = 0
       and venue_cents + futty_cents = -amount_cents)
  )
);

create index money_ledger_booking_idx on public.money_ledger (booking_id);
create index money_ledger_intent_idx on public.money_ledger (stripe_intent_id);

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
  p_stripe_intent_id text,
  p_stripe_id text,
  p_reason text,
  p_venue_cents integer default 0,
  p_futty_cents integer default 0,
  p_stripe_fee_cents integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.money_ledger (booking_id, share_id, guarantee_id, kind, amount_cents, stripe_intent_id, stripe_id,
                                   venue_cents, futty_cents, stripe_fee_cents, reason)
  values (p_booking_id, p_share_id, p_guarantee_id, p_kind, p_amount_cents, p_stripe_intent_id, p_stripe_id,
          p_venue_cents, p_futty_cents, p_stripe_fee_cents, p_reason)
  on conflict (kind, stripe_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

-- Money taken on an intent: p_fee_cents of it is Futty's service fee (the
-- rest is the venue's pitch money) and Stripe kept p_stripe_fee_cents of
-- that fee (its actual fee, from the charge's balance transaction).
create or replace function public.record_intent_capture(
  p_booking_id uuid,
  p_share_id uuid,
  p_guarantee_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_fee_cents integer,
  p_stripe_fee_cents integer,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_fee_cents is null or p_fee_cents < 0 or p_fee_cents > p_amount_cents
     or p_stripe_fee_cents is null or p_stripe_fee_cents < 0 then
    raise exception 'invalid_split';
  end if;
  return public.record_money_movement(p_booking_id, p_share_id, p_guarantee_id, 'capture', p_amount_cents,
    p_intent_id, p_intent_id, p_reason,
    p_amount_cents - p_fee_cents, p_fee_cents - p_stripe_fee_cents, p_stripe_fee_cents);
end;
$$;

-- A refund (re_...) on an intent whose capture is in the ledger. The venue's
-- part is given back first, then Futty's; Stripe keeps its fee. Refunds can
-- never add up to more than was taken.
create or replace function public.record_intent_refund(
  p_intent_id text,
  p_refund_id text,
  p_amount_cents integer,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture public.money_ledger;
  v_refunded integer;
  v_venue_left integer;
  v_venue integer;
begin
  if exists (select 1 from public.money_ledger where kind = 'refund' and stripe_id = p_refund_id) then
    return false;
  end if;
  select * into v_capture from public.money_ledger where kind = 'capture' and stripe_id = p_intent_id;
  if v_capture.id is null then
    raise exception 'capture_not_recorded';
  end if;
  select coalesce(sum(amount_cents), 0), v_capture.venue_cents + coalesce(sum(venue_cents), 0)
  into v_refunded, v_venue_left
  from public.money_ledger where kind = 'refund' and stripe_intent_id = p_intent_id;
  if p_amount_cents < 1 or v_refunded + p_amount_cents > v_capture.amount_cents then
    raise exception 'refund_exceeds_capture';
  end if;
  v_venue := least(p_amount_cents, v_venue_left);
  return public.record_money_movement(v_capture.booking_id, v_capture.share_id, v_capture.guarantee_id, 'refund',
    p_amount_cents, p_intent_id, p_refund_id, p_reason, -v_venue, -(p_amount_cents - v_venue), 0);
end;
$$;

-- The books for one booking: venue + Futty + Stripe + refunds = taken.
create or replace function public.money_balance(p_booking_id uuid)
returns table (taken_cents integer, refunded_cents integer, venue_cents integer, futty_cents integer,
               stripe_fee_cents integer, balanced boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.taken, t.refunded, t.venue, t.futty, t.stripe, t.venue + t.futty + t.stripe + t.refunded = t.taken
  from (
    select coalesce(sum(amount_cents) filter (where kind = 'capture'), 0)::integer as taken,
           coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::integer as refunded,
           coalesce(sum(l.venue_cents), 0)::integer as venue,
           coalesce(sum(l.futty_cents), 0)::integer as futty,
           coalesce(sum(l.stripe_fee_cents), 0)::integer as stripe
    from public.money_ledger l
    where l.booking_id = p_booking_id
  ) t;
$$;

revoke all on function public.record_money_movement(uuid, uuid, uuid, text, integer, text, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_money_movement(uuid, uuid, uuid, text, integer, text, text, text, integer, integer, integer)
  to service_role;
revoke all on function public.record_intent_capture(uuid, uuid, uuid, text, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.record_intent_capture(uuid, uuid, uuid, text, integer, integer, integer, text) to service_role;
revoke all on function public.record_intent_refund(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_intent_refund(text, text, integer, text) to service_role;
revoke all on function public.money_balance(uuid) from public, anon, authenticated;
grant execute on function public.money_balance(uuid) to service_role;

-- Money that still has to go back: a hold to release or a payment to
-- refund whose Stripe call failed. run-payment-jobs works through it until
-- each succeeds; every attempt is logged in money_release_attempts.
create table public.money_releases (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  share_id uuid,
  guarantee_id uuid,
  stripe_intent_id text not null,
  reason text not null check (reason <> ''),
  status text not null default 'pending' check (status in ('pending', 'done')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create unique index money_releases_one_pending_idx on public.money_releases (stripe_intent_id) where status = 'pending';
create index money_releases_due_idx on public.money_releases (next_attempt_at) where status = 'pending';

create table public.money_release_attempts (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.money_releases (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null,
  outcome text,
  error text
);

alter table public.money_releases enable row level security;
alter table public.money_release_attempts enable row level security;
revoke all on public.money_releases, public.money_release_attempts from public, anon, authenticated;
grant select on public.money_releases, public.money_release_attempts to service_role;

-- How long before a failed release is tried again. Operational, not a
-- money rule: 5 minutes, doubling, at most 6 hours.
create or replace function public.money_release_retry_at(p_attempts integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now() + least(interval '5 minutes' * power(2, greatest(p_attempts - 1, 0)), interval '6 hours');
$$;

-- A release whose Stripe call just failed: queued (or, if it already is,
-- this counts as another failed attempt). Returns the queue row.
create or replace function public.queue_money_release(
  p_booking_id uuid,
  p_share_id uuid,
  p_guarantee_id uuid,
  p_intent_id text,
  p_reason text,
  p_error text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.money_releases where stripe_intent_id = p_intent_id and status = 'pending' for update;
  if v_id is null then
    insert into public.money_releases (booking_id, share_id, guarantee_id, stripe_intent_id, reason)
    values (p_booking_id, p_share_id, p_guarantee_id, p_intent_id, p_reason)
    returning id into v_id;
  end if;
  perform public.money_release_attempted(v_id, false, null, p_error);
  return v_id;
end;
$$;

-- Releases due for another try.
create or replace function public.money_releases_due()
returns table (release_id uuid, booking_id uuid, share_id uuid, guarantee_id uuid, stripe_intent_id text, reason text,
               attempts integer)
language sql
stable
security definer
set search_path = ''
as $$
  select id, booking_id, share_id, guarantee_id, stripe_intent_id, reason, attempts
  from public.money_releases
  where status = 'pending' and next_attempt_at <= now()
  order by next_attempt_at;
$$;

-- One attempt at a queued release, logged; done when it succeeded.
create or replace function public.money_release_attempted(p_release_id uuid, p_succeeded boolean, p_outcome text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.money_release_attempts (release_id, succeeded, outcome, error)
  values (p_release_id, p_succeeded, p_outcome, p_error);
  if p_succeeded then
    update public.money_releases set status = 'done', done_at = now(), attempts = attempts + 1, last_error = null
    where id = p_release_id and status = 'pending';
  else
    update public.money_releases
    set attempts = attempts + 1, last_error = p_error, next_attempt_at = public.money_release_retry_at(attempts + 1)
    where id = p_release_id and status = 'pending';
  end if;
end;
$$;

revoke all on function public.money_release_retry_at(integer) from public, anon, authenticated;
grant execute on function public.money_release_retry_at(integer) to service_role;
revoke all on function public.queue_money_release(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.queue_money_release(uuid, uuid, uuid, text, text, text) to service_role;
revoke all on function public.money_releases_due() from public, anon, authenticated;
grant execute on function public.money_releases_due() to service_role;
revoke all on function public.money_release_attempted(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.money_release_attempted(uuid, boolean, text, text) to service_role;

-- Notification type for a failed guarantee hold (contract 4; A2 builds the
-- real send_notification, P3 added the stub).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed', 'match_payment_due',
  'team_invite', 'booking_invite', 'venue_closed_new_bookings', 'guarantee_hold_failed'
]));

-- The old 3-hour auto-cancel (cancel-unpaid-bookings) only for bookings made
-- before P4a. New bookings have the 15-minute payment window instead
-- (bookings_past_payment_window).
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
