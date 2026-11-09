-- Recovering from failures part-way through moving money
-- (docs/specs/13-payments-bookings.md, "When money is held and taken",
-- "Server-side checks": every money movement happens once):
--   a cancelled booking that still has money on it is found again by the
--   job until nothing is left (a release run that died part-way);
--   a failed capture backs off 1, 5, 15, 60 minutes, then hourly, and the
--   third failure raises an admin alert;
--   a guarantee hold that got no answer from Stripe backs off the same way,
--   without telling the booker, and is checked at Stripe after kickoff too;
--   the 15-minute window counts a card saved with a SetupIntent.
begin;

-- A release run that died after the first of three shares: the booking is
-- found again until every share is released. A release already on the
-- retry queue is left to the queue. Live bookings and bookings from before
-- P4a are never picked up.
do $$
declare
  v_booker uuid := tests.create_user('recovery-booker@futty.test');
  v_two uuid := tests.create_user('recovery-two@futty.test');
  v_three uuid := tests.create_user('recovery-three@futty.test');
  v_live_booker uuid := tests.create_user('recovery-live@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_booking public.venue_bookings;
  v_live public.venue_bookings;
  v_s1 uuid;
  v_s2 uuid;
  v_s3 uuid;
  v_release uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as(v_live_booker);
  v_live := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_s1 := (tests.share_of(v_booking.id, v_booker)).id;
  v_s2 := (tests.join_booking(v_booking.id, v_two)).id;
  v_s3 := (tests.join_booking(v_booking.id, v_three)).id;
  perform tests.hold_share(v_s1, 'pi_rec_1');
  perform tests.hold_share(v_s2, 'pi_rec_2');
  perform tests.hold_share(v_s3, 'pi_rec_3');
  perform tests.hold_share((tests.share_of(v_live.id, v_live_booker)).id, 'pi_rec_live');

  perform tests.act_as_service_role();
  assert not exists (select 1 from public.bookings_with_money_to_release()), 'nothing cancelled yet';
  perform tests.act_as_postgres();

  perform public.cancel_booking_for(v_booking.id, v_booker);
  perform tests.act_as_service_role();
  assert (select array_agg(booking_id) from public.bookings_with_money_to_release()) = array[v_booking.id],
    'the cancelled booking with held shares is found; the live one is not';

  -- The run releases the first share, then dies.
  perform public.record_money_movement(v_booking.id, v_s1, null, 'cancel', 680, 'pi_rec_1', 'pi_rec_1', 'booking_cancelled');
  perform public.money_release_done(v_booking.id, v_s1, null, 'pi_rec_1', 'cancelled');
  assert exists (select 1 from public.bookings_with_money_to_release() where booking_id = v_booking.id),
    'two shares still held: found again';
  assert (select array_agg(id order by id) from public.booking_money_to_release(v_booking.id))
         = (select array_agg(x order by x) from unnest(array[v_s2, v_s3]) x),
    'the next run releases only the two left';

  -- The second share's release failed and is queued: that's the queue's job.
  v_release := public.queue_money_release(v_booking.id, v_s2, null, 'pi_rec_2', 'booking_cancelled', 'api_error');
  perform public.money_release_done(v_booking.id, v_s3, null, 'pi_rec_3', 'cancelled');
  assert not exists (select 1 from public.bookings_with_money_to_release() where booking_id = v_booking.id),
    'only a queued release is left: not picked up twice';

  perform public.money_release_done(v_booking.id, v_s2, null, 'pi_rec_2', 'cancelled');
  perform public.money_release_attempted(v_release, true, 'cancelled', null);
  assert not exists (select 1 from public.bookings_with_money_to_release()), 'nothing left';
  perform tests.act_as_postgres();
  assert (select array_agg(distinct status) from public.booking_payment_shares where booking_id = v_booking.id)
         = array['cancelled'], 'every share released, once';

  -- A booking from before P4a (no mode) is never swept.
  update public.venue_bookings set payment_mode = null where id = v_live.id;
  perform public.cancel_booking_for(v_live.id, v_live_booker);
  perform tests.act_as_service_role();
  assert not exists (select 1 from public.bookings_with_money_to_release()), 'old bookings keep the old flow';
  perform tests.act_as_postgres();
end $$;

-- A run that cancelled a hold at Stripe but died before recording it: the
-- next run finds the intent already cancelled and records the release from
-- the hold in the ledger, once. An intent that never held money records
-- nothing.
do $$
declare
  v_booker uuid := tests.create_user('recovery-lost-cancel@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := (tests.share_of(v_booking.id, v_booker)).id;
  perform tests.hold_share(v_share, 'pi_rec_lost');

  perform tests.act_as_service_role();
  assert public.record_intent_cancelled(v_booking.id, v_share, null, 'pi_rec_lost', 'booking_cancelled'), 'recorded';
  assert not public.record_intent_cancelled(v_booking.id, v_share, null, 'pi_rec_lost', 'booking_cancelled'), 'once';
  assert not public.record_intent_cancelled(v_booking.id, v_share, null, 'pi_never_held', 'booking_cancelled'),
    'nothing was held on it: nothing to record';
  perform tests.act_as_postgres();
  assert (select (amount_cents, reason) from public.money_ledger where kind = 'cancel' and stripe_id = 'pi_rec_lost')
         = (680, 'booking_cancelled'::text), 'the held amount, with its reason';
end $$;

-- A held guarantee, or a paid share, on a cancelled booking is found too.
do $$
declare
  v_booker uuid := tests.create_user('recovery-guarantee@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  update public.profiles set stripe_customer_id = 'cus_rec_g' where id = v_booker;
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_rec_g_share', 'pm_rec_g');
  select id into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;
  perform tests.act_as_service_role();
  perform public.guarantee_hold_placed(v_guarantee, 'pi_rec_g_hold', 6000);
  -- The share was taken.
  perform public.share_captured((tests.share_of(v_booking.id, v_booker)).id, 680, 35);
  perform tests.act_as_postgres();

  perform public.cancel_booking_for(v_booking.id, v_booker);
  perform tests.act_as_service_role();
  assert exists (select 1 from public.bookings_with_money_to_release() where booking_id = v_booking.id), 'found';
  perform public.money_release_done(v_booking.id, (tests.share_of(v_booking.id, v_booker)).id, null, 'pi_rec_g_share', 'refunded');
  assert exists (select 1 from public.bookings_with_money_to_release() where booking_id = v_booking.id),
    'the guarantee hold is still on the card';
  perform public.money_release_done(v_booking.id, null, v_guarantee, 'pi_rec_g_hold', 'cancelled');
  assert not exists (select 1 from public.bookings_with_money_to_release() where booking_id = v_booking.id), 'all given back';
  perform tests.act_as_postgres();
end $$;

-- A failed capture backs off 1, 5, 15, 60 minutes, then hourly; the third
-- failure raises one admin alert for the founders.
do $$
declare
  v_booker uuid := tests.create_user('recovery-capture@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share uuid;
  v_result jsonb;
  v_waits integer[] := array[]::integer[];
  v_alerts integer[] := array[]::integer[];
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := (tests.share_of(v_booking.id, v_booker)).id;
  perform tests.hold_share(v_share, 'pi_rec_cap');
  update public.booking_payment_shares set capture_due_at = now() - interval '1 minute' where id = v_share;

  for i in 1..6 loop
    perform tests.act_as_service_role();
    assert exists (select 1 from public.shares_due_for_capture() where share_id = v_share), format('due before failure %s', i);
    v_result := public.share_capture_failed(v_share, 'card_declined');
    assert not exists (select 1 from public.shares_due_for_capture() where share_id = v_share),
      format('not retried before its back-off, failure %s', i);
    perform tests.act_as_postgres();
    v_waits := v_waits || round(extract(epoch from
      (select capture_next_attempt_at from public.booking_payment_shares where id = v_share) - now()) / 60)::integer;
    v_alerts := v_alerts || (select count(*)::integer from public.admin_alerts where share_id = v_share);
    update public.booking_payment_shares set capture_next_attempt_at = now() - interval '1 second' where id = v_share;
  end loop;

  assert v_waits = array[1, 5, 15, 60, 60, 60], format('1, 5, 15, 60 minutes, then hourly, got %s', v_waits);
  assert v_alerts = array[0, 0, 1, 1, 1, 1], format('one alert, at the third failure, got %s', v_alerts);
  assert (select (kind, booking_id, details ->> 'last_error', (details ->> 'attempts')::int)
          from public.admin_alerts where share_id = v_share) = ('capture_failing'::text, v_booking.id, 'card_declined'::text, 3),
    'the alert says what is failing and why';
  assert (select (status, capture_attempts, capture_last_error) from public.booking_payment_shares where id = v_share)
         = ('authorized'::text, 6, 'card_declined'::text), 'still held, every failure counted';

  -- Players can't read the alerts or record a failure.
  perform tests.act_as(v_booker);
  assert tests.error_of('select count(*) from public.admin_alerts') like 'permission denied%', 'alerts are internal';
  assert tests.error_of(format($q$ select public.share_capture_failed(%L, 'x') $q$, v_share)) like 'permission denied%',
    'service role only';
  perform tests.act_as_postgres();
end $$;

-- A guarantee hold with no answer from Stripe (network, Stripe down) is not
-- a failed hold: the booker isn't told and it's tried again after 1, 5, 15,
-- 60 minutes, then hourly. It is checked at Stripe before the next try,
-- after kickoff too, so a hold that went through is never lost.
do $$
declare
  v_booker uuid := tests.create_user('recovery-api@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_booking public.venue_bookings;
  v_guarantee uuid;
  v_due record;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  update public.profiles set stripe_customer_id = 'cus_rec_api' where id = v_booker;
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_rec_api_share', 'pm_rec_api');
  select id into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;

  perform tests.act_as_service_role();
  select * into v_due from public.guarantees_due_for_hold(v_guarantee);
  assert (v_due.api_errors, v_due.check_only, v_due.stripe_payment_method_id) = (0, false, 'pm_rec_api'),
    format('a first try, got %s / %s / %s', v_due.api_errors, v_due.check_only, v_due.stripe_payment_method_id);
  assert v_due.created_at is not null, 'with when the guarantee was made, to look for its intents at Stripe';

  v_result := public.guarantee_hold_errored(v_guarantee, 'api_connection_error');
  assert v_result ->> 'result' = 'retry', format('got %s', v_result);
  assert not exists (select 1 from public.guarantees_due_for_hold(v_guarantee)), 'not retried at once';
  perform tests.act_as_postgres();
  assert (select (status, attempts, api_errors, last_error, round(extract(epoch from next_attempt_at - now()) / 60)::int)
          from public.booking_guarantees where id = v_guarantee) = ('scheduled'::text, 0, 1, 'api_connection_error'::text, 1),
    'not a failed attempt; tried again in a minute';
  assert not exists (select 1 from public.notifications where profile_id = v_booker and type = 'guarantee_hold_failed'),
    'the booker is not told: nothing is wrong with their card';

  update public.booking_guarantees set next_attempt_at = now() - interval '1 second' where id = v_guarantee;
  perform tests.act_as_service_role();
  perform public.guarantee_hold_errored(v_guarantee, 'api_error');
  perform tests.act_as_postgres();
  assert (select round(extract(epoch from next_attempt_at - now()) / 60)::int from public.booking_guarantees
          where id = v_guarantee) = 5, 'then 5 minutes';

  -- Kickoff passes while Stripe's answer is still unknown: checked, never placed.
  update public.booking_guarantees set next_attempt_at = now() - interval '1 second' where id = v_guarantee;
  perform tests.set_kickoff(v_booking.id, now() - interval '1 minute');
  perform tests.act_as_service_role();
  select * into v_due from public.guarantees_due_for_hold(v_guarantee);
  assert (v_due.guarantee_id, v_due.check_only) = (v_guarantee, true), 'after kickoff: only looked up at Stripe';
  perform public.guarantee_hold_check_cleared(v_guarantee);
  assert not exists (select 1 from public.guarantees_due_for_hold(v_guarantee)), 'nothing found: never tried again';
  perform tests.act_as_postgres();
  assert (select api_errors from public.booking_guarantees where id = v_guarantee) = 0, 'cleared';
end $$;

-- A hold placed (or found at Stripe) clears the unanswered tries; a card
-- problem (failed hold) does too, and that one tells the booker.
do $$
declare
  v_booker uuid := tests.create_user('recovery-api-found@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  update public.profiles set stripe_customer_id = 'cus_rec_found' where id = v_booker;
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_rec_found_share', 'pm_rec_found');
  select id into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;

  perform tests.act_as_service_role();
  perform public.guarantee_hold_errored(v_guarantee, 'api_connection_error');
  perform public.guarantee_hold_failed(v_guarantee, null, 'payment_method: resource_missing', false);
  perform tests.act_as_postgres();
  assert (select (status, attempts, api_errors) from public.booking_guarantees where id = v_guarantee) = ('failed'::text, 1, 0),
    'a card problem is a failed attempt';
  assert (select count(*) from public.notifications where profile_id = v_booker and type = 'guarantee_hold_failed') = 1,
    'and the booker is told once';

  update public.booking_guarantees set next_attempt_at = now() - interval '1 second' where id = v_guarantee;
  perform tests.act_as_service_role();
  perform public.guarantee_hold_errored(v_guarantee, 'api_connection_error');
  assert public.guarantee_hold_placed(v_guarantee, 'pi_rec_found_hold', 6000) ->> 'result' = 'held', 'found at Stripe: held';
  perform tests.act_as_postgres();
  assert (select (status, api_errors) from public.booking_guarantees where id = v_guarantee) = ('held'::text, 0), 'cleared';
end $$;

-- The 15-minute window: a booker saving a card with a SetupIntent (Premium,
-- cash) is found with it, so the job asks Stripe before cancelling.
do $$
declare
  v_booker uuid := tests.create_user('recovery-window-setup@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share uuid;
  v_row record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_booker);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := (tests.share_of(v_booking.id, v_booker)).id;
  perform tests.act_as_service_role();
  perform public.attach_share_setup(v_share, v_booker, 'cash', 'seti_rec_window', null);
  perform tests.act_as_postgres();
  update public.venue_bookings set created_at = now() - interval '16 minutes' where id = v_booking.id;

  perform tests.act_as_service_role();
  select * into v_row from public.bookings_past_payment_window() where booking_id = v_booking.id;
  assert (v_row.booker_intent_id, v_row.booker_setup_intent_id, v_row.booker_share_id) is not distinct from (null::text, 'seti_rec_window'::text, v_share),
    format('the SetupIntent is checked at Stripe first, got %s / %s / %s', v_row.booker_intent_id, v_row.booker_setup_intent_id, v_row.booker_share_id);
  assert v_row.booked_at = now() - interval '16 minutes', 'with when the window opened';

  -- Saved 14 minutes after booking (Stripe's event time): it counts.
  assert public.share_card_saved(v_share, 'seti_rec_window', 'pm_rec_window', now() - interval '2 minutes') ->> 'result' = 'saved',
    'a card saved inside the window counts';
  perform tests.act_as_postgres();
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the booking stands';
end $$;

-- Every new function is internal.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'bookings_with_money_to_release()',
    'record_intent_cancelled(uuid, uuid, uuid, text, text)',
    'share_capture_failed(uuid, text)',
    'guarantee_hold_errored(uuid, text)',
    'guarantee_hold_check_cleared(uuid)',
    'money_backoff_at(integer)',
    'guarantees_due_for_hold(uuid)',
    'bookings_past_payment_window()'
  ] loop
    assert not has_function_privilege('authenticated', 'public.' || v_fn, 'execute'), v_fn || ': not for players';
    assert not has_function_privilege('anon', 'public.' || v_fn, 'execute'), v_fn || ': not for anon';
    assert has_function_privilege('service_role', 'public.' || v_fn, 'execute'), v_fn || ': service role';
  end loop;
  assert not has_table_privilege('authenticated', 'public.admin_alerts', 'select'), 'admin_alerts: internal';
end $$;

rollback;
