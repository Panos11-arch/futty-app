-- P6a: cash and counter money in the ledger (docs/specs/13-payments-
-- bookings.md "Venue dashboard", decided 13 November).
--
-- Revenue by source (P6b) is read from money_ledger.venue_cents, so money the
-- venue takes in person is recorded too:
--   cash_received  staff tick an app player's cash as paid: the share's
--                  pitch part at that moment (cash_cents), once per share
--                  (+amount); the venue hands it back only when the
--                  cancellation rules would give a card player money back
--                  (-amount, the reversal, once; cancellation_plan's
--                  cash_back_cents, applied by cancel_booking_internal in
--                  pay_dashboard_guards).
--   counter_paid   a walk-in or phone booking marked paid at the counter
--                  (+amount), or a paid one cancelled (-amount, the reversal).
-- Neither went through Futty or Stripe: the venue already holds the money.
-- So P4d's payouts and the books' balance check leave both kinds out by name.

alter table public.money_ledger drop constraint money_ledger_kind_check;
alter table public.money_ledger add constraint money_ledger_kind_check check (kind in (
  'hold', 'capture', 'cancel', 'refund', 'credit_issued', 'credit_returned', 'credit_spent', 'credit_expired',
  'venue_payable', 'transfer', 'debt_created', 'debt_settled', 'cash_received', 'counter_paid'));

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
);

-- Venue staff tick a cash player as paid (P4c), and now record it: the
-- share's pitch part paid in cash, once (ref cash:<share>). Same checks and
-- errors as before.
create or replace function public.mark_cash_received(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    raise exception 'share_not_found';
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if not public.is_venue_staff(v_booking.venue_id, auth.uid()) then
    raise exception 'not_venue_staff';
  end if;
  if v_share.payment_method <> 'cash' then
    raise exception 'not_cash';
  end if;
  if v_booking.status = 'cancelled' or v_share.status not in ('pending', 'authorized', 'paid') then
    raise exception 'share_not_active';
  end if;
  if exists (select 1 from public.booking_collections c where c.booking_id = v_booking.id) then
    raise exception 'collection_started';
  end if;
  if v_share.cash_received_at is not null then
    -- Already received (ticked, or paid by card in the app): nothing new.
    return;
  end if;
  update public.booking_payment_shares
  set cash_received_at = now(), cash_received_by = auth.uid()
  where id = p_share_id;
  if v_share.cash_cents > 0 then
    perform public.record_ledger_entry(v_booking.id, v_share.id, null, 'cash_received', v_share.cash_cents,
                                       'cash:' || v_share.id, 'cash_received_at_venue', v_share.cash_cents, 0, 0);
  end if;
end;
$$;

revoke all on function public.mark_cash_received(uuid) from public, anon;
grant execute on function public.mark_cash_received(uuid) to authenticated, service_role;

-- Ticked cash handed back (decided 13 November, Dimitris; for Panos to
-- confirm): the reversing cash_received row for one share, once (ref
-- cash_reversal:<share>). Nothing if its cash was never ticked. Called only
-- by cancel_booking_internal, when cancellation_plan says the cash goes back.
create or replace function public.reverse_cash_received(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.money_ledger;
begin
  select * into v_row from public.money_ledger where kind = 'cash_received' and ref = 'cash:' || p_share_id;
  if v_row.id is null then
    return false;
  end if;
  return public.record_ledger_entry(v_row.booking_id, p_share_id, null, 'cash_received', v_row.amount_cents,
                                    'cash_reversal:' || p_share_id, 'cash_returned', -v_row.amount_cents, 0, 0);
end;
$$;


revoke all on function public.reverse_cash_received(uuid) from public, anon, authenticated;
grant execute on function public.reverse_cash_received(uuid) to service_role;

-- The books for one booking: venue + Futty + Stripe + refunds + credit =
-- taken (spec 13, "The books always balance"). Money the venue took in
-- person (cash_received, counter_paid) never went through Stripe, so it's
-- left out by name.
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
      and l.kind not in ('cash_received', 'counter_paid')
  ) t;
$$;

revoke all on function public.money_balance(uuid) from public, anon, authenticated;
grant execute on function public.money_balance(uuid) to service_role;
