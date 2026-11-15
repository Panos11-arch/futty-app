-- P6b: a debt settled at the venue is cash the venue received
-- (docs/specs/13-payments-bookings.md "Venue dashboard", decided 13
-- November, Dimitris; for Panos to confirm).
--
-- When staff mark a debt settled (settle_debt), the player paid the venue in
-- person: the whole debt, Futty's part included (which the venue then owes
-- Futty, the venue_payable row settle_debt already writes). So revenue by
-- source (app cash) can read it from money_ledger.venue_cents, it's recorded
-- once per debt:
--   debt_cash_received  +amount, all of it venue_cents (ref debt-cash-<debt>)
-- Like cash_received and counter_paid, it never went through Futty or
-- Stripe, so P4d's payouts and the books' balance check leave it out by
-- name. A debt paid by card in the app stays a Stripe capture (debt_paid).

alter table public.money_ledger drop constraint money_ledger_kind_check;
alter table public.money_ledger add constraint money_ledger_kind_check check (kind in (
  'hold', 'capture', 'cancel', 'refund', 'credit_issued', 'credit_returned', 'credit_spent', 'credit_expired',
  'venue_payable', 'transfer', 'debt_created', 'debt_settled', 'cash_received', 'counter_paid',
  'debt_cash_received'));

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
);

-- As in 20261111090000_pay_collection_decisions, plus: the debt the venue
-- received in person is recorded once as debt_cash_received.
create or replace function public.settle_debt(p_debt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt public.venue_debts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_debt from public.venue_debts where id = p_debt_id for update;
  if v_debt.id is null then
    raise exception 'debt_not_found';
  end if;
  if v_debt.owed_to <> 'venue' or not public.is_venue_staff(v_debt.venue_id, auth.uid()) then
    raise exception 'not_venue_staff';
  end if;
  if v_debt.settled_at is not null then
    raise exception 'debt_settled';
  end if;
  perform public.debt_settled_now(v_debt, 'venue', auth.uid(), null);
  insert into public.money_ledger (booking_id, debt_id, kind, amount_cents, ref, reason, venue_cents)
  values (v_debt.booking_id, v_debt.id, 'debt_cash_received', v_debt.amount_cents, 'debt-cash-' || v_debt.id,
          'debt_settled_at_venue', v_debt.amount_cents)
  on conflict (kind, ref) where ref is not null do nothing;
  if v_debt.futty_cents > 0 then
    insert into public.venue_payables (venue_id, booking_id, share_id, debt_id, amount_cents, reason)
    values (v_debt.venue_id, v_debt.booking_id, null, v_debt.id, v_debt.futty_cents, 'venue_settled_debt_fee')
    on conflict (debt_id) do nothing;
    if found then
      perform public.record_ledger_entry(v_debt.booking_id, null, null, 'venue_payable', v_debt.futty_cents,
        'venue-payable-debt-' || v_debt.id, 'venue_settled_debt_fee', -v_debt.futty_cents, v_debt.futty_cents, 0);
    end if;
  end if;
end;
$$;

revoke all on function public.settle_debt(uuid) from public, anon;
grant execute on function public.settle_debt(uuid) to authenticated, service_role;

-- Internal, one-off: debts the venue settled before debt_cash_received
-- existed already have their venue_payable (Futty's part), so without this
-- their period would show app cash of -€0.80 and no +€6.80. Each gets its
-- cash row, dated when it was settled, once (the ref is unique per debt).
-- Returns how many rows it wrote. Run below; kept so tests can run it again.
create or replace function public.backfill_debt_cash_received()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.money_ledger (booking_id, debt_id, kind, amount_cents, ref, reason, venue_cents, created_at)
  select d.booking_id, d.id, 'debt_cash_received', d.amount_cents, 'debt-cash-' || d.id, 'debt_settled_at_venue',
         d.amount_cents, d.settled_at
  from public.venue_debts d
  where d.owed_to = 'venue' and d.settled_by = 'venue' and d.settled_at is not null
  on conflict (kind, ref) where ref is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.backfill_debt_cash_received() from public, anon, authenticated;
grant execute on function public.backfill_debt_cash_received() to service_role;

select public.backfill_debt_cash_received();

-- As in 20261113220547_pay_dashboard_ledger: money the venue took in person
-- (cash_received, counter_paid, and now debt_cash_received) never went
-- through Stripe, so it's left out by name.
create or replace function public.money_balance(p_booking_id uuid)
returns table (taken_cents integer, refunded_cents integer, venue_cents integer, futty_cents integer,
               stripe_fee_cents integer, credit_cents integer, balanced boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.taken, t.refunded, t.venue, t.futty, t.stripe, t.credit,
         t.venue + t.futty + t.stripe + t.refunded = t.taken
  from (
    select coalesce(sum(amount_cents) filter (where kind = 'capture'), 0)::integer as taken,
           coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::integer as refunded,
           coalesce(sum(l.venue_cents), 0)::integer as venue,
           coalesce(sum(l.futty_cents), 0)::integer as futty,
           coalesce(sum(l.stripe_fee_cents), 0)::integer as stripe,
           coalesce(sum(l.credit_cents), 0)::integer as credit
    from public.money_ledger l
    where l.booking_id = p_booking_id
      and l.kind not in ('cash_received', 'counter_paid', 'debt_cash_received')
  ) t;
$$;

revoke all on function public.money_balance(uuid) from public, anon, authenticated;
grant execute on function public.money_balance(uuid) to service_role;
