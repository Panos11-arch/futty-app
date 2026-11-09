-- The money ledger and who can touch the payment functions
-- (docs/specs/13-payments-bookings.md, "Server-side checks"):
--   every hold, capture and cancel is written once, with its reason;
--   the ledger and the internal payment functions are service_role only;
--   a booker sees their own guarantee, nobody else's.
begin;

-- Recording the same movement twice writes one row.
do $$
declare
  v_booking uuid := gen_random_uuid();
begin
  perform tests.act_as_service_role();
  assert public.record_money_movement(v_booking, null, null, 'cancel', 680, 'pi_ledger', 'booking_cancelled'),
    'first time: recorded';
  assert not public.record_money_movement(v_booking, null, null, 'cancel', 680, 'pi_ledger', 'booking_cancelled'),
    'second time: already there';
  assert tests.error_of(format($q$ select public.record_money_movement(%L, null, null, 'gift', 1, 'pi_x', 'x') $q$, v_booking))
         like '%money_ledger_kind_check%', 'only known kinds';
  assert tests.error_of(format($q$ select public.record_money_movement(%L, null, null, 'hold', 1, 'pi_y', '') $q$, v_booking))
         like '%money_ledger_reason_check%', 'every movement has a reason';
  perform tests.act_as_postgres();
  assert (select count(*) from public.money_ledger where booking_id = v_booking) = 1, 'one row';

  -- Nobody can change the record, not even the service role.
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ update public.money_ledger set amount_cents = 1 where booking_id = %L $q$, v_booking))
         like 'permission denied%', 'the ledger is append-only';
  assert tests.error_of(format($q$ delete from public.money_ledger where booking_id = %L $q$, v_booking))
         like 'permission denied%', 'and rows are never deleted';
  perform tests.act_as_postgres();
end $$;

-- Players can't read the ledger or call the internal payment functions.
do $$
declare
  v_player uuid := tests.create_user('ledger-player@futty.test');
  v_fn text;
begin
  perform tests.act_as(v_player);
  assert tests.error_of('select count(*) from public.money_ledger') like 'permission denied%', 'no ledger for players';
  perform tests.act_as_postgres();

  foreach v_fn in array array[
    'money_share(integer, integer, text, boolean, boolean, text)',
    'prepare_share_payment(uuid, uuid, text, boolean)',
    'set_share_payment_intent(uuid, text)',
    'set_stripe_customer(uuid, text)',
    'share_payment_held(text, integer, text)',
    'share_payment_captured(text, integer, text)',
    'share_card_saved(uuid, text, text)',
    'shares_due_for_capture()',
    'share_captured(uuid, integer)',
    'guarantees_due_for_hold(uuid)',
    'guarantee_hold_placed(uuid, text, integer)',
    'guarantee_hold_failed(uuid, text, text)',
    'record_money_movement(uuid, uuid, uuid, text, integer, text, text)',
    'booking_money_to_release(uuid)',
    'share_released(uuid, text)',
    'guarantee_released(uuid)'
  ] loop
    assert not has_function_privilege('authenticated', 'public.' || v_fn, 'execute'), v_fn || ': not for players';
    assert not has_function_privilege('anon', 'public.' || v_fn, 'execute'), v_fn || ': not for anon';
    assert has_function_privilege('service_role', 'public.' || v_fn, 'execute'), v_fn || ': for the service role';
    assert (select 'search_path=""' = any (proconfig) from pg_proc where oid = ('public.' || v_fn)::regprocedure),
      v_fn || ': search_path is empty';
  end loop;
end $$;

-- A booker sees their own guarantee; another player doesn't.
do $$
declare
  v_booker uuid := tests.create_user('ledger-guarantee-booker@futty.test');
  v_other uuid := tests.create_user('ledger-guarantee-other@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 5, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  assert (select count(*) from public.booking_guarantees where booking_id = v_booking.id) = 1, 'the booker sees it';
  assert tests.error_of(format($q$ update public.booking_guarantees set amount_cents = 1 where booking_id = %L $q$, v_booking.id))
         like 'permission denied%', 'but can''t change it';
  perform tests.act_as(v_other);
  assert (select count(*) from public.booking_guarantees where booking_id = v_booking.id) = 0, 'others don''t';
  perform tests.act_as_postgres();
end $$;

-- Cancelling a booking: what has to be released, and recording it.
do $$
declare
  v_booker uuid := tests.create_user('ledger-cancel-booker@futty.test');
  v_held uuid := tests.create_user('ledger-cancel-held@futty.test');
  v_paid uuid := tests.create_user('ledger-cancel-paid@futty.test');
  v_unpaid uuid := tests.create_user('ledger-cancel-unpaid@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee uuid;
  v_row record;
  v_kinds text[];
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  perform tests.join_booking(v_booking.id, v_held);
  perform tests.join_booking(v_booking.id, v_paid);
  perform tests.join_booking(v_booking.id, v_unpaid);
  select id into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;

  perform tests.act_as_service_role();
  perform public.set_share_payment_intent((tests.share_of(v_booking.id, v_booker)).id, 'pi_c_booker');
  perform public.share_payment_held('pi_c_booker', 680, 'pm_c');
  perform public.set_share_payment_intent((tests.share_of(v_booking.id, v_held)).id, 'pi_c_held');
  perform public.share_payment_held('pi_c_held', 680, 'pm_h');
  perform public.set_share_payment_intent((tests.share_of(v_booking.id, v_paid)).id, 'pi_c_paid');
  perform public.share_payment_held('pi_c_paid', 680, 'pm_p');
  perform public.share_captured((tests.share_of(v_booking.id, v_paid)).id, 680);
  perform public.guarantee_hold_placed(v_guarantee, 'pi_c_guarantee', 6000);

  select array_agg(kind || ':' || status || ':' || coalesce(stripe_payment_intent_id, '-') || ':' || amount_cents order by kind, stripe_payment_intent_id)
  into v_kinds
  from public.booking_money_to_release(v_booking.id);
  assert v_kinds = array[
    'guarantee:held:pi_c_guarantee:6000',
    'share:authorized:pi_c_booker:680',
    'share:authorized:pi_c_held:680',
    'share:paid:pi_c_paid:680',
    'share:pending:-:680'
  ], format('every hold, payment and unpaid share is listed, got %s', v_kinds);

  assert public.share_released((tests.share_of(v_booking.id, v_held)).id, 'cancelled'), 'released';
  assert not public.share_released((tests.share_of(v_booking.id, v_held)).id, 'cancelled'), 'only once';
  assert tests.error_of(format($q$ select public.share_released(%L, 'paid') $q$, (tests.share_of(v_booking.id, v_held)).id))
         = 'invalid_status', 'only cancelled or refunded';
  assert public.guarantee_released(v_guarantee), 'guarantee released';
  perform tests.act_as_postgres();
  assert (select status from public.booking_guarantees where id = v_guarantee) = 'cancelled', 'cancelled';
  assert (tests.share_of(v_booking.id, v_held)).status = 'cancelled', 'share cancelled';
end $$;

rollback;
