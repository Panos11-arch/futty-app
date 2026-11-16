-- P12: switching 5 v 5 -> 6 v 6 (docs/specs/13-payments-bookings.md,
-- "Switching after booking", decided 16 November):
--   each player who paid gets the difference in their pitch part as venue
--   credit (€60: 600 - 500 = 100), the booking has 12 spots, every player is
--   told; a held share gets its credit when it is taken, as does a payment
--   started at the old price; credit that paid for the share goes back
--   first; an unticked cash player owes less instead; a ticked one, and a
--   Premium player, get the credit too; the booker carries leftover cents.
begin;

-- €60, ten players at 680: 100 credit each, 12 spots, everyone told.
do $$
declare
  v_booker uuid := tests.create_user('switch-up-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_result jsonb;
  v_share public.booking_payment_shares;
  v_new uuid := tests.create_user('switch-up-eleventh@futty.test');
  v_plan jsonb;
  i integer;
  v_moves integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'switch-up');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_swup_' || i, interval '2 hours');
  end loop;
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'booked and paid';

  select count(*) into v_moves from public.money_ledger where booking_id = v_booking.id;
  v_result := tests.switch(v_booking.id, 6);
  assert (v_result ->> 'players_per_side')::integer = 6 and (v_result ->> 'capacity')::integer = 12,
    format('now 6 v 6 with 12 spots, got %s', v_result);
  assert (v_result ->> 'credit_cents')::integer = 1000, format('1000 credit in all, got %s', v_result);
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert (tests.match_of(v_booking.id)).players_per_side = 6, format('the match is 6 a side, got %s', row_to_json(tests.match_of(v_booking.id)));
  assert v_booking.capacity = 12 and v_booking.booked_capacity = 10 and v_booking.switched_at is not null
         and v_booking.switched_by = v_booker, 'the booking records the switch';

  for i in 0 .. 9 loop
    v_share := tests.player(v_booking.id, i);
    assert v_share.switch_credit_cents = 100 and v_share.switch_credit_issued_at is not null
           and v_share.switch_credit_back_cents = 0,
      format('player %s: 100 credit given, got %s', i, row_to_json(v_share));
    assert v_share.amount_cents = 680 and v_share.pitch_cents = 600, 'what they paid is unchanged';
    assert (select amount_cents from public.venue_credits
            where source_share_id = v_share.id and source = 'format_switch' and venue_id = v_venue) = 100,
      format('player %s: a 100 credit at the venue', i);
    assert (select expires_at from public.venue_credits where source_share_id = v_share.id and source = 'format_switch')
           = (select issued_at from public.venue_credits where source_share_id = v_share.id and source = 'format_switch')
             + public.rule_credit_expiry(), 'new credit lasts the credit expiry rule';
    assert (select count(*) from public.money_ledger
            where share_id = v_share.id and kind = 'credit_issued' and amount_cents = 100 and reason = 'format_switch') = 1,
      'the credit is in the ledger with its reason';
    assert tests.notified(v_share.profile_id, 'booking_switched') = 1,
      format('player %s is told', i);
  end loop;
  assert (select count(*) from public.notifications where type = 'booking_switched'
          and data ->> 'bookingId' = v_booking.id::text and title = 'Now 6 v 6' and body like '%€1.00 credit%') = 10,
    'all ten are told about their €1.00 credit';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
  assert (select count(*) from public.money_ledger where booking_id = v_booking.id and kind <> 'credit_issued') = v_moves,
    'no money moves in Stripe: only the credit rows are new';

  -- Spots 11 and 12 pay the 6 v 6 price: 500 + 80.
  v_share := tests.join_booking(v_booking.id, v_new);
  v_plan := public.plan_share_payment(v_share.id, v_new, 'card', false);
  assert (v_plan ->> 'amount_cents')::integer = 580 and (v_plan ->> 'pitch_cents')::integer = 500,
    format('the 11th player pays 580, got %s', v_plan);

  -- One switch per booking.
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 5)', v_booking.id)) = 'already_switched',
    'a second switch is refused';
end $$;

-- A share held but not taken yet gets its credit when it is taken; so does a
-- payment started at the 5 v 5 price that lands after the switch.
do $$
declare
  v_booker uuid := tests.create_user('switch-held-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_held public.booking_payment_shares;
  v_late public.booking_payment_shares;
  v_unpaid public.booking_payment_shares;
  v_plan jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                          p_label => 'switch-held');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swheld_0', interval '2 hours');
  v_held := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_swheld_1', interval '10 minutes');
  assert v_held.status = 'authorized', 'held, not taken yet';
  v_plan := tests.pay_share((tests.player(v_booking.id, 2)).id, 'pi_swheld_2');
  assert (v_plan ->> 'amount_cents')::integer = 680, 'a payment started at the 5 v 5 price';

  perform tests.switch(v_booking.id, 6);

  v_held := tests.player(v_booking.id, 1);
  assert v_held.switch_credit_cents = 100 and v_held.switch_credit_issued_at is null, 'owed 100, not given yet';
  assert not exists (select 1 from public.venue_credits where source_share_id = v_held.id), 'no credit while only held';
  -- Not yet paying: shown at the 6 v 6 price.
  v_unpaid := tests.player(v_booking.id, 3);
  assert v_unpaid.amount_cents = 580 and v_unpaid.pitch_cents = 500, format('an unpaid share is now 580, got %s', v_unpaid.amount_cents);

  -- Taken: the credit is given.
  perform public.share_captured(v_held.id, 680, tests.stripe_fee(680));
  v_held := tests.player(v_booking.id, 1);
  assert v_held.status = 'paid' and v_held.switch_credit_issued_at is not null, 'taken and given';
  assert (select amount_cents from public.venue_credits where source_share_id = v_held.id and source = 'format_switch') = 100,
    'the held share gets 100 when taken';

  -- The payment at the old price lands, is held, then taken.
  v_late := tests.player(v_booking.id, 2);
  perform public.share_payment_held(v_late.id, 'pi_swheld_2', 680, 'pm_swheld_2', now());
  v_late := tests.player(v_booking.id, 2);
  assert v_late.status = 'authorized' and v_late.switch_credit_cents = 100, format('owed 100 when held, got %s', row_to_json(v_late));
  perform public.share_captured(v_late.id, 680, tests.stripe_fee(680));
  assert (select amount_cents from public.venue_credits where source_share_id = v_late.id and source = 'format_switch') = 100,
    'the late payment gets 100 when taken';

  -- Taking it again gives nothing more.
  perform public.issue_switch_credit(v_late.id);
  assert (select count(*) from public.venue_credits where source_share_id = v_late.id) = 1, 'credit given once';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Credit that paid for a share goes back first, keeping its expiry; only the
-- card-paid rest is new credit. Premium players get the difference too.
do $$
declare
  v_booker uuid := tests.create_user('switch-credit-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_all public.booking_payment_shares;
  v_some public.booking_payment_shares;
  v_premium public.booking_payment_shares;
  v_old_credit uuid;
  v_small_credit uuid;
  v_expires timestamptz;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                          p_label => 'switch-credit');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swcr_0', interval '2 hours');
  -- €5.00 credit and €1.80 by card.
  v_all := tests.player(v_booking.id, 1);
  v_old_credit := tests.give_credit(v_all.profile_id, v_venue, 500, interval '30 days');
  select expires_at into v_expires from public.venue_credits where id = v_old_credit;
  v_all := tests.pay_ago(v_all.id, 'pi_swcr_1', interval '2 hours', 'card', true);
  assert v_all.credit_cents = 500 and v_all.amount_cents = 180, format('500 credit + 180 card, got %s', row_to_json(v_all));
  -- €0.50 credit and €6.30 by card.
  v_some := tests.player(v_booking.id, 2);
  v_small_credit := tests.give_credit(v_some.profile_id, v_venue, 50, interval '30 days');
  v_some := tests.pay_ago(v_some.id, 'pi_swcr_2', interval '2 hours', 'card', true);
  assert v_some.credit_cents = 50 and v_some.amount_cents = 630, format('50 credit + 630 card, got %s', row_to_json(v_some));
  -- Premium: 600, no fee.
  v_premium := tests.player(v_booking.id, 3);
  perform tests.make_premium(v_premium.profile_id);
  v_premium := tests.pay_ago(v_premium.id, 'pi_swcr_3', interval '2 hours');
  assert v_premium.amount_cents = 600 and v_premium.pitch_cents = 600, format('Premium pays 600, got %s', v_premium.amount_cents);

  perform tests.switch(v_booking.id, 6);

  v_all := tests.player(v_booking.id, 1);
  assert v_all.switch_credit_cents = 100 and v_all.switch_credit_back_cents = 100, 'all 100 goes back to the credit';
  assert (select remaining_cents from public.venue_credits where id = v_old_credit) = 100
         and (select expires_at from public.venue_credits where id = v_old_credit) = v_expires,
    'the old credit has 100 back, with its old expiry';
  assert not exists (select 1 from public.venue_credits where source_share_id = v_all.id), 'no new credit';
  assert (select coalesce(sum(amount_cents), 0) from public.venue_credit_spends where share_id = v_all.id and status = 'spent') = 400,
    '400 of the credit still pays for the share';

  v_some := tests.player(v_booking.id, 2);
  assert v_some.switch_credit_cents = 100 and v_some.switch_credit_back_cents = 50, '50 goes back to the credit';
  assert (select remaining_cents from public.venue_credits where id = v_small_credit) = 50, 'all 50 back';
  assert (select amount_cents from public.venue_credits where source_share_id = v_some.id and source = 'format_switch') = 50,
    'the card-paid 50 is new credit';

  v_premium := tests.player(v_booking.id, 3);
  assert (select amount_cents from public.venue_credits where source_share_id = v_premium.id and source = 'format_switch') = 100,
    'Premium gets the 100 too';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Cash: unticked owes 500 instead of 600, no credit; ticked gets 100 credit.
do $$
declare
  v_owner uuid := tests.create_user('switch-cash-owner@futty.test');
  v_booker uuid := tests.create_user('switch-cash-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_unticked public.booking_payment_shares;
  v_ticked public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'switch-cash');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swcash_0', interval '2 hours');
  perform tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_swcash_1', interval '2 hours', 'cash');
  perform tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_swcash_2', interval '2 hours', 'cash');
  v_ticked := tests.player(v_booking.id, 2);
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_ticked.id);
  perform tests.act_as_postgres();

  perform tests.switch(v_booking.id, 6);

  v_unticked := tests.player(v_booking.id, 1);
  assert v_unticked.cash_cents = 500 and v_unticked.pitch_cents = 500 and v_unticked.amount_cents = 80,
    format('an unticked cash player owes 500 at the venue, fee unchanged; got %s', row_to_json(v_unticked));
  assert v_unticked.switch_credit_cents = 0 and not exists (select 1 from public.venue_credits where source_share_id = v_unticked.id),
    'and gets no credit';
  assert (tests.last_notification(v_unticked.profile_id, 'booking_switched')).body like '%€5.00 in cash%',
    'and is told the new cash amount';

  v_ticked := tests.player(v_booking.id, 2);
  assert v_ticked.switch_credit_cents = 100 and v_ticked.switch_credit_issued_at is not null, 'a ticked cash player: 100';
  assert (select amount_cents from public.venue_credits where source_share_id = v_ticked.id and source = 'format_switch') = 100,
    'as venue credit';
end $$;

-- Leftover cents: €55 is 550 each at 5 v 5; at 6 v 6 458, and 462 for the
-- booker. So 92 credit each and 88 for the booker; when the booker gave up
-- their spot, the first player who joined carries them.
do $$
declare
  v_booker uuid := tests.create_user('switch-cents-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_gone uuid := tests.create_user('switch-gone-booker@futty.test');
  v_venue2 uuid := tests.create_venue(p_pitches => 1);
  v_booking2 public.venue_bookings;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 5500);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'switch-cents');
  for i in 0 .. 2 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_swcents_' || i, interval '2 hours');
  end loop;
  perform tests.switch(v_booking.id, 6);
  assert (tests.player(v_booking.id, 0)).switch_credit_cents = 88, 'the booker: 550 - 462 = 88';
  assert (tests.player(v_booking.id, 1)).switch_credit_cents = 92, 'a player: 550 - 458 = 92';
  assert (tests.player(v_booking.id, 2)).switch_credit_cents = 92, 'another player: 92';

  -- The booker gave up their spot: the first player who joined carries the
  -- leftover cents, so gets 88.
  perform tests.set_price(v_venue2, '5-a-side', 5500);
  update public.venues set allows_6v6_on_5s = true where id = v_venue2;
  v_booking2 := tests.booking_with_players(v_gone, v_venue2, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                           p_label => 'switch-gone');
  for i in 0 .. 2 loop
    perform tests.pay_ago((tests.player(v_booking2.id, i)).id, 'pi_swgone_' || i, interval '2 hours');
  end loop;
  update public.booking_payment_shares set status = 'cancelled' where id = (tests.player(v_booking2.id, 0)).id;
  perform tests.switch(v_booking2.id, 6);
  assert (tests.player(v_booking2.id, 1)).switch_credit_cents = 88, 'the first joiner: 550 - 462 = 88';
  assert (tests.player(v_booking2.id, 2)).switch_credit_cents = 92, 'the next: 92';
end $$;

rollback;
