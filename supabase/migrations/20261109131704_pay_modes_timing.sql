-- P4a: when money is held and taken (docs/specs/13-payments-bookings.md).
-- The state changes Stripe reports (through the verified webhook) and the
-- scheduled job (run-payment-jobs) make. All service_role only; each one
-- writes its money movement to money_ledger, once.
--
-- Webhooks find a share by the share id in the intent's metadata. An event
-- for an intent that isn't the share's current one (it was replaced), for a
-- cancelled booking, or for the wrong amount is never applied to the share:
-- the function records what Stripe did and answers 'release' (cancel the
-- hold) or 'refund' (give the money back), which the caller does at once,
-- or queues (money_releases) when Stripe fails.

-- Internal: the booker's card is saved; the guarantee is scheduled for
-- hold_due_at. Returns the guarantee and whether it's due now.
create or replace function public.guarantee_card_saved(p_booking_id uuid, p_profile_id uuid, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
begin
  if p_payment_method_id is null then
    return jsonb_build_object('guarantee_id', null, 'guarantee_due', false);
  end if;
  update public.booking_guarantees g
  set stripe_payment_method_id = p_payment_method_id,
      stripe_customer_id = (select stripe_customer_id from public.profiles where id = p_profile_id),
      status = 'scheduled',
      next_attempt_at = g.hold_due_at
  where g.booking_id = p_booking_id and g.profile_id = p_profile_id and g.status = 'awaiting_card'
  returning * into v_guarantee;
  return jsonb_build_object('guarantee_id', v_guarantee.id, 'guarantee_due', coalesce(v_guarantee.hold_due_at <= now(), false));
end;
$$;

-- Internal: the booker has paid (or settled) their share. The pitch is
-- theirs once they've paid what the mode asks within the 15-minute window:
-- the full amount (pay_all), or their own share plus a saved card (the
-- each-pays modes). In responsible mode that card is the guarantee's.
create or replace function public.booker_share_settled(p_share public.booking_payment_shares, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  if not p_share.is_booker then
    return jsonb_build_object('guarantee_id', null, 'guarantee_due', false);
  end if;
  select payment_mode into v_mode from public.venue_bookings where id = p_share.booking_id;
  if v_mode = 'pay_all' or p_payment_method_id is not null then
    update public.venue_bookings set status = 'confirmed' where id = p_share.booking_id and status = 'pending_payment';
  end if;
  return public.guarantee_card_saved(p_share.booking_id, p_share.profile_id, p_payment_method_id);
end;
$$;

-- The booker didn't complete payment within 15 minutes of booking: the
-- booking is cancelled and its pitches released (the pitch trigger does
-- that on 'cancelled'). Shares with no intent and the guarantee are closed
-- here; the caller then releases every intent (booking_money_to_release).
-- Returns false when there is nothing to expire.
create or replace function public.expire_unpaid_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.payment_mode is null or v_booking.status <> 'pending_payment'
     or now() <= public.money_payment_window_ends_at(v_booking.created_at) then
    return false;
  end if;

  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and status in ('pending', 'covered') and stripe_payment_intent_id is null;
  update public.booking_guarantees set status = 'cancelled', next_attempt_at = null
  where booking_id = p_booking_id and status <> 'cancelled' and stripe_payment_intent_id is null;

  perform public.send_notification(v_booking.created_by, 'booking_cancelled', jsonb_build_object(
    'title', 'Booking cancelled',
    'body', 'Payment wasn''t completed within 15 minutes, so the booking was cancelled and the pitch released.',
    'bookingId', p_booking_id
  ));
  return true;
end;
$$;

-- Job: bookings whose booker hasn't completed payment within 15 minutes,
-- with the booker's open intent, if any (the job checks it at Stripe first:
-- a payment that went through is decided by its webhook, by event time).
create or replace function public.bookings_past_payment_window()
returns table (booking_id uuid, booker_intent_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, s.stripe_payment_intent_id
  from public.venue_bookings b
  left join public.booking_payment_shares s on s.booking_id = b.id and s.is_booker
  where b.status = 'pending_payment'
    and b.payment_mode is not null
    and now() > public.money_payment_window_ends_at(b.created_at)
  order by b.created_at;
$$;

-- Webhook, payment_intent.amount_capturable_updated: the card is held.
-- p_at is when Stripe says it happened (the event time), which decides the
-- 15-minute window and whether the share is non-refundable.
-- A hold confirmed less than 6 hours before kickoff without the
-- non-refundable notice accepted is refused: released, the share stays
-- unpaid and the player is asked to pay again and accept it.
-- A share is taken when its free hour ends (money_capture_due_at): at once
-- when held less than 6 hours before kickoff.
-- 'legacy' / 'unknown' tell the webhook to fall back to the old handling.
create or replace function public.share_payment_held(
  p_share_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_payment_method_id text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_kickoff timestamptz;
  v_release jsonb;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if v_booking.payment_mode is null then
    return jsonb_build_object('result', 'legacy');
  end if;
  v_release := jsonb_build_object('result', 'release', 'booking_id', v_share.booking_id, 'share_id', v_share.id);

  if v_share.stripe_payment_intent_id is distinct from p_intent_id then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                         p_intent_id, 'replaced_intent_held');
    return v_release || jsonb_build_object('reason', 'replaced_intent');
  end if;
  if v_booking.status = 'cancelled' or v_share.status in ('cancelled', 'refunded') then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                         p_intent_id, 'share_held');
    return v_release || jsonb_build_object('reason', 'booking_cancelled');
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                         p_intent_id, 'amount_mismatch_held');
    return v_release || jsonb_build_object('reason', 'amount_mismatch');
  end if;
  if v_share.status <> 'pending' then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;

  perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                       p_intent_id, 'share_held');

  if v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.money_payment_window_ends_at(v_booking.created_at) then
    perform public.expire_unpaid_booking(v_booking.id);
    return jsonb_build_object('result', 'expired', 'booking_id', v_booking.id, 'share_id', v_share.id);
  end if;

  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if public.money_is_non_refundable(p_at, v_kickoff) and v_share.non_refundable_accepted_at is null then
    perform public.send_notification(v_share.profile_id, 'match_payment_due', jsonb_build_object(
      'title', 'Pay again to keep your spot',
      'body', 'Your game starts in less than 6 hours, so it''s non-refundable. Your card wasn''t charged: '
              || 'accept the notice and pay again.',
      'bookingId', v_share.booking_id
    ));
    return v_release || jsonb_build_object('reason', 'non_refundable_not_accepted');
  end if;

  update public.booking_payment_shares
  set status = 'authorized', held_at = p_at, capture_due_at = public.money_capture_due_at(p_at, v_kickoff),
      stripe_payment_method_id = p_payment_method_id
  where id = v_share.id
  returning * into v_share;

  return jsonb_build_object('result', 'held', 'share_id', v_share.id, 'booking_id', v_share.booking_id)
         || public.booker_share_settled(v_share, p_payment_method_id);
end;
$$;

-- Webhook, payment_intent.succeeded: the money was taken. For a share paid
-- less than 6 hours before kickoff that's straight away; for a held share
-- it's the job's capture (which also records it, so this is then a no-op).
-- p_fee_cents is the service fee in the intent's metadata (used for an
-- intent that isn't the share's current one); p_stripe_fee_cents is
-- Stripe's actual fee. Money taken on a replaced intent, a cancelled
-- booking or for the wrong amount is recorded, then refunded by the caller.
create or replace function public.share_payment_captured(
  p_share_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_payment_method_id text,
  p_fee_cents integer,
  p_stripe_fee_cents integer,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_refund jsonb;
  v_was text;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if v_booking.payment_mode is null then
    return jsonb_build_object('result', 'legacy');
  end if;
  v_refund := jsonb_build_object('result', 'refund', 'booking_id', v_share.booking_id, 'share_id', v_share.id);

  if v_share.stripe_payment_intent_id is distinct from p_intent_id then
    perform public.record_intent_capture(v_share.booking_id, v_share.id, null, p_intent_id, p_amount_cents,
                                         p_fee_cents, p_stripe_fee_cents, 'replaced_intent_taken');
    return v_refund || jsonb_build_object('reason', 'replaced_intent');
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    perform public.record_intent_capture(v_share.booking_id, v_share.id, null, p_intent_id, p_amount_cents,
                                         p_fee_cents, p_stripe_fee_cents, 'amount_mismatch_taken');
    return v_refund || jsonb_build_object('reason', 'amount_mismatch');
  end if;

  v_was := v_share.status;
  perform public.record_intent_capture(v_share.booking_id, v_share.id, null, p_intent_id, p_amount_cents,
    v_share.fee_cents, p_stripe_fee_cents, case when v_was = 'pending' then 'share_taken_at_once' else 'share_taken' end);

  if v_booking.status = 'cancelled' or v_was in ('cancelled', 'refunded') then
    return v_refund || jsonb_build_object('reason', 'booking_cancelled');
  end if;
  if v_was not in ('pending', 'authorized') then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;

  if v_was = 'pending' and v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.money_payment_window_ends_at(v_booking.created_at) then
    perform public.expire_unpaid_booking(v_booking.id);
    return jsonb_build_object('result', 'expired', 'booking_id', v_booking.id, 'share_id', v_share.id);
  end if;

  update public.booking_payment_shares
  set status = 'paid', paid_at = p_at, stripe_payment_method_id = coalesce(stripe_payment_method_id, p_payment_method_id)
  where id = v_share.id
  returning * into v_share;

  return jsonb_build_object('result', 'captured', 'share_id', v_share.id, 'booking_id', v_share.booking_id)
         || case when v_was = 'pending' then public.booker_share_settled(v_share, p_payment_method_id)
                 else jsonb_build_object('guarantee_id', null, 'guarantee_due', false) end;
end;
$$;

-- Webhook, setup_intent.succeeded for a share with nothing to pay by card
-- (a Premium cash booker): the card is saved, the share is settled and the
-- guarantee scheduled. Only the SetupIntent on the share counts.
create or replace function public.share_card_saved(
  p_share_id uuid,
  p_setup_intent_id text,
  p_payment_method_id text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
begin
  select * into v_share from public.booking_payment_shares
  where id = p_share_id and status = 'pending' and amount_cents = 0 and stripe_setup_intent_id = p_setup_intent_id
  for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.money_payment_window_ends_at(v_booking.created_at) then
    perform public.expire_unpaid_booking(v_booking.id);
    return jsonb_build_object('result', 'expired', 'booking_id', v_booking.id, 'share_id', v_share.id);
  end if;

  update public.booking_payment_shares
  set status = 'paid', paid_at = p_at, stripe_payment_method_id = p_payment_method_id
  where id = v_share.id
  returning * into v_share;
  return jsonb_build_object('result', 'saved', 'share_id', v_share.id, 'setup_intent_id', p_setup_intent_id)
         || public.booker_share_settled(v_share, p_payment_method_id);
end;
$$;

-- Job: held shares whose free hour is over.
create or replace function public.shares_due_for_capture()
returns table (share_id uuid, booking_id uuid, stripe_payment_intent_id text, amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.booking_id, s.stripe_payment_intent_id, s.amount_cents
  from public.booking_payment_shares s
  join public.venue_bookings b on b.id = s.booking_id
  where s.status = 'authorized'
    and s.capture_method = 'manual'
    and s.capture_due_at <= now()
    and s.stripe_payment_intent_id is not null
    and b.payment_mode is not null
    and b.status <> 'cancelled'
  order by s.capture_due_at;
$$;

-- Job: Stripe captured a held share (p_stripe_fee_cents = its actual fee).
-- If the booking was cancelled meanwhile, the capture is recorded and the
-- job refunds it ('refund').
create or replace function public.share_captured(p_share_id uuid, p_amount_cents integer, p_stripe_fee_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking_status text;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null or v_share.stripe_payment_intent_id is null then
    raise exception 'share_not_found';
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    raise exception 'amount_mismatch';
  end if;
  perform public.record_intent_capture(v_share.booking_id, v_share.id, null, v_share.stripe_payment_intent_id,
                                       p_amount_cents, v_share.fee_cents, p_stripe_fee_cents, 'share_taken');
  select status into v_booking_status from public.venue_bookings where id = v_share.booking_id;
  if v_booking_status = 'cancelled' or v_share.status in ('cancelled', 'refunded') then
    return jsonb_build_object('result', 'refund', 'booking_id', v_share.booking_id, 'share_id', v_share.id,
                              'reason', 'booking_cancelled');
  end if;
  if v_share.status <> 'authorized' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  update public.booking_payment_shares set status = 'paid', paid_at = now() where id = p_share_id;
  return jsonb_build_object('result', 'captured', 'share_id', v_share.id);
end;
$$;

-- Job (or the webhook for one guarantee): guarantee holds to place now, a
-- first try at hold_due_at, a retry 6 hours after each failure, and none
-- from kickoff on (decided 9 November: what's unpaid then becomes the
-- booker's debt at collection). A cancelled booking's guarantee is never
-- placed.
create or replace function public.guarantees_due_for_hold(p_guarantee_id uuid default null)
returns table (
  guarantee_id uuid,
  booking_id uuid,
  profile_id uuid,
  amount_cents integer,
  stripe_customer_id text,
  stripe_payment_method_id text,
  attempts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.booking_id, g.profile_id, g.amount_cents, g.stripe_customer_id, g.stripe_payment_method_id, g.attempts
  from public.booking_guarantees g
  join public.venue_bookings b on b.id = g.booking_id
  where g.status in ('scheduled', 'failed')
    and g.next_attempt_at <= now()
    and g.stripe_payment_method_id is not null
    and g.stripe_customer_id is not null
    and b.status <> 'cancelled'
    and now() < public.booking_kickoff_at(b.booking_day, b.start_time)
    and (p_guarantee_id is null or g.id = p_guarantee_id)
  order by g.next_attempt_at;
$$;

-- The guarantee hold is on the card. If the booking was cancelled while
-- it was being placed (or the amount is wrong), it's recorded and the
-- caller releases it at once ('release').
create or replace function public.guarantee_hold_placed(p_guarantee_id uuid, p_intent_id text, p_amount_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
  v_booking_status text;
  v_release jsonb;
begin
  select * into v_guarantee from public.booking_guarantees where id = p_guarantee_id for update;
  if v_guarantee.id is null then
    raise exception 'guarantee_not_found';
  end if;
  if v_guarantee.status = 'held' and v_guarantee.stripe_payment_intent_id = p_intent_id then
    return jsonb_build_object('result', 'duplicate');
  end if;
  perform public.record_money_movement(v_guarantee.booking_id, null, v_guarantee.id, 'hold', p_amount_cents, p_intent_id,
                                       p_intent_id, 'guarantee_held');
  v_release := jsonb_build_object('result', 'release', 'booking_id', v_guarantee.booking_id, 'guarantee_id', v_guarantee.id);
  select status into v_booking_status from public.venue_bookings where id = v_guarantee.booking_id;
  if v_booking_status = 'cancelled' or v_guarantee.status = 'cancelled' then
    return v_release || jsonb_build_object('reason', 'booking_cancelled');
  end if;
  if v_guarantee.status not in ('scheduled', 'failed') then
    return v_release || jsonb_build_object('reason', 'already_held');
  end if;
  if p_amount_cents is distinct from v_guarantee.amount_cents then
    return v_release || jsonb_build_object('reason', 'amount_mismatch');
  end if;
  update public.booking_guarantees
  set status = 'held', held_at = now(), stripe_payment_intent_id = p_intent_id, attempts = attempts + 1,
      next_attempt_at = null, last_error = null
  where id = p_guarantee_id;
  return jsonb_build_object('result', 'held');
end;
$$;

-- A failed hold: retried in 6 hours (until kickoff). The booker is told on
-- the first failure only (decided 9 November); when their bank wants 3-D
-- Secure, they're asked to confirm their card in the app. The booking is
-- never touched.
create or replace function public.guarantee_hold_failed(
  p_guarantee_id uuid,
  p_intent_id text,
  p_error text,
  p_needs_action boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
  v_notify boolean;
begin
  select * into v_guarantee from public.booking_guarantees where id = p_guarantee_id for update;
  if v_guarantee.status not in ('scheduled', 'failed') then
    return jsonb_build_object('result', 'ignored');
  end if;
  v_notify := v_guarantee.failure_notified_at is null;

  update public.booking_guarantees
  set status = 'failed',
      attempts = attempts + 1,
      last_error = p_error,
      stripe_payment_intent_id = coalesce(p_intent_id, stripe_payment_intent_id),
      next_attempt_at = public.money_guarantee_retry_at(now()),
      failure_notified_at = coalesce(failure_notified_at, now())
  where id = p_guarantee_id
  returning * into v_guarantee;

  if v_notify then
    perform public.send_notification(v_guarantee.profile_id, 'guarantee_hold_failed', jsonb_build_object(
      'title', case when p_needs_action then 'Confirm your card' else 'Update your card' end,
      'body', case when p_needs_action
                then 'Your bank needs you to confirm your card for your booking''s guarantee. Your booking stays on. '
                     || 'Open the booking to confirm it.'
                else 'We couldn''t hold your card as the guarantee for your booking. Your booking stays on. '
                     || 'Update your card and we''ll try again.'
              end,
      'bookingId', v_guarantee.booking_id,
      'needsAction', coalesce(p_needs_action, false)
    ));
  end if;

  return jsonb_build_object('result', 'failed', 'attempts', v_guarantee.attempts, 'notified', v_notify);
end;
$$;

-- update-guarantee-card, as the verified caller: the guarantee whose card
-- they may replace (their own, on a live booking, before kickoff, once their
-- card was first saved).
create or replace function public.guarantee_for_card_update(p_booking_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
  v_booking public.venue_bookings;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.created_by is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  select * into v_guarantee from public.booking_guarantees where booking_id = p_booking_id;
  if v_guarantee.id is null or v_guarantee.status not in ('scheduled', 'failed') then
    raise exception 'no_guarantee_to_update';
  end if;
  if now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    raise exception 'guarantee_closed';
  end if;
  return jsonb_build_object(
    'guarantee_id', v_guarantee.id,
    'stripe_customer_id', (select stripe_customer_id from public.profiles where id = p_profile_id),
    'stripe_payment_method_id', v_guarantee.stripe_payment_method_id
  );
end;
$$;

-- Webhook, setup_intent.succeeded for a guarantee card (confirmed by the
-- booker in the app, 3-D Secure included): the new card replaces the old
-- one and the hold is tried at once when it's due.
create or replace function public.guarantee_card_replaced(p_guarantee_id uuid, p_profile_id uuid, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
  v_booking public.venue_bookings;
begin
  select * into v_guarantee from public.booking_guarantees where id = p_guarantee_id for update;
  select * into v_booking from public.venue_bookings where id = v_guarantee.booking_id;
  if v_guarantee.id is null or v_guarantee.profile_id is distinct from p_profile_id
     or v_guarantee.status not in ('scheduled', 'failed') or v_booking.status = 'cancelled'
     or p_payment_method_id is null
     or now() >= public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) then
    return jsonb_build_object('result', 'ignored', 'guarantee_id', null, 'guarantee_due', false);
  end if;
  update public.booking_guarantees
  set stripe_payment_method_id = p_payment_method_id,
      stripe_customer_id = (select stripe_customer_id from public.profiles where id = p_profile_id),
      status = 'scheduled',
      next_attempt_at = greatest(hold_due_at, now()),
      last_error = null
  where id = p_guarantee_id
  returning * into v_guarantee;
  return jsonb_build_object('result', 'replaced', 'guarantee_id', v_guarantee.id,
                            'guarantee_due', v_guarantee.next_attempt_at <= now());
end;
$$;

-- cancel-booking and the payment window: every bit of money on a cancelled
-- booking still to release or refund. 'booking' = a booking from before
-- split payments, paid as one intent.
create or replace function public.booking_money_to_release(p_booking_id uuid)
returns table (kind text, id uuid, status text, stripe_payment_intent_id text, amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select 'share', s.id, s.status, s.stripe_payment_intent_id, s.amount_cents
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid')
  union all
  select 'guarantee', g.id, g.status, g.stripe_payment_intent_id, g.amount_cents
  from public.booking_guarantees g
  where g.booking_id = p_booking_id and g.status <> 'cancelled'
  union all
  select 'booking', b.id, b.status, b.stripe_payment_intent_id, b.amount_cents
  from public.venue_bookings b
  where b.id = p_booking_id and b.stripe_payment_intent_id is not null and b.amount_cents > 0
    and not exists (select 1 from public.booking_payment_shares s where s.booking_id = b.id);
$$;

-- An intent was released ('cancelled': the hold is off; 'refunded': the
-- money is back; 'nothing': there was nothing on it). On a cancelled
-- booking, the share whose current intent it was, and the guarantee, are
-- closed. A replaced intent, or a release on a live booking (a refused
-- hold), leaves the share as it is.
create or replace function public.money_release_done(
  p_booking_id uuid,
  p_share_id uuid,
  p_guarantee_id uuid,
  p_intent_id text,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('cancelled', 'refunded', 'nothing') then
    raise exception 'invalid_outcome';
  end if;
  if not exists (select 1 from public.venue_bookings where id = p_booking_id and status = 'cancelled') then
    return;
  end if;
  update public.booking_payment_shares
  set status = case when p_outcome = 'refunded' then 'refunded' else 'cancelled' end
  where id = p_share_id and stripe_payment_intent_id = p_intent_id and status in ('pending', 'authorized', 'paid');
  update public.booking_guarantees set status = 'cancelled', next_attempt_at = null
  where id = p_guarantee_id and status <> 'cancelled';
end;
$$;

create or replace function public.share_released(p_share_id uuid, p_new_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_new_status not in ('cancelled', 'refunded') then
    raise exception 'invalid_status';
  end if;
  update public.booking_payment_shares
  set status = p_new_status
  where id = p_share_id and status in ('pending', 'authorized', 'paid');
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.guarantee_released(p_guarantee_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.booking_guarantees
  set status = 'cancelled', next_attempt_at = null
  where id = p_guarantee_id and status <> 'cancelled';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.guarantee_card_saved(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.guarantee_card_saved(uuid, uuid, text) to service_role;
revoke all on function public.booker_share_settled(public.booking_payment_shares, text) from public, anon, authenticated;
grant execute on function public.booker_share_settled(public.booking_payment_shares, text) to service_role;
revoke all on function public.expire_unpaid_booking(uuid) from public, anon, authenticated;
grant execute on function public.expire_unpaid_booking(uuid) to service_role;
revoke all on function public.bookings_past_payment_window() from public, anon, authenticated;
grant execute on function public.bookings_past_payment_window() to service_role;
revoke all on function public.share_payment_held(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.share_payment_held(uuid, text, integer, text, timestamptz) to service_role;
revoke all on function public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz) to service_role;
revoke all on function public.share_card_saved(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.share_card_saved(uuid, text, text, timestamptz) to service_role;
revoke all on function public.shares_due_for_capture() from public, anon, authenticated;
grant execute on function public.shares_due_for_capture() to service_role;
revoke all on function public.share_captured(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.share_captured(uuid, integer, integer) to service_role;
revoke all on function public.guarantees_due_for_hold(uuid) from public, anon, authenticated;
grant execute on function public.guarantees_due_for_hold(uuid) to service_role;
revoke all on function public.guarantee_hold_placed(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.guarantee_hold_placed(uuid, text, integer) to service_role;
revoke all on function public.guarantee_hold_failed(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.guarantee_hold_failed(uuid, text, text, boolean) to service_role;
revoke all on function public.guarantee_for_card_update(uuid, uuid) from public, anon, authenticated;
grant execute on function public.guarantee_for_card_update(uuid, uuid) to service_role;
revoke all on function public.guarantee_card_replaced(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.guarantee_card_replaced(uuid, uuid, text) to service_role;
revoke all on function public.booking_money_to_release(uuid) from public, anon, authenticated;
grant execute on function public.booking_money_to_release(uuid) to service_role;
revoke all on function public.money_release_done(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.money_release_done(uuid, uuid, uuid, text, text) to service_role;
revoke all on function public.share_released(uuid, text) from public, anon, authenticated;
grant execute on function public.share_released(uuid, text) to service_role;
revoke all on function public.guarantee_released(uuid) from public, anon, authenticated;
grant execute on function public.guarantee_released(uuid) to service_role;
