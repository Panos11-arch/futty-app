-- The booker's whole-team charge (10 November decision): taken on-session
-- when the booker confirms the cancellation. If it fails, or needs 3-D
-- Secure they don't complete, the cancellation stands, the booker is told
-- once, and it's retried off-session every 6 hours until the original
-- kickoff; what's still unpaid then becomes a debt to Futty in P4c. Futty
-- receives the charge.
begin;

do $$
declare
  v_booker uuid := tests.create_user('fee-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_done jsonb;
  v_fee_id uuid;
  v_fee public.booking_cancellation_fees;
  v_charge record;
  v_result jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                          p_label => 'fee');
  for i in 0 .. 3 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_fee_' || i, interval '2 hours');
  end loop;
  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);
  v_fee_id := (v_done ->> 'fee_id')::uuid;

  -- What cancel-booking charges on-session, right away.
  perform tests.act_as_service_role();
  select * into v_charge from public.cancellation_fee_to_charge(v_fee_id);
  assert (v_charge.amount_cents, v_charge.attempt, v_charge.off_session, v_charge.stripe_payment_method_id)
         = (300, 1, false, 'pm_pi_fee_0'), format('300 on-session on the saved card, got %s', row_to_json(v_charge));

  -- The bank wants 3-D Secure: the booker is shown it, not notified, retried in 6 hours.
  v_result := public.cancellation_fee_attempted(v_fee_id, 'pi_fee_charge_1', 'requires_action', null);
  perform tests.act_as_postgres();
  select * into v_fee from public.booking_cancellation_fees where id = v_fee_id;
  assert v_fee.status = 'requires_action' and v_fee.next_attempt_at = now() + interval '6 hours'
         and v_fee.failure_notified_at is null, format('waiting for 3-D Secure, got %s', row_to_json(v_fee));
  assert (select status from public.venue_bookings where id = v_booking.id) = 'cancelled', 'the cancellation stands';

  -- 6 hours on, the off-session retry is due; it's declined: told once.
  update public.booking_cancellation_fees set next_attempt_at = now() - interval '1 second' where id = v_fee_id;
  perform tests.act_as_service_role();
  assert exists (select 1 from public.cancellation_fees_due() where fee_id = v_fee_id), 'due';
  select * into v_charge from public.cancellation_fee_to_charge(v_fee_id);
  assert (v_charge.attempt, v_charge.off_session, v_charge.previous_intent_id) = (2, true, 'pi_fee_charge_1'),
    'the second try is off-session, after the first intent';
  perform public.cancellation_fee_attempted(v_fee_id, 'pi_fee_charge_2', 'failed', 'card_declined');
  update public.booking_cancellation_fees set next_attempt_at = now() - interval '1 second' where id = v_fee_id;
  perform public.cancellation_fee_attempted(v_fee_id, 'pi_fee_charge_3', 'failed', 'card_declined');
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications where profile_id = v_booker and type = 'cancellation_fee_failed') = 1,
    'the booker is told once';
  select * into v_fee from public.booking_cancellation_fees where id = v_fee_id;
  assert v_fee.status = 'failed' and v_fee.attempts = 3 and v_fee.next_attempt_at = now() + interval '6 hours',
    format('retried every 6 hours, got %s', row_to_json(v_fee));

  -- No answer from Stripe: the same attempt is tried again soon, nobody told.
  perform tests.act_as_service_role();
  perform public.cancellation_fee_attempted(v_fee_id, null, 'error', 'api_connection_error');
  perform tests.act_as_postgres();
  select * into v_fee from public.booking_cancellation_fees where id = v_fee_id;
  assert v_fee.attempts = 3 and v_fee.next_attempt_at < now() + interval '6 hours', 'same attempt, after a back-off';

  -- Retries stop at the original kickoff.
  update public.booking_cancellation_fees set next_attempt_at = now() - interval '1 second', stop_at = now()
  where id = v_fee_id;
  perform tests.act_as_service_role();
  assert not exists (select 1 from public.cancellation_fees_due() where fee_id = v_fee_id), 'no retries from kickoff on';
  perform tests.act_as_postgres();

  -- It's paid (the booker finished 3-D Secure later): Futty's, in the ledger.
  perform tests.act_as_service_role();
  v_result := public.cancellation_fee_paid(v_fee_id, 'pi_fee_charge_1', 300, 30);
  assert v_result ->> 'result' = 'paid', format('paid, got %s', v_result);
  assert public.cancellation_fee_paid(v_fee_id, 'pi_fee_charge_1', 300, 30) ->> 'result' = 'duplicate', 'once';
  -- Another intent for the same charge also went through: given back.
  v_result := public.cancellation_fee_paid(v_fee_id, 'pi_fee_charge_x', 300, 30);
  assert v_result ->> 'result' = 'refund', format('a second payment is refunded, got %s', v_result);
  perform tests.act_as_postgres();
  assert (select (amount_cents, venue_cents, futty_cents, stripe_fee_cents) from public.money_ledger
          where stripe_id = 'pi_fee_charge_1' and kind = 'capture') = (300, 0, 270, 30), 'Futty gets it, less Stripe';
  assert (select status from public.booking_cancellation_fees where id = v_fee_id) = 'paid', 'paid';
end $$;

rollback;
