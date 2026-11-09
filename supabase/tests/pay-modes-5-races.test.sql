-- Races and failure paths in taking and giving back money
-- (docs/specs/13-payments-bookings.md, "When money is held and taken",
-- "Server-side checks": every money movement happens once, and the books
-- always balance). The Stripe side of each is tested in the Edge Functions'
-- Deno tests; these check what the database decides and records.
begin;

-- Double Pay with a method change: a share's amounts only change together
-- with its intent, and never under an intent someone else attached
-- meanwhile or one that's already held.
do $$
declare
  v_booker uuid := tests.create_user('race-double-booker@futty.test');
  v_player uuid := tests.create_user('race-double-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := tests.join_booking(v_booking.id, v_player);

  -- Device A pays by card: pi_card goes on the share with 680.
  perform tests.pay_share(v_share.id, 'pi_card');
  -- Device B, which saw no intent, switches to cash: refused, nothing changes.
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.attach_share_intent(%L, %L, 'cash', false, 'pi_cash', 80, 'manual', null) $q$,
                               v_share.id, v_player)) = 'share_changed', 'a stale request is refused';
  -- An intent whose amount isn't the plan's is refused too.
  assert tests.error_of(format($q$ select public.attach_share_intent(%L, %L, 'cash', false, 'pi_cash', 680, 'manual', 'pi_card') $q$,
                               v_share.id, v_player)) = 'share_changed', 'the intent must be exactly the plan';
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_player);
  assert (v_share.stripe_payment_intent_id, v_share.payment_method, v_share.amount_cents) = ('pi_card', 'card', 680),
    'the share still describes the card intent';

  -- Device A's card is held; now nothing about the share can change.
  perform tests.act_as_service_role();
  perform public.share_payment_held(v_share.id, 'pi_card', 680, 'pm_a', now());
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'cash', false) $q$, v_share.id, v_player))
         = 'share_not_pending', 'a held share is never replanned';
  assert tests.error_of(format($q$ select public.attach_share_intent(%L, %L, 'cash', false, 'pi_cash', 80, 'manual', 'pi_card') $q$,
                               v_share.id, v_player)) = 'share_not_pending', 'nor re-attached';
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_player);
  assert (v_share.status, v_share.amount_cents, v_share.payment_method) = ('authorized', 680, 'card'), 'held at 680 by card';
end $$;

-- Cancelling racing an immediate capture: the money was taken as the
-- booking was cancelled. It's recorded, then refunded and recorded; the
-- books balance at zero for the venue and Futty keeps nothing.
do $$
declare
  v_booker uuid := tests.create_user('race-cancel-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_slot record := tests.slot_starting_in(interval '5 hours');
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_result jsonb;
  v_balance record;
begin
  perform tests.set_price(v_venue, '5-a-side', 12000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_slot.day, v_slot.start_time, v_slot.end_time, 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_booker);
  perform tests.pay_share(v_share.id, 'pi_cancel_race', 'card', true);

  -- The booking is cancelled; the capture lands right after.
  perform public.cancel_booking_for(v_booking.id, v_booker);
  perform tests.act_as_service_role();
  v_result := public.share_payment_captured(v_share.id, 'pi_cancel_race', 680, 'pm_x', 80, 35, now());
  assert (v_result ->> 'result', v_result ->> 'reason') = ('refund', 'booking_cancelled'),
    format('money taken on a cancelled booking is refunded, got %s', v_result);
  assert (select (amount_cents, venue_cents, futty_cents, stripe_fee_cents) = (680, 600, 45, 35)
          from public.money_ledger where kind = 'capture' and stripe_id = 'pi_cancel_race'), 'the capture is recorded';

  -- The Edge Function refunds it (re_cancel_race) and records it.
  assert public.record_intent_refund('pi_cancel_race', 're_cancel_race', 680, 'booking_cancelled'), 'refund recorded';
  perform public.money_release_done(v_booking.id, v_share.id, null, 'pi_cancel_race', 'refunded');
  select * into v_balance from public.money_balance(v_booking.id);
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_booker)).status = 'refunded', 'the share is refunded';
  assert (v_balance.taken_cents, v_balance.refunded_cents, v_balance.venue_cents, v_balance.futty_cents, v_balance.stripe_fee_cents)
         = (680, 680, 0, -35, 35), format('venue 0, Futty pays Stripe''s 35, got %s', row(v_balance.*));
  assert v_balance.balanced, 'the books balance';
end $$;

-- A guarantee hold placed after the booking was cancelled is recorded and
-- released at once; the guarantee stays cancelled.
do $$
declare
  v_booker uuid := tests.create_user('race-guarantee-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee uuid;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  update public.profiles set stripe_customer_id = 'cus_race_g' where id = v_booker;
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_race_g_share', 'pm_race_g');
  select id into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;

  -- The job read the guarantee as due, then the booking was cancelled.
  perform public.cancel_booking_for(v_booking.id, v_booker);
  perform public.guarantee_released(v_guarantee);
  perform tests.act_as_service_role();
  v_result := public.guarantee_hold_placed(v_guarantee, 'pi_race_g_hold', 6000);
  assert (v_result ->> 'result', v_result ->> 'reason') = ('release', 'booking_cancelled'),
    format('released at once, got %s', v_result);
  perform public.record_money_movement(v_booking.id, null, v_guarantee, 'cancel', 6000, 'pi_race_g_hold', 'pi_race_g_hold',
                                       'booking_cancelled');
  perform public.money_release_done(v_booking.id, null, v_guarantee, 'pi_race_g_hold', 'cancelled');
  perform tests.act_as_postgres();
  assert (select status from public.booking_guarantees where id = v_guarantee) = 'cancelled', 'still cancelled, never held';
  assert (select array_agg(kind order by kind) from public.money_ledger where stripe_intent_id = 'pi_race_g_hold')
         = array['cancel', 'hold'], 'the hold and its release are both recorded';
end $$;

-- Guarantee retries stop at kickoff (decided 9 November); the booker can
-- replace their card and the hold is retried at once.
do $$
declare
  v_booker uuid := tests.create_user('race-retry-booker@futty.test');
  v_other uuid := tests.create_user('race-retry-other@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_booking public.venue_bookings;
  v_guarantee uuid;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  update public.profiles set stripe_customer_id = 'cus_retry' where id = v_booker;
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_retry_share', 'pm_retry');
  select id into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;

  perform tests.act_as_service_role();
  v_result := public.guarantee_hold_failed(v_guarantee, 'pi_retry_1', 'authentication_required', true);
  assert (v_result ->> 'notified')::boolean, 'the booker is told once';
  perform tests.act_as_postgres();
  assert (select data ->> 'needsAction' from public.notifications where profile_id = v_booker and type = 'guarantee_hold_failed')
         = 'true', '3-D Secure: asked to confirm the card in the app';

  -- The retry time has come, but so has kickoff: no more tries.
  update public.booking_guarantees set next_attempt_at = now() - interval '1 minute' where id = v_guarantee;
  perform tests.act_as_service_role();
  assert exists (select 1 from public.guarantees_due_for_hold() where guarantee_id = v_guarantee), 'due before kickoff';
  perform tests.act_as_postgres();

  -- The booker replaces the card: only they can, and the hold is due at once.
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.guarantee_for_card_update(%L, %L) $q$, v_booking.id, v_other))
         = 'not_your_booking', 'only the booker';
  assert public.guarantee_for_card_update(v_booking.id, v_booker) ->> 'guarantee_id' = v_guarantee::text, 'the booker can';
  update public.booking_guarantees set next_attempt_at = now() + interval '5 hours' where id = v_guarantee;
  assert public.guarantee_card_replaced(v_guarantee, v_other, 'pm_stolen') ->> 'result' = 'ignored', 'not someone else''s card';
  v_result := public.guarantee_card_replaced(v_guarantee, v_booker, 'pm_new');
  assert (v_result ->> 'guarantee_due')::boolean, format('retried at once with the new card, got %s', v_result);
  assert (select stripe_payment_method_id = 'pm_new' from public.guarantees_due_for_hold() where guarantee_id = v_guarantee),
    'with the new card';
  perform tests.act_as_postgres();

  perform tests.set_kickoff(v_booking.id, now() - interval '1 minute');
  perform tests.act_as_service_role();
  assert not exists (select 1 from public.guarantees_due_for_hold() where guarantee_id = v_guarantee),
    'from kickoff on, the hold is never tried again';
  assert tests.error_of(format($q$ select public.guarantee_for_card_update(%L, %L) $q$, v_booking.id, v_booker))
         = 'guarantee_closed', 'and the card can''t be replaced';
  perform tests.act_as_postgres();
end $$;

-- A failed refund is queued and retried until it succeeds; each attempt is
-- logged.
do $$
declare
  v_booking uuid := gen_random_uuid();
  v_release uuid;
begin
  perform tests.act_as_service_role();
  v_release := public.queue_money_release(v_booking, null, null, 'pi_queue', 'booking_cancelled', 'api_connection_error');
  assert public.queue_money_release(v_booking, null, null, 'pi_queue', 'booking_cancelled', 'api_connection_error') = v_release,
    'the same intent is queued once';
  assert not exists (select 1 from public.money_releases_due() where release_id = v_release), 'not retried straight away';
  perform tests.act_as_postgres();

  update public.money_releases set next_attempt_at = now() - interval '1 second' where id = v_release;
  perform tests.act_as_service_role();
  assert (select attempts from public.money_releases_due() where release_id = v_release) = 2, 'due, after two failures';
  perform public.money_release_attempted(v_release, false, null, 'rate_limit');
  perform tests.act_as_postgres();
  update public.money_releases set next_attempt_at = now() - interval '1 second' where id = v_release;
  perform tests.act_as_service_role();
  perform public.money_release_attempted(v_release, true, 'refunded', null);
  assert not exists (select 1 from public.money_releases_due() where release_id = v_release), 'done: off the queue';
  perform tests.act_as_postgres();

  assert (select (status, attempts) = ('done', 4) from public.money_releases where id = v_release), 'done after 4 attempts';
  assert (select array_agg(succeeded order by attempted_at, succeeded) from public.money_release_attempts where release_id = v_release)
         = array[false, false, false, true], 'every attempt is logged';
  assert public.money_release_retry_at(1) <= now() + interval '5 minutes'
     and public.money_release_retry_at(20) = now() + interval '6 hours', 'backs off, at most 6 hours';
end $$;

-- Two partial refunds on one intent: each is recorded once, keyed on its
-- refund id; the venue's part goes back first; never more than was taken.
do $$
declare
  v_booking uuid := gen_random_uuid();
  v_balance record;
begin
  perform tests.act_as_service_role();
  assert public.record_intent_capture(v_booking, null, null, 'pi_partial', 680, 80, 35, 'share_taken'), 'captured';
  assert public.record_intent_refund('pi_partial', 're_partial_1', 300, 'first'), 'first refund';
  assert public.record_intent_refund('pi_partial', 're_partial_2', 330, 'second'), 'second refund, same intent';
  assert not public.record_intent_refund('pi_partial', 're_partial_1', 300, 'first'), 'a refund is recorded once';
  assert tests.error_of($q$ select public.record_intent_refund('pi_partial', 're_partial_3', 51, 'too much') $q$)
         = 'refund_exceeds_capture', 'never more than was taken';
  assert tests.error_of($q$ select public.record_intent_refund('pi_partial', 'pi_partial', 1, 'by intent') $q$)
         like '%money_ledger_refund_id_check%', 'a refund is keyed on its refund id, not the intent';
  assert tests.error_of($q$ select public.record_intent_refund('pi_nothing', 're_nothing', 1, 'x') $q$)
         = 'capture_not_recorded', 'only money that was taken can be refunded';
  select * into v_balance from public.money_balance(v_booking);
  perform tests.act_as_postgres();

  assert (select array_agg((venue_cents, futty_cents)::text order by stripe_id) from public.money_ledger
          where kind = 'refund' and stripe_intent_id = 'pi_partial') = array['(-300,0)', '(-300,-30)'],
    'the venue''s 600 goes back first, then Futty''s fee';
  assert (v_balance.taken_cents, v_balance.refunded_cents, v_balance.venue_cents, v_balance.futty_cents, v_balance.stripe_fee_cents)
         = (680, 630, 0, 15, 35) and v_balance.balanced, format('the books balance, got %s', row(v_balance.*));
end $$;

-- A webhook for a replaced intent never touches the share: a hold on it is
-- released, money taken on it is recorded with its own fee and refunded.
do $$
declare
  v_booker uuid := tests.create_user('race-replaced-booker@futty.test');
  v_player uuid := tests.create_user('race-replaced-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.pay_share(v_share.id, 'pi_old');
  perform tests.pay_share(v_share.id, 'pi_new', 'cash');

  perform tests.act_as_service_role();
  v_result := public.share_payment_held(v_share.id, 'pi_old', 680, 'pm_old', now());
  assert (v_result ->> 'result', v_result ->> 'reason') = ('release', 'replaced_intent'), format('released, got %s', v_result);
  v_result := public.share_payment_captured(v_share.id, 'pi_old', 680, 'pm_old', 80, 35, now());
  assert (v_result ->> 'result', v_result ->> 'reason') = ('refund', 'replaced_intent'), format('refunded, got %s', v_result);
  assert public.record_intent_refund('pi_old', 're_old', 680, 'replaced_intent'), 'the refund is recorded';
  perform public.money_release_done(v_booking.id, v_share.id, null, 'pi_old', 'refunded');
  perform tests.act_as_postgres();

  v_share := tests.share_of(v_booking.id, v_player);
  assert (v_share.status, v_share.stripe_payment_intent_id, v_share.amount_cents, v_share.payment_method)
         = ('pending', 'pi_new', 80, 'cash'), format('the share is untouched, got %s', row(v_share.*));
  assert (select balanced and refunded_cents = 680 from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- The booker completes payment within 15 minutes of booking or the booking
-- is cancelled and its pitches released (decided 9 November). A payment
-- Stripe reports after the window is refused by its event time.
do $$
declare
  v_booker uuid := tests.create_user('race-window-booker@futty.test');
  v_late uuid := tests.create_user('race-window-late@futty.test');
  v_ontime uuid := tests.create_user('race-window-ontime@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 3);
  v_unpaid public.venue_bookings;
  v_late_booking public.venue_bookings;
  v_ontime_booking public.venue_bookings;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_unpaid := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as(v_late);
  v_late_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as(v_ontime);
  v_ontime_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();

  perform tests.act_as_service_role();
  assert not exists (select 1 from public.bookings_past_payment_window() where booking_id = v_unpaid.id), 'inside 15 minutes';
  assert not public.expire_unpaid_booking(v_unpaid.id), 'nothing to expire yet';
  perform tests.act_as_postgres();

  -- Each booker started paying inside the window.
  perform tests.pay_share((tests.share_of(v_late_booking.id, v_late)).id, 'pi_window_late');
  perform tests.pay_share((tests.share_of(v_ontime_booking.id, v_ontime)).id, 'pi_window_ontime');

  -- 16 minutes later.
  update public.venue_bookings set created_at = now() - interval '16 minutes'
  where id in (v_unpaid.id, v_late_booking.id, v_ontime_booking.id);

  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false) $q$,
                               (tests.share_of(v_unpaid.id, v_booker)).id, v_booker)) = 'payment_window_closed',
    'the booker can''t start paying after 15 minutes';
  assert exists (select 1 from public.bookings_past_payment_window() where booking_id = v_unpaid.id and booker_intent_id is null),
    'the job finds it';
  assert public.expire_unpaid_booking(v_unpaid.id), 'expired';
  assert not public.expire_unpaid_booking(v_unpaid.id), 'once';

  -- Held 14 minutes after booking, reported late: it counts.
  v_result := public.share_payment_held((tests.share_of(v_ontime_booking.id, v_ontime)).id, 'pi_window_ontime', 680, 'pm_ontime',
                                        now() - interval '2 minutes');
  assert v_result ->> 'result' = 'held', format('a payment inside the window counts, got %s', v_result);
  -- Held 16 minutes after booking: refused; the booking is cancelled.
  v_result := public.share_payment_held((tests.share_of(v_late_booking.id, v_late)).id, 'pi_window_late', 6550, 'pm_late', now());
  assert v_result ->> 'result' = 'expired', format('a payment after the window is refused, got %s', v_result);
  perform tests.act_as_postgres();

  assert (select status from public.venue_bookings where id = v_unpaid.id) = 'cancelled', 'the unpaid booking is cancelled';
  assert not exists (select 1 from public.booking_pitches where booking_id = v_unpaid.id), 'its pitch is released';
  assert (select status from public.booking_guarantees where booking_id = v_unpaid.id) = 'cancelled', 'its guarantee closed';
  assert (tests.share_of(v_unpaid.id, v_booker)).status = 'cancelled', 'its unpaid share closed';
  assert exists (select 1 from public.notifications where profile_id = v_booker and type = 'booking_cancelled'), 'the booker is told';
  assert (select status from public.venue_bookings where id = v_late_booking.id) = 'cancelled', 'the late booking is cancelled';
  assert (select status from public.venue_bookings where id = v_ontime_booking.id) = 'confirmed', 'the on-time one stands';

  -- The freed slot can be booked again.
  perform tests.act_as(tests.create_user('race-window-again@futty.test'));
  perform public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
end $$;

-- A cancelled or refunded share frees its spot: only active shares count
-- toward capacity.
do $$
declare
  v_booker uuid := tests.create_user('race-capacity-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_players uuid[] := array[]::uuid[];
  v_extra uuid := tests.create_user('race-capacity-extra@futty.test');
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  for i in 1..9 loop
    v_players := v_players || tests.create_user(format('race-capacity-%s@futty.test', i));
    perform tests.join_booking(v_booking.id, v_players[i]);
  end loop;
  assert (tests.join_booking(v_booking.id, v_extra)).id is null, 'full at 10';

  update public.booking_payment_shares set status = 'cancelled' where booking_id = v_booking.id and profile_id = v_players[1];
  assert (tests.join_booking(v_booking.id, v_extra)).amount_cents = 680, 'a cancelled spot can be taken again';
end $$;

rollback;
