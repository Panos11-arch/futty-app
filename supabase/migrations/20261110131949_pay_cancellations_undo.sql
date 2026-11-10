-- P4b second re-review (docs/specs/13-payments-bookings.md, "Venue credit",
-- decided 10 November):
--   High    a hold undone on the booker's share (the release job cancelled
--           an intent the booker had just confirmed) puts the booking back
--           to pending_payment with a new 15-minute payment window from
--           that moment, and the booker is told to pay again. Not paid
--           within it, the normal expiry cancels the booking and releases
--           the pitches.
--   Medium  release_share_credit_reservation is called by the
--           payment_intent.canceled webhook with p_hold_released as well
--           (stripe-webhook/modes.ts); nothing changes here for that.
--
-- The payment window now runs from payment_window_started_at when it's set
-- (a new window after an undo), otherwise from when the booking was made.
-- Every function that checks the window reads it through
-- booking_payment_window_ends_at; they are otherwise unchanged.

alter table public.venue_bookings add column payment_window_started_at timestamptz;
comment on column public.venue_bookings.payment_window_started_at is
  'Start of a new 15-minute payment window (the booker''s payment was undone); null: the window runs from created_at.';

-- When the booker's 15 minutes to pay end.
create or replace function public.booking_payment_window_ends_at(p_booking public.venue_bookings)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select public.money_payment_window_ends_at(coalesce(p_booking.payment_window_started_at, p_booking.created_at));
$$;

-- As in 20261109180831_pay_cancellations_credit, with the booking's current payment window.
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
    -- TODO(P4c): a Premium cash player who isn't the booker saves a card
    -- the same way. Until then they are refused.
    if not ((p_share.is_booker and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot'))
            or v_credit > 0) then
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

-- As in 20261109180838_pay_cancellations_apply, with the booking's current payment window.
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

-- As in 20261109180838_pay_cancellations_apply, with the booking's current payment window.
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

-- As in 20261110124905_pay_cancellations_fixes, with the booking's current payment window.
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

-- As in 20261110120916_pay_cancellations_reservations, with the booking's current payment window.
create or replace function public.expire_unpaid_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_share_id uuid;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.payment_mode is null or v_booking.status <> 'pending_payment'
     or now() <= public.booking_payment_window_ends_at(v_booking) then
    return false;
  end if;

  update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = p_booking_id and status in ('pending', 'covered') and stripe_payment_intent_id is null;
  update public.booking_guarantees set status = 'cancelled', next_attempt_at = null
  where booking_id = p_booking_id and status <> 'cancelled' and stripe_payment_intent_id is null;
  for v_share_id in
    select id from public.booking_payment_shares where booking_id = p_booking_id and status = 'pending'
  loop
    perform public.return_share_credit(v_share_id, 'booking_expired');
  end loop;

  perform public.send_notification(v_booking.created_by, 'booking_cancelled', jsonb_build_object(
    'title', 'Booking cancelled',
    'body', 'Payment wasn''t completed within 15 minutes, so the booking was cancelled and the pitch released.',
    'bookingId', p_booking_id
  ));
  return true;
end;
$$;

-- As in 20261109164845_pay_modes_recovery, with the booking's current payment window.
create or replace function public.bookings_past_payment_window()
returns table (
  booking_id uuid,
  booker_share_id uuid,
  booker_intent_id text,
  booker_setup_intent_id text,
  booked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, s.id, s.stripe_payment_intent_id, s.stripe_setup_intent_id, b.created_at
  from public.venue_bookings b
  left join public.booking_payment_shares s on s.booking_id = b.id and s.is_booker
  where b.status = 'pending_payment'
    and b.payment_mode is not null
    and now() > public.booking_payment_window_ends_at(b)
  order by b.created_at;
$$;

-- As in pay_cancellations_fixes, and when the hold undone is the booker's,
-- the booking goes back to pending_payment with a new 15-minute window from
-- now, and the booker is told to pay again within it. The booking is locked
-- before the share, as cancel_booking_internal and expire_unpaid_booking do.
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
  elsif v_share.status = 'authorized' and coalesce(p_hold_released, false)
        and v_share.stripe_payment_intent_id = p_intent_id and v_share.credit_cents > 0 then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'cancel', v_share.amount_cents,
                                         p_intent_id, p_intent_id, 'payment_not_completed');
    update public.booking_payment_shares set status = 'pending', held_at = null, capture_due_at = null
    where id = p_share_id;
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
  else
    return false;
  end if;

  perform public.share_drop_credit(p_share_id, 'payment_not_completed');
  return true;
end;
$$;

revoke all on function public.booking_payment_window_ends_at(public.venue_bookings) from public, anon, authenticated;
grant execute on function public.booking_payment_window_ends_at(public.venue_bookings) to service_role;
