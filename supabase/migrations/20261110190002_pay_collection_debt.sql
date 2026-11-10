-- P4c: debt, cash at the venue and saved cards (docs/specs/13-payments-bookings.md,
-- "Cash, debt and venue credit", "When money is held and taken" step 6,
-- "Server-side checks"; 14, P4c items 3 and 4).
--   - A player with any unsettled debt, to any venue or to Futty, can't
--     book, join a booking or choose cash anywhere (player_in_debt), but can
--     always pay the debt. Paying adds no fee.
--   - The venue's staff tick cash, run collection early (once the match
--     has ended) and mark debts to their venue settled.
--   - After the match an unticked cash player can pay their cash part by
--     card, no fee, until collection starts.
--   - The booker's whole-team cancellation charge still unpaid at the
--     original kickoff becomes a debt to Futty (decided 10 November).
--   - Every player who could owe money saves a card: a Premium cash player
--     who isn't the booker now saves one with a SetupIntent instead of
--     being refused (P4a's TODO).

-- Internal: does this player owe anything, anywhere?
create or replace function public.profile_has_debt(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.venue_debts where profile_id = p_profile_id and settled_at is null);
$$;

-- For the app: is the signed-in player in debt? (Players can only ask about themselves.)
create or replace function public.player_in_debt(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from p_profile_id then
    raise exception 'not_allowed';
  end if;
  return public.profile_has_debt(p_profile_id);
end;
$$;

-- Booking and joining are refused for a player in debt, whichever way
-- they come in (book_slot, an accepted invite, a squad post, the booker
-- adding them): every booking a player makes and every spot they take is
-- a row in these tables. Owner blocks aren't bookings by a player.
create or replace function public.refuse_debtor_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_type = 'user_booking' and public.profile_has_debt(new.created_by) then
    raise exception 'player_in_debt';
  end if;
  return new;
end;
$$;
create trigger refuse_debtor_booking before insert on public.venue_bookings
  for each row execute function public.refuse_debtor_booking();

create or replace function public.refuse_debtor_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.profile_has_debt(new.profile_id) then
    raise exception 'player_in_debt';
  end if;
  return new;
end;
$$;
create trigger refuse_debtor_share before insert on public.booking_payment_shares
  for each row execute function public.refuse_debtor_share();

-- As in 20261110131949_pay_cancellations_undo, plus (P4c):
--   - choosing cash is refused for a player in debt (player_in_debt);
--   - no share can be paid once its booking's collection is due or
--     started: what's unpaid is collected instead (collection_started);
--   - a share with nothing to charge by card in an each-pays booking saves
--     the player's card (needs_saved_card), whoever they are: every player
--     who could owe money saves a card (spec 13, step 6). A covered spot
--     in a pay-for-everyone booking never gets here (share_not_pending).
create or replace function public.share_payment_plan(
  p_share public.booking_payment_shares,
  p_profile_id uuid,
  p_method text,
  p_accept_non_refundable boolean,
  p_use_credit boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_amounts record;
  v_paid record;
  v_available integer;
  v_credit integer := 0;
  v_fee integer;
  v_card integer;
  v_non_refundable boolean := false;
  v_needs_card boolean := false;
  v_customer text;
begin
  if p_share.id is null then
    raise exception 'share_not_found';
  end if;
  if p_share.profile_id is distinct from p_profile_id then
    raise exception 'not_your_share';
  end if;
  if p_share.status <> 'pending' then
    raise exception 'share_not_pending';
  end if;
  select * into v_booking from public.venue_bookings where id = p_share.booking_id;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  select stripe_customer_id into v_customer from public.profiles where id = p_profile_id;

  if v_booking.payment_mode is null then
    if coalesce(p_use_credit, false) then
      raise exception 'credit_not_allowed_legacy';
    end if;
    return jsonb_build_object(
      'share_id', p_share.id, 'booking_id', p_share.booking_id, 'is_booker', p_share.is_booker,
      'payment_mode', null, 'status', p_share.status, 'payment_method', p_share.payment_method,
      'amount_cents', p_share.amount_cents, 'stripe_payment_intent_id', p_share.stripe_payment_intent_id,
      'stripe_customer_id', v_customer, 'needs_saved_card', false, 'credit_cents', 0);
  end if;

  if public.collection_is_due(v_booking)
     or exists (select 1 from public.booking_collections c where c.booking_id = v_booking.id) then
    raise exception 'collection_started';
  end if;
  if p_method = 'cash' and public.profile_has_debt(p_profile_id) then
    raise exception 'player_in_debt';
  end if;

  if p_share.is_booker and v_booking.status = 'pending_payment'
     and now() > public.booking_payment_window_ends_at(v_booking) then
    raise exception 'payment_window_closed';
  end if;

  select * into v_amounts from public.money_share(
    v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, p_share.is_booker,
    exists (select 1 from public.profiles where id = p_profile_id and is_premium), p_method);
  v_fee := v_amounts.fee_cents;
  v_card := v_amounts.card_cents;

  if coalesce(p_use_credit, false) then
    if p_method <> 'card' then
      raise exception 'credit_needs_card';
    end if;
    -- What's free at this venue, plus what this share already set aside.
    v_available := public.venue_credit_available_cents(p_profile_id, v_booking.venue_id)
      + coalesce((select sum(sp.amount_cents) from public.venue_credit_spends sp
                  join public.venue_credits c on c.id = sp.credit_id
                  where sp.share_id = p_share.id and sp.status = 'reserved' and c.expires_at > now()), 0);
    if v_available <= 0 then
      raise exception 'no_credit_at_venue';
    end if;
    select * into v_paid from public.money_credit_payment(v_amounts.pitch_cents, v_amounts.fee_cents, v_available);
    v_credit := v_paid.credit_cents;
    v_fee := v_paid.fee_cents;
    v_card := v_paid.card_cents;
  end if;

  v_non_refundable := public.money_is_non_refundable(now(), public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time));
  if v_non_refundable and not coalesce(p_accept_non_refundable, false) then
    raise exception 'non_refundable_not_accepted';
  end if;

  if v_card = 0 then
    -- Nothing to charge by card: the card is saved instead, so top-ups
    -- and debts can be charged later.
    if not (v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot') or v_credit > 0) then
      raise exception 'saved_card_required';
    end if;
    v_needs_card := true;
  end if;

  return jsonb_build_object(
    'share_id', p_share.id,
    'booking_id', p_share.booking_id,
    'is_booker', p_share.is_booker,
    'payment_mode', v_booking.payment_mode,
    'status', p_share.status,
    'payment_method', p_method,
    'amount_cents', v_card,
    'pitch_cents', v_amounts.pitch_cents,
    'fee_cents', v_fee,
    'cash_cents', v_amounts.cash_cents,
    'credit_cents', v_credit,
    'capture_method', case when v_non_refundable then 'immediate' else 'manual' end,
    'non_refundable', v_non_refundable,
    'stripe_payment_intent_id', p_share.stripe_payment_intent_id,
    'stripe_customer_id', v_customer,
    'needs_saved_card', v_needs_card
  );
end;
$$;

-- Internal: is the caller staff of this venue?
create or replace function public.is_venue_staff(p_venue_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null
     and exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_profile_id = p_profile_id);
$$;

-- Venue staff: a cash player paid in person ("cash - paid"). Until
-- collection starts; after that an unticked player's cash is a debt (or
-- was taken from the booker's hold), which the venue settles instead.
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
  update public.booking_payment_shares
  set cash_received_at = coalesce(cash_received_at, now()),
      cash_received_by = case when cash_received_at is null then auth.uid() else cash_received_by end
  where id = p_share_id;
end;
$$;

-- Venue staff: collect now instead of 2 hours after the match, once the
-- match has ended (decided 10 November). run-collection picks it up on its
-- next run.
create or replace function public.request_collection(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_venue_staff(v_booking.venue_id, auth.uid()) then
    raise exception 'not_venue_staff';
  end if;
  if v_booking.payment_mode is null or v_booking.payment_mode not in ('each_pays_responsible', 'each_pays_own_spot') then
    raise exception 'nothing_to_collect';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'booking_not_confirmed';
  end if;
  if exists (select 1 from public.booking_collections c where c.booking_id = p_booking_id) then
    raise exception 'already_collected';
  end if;
  if now() < public.booking_ends_at(v_booking.booking_day, v_booking.end_time) then
    raise exception 'match_not_over';
  end if;
  update public.venue_bookings set collection_requested_at = coalesce(collection_requested_at, now())
  where id = p_booking_id;
end;
$$;

-- Internal: a debt is settled (paid, or marked by the venue), recorded and
-- the player told.
create or replace function public.debt_settled_now(p_debt public.venue_debts, p_by text, p_by_profile uuid, p_intent_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt public.venue_debts;
begin
  update public.venue_debts
  set settled_at = now(), settled_by = p_by, settled_by_profile = p_by_profile,
      paid_intent_id = p_intent_id
  where id = p_debt.id and settled_at is null
  returning * into v_debt;
  if v_debt.id is null then
    return;
  end if;
  perform public.record_debt_entry(v_debt, 'debt_settled', 'debt-settled-' || v_debt.id,
                                   case when p_by = 'venue' then 'debt_settled_by_venue' else 'debt_paid' end);
  perform public.send_notification(v_debt.profile_id, 'debt_settled', jsonb_build_object(
    'title', 'Debt cleared',
    'body', case when p_by = 'venue'
                 then format('%s marked your %s as paid. You can book and join games again.',
                             (select v.name from public.venues v where v.id = v_debt.venue_id),
                             public.money_format_euros(v_debt.amount_cents))
                 else format('Your %s is paid. You can book and join games again.',
                             public.money_format_euros(v_debt.amount_cents)) end,
    'debtId', v_debt.id,
    'bookingId', v_debt.booking_id,
    'amountCents', v_debt.amount_cents
  ));
end;
$$;

-- Venue staff: a debt to their venue was settled outside the app.
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
end;
$$;

-- pay-owed, step 1, as the verified caller: what paying one debt costs.
-- Exactly the debt: no fee is added (spec 13: Futty absorbs Stripe's cost).
create or replace function public.plan_debt_payment(p_debt_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_debt public.venue_debts;
begin
  select * into v_debt from public.venue_debts where id = p_debt_id;
  if v_debt.id is null then
    raise exception 'debt_not_found';
  end if;
  if v_debt.profile_id is distinct from p_profile_id then
    raise exception 'not_your_debt';
  end if;
  if v_debt.settled_at is not null then
    raise exception 'debt_settled';
  end if;
  return jsonb_build_object(
    'kind', 'debt',
    'debt_id', v_debt.id,
    'booking_id', v_debt.booking_id,
    'owed_to', v_debt.owed_to,
    'venue_id', v_debt.venue_id,
    'amount_cents', v_debt.amount_cents,
    'venue_cents', v_debt.venue_cents,
    'futty_cents', v_debt.futty_cents,
    'stripe_payment_intent_id', v_debt.stripe_payment_intent_id,
    'stripe_customer_id', (select stripe_customer_id from public.profiles where id = p_profile_id)
  );
end;
$$;

-- pay-owed, step 2: the intent Stripe created goes on the debt, only if
-- nothing changed (the debt still has the intent the caller saw, and the
-- amount is still the debt).
create or replace function public.attach_debt_intent(
  p_debt_id uuid,
  p_profile_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_expected_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt public.venue_debts;
begin
  select * into v_debt from public.venue_debts where id = p_debt_id for update;
  perform public.plan_debt_payment(p_debt_id, p_profile_id);
  if v_debt.stripe_payment_intent_id is distinct from p_expected_intent_id or p_amount_cents is distinct from v_debt.amount_cents then
    raise exception 'debt_changed';
  end if;
  update public.venue_debts set stripe_payment_intent_id = p_intent_id where id = p_debt_id;
end;
$$;

-- Webhook, payment_intent.succeeded for a debt: recorded (the venue's part
-- to the venue, Futty's part less Stripe's fee to Futty) and the debt
-- settled. A payment for a debt already settled, or for the wrong amount,
-- is given back ('refund').
create or replace function public.debt_paid(p_debt_id uuid, p_intent_id text, p_amount_cents integer, p_stripe_fee_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt public.venue_debts;
begin
  select * into v_debt from public.venue_debts where id = p_debt_id for update;
  if v_debt.id is null then
    raise exception 'debt_not_found';
  end if;
  if v_debt.settled_at is not null and v_debt.paid_intent_id = p_intent_id then
    return jsonb_build_object('result', 'duplicate');
  end if;
  perform public.record_intent_capture(v_debt.booking_id, null, null, p_intent_id, p_amount_cents,
                                       least(v_debt.futty_cents, p_amount_cents), p_stripe_fee_cents, 'debt_paid');
  if v_debt.settled_at is not null or p_amount_cents is distinct from v_debt.amount_cents then
    return jsonb_build_object('result', 'refund', 'booking_id', v_debt.booking_id,
      'reason', case when v_debt.settled_at is not null then 'debt_already_settled' else 'amount_mismatch' end);
  end if;
  perform public.debt_settled_now(v_debt, 'payment', v_debt.profile_id, p_intent_id);
  return jsonb_build_object('result', 'settled');
end;
$$;

-- pay-owed for a cash part, as the verified caller: after the match, an
-- unticked cash player pays their pitch part by card ("Pay €6.00 by card
-- now"), no fee, until collection starts.
create or replace function public.plan_cash_payment(p_share_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_amount integer;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id;
  if v_share.id is null then
    raise exception 'share_not_found';
  end if;
  if v_share.profile_id is distinct from p_profile_id then
    raise exception 'not_your_share';
  end if;
  if v_share.payment_method <> 'cash' then
    raise exception 'not_cash';
  end if;
  if v_share.status not in ('authorized', 'paid') then
    raise exception 'share_not_paid';
  end if;
  if v_share.cash_received_at is not null then
    raise exception 'cash_already_paid';
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  if public.collection_is_due(v_booking)
     or exists (select 1 from public.booking_collections c where c.booking_id = v_booking.id) then
    raise exception 'collection_started';
  end if;
  if now() < public.booking_ends_at(v_booking.booking_day, v_booking.end_time) then
    raise exception 'match_not_over';
  end if;
  select a.due_pitch_cents into v_amount from public.collection_amounts(v_booking.id) a where a.share_id = p_share_id;
  return jsonb_build_object(
    'kind', 'cash',
    'share_id', v_share.id,
    'booking_id', v_booking.id,
    'venue_id', v_booking.venue_id,
    'amount_cents', v_amount,
    'stripe_payment_intent_id', v_share.cash_intent_id,
    'stripe_customer_id', (select stripe_customer_id from public.profiles where id = p_profile_id)
  );
end;
$$;

create or replace function public.attach_cash_intent(
  p_share_id uuid,
  p_profile_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_expected_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_plan jsonb;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  v_plan := public.plan_cash_payment(p_share_id, p_profile_id);
  if v_share.cash_intent_id is distinct from p_expected_intent_id
     or p_amount_cents is distinct from (v_plan ->> 'amount_cents')::integer then
    raise exception 'share_changed';
  end if;
  update public.booking_payment_shares set cash_intent_id = p_intent_id where id = p_share_id;
end;
$$;

-- Webhook, payment_intent.succeeded for a cash part paid by card: all of
-- it is the venue's (Futty absorbs Stripe's fee), and it counts as paid in
-- cash. Paid twice, after the venue ticked it, after collection started,
-- on an intent the share no longer uses, or for the wrong amount: given
-- back ('refund').
create or replace function public.cash_paid_by_card(p_share_id uuid, p_intent_id text, p_amount_cents integer,
                                                    p_stripe_fee_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_due integer;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    raise exception 'share_not_found';
  end if;
  if v_share.cash_received_at is not null and v_share.cash_intent_id = p_intent_id then
    return jsonb_build_object('result', 'duplicate');
  end if;
  perform public.record_intent_capture(v_share.booking_id, v_share.id, null, p_intent_id, p_amount_cents, 0,
                                       p_stripe_fee_cents, 'cash_paid_by_card');
  select a.due_pitch_cents into v_due from public.collection_amounts(v_share.booking_id) a where a.share_id = p_share_id;
  if v_share.cash_received_at is not null
     or v_share.cash_intent_id is distinct from p_intent_id
     or exists (select 1 from public.booking_collections c where c.booking_id = v_share.booking_id)
     or p_amount_cents is distinct from v_due then
    return jsonb_build_object('result', 'refund', 'booking_id', v_share.booking_id, 'share_id', v_share.id,
                              'reason', 'cash_not_due');
  end if;
  update public.booking_payment_shares set cash_received_at = now(), cash_received_by = null where id = p_share_id;
  return jsonb_build_object('result', 'paid');
end;
$$;

-- Job: the booker's whole-team cancellation charge, still unpaid at the
-- original kickoff (when its retries stop), becomes the booker's debt to
-- Futty (decided 10 November), once. Returns how many.
create or replace function public.cancellation_fees_to_debts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.booking_cancellation_fees;
  v_count integer := 0;
begin
  for v_fee in
    select f.* from public.booking_cancellation_fees f
    where f.status <> 'paid' and now() >= f.stop_at
      and not exists (select 1 from public.venue_debts d where d.cancellation_fee_id = f.id)
    for update skip locked
  loop
    perform public.create_venue_debt(v_fee.profile_id, 'futty', null, v_fee.booking_id, v_fee.amount_cents, 0,
                                     v_fee.amount_cents, 'cancellation_fee', null, v_fee.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- As in 20261109180842_pay_cancellations_work, plus (P4c): once the charge
-- has become a debt to Futty, a late payment of it (the booker finishing
-- 3-D Secure, or one that was processing) settles that debt; if the debt
-- was already paid another way, this payment is given back.
create or replace function public.cancellation_fee_paid(p_fee_id uuid, p_intent_id text, p_amount_cents integer, p_stripe_fee_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.booking_cancellation_fees;
  v_debt public.venue_debts;
begin
  select * into v_fee from public.booking_cancellation_fees where id = p_fee_id for update;
  if v_fee.id is null then
    raise exception 'fee_not_found';
  end if;
  if v_fee.status = 'paid' and v_fee.paid_intent_id = p_intent_id then
    return jsonb_build_object('result', 'duplicate');
  end if;
  perform public.record_intent_capture(v_fee.booking_id, null, null, p_intent_id, p_amount_cents, p_amount_cents,
                                       p_stripe_fee_cents, 'cancellation_fee');
  if v_fee.status = 'paid' or p_amount_cents is distinct from v_fee.amount_cents then
    return jsonb_build_object('result', 'refund', 'booking_id', v_fee.booking_id,
      'reason', case when v_fee.status = 'paid' then 'duplicate_cancellation_fee' else 'amount_mismatch' end);
  end if;
  select * into v_debt from public.venue_debts where cancellation_fee_id = p_fee_id for update;
  if v_debt.id is not null and v_debt.settled_at is not null then
    return jsonb_build_object('result', 'refund', 'booking_id', v_fee.booking_id, 'reason', 'debt_already_settled');
  end if;
  update public.booking_cancellation_fees
  set status = 'paid', paid_intent_id = p_intent_id, stripe_payment_intent_id = p_intent_id, paid_at = now(),
      next_attempt_at = null, last_error = null
  where id = p_fee_id;
  if v_debt.id is not null then
    perform public.debt_settled_now(v_debt, 'payment', v_debt.profile_id, p_intent_id);
  end if;
  return jsonb_build_object('result', 'paid');
end;
$$;

revoke all on function public.profile_has_debt(uuid) from public, anon, authenticated;
grant execute on function public.profile_has_debt(uuid) to service_role;
revoke all on function public.player_in_debt(uuid) from public, anon;
grant execute on function public.player_in_debt(uuid) to authenticated, service_role;
revoke all on function public.refuse_debtor_booking() from public, anon, authenticated;
revoke all on function public.refuse_debtor_share() from public, anon, authenticated;
revoke all on function public.share_payment_plan(public.booking_payment_shares, uuid, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.share_payment_plan(public.booking_payment_shares, uuid, text, boolean, boolean)
  to service_role;
revoke all on function public.is_venue_staff(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_venue_staff(uuid, uuid) to service_role;
revoke all on function public.mark_cash_received(uuid) from public, anon;
grant execute on function public.mark_cash_received(uuid) to authenticated, service_role;
revoke all on function public.request_collection(uuid) from public, anon;
grant execute on function public.request_collection(uuid) to authenticated, service_role;
revoke all on function public.debt_settled_now(public.venue_debts, text, uuid, text) from public, anon, authenticated;
grant execute on function public.debt_settled_now(public.venue_debts, text, uuid, text) to service_role;
revoke all on function public.settle_debt(uuid) from public, anon;
grant execute on function public.settle_debt(uuid) to authenticated, service_role;
revoke all on function public.plan_debt_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.plan_debt_payment(uuid, uuid) to service_role;
revoke all on function public.attach_debt_intent(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.attach_debt_intent(uuid, uuid, text, integer, text) to service_role;
revoke all on function public.debt_paid(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.debt_paid(uuid, text, integer, integer) to service_role;
revoke all on function public.plan_cash_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.plan_cash_payment(uuid, uuid) to service_role;
revoke all on function public.attach_cash_intent(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.attach_cash_intent(uuid, uuid, text, integer, text) to service_role;
revoke all on function public.cash_paid_by_card(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.cash_paid_by_card(uuid, text, integer, integer) to service_role;
revoke all on function public.cancellation_fees_to_debts() from public, anon, authenticated;
grant execute on function public.cancellation_fees_to_debts() to service_role;
revoke all on function public.cancellation_fee_paid(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.cancellation_fee_paid(uuid, text, integer, integer) to service_role;
