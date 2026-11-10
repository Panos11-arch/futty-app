-- Credit set aside for a payment that's never finished is released, so a
-- player's credit never stays locked: when the payment is cancelled, when
-- the booking it was for expires, or when it isn't completed within 15
-- minutes (run-payment-jobs cancels the intent at Stripe first, so it can't
-- be paid with credit that has gone back).
begin;

-- Not completed within 15 minutes: released, the share back to its price
-- without credit.
do $$
declare
  v_booker uuid := tests.create_user('resv-booker@futty.test');
  v_player uuid := tests.create_user('resv-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_credit uuid;
  v_due record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_credit := tests.give_credit(v_player, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'resv');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_resv_0');
  v_share := tests.join_booking(v_booking.id, v_player);

  -- The player starts paying with credit and never finishes.
  perform tests.pay_share(v_share.id, 'pi_resv_unfinished', 'card');
  perform tests.act_as_service_role();
  perform public.attach_share_intent(v_share.id, v_player, 'card', false, 'pi_resv_unfinished_credit', 180, 'manual',
                                     'pi_resv_unfinished', true);
  perform tests.act_as_postgres();
  assert (select remaining_cents from public.venue_credits where id = v_credit) = 0, 'the credit is set aside';

  perform tests.act_as_service_role();
  assert not exists (select 1 from public.credit_reservations_to_release() where share_id = v_share.id),
    'not before 15 minutes';
  perform tests.act_as_postgres();

  update public.venue_credit_spends set created_at = now() - interval '15 minutes' where share_id = v_share.id;
  perform tests.act_as_service_role();
  select * into v_due from public.credit_reservations_to_release() where share_id = v_share.id;
  assert v_due.stripe_payment_intent_id = 'pi_resv_unfinished_credit', format('due at 15 minutes, got %s', row_to_json(v_due));

  -- run-payment-jobs cancelled that intent at Stripe; now the credit goes back.
  assert tests.error_of(format($q$ select public.release_share_credit_reservation(%L, 'pi_someone_else') $q$, v_share.id))
         is null, 'a call for another intent is harmless';
  assert not public.release_share_credit_reservation(v_share.id, 'pi_someone_else'), '...and releases nothing';
  assert public.release_share_credit_reservation(v_share.id, 'pi_resv_unfinished_credit'), 'released';
  assert not public.release_share_credit_reservation(v_share.id, 'pi_resv_unfinished_credit'), 'once';
  perform tests.act_as_postgres();

  assert (select remaining_cents from public.venue_credits where id = v_credit) = 500, 'the player has their 500 again';
  v_share := tests.share_of(v_booking.id, v_player);
  assert (v_share.credit_cents, v_share.amount_cents, v_share.fee_cents, v_share.status) = (0, 680, 80, 'pending'),
    format('the share is back to 680 without credit, got %s', row_to_json(v_share));
  assert not exists (select 1 from public.money_ledger where share_id = v_share.id and kind like 'credit%'),
    'credit set aside and never spent moves nothing in the ledger';

  -- They can start again with it.
  perform tests.act_as_service_role();
  assert (public.plan_share_payment(v_share.id, v_player, 'card', false, true) ->> 'credit_cents')::integer = 500,
    'the credit can be used again';
  perform tests.act_as_postgres();
end $$;

-- A payment that went through keeps its credit: spent, never listed.
do $$
declare
  v_booker uuid := tests.create_user('resv-held-booker@futty.test');
  v_player uuid := tests.create_user('resv-held-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'resv-held');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.pay_ago(v_share.id, 'pi_resv_held', interval '0', 'card', true);
  update public.venue_credit_spends set created_at = now() - interval '1 hour' where share_id = v_share.id;
  perform tests.act_as_service_role();
  assert not exists (select 1 from public.credit_reservations_to_release() where share_id = v_share.id),
    'held: the credit is spent, not just set aside';
  assert not public.release_share_credit_reservation(v_share.id, 'pi_resv_held'), 'and can''t be released';
  perform tests.act_as_postgres();
  assert (select status from public.venue_credit_spends where share_id = v_share.id) = 'spent', 'spent';
end $$;

-- The payment is cancelled (Stripe says the intent was cancelled): released
-- at once, whatever the time.
do $$
declare
  v_booker uuid := tests.create_user('resv-cancel-booker@futty.test');
  v_player uuid := tests.create_user('resv-cancel-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'resv-cancel');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.pay_share(v_share.id, 'pi_resv_x', 'card');
  perform tests.act_as_service_role();
  perform public.attach_share_intent(v_share.id, v_player, 'card', false, 'pi_resv_cancelled', 180, 'manual', 'pi_resv_x', true);
  assert public.release_share_credit_reservation(v_share.id, 'pi_resv_cancelled'), 'released when cancelled';
  perform tests.act_as_postgres();
  assert public.venue_credit_available_cents(v_player, v_venue) = 500, 'available again';
end $$;

-- A credit-covered payment saving a card (SetupIntent) that's never
-- finished: released the same way.
do $$
declare
  v_booker uuid := tests.create_user('resv-setup-booker@futty.test');
  v_player uuid := tests.create_user('resv-setup-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_due record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 700);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'resv-setup');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.act_as_service_role();
  perform public.attach_share_setup(v_share.id, v_player, 'card', 'seti_resv', null, true);
  perform tests.act_as_postgres();
  update public.venue_credit_spends set created_at = now() - interval '20 minutes' where share_id = v_share.id;
  perform tests.act_as_service_role();
  select * into v_due from public.credit_reservations_to_release() where share_id = v_share.id;
  assert v_due.stripe_setup_intent_id = 'seti_resv' and v_due.stripe_payment_intent_id is null, 'the SetupIntent is listed';
  assert public.release_share_credit_reservation(v_share.id, 'seti_resv'), 'released';
  perform tests.act_as_postgres();
  assert public.venue_credit_available_cents(v_player, v_venue) = 700, 'all 700 back';
  assert (tests.share_of(v_booking.id, v_player)).stripe_setup_intent_id is null, 'the unfinished SetupIntent is cleared';
end $$;

-- The booking expires (the booker didn't pay within 15 minutes): credit
-- the booker set aside goes back with it.
do $$
declare
  v_booker uuid := tests.create_user('resv-expire-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_booker, v_venue, 300);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'resv-expire');
  v_share := tests.player(v_booking.id, 0);
  perform tests.act_as_service_role();
  perform public.attach_share_intent(v_share.id, v_booker, 'card', false, 'pi_resv_booker', 380, 'manual', null, true);
  perform tests.act_as_postgres();
  assert public.venue_credit_available_cents(v_booker, v_venue) = 0, 'set aside';
  update public.venue_bookings set created_at = now() - interval '16 minutes' where id = v_booking.id;
  perform tests.act_as_service_role();
  assert public.expire_unpaid_booking(v_booking.id), 'the booking expires';
  perform tests.act_as_postgres();
  assert public.venue_credit_available_cents(v_booker, v_venue) = 300, 'the credit goes back with it';
end $$;

rollback;
