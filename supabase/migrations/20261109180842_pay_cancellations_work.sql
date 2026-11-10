-- P4b: the Stripe work a cancellation leaves, the player's card-or-credit
-- choice, and the booker's extra charge (docs/specs/13-payments-bookings.md,
-- "Cancellations and refunds", and the 10 November decisions). All
-- service_role only: cancel-booking, choose-cancellation-refund,
-- stripe-webhook and run-payment-jobs call these with ids they checked.

-- Work still to do at Stripe:
--   release  cancel a hold (or refund a payment taken in the free hour)
--   capture  take a held share whose money is kept, before crediting it
--   refund   refund a share given back after the booker or venue
--            cancelled (the player chose card, or didn't choose in 48 hours)
-- p_cancellation_id = one cancellation's work, done by cancel-booking at
-- once (refunds wait for the choice); null = everything due, for the job.
create or replace function public.cancellation_work(p_cancellation_id uuid)
returns table (
  line_id uuid,
  kind text,
  booking_id uuid,
  share_id uuid,
  guarantee_id uuid,
  stripe_intent_id text,
  amount_cents integer,
  reason text,
  attempts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id,
         case l.action when 'release' then 'release' when 'refund_choice' then 'refund' else 'capture' end,
         l.booking_id, l.share_id, l.guarantee_id, l.stripe_intent_id, l.paid_cents, l.reason, l.attempts
  from public.booking_cancellation_lines l
  where l.work = 'pending'
    and case when p_cancellation_id is null then l.next_attempt_at <= now()
             else l.cancellation_id = p_cancellation_id and l.action <> 'refund_choice' end
  order by l.next_attempt_at, l.id;
$$;

-- One line's work, for choose-cancellation-refund right after a card choice.
create or replace function public.cancellation_line_work(p_line_id uuid)
returns table (
  line_id uuid,
  kind text,
  booking_id uuid,
  share_id uuid,
  guarantee_id uuid,
  stripe_intent_id text,
  amount_cents integer,
  reason text,
  attempts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id,
         case l.action when 'release' then 'release' when 'refund_choice' then 'refund' else 'capture' end,
         l.booking_id, l.share_id, l.guarantee_id, l.stripe_intent_id, l.paid_cents, l.reason, l.attempts
  from public.booking_cancellation_lines l
  where l.id = p_line_id and l.work = 'pending';
$$;

-- A release done (its movement is in the ledger, from release.ts).
create or replace function public.cancellation_line_done(p_line_id uuid, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.booking_cancellation_lines
  set work = 'done', outcome = p_outcome, done_at = now(), last_error = null
  where id = p_line_id and work = 'pending' and action = 'release';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- A held share whose money is kept was taken (Stripe's actual fee
-- p_stripe_fee_cents): recorded, then credit issued as quoted. Once.
create or replace function public.cancellation_line_captured(p_line_id uuid, p_amount_cents integer, p_stripe_fee_cents integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.booking_cancellation_lines;
  v_share public.booking_payment_shares;
  v_scope text;
begin
  select * into v_line from public.booking_cancellation_lines where id = p_line_id for update;
  if v_line.id is null or v_line.action not in ('keep', 'keep_and_credit') or not v_line.needs_capture then
    raise exception 'line_not_found';
  end if;
  if v_line.work = 'done' then
    return false;
  end if;
  select * into v_share from public.booking_payment_shares where id = v_line.share_id;
  if p_amount_cents is distinct from v_line.paid_cents then
    raise exception 'amount_mismatch';
  end if;
  perform public.record_intent_capture(v_line.booking_id, v_line.share_id, null, v_line.stripe_intent_id, p_amount_cents,
                                       v_share.fee_cents, p_stripe_fee_cents, 'cancellation_taken');
  select scope into v_scope from public.booking_cancellations where id = v_line.cancellation_id;
  perform public.cancellation_issue_credit(v_line, v_scope);
  update public.booking_cancellation_lines
  set work = 'done', outcome = 'captured', done_at = now(), last_error = null
  where id = p_line_id;
  return true;
end;
$$;

-- What a venue owes for a share it cancelled: Stripe's real fee on it (from
-- the capture's balance transaction, in the ledger). Once per share.
create or replace function public.cancellation_venue_payable(p_line public.booking_cancellation_lines)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee integer;
begin
  if p_line."window" <> 'venue' or p_line.stripe_intent_id is null or p_line.paid_cents = 0 then
    return;
  end if;
  select stripe_fee_cents into v_fee from public.money_ledger where kind = 'capture' and stripe_id = p_line.stripe_intent_id;
  if coalesce(v_fee, 0) = 0 then
    return;
  end if;
  insert into public.venue_payables (venue_id, booking_id, share_id, amount_cents, reason)
  values (p_line.venue_id, p_line.booking_id, p_line.share_id, v_fee, 'venue_cancelled_stripe_fee')
  on conflict (share_id, reason) do nothing;
  if found then
    perform public.record_ledger_entry(p_line.booking_id, p_line.share_id, null, 'venue_payable', v_fee,
      'venue-payable-' || p_line.share_id, 'venue_cancelled_stripe_fee', -v_fee, v_fee, 0);
  end if;
end;
$$;

-- A share given back by card: refunded (release.ts recorded the refund);
-- any credit that paid for it goes back to the player; the venue owes
-- Stripe's fee if it cancelled. Once.
create or replace function public.cancellation_line_refunded(p_line_id uuid, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.booking_cancellation_lines;
begin
  select * into v_line from public.booking_cancellation_lines where id = p_line_id for update;
  if v_line.id is null or v_line.action <> 'refund_choice' then
    raise exception 'line_not_found';
  end if;
  if v_line.work = 'done' then
    return false;
  end if;
  update public.booking_payment_shares set status = 'refunded' where id = v_line.share_id and status = 'refund_due';
  perform public.cancellation_venue_payable(v_line);
  update public.booking_cancellation_lines
  set work = 'done', outcome = p_outcome, choice = coalesce(choice, 'card'), done_at = now(), last_error = null
  where id = p_line_id;
  return true;
end;
$$;

-- A line's Stripe work failed: tried again after 1, 5, 15, 60 minutes, then
-- hourly; the third failure raises one admin alert.
create or replace function public.cancellation_line_failed(p_line_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.booking_cancellation_lines;
begin
  update public.booking_cancellation_lines
  set attempts = attempts + 1, last_error = p_error, next_attempt_at = public.money_backoff_at(attempts + 1)
  where id = p_line_id and work = 'pending'
  returning * into v_line;
  if v_line.id is null then
    return jsonb_build_object('result', 'ignored');
  end if;
  if v_line.attempts = 3 then
    insert into public.admin_alerts (kind, booking_id, share_id, details)
    values ('cancellation_failing', v_line.booking_id, v_line.share_id, jsonb_build_object(
      'line_id', v_line.id, 'action', v_line.action, 'attempts', v_line.attempts, 'last_error', p_error,
      'stripe_intent_id', v_line.stripe_intent_id, 'guarantee_id', v_line.guarantee_id))
    on conflict do nothing;
  end if;
  return jsonb_build_object('result', 'failed', 'attempts', v_line.attempts);
end;
$$;

-- choose-cancellation-refund, as the verified caller: card refund or venue
-- credit for a share given back, within 48 hours. Credit is issued at once
-- (the whole card payment as credit; credit that paid for the share goes
-- back to where it came from); a card refund is left for the caller to send
-- now ('refund').
create or replace function public.choose_cancellation_refund(p_line_id uuid, p_profile_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.booking_cancellation_lines;
  v_scope text;
begin
  select * into v_line from public.booking_cancellation_lines where id = p_line_id for update;
  if v_line.id is null or v_line.action <> 'refund_choice' then
    raise exception 'refund_not_found';
  end if;
  if p_choice is null or p_choice not in ('card', 'credit') then
    raise exception 'invalid_choice';
  end if;
  if v_line.profile_id is distinct from p_profile_id then
    raise exception 'not_your_refund';
  end if;
  if v_line.choice is not null or v_line.work = 'done' then
    raise exception 'already_chosen';
  end if;
  if now() >= v_line.choose_by then
    raise exception 'choice_closed';
  end if;

  if p_choice = 'card' then
    update public.booking_cancellation_lines set choice = 'card', chosen_at = now(), next_attempt_at = now()
    where id = p_line_id;
    return jsonb_build_object('result', 'refund', 'line_id', p_line_id, 'refund_cents', v_line.refund_cents);
  end if;

  select scope into v_scope from public.booking_cancellations where id = v_line.cancellation_id;
  update public.booking_payment_shares set status = 'credited' where id = v_line.share_id and status = 'refund_due';
  perform public.return_share_credit(v_line.share_id, 'chose_credit');
  if v_line.paid_cents > 0 then
    -- The whole card payment becomes credit: the venue's part and Futty's
    -- fee both go to the player's credit.
    perform public.issue_venue_credit(v_line.profile_id, v_line.venue_id, v_line.paid_cents,
      case v_scope when 'venue' then 'venue_cancelled' else 'booking_cancelled' end,
      v_line.booking_id, v_line.share_id, -(v_line.paid_cents - v_line.fee_cents), -v_line.fee_cents);
  end if;
  perform public.cancellation_venue_payable(v_line);
  update public.booking_cancellation_lines
  set choice = 'credit', chosen_at = now(), work = 'done', outcome = 'credited', done_at = now()
  where id = p_line_id;
  return jsonb_build_object('result', 'credited', 'line_id', p_line_id, 'credit_cents', v_line.refund_cents);
end;
$$;

-- The booker's extra charge, to try now: the attempt number (each try a
-- new Stripe request; 1 = on-session, when the booker confirms) and the
-- intent of the last try, which the caller checks at Stripe first. Nothing
-- once paid or from the original kickoff on.
create or replace function public.cancellation_fee_to_charge(p_fee_id uuid)
returns table (
  fee_id uuid,
  booking_id uuid,
  cancellation_id uuid,
  profile_id uuid,
  amount_cents integer,
  stripe_customer_id text,
  stripe_payment_method_id text,
  attempt integer,
  off_session boolean,
  previous_intent_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.booking_id, f.cancellation_id, f.profile_id, f.amount_cents, f.stripe_customer_id,
         f.stripe_payment_method_id, f.attempts + 1, f.attempts > 0, f.stripe_payment_intent_id
  from public.booking_cancellation_fees f
  where f.id = p_fee_id and f.status <> 'paid' and now() < f.stop_at;
$$;

-- Job: extra charges to retry now (until the original kickoff).
create or replace function public.cancellation_fees_due()
returns table (fee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id from public.booking_cancellation_fees f
  where f.status <> 'paid' and f.next_attempt_at <= now() and now() < f.stop_at
  order by f.next_attempt_at;
$$;

-- An attempt at the extra charge didn't take it:
--   requires_action  the bank asked for 3-D Secure while the booker was in
--                    the app: shown there; retried off-session in 6 hours
--   failed           declined or can't be used: the booker is told once;
--                    retried in 6 hours
--   error            no answer from Stripe: the same attempt again after a
--                    back-off; nobody told
create or replace function public.cancellation_fee_attempted(p_fee_id uuid, p_intent_id text, p_outcome text, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.booking_cancellation_fees;
  v_notify boolean := false;
begin
  if p_outcome not in ('requires_action', 'failed', 'error') then
    raise exception 'invalid_outcome';
  end if;
  select * into v_fee from public.booking_cancellation_fees where id = p_fee_id for update;
  if v_fee.id is null or v_fee.status = 'paid' then
    return jsonb_build_object('result', 'ignored');
  end if;

  if p_outcome = 'error' then
    update public.booking_cancellation_fees
    set api_errors = api_errors + 1, last_error = p_error, next_attempt_at = public.money_backoff_at(api_errors + 1),
        stripe_payment_intent_id = coalesce(p_intent_id, stripe_payment_intent_id)
    where id = p_fee_id;
    return jsonb_build_object('result', 'retry');
  end if;

  v_notify := p_outcome = 'failed' and v_fee.failure_notified_at is null;
  update public.booking_cancellation_fees
  set status = p_outcome, attempts = attempts + 1, api_errors = 0, last_error = coalesce(p_error, p_outcome),
      stripe_payment_intent_id = coalesce(p_intent_id, stripe_payment_intent_id),
      next_attempt_at = public.money_guarantee_retry_at(now()),
      failure_notified_at = case when v_notify then now() else failure_notified_at end
  where id = p_fee_id;

  if v_notify then
    perform public.send_notification(v_fee.profile_id, 'cancellation_fee_failed', jsonb_build_object(
      'title', 'Update your card',
      'body', format('We couldn''t take the %s for cancelling your team''s game (%s players x €1.00). '
                     || 'The game is still cancelled. Update your card and we''ll try again.',
                     public.money_format_euros(v_fee.amount_cents), v_fee.players),
      'bookingId', v_fee.booking_id,
      'feeId', v_fee.id
    ));
  end if;
  return jsonb_build_object('result', p_outcome, 'notified', v_notify);
end;
$$;

-- The extra charge was taken (webhook or cancel-booking; Stripe's actual
-- fee p_stripe_fee_cents). All of it is Futty's. A second payment for the
-- same charge (a late 3-D Secure on an earlier try), or a wrong amount, is
-- recorded and answered 'refund'.
create or replace function public.cancellation_fee_paid(p_fee_id uuid, p_intent_id text, p_amount_cents integer, p_stripe_fee_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.booking_cancellation_fees;
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
  update public.booking_cancellation_fees
  set status = 'paid', paid_intent_id = p_intent_id, stripe_payment_intent_id = p_intent_id, paid_at = now(),
      next_attempt_at = null, last_error = null
  where id = p_fee_id;
  return jsonb_build_object('result', 'paid');
end;
$$;

revoke all on function public.cancellation_work(uuid) from public, anon, authenticated;
grant execute on function public.cancellation_work(uuid) to service_role;
revoke all on function public.cancellation_line_work(uuid) from public, anon, authenticated;
grant execute on function public.cancellation_line_work(uuid) to service_role;
revoke all on function public.cancellation_line_done(uuid, text) from public, anon, authenticated;
grant execute on function public.cancellation_line_done(uuid, text) to service_role;
revoke all on function public.cancellation_line_captured(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.cancellation_line_captured(uuid, integer, integer) to service_role;
revoke all on function public.cancellation_venue_payable(public.booking_cancellation_lines) from public, anon, authenticated;
grant execute on function public.cancellation_venue_payable(public.booking_cancellation_lines) to service_role;
revoke all on function public.cancellation_line_refunded(uuid, text) from public, anon, authenticated;
grant execute on function public.cancellation_line_refunded(uuid, text) to service_role;
revoke all on function public.cancellation_line_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.cancellation_line_failed(uuid, text) to service_role;
revoke all on function public.choose_cancellation_refund(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.choose_cancellation_refund(uuid, uuid, text) to service_role;
revoke all on function public.cancellation_fee_to_charge(uuid) from public, anon, authenticated;
grant execute on function public.cancellation_fee_to_charge(uuid) to service_role;
revoke all on function public.cancellation_fees_due() from public, anon, authenticated;
grant execute on function public.cancellation_fees_due() to service_role;
revoke all on function public.cancellation_fee_attempted(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cancellation_fee_attempted(uuid, text, text, text) to service_role;
revoke all on function public.cancellation_fee_paid(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.cancellation_fee_paid(uuid, text, integer, integer) to service_role;
