-- The booker's guarantee (docs/specs/13-payments-bookings.md, "When money is
-- held and taken", step 3), each_pays_responsible only:
--   the booker's card is saved at booking;
--   a hold for the full pitch price is placed 72 hours before kickoff, or at
--   booking when kickoff is closer;
--   if it fails the booker is notified (guarantee_hold_failed) ONCE (decided
--   9 November) and it's retried every 6 hours;
--   a failed hold never cancels the booking.
begin;

-- Kickoff 5 days away: the hold is due at kickoff minus 72 hours.
do $$
declare
  v_booker uuid := tests.create_user('guarantee-far@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee public.booking_guarantees;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 5, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();

  select * into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;
  assert v_guarantee.id is not null, 'responsible mode has a guarantee';
  assert (v_guarantee.profile_id, v_guarantee.amount_cents, v_guarantee.status) = (v_booker, 6000, 'awaiting_card'),
    format('the full pitch price, waiting for the booker''s card, got %s', row(v_guarantee.*));
  assert v_guarantee.hold_due_at = tests.kickoff_of(v_booking.id) - interval '72 hours', 'due at kickoff minus 72 hours';

  -- The booker pays their share: the card is saved for the guarantee.
  update public.profiles set stripe_customer_id = 'cus_far' where id = v_booker;
  perform tests.act_as_service_role();
  perform public.prepare_share_payment((tests.share_of(v_booking.id, v_booker)).id, v_booker, 'card', false);
  perform public.set_share_payment_intent((tests.share_of(v_booking.id, v_booker)).id, 'pi_far');
  v_result := public.share_payment_held('pi_far', 680, 'pm_far');
  perform tests.act_as_postgres();
  assert (v_result ->> 'guarantee_due')::boolean = false, 'not due yet';
  select * into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;
  assert (v_guarantee.status, v_guarantee.stripe_payment_method_id, v_guarantee.stripe_customer_id)
         = ('scheduled', 'pm_far', 'cus_far'), format('card saved, got %s', row(v_guarantee.*));

  perform tests.act_as_service_role();
  assert not exists (select 1 from public.guarantees_due_for_hold() where guarantee_id = v_guarantee.id),
    'not placed before kickoff minus 72 hours';
  perform tests.act_as_postgres();

  -- Move the clock: kickoff minus 72 hours has passed.
  update public.booking_guarantees set hold_due_at = now() - interval '1 minute', next_attempt_at = now() - interval '1 minute'
  where id = v_guarantee.id;
  perform tests.act_as_service_role();
  assert (select (amount_cents, stripe_payment_method_id, stripe_customer_id, attempts) = (6000, 'pm_far', 'cus_far', 0)
          from public.guarantees_due_for_hold() where guarantee_id = v_guarantee.id), 'due now, for 6000';

  v_result := public.guarantee_hold_placed(v_guarantee.id, 'pi_guarantee_far', 6000);
  assert v_result ->> 'result' = 'held', format('held, got %s', v_result);
  assert public.guarantee_hold_placed(v_guarantee.id, 'pi_guarantee_far', 6000) ->> 'result' = 'duplicate', 'once';
  assert tests.error_of(format($q$ select public.guarantee_hold_placed(%L, 'pi_other', 5000) $q$, v_guarantee.id))
         = 'amount_mismatch', 'the hold must be the full pitch price';
  assert not exists (select 1 from public.guarantees_due_for_hold() where guarantee_id = v_guarantee.id), 'not placed twice';
  perform tests.act_as_postgres();

  assert (select status from public.booking_guarantees where id = v_guarantee.id) = 'held', 'held';
  assert (select count(*) from public.money_ledger
          where guarantee_id = v_guarantee.id and kind = 'hold' and amount_cents = 6000 and stripe_id = 'pi_guarantee_far') = 1,
    'one guarantee hold in the ledger';
end $$;

-- Kickoff 2 days away: due at booking, so the moment the card is saved.
do $$
declare
  v_booker uuid := tests.create_user('guarantee-near@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee public.booking_guarantees;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  -- create-share-payment saves the booker's Stripe customer before any card is held.
  update public.profiles set stripe_customer_id = 'cus_' || v_booker where id = v_booker;
  select * into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;
  assert v_guarantee.hold_due_at = v_booking.created_at, 'due at booking when kickoff is under 72 hours away';

  perform tests.act_as_service_role();
  perform public.prepare_share_payment((tests.share_of(v_booking.id, v_booker)).id, v_booker, 'card', false);
  perform public.set_share_payment_intent((tests.share_of(v_booking.id, v_booker)).id, 'pi_near');
  v_result := public.share_payment_held('pi_near', 680, 'pm_near');
  assert (v_result ->> 'guarantee_due')::boolean, format('due as soon as the card is saved, got %s', v_result);
  assert (v_result ->> 'guarantee_id')::uuid = v_guarantee.id, 'the webhook is told which guarantee';
  assert exists (select 1 from public.guarantees_due_for_hold(v_guarantee.id)), 'and can place it straight away';
  perform tests.act_as_postgres();
end $$;

-- A failed hold leaves the booking active, notifies the booker once and
-- retries every 6 hours.
do $$
declare
  v_booker uuid := tests.create_user('guarantee-fail@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee public.booking_guarantees;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  -- create-share-payment saves the booker's Stripe customer before any card is held.
  update public.profiles set stripe_customer_id = 'cus_' || v_booker where id = v_booker;
  select * into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;

  perform tests.act_as_service_role();
  perform public.prepare_share_payment((tests.share_of(v_booking.id, v_booker)).id, v_booker, 'card', false);
  perform public.set_share_payment_intent((tests.share_of(v_booking.id, v_booker)).id, 'pi_fail_share');
  perform public.share_payment_held('pi_fail_share', 680, 'pm_fail');

  v_result := public.guarantee_hold_failed(v_guarantee.id, 'pi_fail_1', 'card_declined');
  perform tests.act_as_postgres();
  select * into v_guarantee from public.booking_guarantees where id = v_guarantee.id;
  assert (v_guarantee.status, v_guarantee.attempts, v_guarantee.last_error) = ('failed', 1, 'card_declined'),
    format('failed once, got %s', row(v_guarantee.*));
  assert v_guarantee.next_attempt_at = public.money_guarantee_retry_at(now()), 'retried in 6 hours';
  assert public.money_guarantee_retry_at(timestamptz '2026-12-01 10:00+02') = timestamptz '2026-12-01 16:00+02', '6 hours';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the booking stays active';
  assert (select count(*) from public.notifications where profile_id = v_booker and type = 'guarantee_hold_failed') = 1,
    'one notification';
  assert (select data ->> 'bookingId' from public.notifications where profile_id = v_booker and type = 'guarantee_hold_failed')
         = v_booking.id::text, 'the notification names the booking';

  perform tests.act_as_service_role();
  assert not exists (select 1 from public.guarantees_due_for_hold() where guarantee_id = v_guarantee.id),
    'no retry before 6 hours';
  perform tests.act_as_postgres();

  -- 6 hours later it is retried, fails again: still one notification.
  update public.booking_guarantees set next_attempt_at = now() - interval '1 minute' where id = v_guarantee.id;
  perform tests.act_as_service_role();
  assert (select attempts from public.guarantees_due_for_hold() where guarantee_id = v_guarantee.id) = 1, 'retried after 6 hours';
  perform public.guarantee_hold_failed(v_guarantee.id, 'pi_fail_2', 'card_declined');
  perform tests.act_as_postgres();
  assert (select attempts from public.booking_guarantees where id = v_guarantee.id) = 2, 'two attempts';
  assert (select count(*) from public.notifications where profile_id = v_booker and type = 'guarantee_hold_failed') = 1,
    'still one notification';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'still active';
  assert not exists (select 1 from public.money_ledger where guarantee_id = v_guarantee.id), 'no money moved';

  -- The retry after that succeeds.
  update public.booking_guarantees set next_attempt_at = now() - interval '1 minute' where id = v_guarantee.id;
  perform tests.act_as_service_role();
  assert public.guarantee_hold_placed(v_guarantee.id, 'pi_fail_3', 6000) ->> 'result' = 'held', 'the third try holds';
  perform tests.act_as_postgres();
end $$;

-- Only responsible mode has a guarantee.
do $$
declare
  v_booker uuid := tests.create_user('guarantee-none@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_own public.venue_bookings;
  v_all public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_own := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_all := public.book_slot(v_venue, tests.cyprus_today() + 2, '14:00', '15:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.booking_guarantees where booking_id in (v_own.id, v_all.id)),
    'no guarantee for own spot or pay for everyone';
end $$;

-- A Premium booker paying their own spot in cash pays nothing by card, so
-- their card is saved with a SetupIntent instead.
do $$
declare
  v_booker uuid := tests.create_user('guarantee-premium-cash@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_prepared jsonb;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_booker);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_booker);

  perform tests.act_as_service_role();
  v_prepared := public.prepare_share_payment(v_share.id, v_booker, 'cash', false);
  assert (v_prepared ->> 'amount_cents')::int = 0 and (v_prepared ->> 'needs_saved_card')::boolean,
    format('nothing to charge, but the guarantee needs a card: %s', v_prepared);
  assert v_prepared ->> 'status' = 'pending', 'not settled until the card is saved';

  v_result := public.share_card_saved(v_share.id, 'seti_premium', 'pm_premium');
  perform tests.act_as_postgres();
  assert (v_result ->> 'guarantee_due')::boolean, 'the guarantee is due once the card is saved';
  assert (tests.share_of(v_booking.id, v_booker)).status = 'paid', 'the share is settled';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the booking is confirmed';
  assert (select stripe_payment_method_id from public.booking_guarantees where booking_id = v_booking.id) = 'pm_premium',
    'the guarantee uses the saved card';
end $$;

rollback;
