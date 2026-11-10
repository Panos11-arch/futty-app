-- P4b last fixes (docs/specs/13-payments-bookings.md, "Venue credit",
-- decided 10 November):
--   1. Only the release job (payment not finished within 15 minutes) can
--      reopen a booking. The job marks the intent it's about to cancel
--      (credit_release_started); only a cancel of that intent undoes a hold
--      the way pay_cancellations_undo does. Any other cancellation of a held
--      payment (the hold expiring after 7 days, a cancel in the Stripe
--      dashboard) never reopens or cancels a confirmed booking: the share's
--      money is released (the hold is gone) and any credit it used comes
--      back, the share is unpaid again, the booking stays as it is, and the
--      founders get an admin alert ('hold_cancelled'). Card, credit or both
--      alike.
--   2. Nobody is told "Pay again to keep your spot" on a booking that's
--      already cancelled: a held share on a cancelled booking is left to the
--      release step, which closes it and gives its credit back.
--   3. One lock order, booking then share, in the hold, capture and
--      card-saved webhooks, the undo and the job's mark, so they can't
--      deadlock. The three webhook functions are copied from
--      pay_cancellations_undo with only the locking changed.

alter table public.booking_payment_shares add column release_job_intent_id text;
comment on column public.booking_payment_shares.release_job_intent_id is
  'The intent the 15-minute release job is cancelling. Only a cancel of this intent may reopen the booking.';

alter table public.admin_alerts drop constraint admin_alerts_kind_check;
alter table public.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('capture_failing', 'cancellation_failing', 'hold_cancelled'));

-- The release job is about to cancel p_intent_id at Stripe: recorded on
-- the share, so the cancelled event that follows is known to be the job's.
-- Only for the share's current payment; returns whether it was marked.
create or replace function public.credit_release_started(p_share_id uuid, p_intent_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  perform 1 from public.venue_bookings
  where id = (select booking_id from public.booking_payment_shares where id = p_share_id) for update;
  update public.booking_payment_shares set release_job_intent_id = p_intent_id
  where id = p_share_id and stripe_payment_intent_id = p_intent_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- As in pay_cancellations_undo, locking the booking before the share.
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
  select * into v_booking from public.venue_bookings
  where id = (select booking_id from public.booking_payment_shares where id = p_share_id) for update;
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  if v_booking.payment_mode is null then
    return jsonb_build_object('result', 'legacy');
  end if;
  v_release := jsonb_build_object('result', 'release', 'booking_id', v_share.booking_id, 'share_id', v_share.id);

  if v_share.stripe_payment_intent_id is distinct from p_intent_id then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                         p_intent_id, 'replaced_intent_held');
    return v_release || jsonb_build_object('reason', 'replaced_intent');
  end if;
  if v_share.status in ('credited', 'forfeited', 'refund_due') then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
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
     and p_at > public.booking_payment_window_ends_at(v_booking) then
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

-- As in pay_cancellations_undo, locking the booking before the share.
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
  select * into v_booking from public.venue_bookings
  where id = (select booking_id from public.booking_payment_shares where id = p_share_id) for update;
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
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

  if v_was in ('credited', 'forfeited', 'refund_due') then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;
  if v_booking.status = 'cancelled' or v_was in ('cancelled', 'refunded') then
    return v_refund || jsonb_build_object('reason', 'booking_cancelled');
  end if;
  if v_was not in ('pending', 'authorized') then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;

  if v_was = 'pending' and v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.booking_payment_window_ends_at(v_booking) then
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

-- As in pay_cancellations_undo, locking the booking before the share.
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
  select * into v_booking from public.venue_bookings
  where id = (select booking_id from public.booking_payment_shares where id = p_share_id) for update;
  select * into v_share from public.booking_payment_shares
  where id = p_share_id and status = 'pending' and amount_cents = 0 and stripe_setup_intent_id = p_setup_intent_id
  for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.booking_payment_window_ends_at(v_booking) then
    perform public.expire_unpaid_booking(v_booking.id);
    return jsonb_build_object('result', 'expired', 'booking_id', v_booking.id, 'share_id', v_share.id);
  end if;

  if v_share.credit_cents > 0 and v_share.non_refundable_accepted_at is null
     and public.money_is_non_refundable(p_at, public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)) then
    perform public.share_drop_credit(v_share.id, 'non_refundable_not_accepted');
    perform public.send_notification(v_share.profile_id, 'match_payment_due', jsonb_build_object(
      'title', 'Pay again to keep your spot',
      'body', 'Your game starts in less than 6 hours, so it''s non-refundable. Your credit wasn''t used: '
              || 'accept the notice and pay again.',
      'bookingId', v_share.booking_id
    ));
    return jsonb_build_object('result', 'refused', 'reason', 'non_refundable_not_accepted', 'share_id', v_share.id);
  end if;

  update public.booking_payment_shares
  set status = 'paid', paid_at = p_at, stripe_payment_method_id = p_payment_method_id
  where id = v_share.id
  returning * into v_share;
  return jsonb_build_object('result', 'saved', 'share_id', v_share.id, 'setup_intent_id', p_setup_intent_id)
         || public.booker_share_settled(v_share, p_payment_method_id);
end;
$$;

-- As in pay_cancellations_undo, except:
--   - a held share on a cancelled booking is left alone (no "Pay again"):
--     the release step closes it and gives its credit back;
--   - only the release job's own cancel (release_job_intent_id) undoes a
--     hold as before, reopening the booking when it's the booker's share;
--   - any other cancelled hold: the share is unpaid again and its credit
--     back, the booking stays as it is, and the founders are alerted.
create or replace function public.release_share_credit_reservation(
  p_share_id uuid,
  p_intent_id text,
  p_hold_released boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_booking_id uuid;
  v_new_window boolean := false;
begin
  select booking_id into v_booking_id from public.booking_payment_shares where id = p_share_id;
  select * into v_booking from public.venue_bookings where id = v_booking_id for update;
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null
     or p_intent_id is distinct from coalesce(v_share.stripe_payment_intent_id, v_share.stripe_setup_intent_id) then
    return false;
  end if;

  if v_share.status = 'pending' then
    if not exists (select 1 from public.venue_credit_spends where share_id = p_share_id and status = 'reserved') then
      return false;
    end if;
    perform public.share_drop_credit(p_share_id, 'payment_not_completed');
    return true;
  end if;

  if v_share.status <> 'authorized' or not coalesce(p_hold_released, false)
     or v_share.stripe_payment_intent_id is distinct from p_intent_id or v_booking.status = 'cancelled' then
    return false;
  end if;

  update public.booking_payment_shares set status = 'pending', held_at = null, capture_due_at = null
  where id = p_share_id;

  if v_share.release_job_intent_id = p_intent_id then
    -- The release job cancelled it: the payment wasn't completed in time.
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'cancel', v_share.amount_cents,
                                         p_intent_id, p_intent_id, 'payment_not_completed');
    v_new_window := v_share.is_booker and v_booking.status in ('confirmed', 'pending_payment');
    if v_new_window then
      update public.venue_bookings set status = 'pending_payment', payment_window_started_at = now()
      where id = v_booking.id;
    end if;
    perform public.send_notification(v_share.profile_id, 'match_payment_due', jsonb_build_object(
      'title', 'Pay again to keep your spot',
      'body', 'Your payment wasn''t completed in time, so your card wasn''t charged and your credit is back. '
              || case when v_new_window
                      then 'Pay again within 15 minutes to keep your booking, or it''s cancelled and the pitch released.'
                      else 'Pay again to keep your spot.' end,
      'bookingId', v_share.booking_id
    ));
    perform public.share_drop_credit(p_share_id, 'payment_not_completed');
    return true;
  end if;

  -- Cancelled some other way (expired after 7 days, or in the Stripe
  -- dashboard): the money for this share is released, the booking stays.
  perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'cancel', v_share.amount_cents,
                                       p_intent_id, p_intent_id, 'hold_cancelled');
  perform public.share_drop_credit(p_share_id, 'hold_cancelled');
  insert into public.admin_alerts (kind, booking_id, share_id, details)
  values ('hold_cancelled', v_share.booking_id, v_share.id, jsonb_build_object(
    'intent_id', p_intent_id, 'amount_cents', v_share.amount_cents, 'credit_cents', v_share.credit_cents,
    'is_booker', v_share.is_booker, 'booking_status', v_booking.status))
  on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.credit_release_started(uuid, text) from public, anon, authenticated;
grant execute on function public.credit_release_started(uuid, text) to service_role;
