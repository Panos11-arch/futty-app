-- P4b: credit set aside for a payment that's never finished is released, so
-- a player's credit never stays locked (pay_cancellations_credit sets it
-- aside when the payment starts):
--   - the payment is cancelled: Stripe reports the share's intent (or
--     SetupIntent) cancelled -> released at once (stripe-webhook);
--   - it isn't completed within 15 minutes of starting: run-payment-jobs
--     checks the intent at Stripe; one that is held, processing or paid is
--     left to its webhook (which spends the credit); any other is cancelled
--     first, so it can never be paid with credit that has gone back, and
--     then the credit is released;
--   - the booking expires (the booker didn't pay within 15 minutes): the
--     credit goes back with it (expire_unpaid_booking, below);
--   - the share is cancelled or refunded: the status trigger, as before.

-- Job: shares still waiting for a payment that set credit aside 15 minutes
-- ago or more, with the intent (or SetupIntent) to check at Stripe.
create or replace function public.credit_reservations_to_release()
returns table (share_id uuid, booking_id uuid, stripe_payment_intent_id text, stripe_setup_intent_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.booking_id, s.stripe_payment_intent_id, s.stripe_setup_intent_id
  from public.booking_payment_shares s
  where s.status = 'pending'
    and exists (select 1 from public.venue_credit_spends sp
                where sp.share_id = s.id and sp.status = 'reserved' and sp.created_at <= now() - interval '15 minutes')
  order by s.id;
$$;

-- The share's payment p_intent_id (an intent or SetupIntent) was cancelled
-- or never finished: the credit it set aside goes back, and the share is
-- priced again without credit. Only for the share's current payment, while
-- it's still waiting to be paid; returns whether anything was released.
create or replace function public.release_share_credit_reservation(p_share_id uuid, p_intent_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_amounts record;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null or v_share.status <> 'pending'
     or p_intent_id is distinct from coalesce(v_share.stripe_payment_intent_id, v_share.stripe_setup_intent_id)
     or not exists (select 1 from public.venue_credit_spends where share_id = p_share_id and status = 'reserved') then
    return false;
  end if;

  perform public.return_share_credit(p_share_id, 'payment_not_completed');

  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  select * into v_amounts from public.money_share(
    v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, v_share.is_booker,
    exists (select 1 from public.profiles where id = v_share.profile_id and is_premium), v_share.payment_method);
  update public.booking_payment_shares
  set credit_cents = 0,
      pitch_cents = v_amounts.pitch_cents,
      fee_cents = v_amounts.fee_cents,
      cash_cents = v_amounts.cash_cents,
      amount_cents = v_amounts.card_cents,
      stripe_setup_intent_id = null
  where id = p_share_id;
  return true;
end;
$$;

-- As in pay_modes_timing, and any credit a share of the booking set aside
-- goes back (its payment never finished; the caller releases the intent).
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
     or now() <= public.money_payment_window_ends_at(v_booking.created_at) then
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

revoke all on function public.credit_reservations_to_release() from public, anon, authenticated;
grant execute on function public.credit_reservations_to_release() to service_role;
revoke all on function public.release_share_credit_reservation(uuid, text) from public, anon, authenticated;
grant execute on function public.release_share_credit_reservation(uuid, text) to service_role;
revoke all on function public.expire_unpaid_booking(uuid) from public, anon, authenticated;
grant execute on function public.expire_unpaid_booking(uuid) to service_role;
