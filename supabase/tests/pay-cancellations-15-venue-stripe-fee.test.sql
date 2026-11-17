-- The venue's cancel quote shows Stripe's fee the venue will owe
-- (docs/specs/13-payments-bookings.md, "The venue cancels"): with scope
-- 'venue', cancellation_quote returns venue_stripe_fee_cents, the sum of the
-- fees recorded in money_ledger for every card payment the cancel refunds
-- or turns into credit. It is exactly what the cancel then records in
-- venue_payables. The quote hash is unchanged; only the venue's own staff
-- can ask.
begin;

-- Card payments: three taken (one refunded, one credited, one left to
-- choose) and one only held. The quote is the three fees; venue_payables
-- ends up with the same.
do $$
declare
  v_owner uuid := tests.create_user('vsf-card-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_refund public.booking_payment_shares;
  v_credit public.booking_payment_shares;
  v_held public.booking_payment_shares;
  v_quote jsonb;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
  v_owed integer;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(tests.create_user('vsf-card-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 3, tests.cyprus_today() + 3, p_label => 'vsf-card');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_vsf_0', interval '2 hours');
  v_refund := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_vsf_1', interval '2 hours');
  v_credit := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_vsf_2', interval '2 hours');
  v_held := tests.pay_ago((tests.player(v_booking.id, 3)).id, 'pi_vsf_3', interval '5 minutes');
  assert v_held.status = 'authorized', 'one share is only held';

  perform tests.act_as(v_owner);
  v_quote := public.cancellation_quote(v_booking.id, 'venue');
  perform tests.act_as_postgres();
  assert (v_quote ->> 'venue_stripe_fee_cents')::integer = 3 * tests.stripe_fee(680),
    format('the quote shows Stripe''s fee on the 3 payments taken, got %s', v_quote -> 'venue_stripe_fee_cents');
  assert v_quote ->> 'quote' = tests.plan(v_booking.id, 'venue', v_owner) ->> 'quote', 'the quote hash is unchanged';

  perform tests.act_as_service_role();
  v_done := public.cancel_booking_internal(v_booking.id, 'venue', v_owner, v_quote ->> 'quote');
  perform tests.act_as_postgres();

  v_line := tests.line(v_done, v_refund.id);
  perform tests.act_as_service_role();
  perform public.choose_cancellation_refund(v_line.id, v_refund.profile_id, 'card');
  perform public.record_intent_refund('pi_vsf_1', 're_vsf_1', 680, 'venue_cancelled');
  perform public.cancellation_line_refunded(v_line.id, 'refunded');
  v_line := tests.line(v_done, v_credit.id);
  perform public.choose_cancellation_refund(v_line.id, v_credit.profile_id, 'credit');
  v_line := tests.line(v_done, (tests.player(v_booking.id, 0)).id);
  perform public.choose_cancellation_refund(v_line.id, (tests.player(v_booking.id, 0)).profile_id, 'credit');
  perform tests.act_as_postgres();

  select sum(amount_cents) into v_owed from public.venue_payables where booking_id = v_booking.id;
  assert v_owed = (v_quote ->> 'venue_stripe_fee_cents')::integer,
    format('venue_payables (%s) is what the quote showed (%s)', v_owed, v_quote ->> 'venue_stripe_fee_cents');
  assert not exists (select 1 from public.venue_payables where share_id = v_held.id), 'nothing on the hold';
end $$;

-- A mix of card and cash: a card player, a cash player who paid the 80 fee
-- by card and whose 600 cash was ticked, and one who hasn't paid. Only the
-- card payments carry a Stripe fee.
do $$
declare
  v_owner uuid := tests.create_user('vsf-mix-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_card public.booking_payment_shares;
  v_cash public.booking_payment_shares;
  v_quote jsonb;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
  v_owed integer;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(tests.create_user('vsf-mix-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 2, tests.cyprus_today() + 3, p_label => 'vsf-mix');
  v_card := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_vsfm_0', interval '2 hours');
  v_cash := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_vsfm_1', interval '2 hours', 'cash');
  assert v_cash.amount_cents = 80 and v_cash.cash_cents = 600, 'a cash player paid the 80 fee by card';
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_cash.id);
  v_quote := public.cancellation_quote(v_booking.id, 'venue');
  perform tests.act_as_postgres();
  assert (v_quote ->> 'venue_stripe_fee_cents')::integer = tests.stripe_fee(680) + tests.stripe_fee(80),
    format('Stripe''s fee on the card parts only, got %s', v_quote -> 'venue_stripe_fee_cents');

  perform tests.act_as_service_role();
  v_done := public.cancel_booking_internal(v_booking.id, 'venue', v_owner, v_quote ->> 'quote');
  v_line := tests.line(v_done, v_card.id);
  perform public.choose_cancellation_refund(v_line.id, v_card.profile_id, 'credit');
  v_line := tests.line(v_done, v_cash.id);
  perform public.choose_cancellation_refund(v_line.id, v_cash.profile_id, 'card');
  perform public.record_intent_refund('pi_vsfm_1', 're_vsfm_1', 80, 'venue_cancelled');
  perform public.cancellation_line_refunded(v_line.id, 'refunded');
  perform tests.act_as_postgres();

  select sum(amount_cents) into v_owed from public.venue_payables where booking_id = v_booking.id;
  assert v_owed = (v_quote ->> 'venue_stripe_fee_cents')::integer,
    format('venue_payables (%s) is what the quote showed (%s)', v_owed, v_quote ->> 'venue_stripe_fee_cents');
end $$;

-- No card payments (nobody has paid yet, or a hold only): 0, and the
-- cancel records nothing owed.
do $$
declare
  v_owner uuid := tests.create_user('vsf-none-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_quote jsonb;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(tests.create_user('vsf-none-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 2, tests.cyprus_today() + 3, p_label => 'vsf-none');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_vsfn_0', interval '5 minutes');
  perform tests.act_as(v_owner);
  v_quote := public.cancellation_quote(v_booking.id, 'venue');
  perform tests.act_as_postgres();
  assert v_quote -> 'venue_stripe_fee_cents' = '0'::jsonb,
    format('nothing owed, got %s', v_quote -> 'venue_stripe_fee_cents');

  perform tests.act_as_service_role();
  perform public.cancel_booking_internal(v_booking.id, 'venue', v_owner, v_quote ->> 'quote');
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.venue_payables where booking_id = v_booking.id), 'no venue_payables';
end $$;

-- Only the venue's own staff get the venue quote; other scopes don't carry
-- the figure.
do $$
declare
  v_owner uuid := tests.create_user('vsf-sec-owner@futty.test');
  v_other_owner uuid := tests.create_user('vsf-sec-other@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_player public.booking_payment_shares;
  v_booker uuid := tests.create_user('vsf-sec-booker@futty.test');
begin
  update public.profiles set role = 'venue_owner' where id in (v_owner, v_other_owner);
  perform tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'vsf-sec');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_vsfs_0', interval '2 hours');
  v_player := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_vsfs_1', interval '2 hours');

  perform tests.act_as(v_other_owner);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'venue') $q$, v_booking.id)) = 'not_your_venue',
    'another venue''s staff can''t';
  perform tests.act_as(v_player.profile_id);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'venue') $q$, v_booking.id)) = 'not_your_venue',
    'a player can''t';
  assert not (public.cancellation_quote(v_booking.id, 'my_spot') ? 'venue_stripe_fee_cents'),
    'a player''s own quote has no venue figure';
  perform tests.act_as(v_booker);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'venue') $q$, v_booking.id)) = 'not_your_venue',
    'the booker can''t';
  assert not (public.cancellation_quote(v_booking.id, 'whole_team') ? 'venue_stripe_fee_cents'),
    'the booker''s quote has no venue figure';
  perform tests.act_as_postgres();
end $$;

rollback;
