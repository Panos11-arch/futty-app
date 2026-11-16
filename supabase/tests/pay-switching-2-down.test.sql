-- P12: switching 6 v 6 -> 5 v 5, and the top-ups after a switch
-- (docs/specs/13-payments-bookings.md, "Switching after booking"):
--   6 v 6 -> 5 v 5 moves nothing at the switch; each player then owes the
--   difference in their pitch part (€60: 600 - 500 = 100), charged with the
--   after-match top-ups; an unticked cash player owes the 5 v 5 cash amount;
--   5 v 5 -> 6 v 6 where only 10 then play: "a 6 v 6 game where only 10
--   players join becomes €6.80 each, through the normal top-up", so each
--   player who got 100 credit owes 100 back.
begin;

-- €60 6 v 6, ten players at 580, switched to 5 v 5: a 100 top-up each.
do $$
declare
  v_booker uuid := tests.create_user('switch-down-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_moves integer;
  v_start jsonb;
  v_item public.booking_collection_items;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_6v6_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                              p_label => 'switch-down');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_swdown_' || i, interval '2 hours');
  end loop;
  assert (tests.player(v_booking.id, 1)).amount_cents = 580, '6 v 6: 580 each';
  select count(*) into v_moves from public.money_ledger where booking_id = v_booking.id;

  perform tests.switch(v_booking.id, 5);
  assert (select capacity from public.venue_bookings where id = v_booking.id) = 10, 'now 10 spots';
  assert (select count(*) from public.money_ledger where booking_id = v_booking.id) = v_moves, 'nothing moves at the switch';
  assert not exists (select 1 from public.venue_credits where source_booking_id = v_booking.id), 'no credit';
  assert (select count(*) from public.notifications where type = 'booking_switched'
          and data ->> 'bookingId' = v_booking.id::text and title = 'Now 5 v 5'
          and body like '%You''ll pay €1.00 more after the match.%') = 10,
    'all ten are told they pay €1.00 more after the match';

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  for i in 0 .. 9 loop
    v_item := tests.item(v_booking.id, (tests.player(v_booking.id, i)).id);
    assert v_item.kind = 'top_up' and v_item.amount_cents = 100 and v_item.fee_cents = 0,
      format('player %s: a 100 top-up, got %s', i, row_to_json(v_item));
  end loop;
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid);
  assert public.settle_collection((v_start ->> 'collection_id')::uuid) ->> 'result' = 'done', 'collected';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
  assert (select taken_cents from public.money_balance(v_booking.id)) = 10 * 580 + 10 * 100, 'taken: 10 x 580 + 10 x 100';
end $$;

-- An unticked cash player owes the 5 v 5 amount at the venue; nobody who
-- hasn't paid is charged a top-up for a share they never paid.
do $$
declare
  v_booker uuid := tests.create_user('switch-down-cash-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
  v_unpaid public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_6v6_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                              p_label => 'switch-down-cash');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swdc_0', interval '2 hours');
  v_cash := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_swdc_1', interval '2 hours', 'cash');
  assert v_cash.cash_cents = 500, '6 v 6 cash: 500';

  perform tests.switch(v_booking.id, 5);
  v_cash := tests.player(v_booking.id, 1);
  assert v_cash.cash_cents = 600 and v_cash.pitch_cents = 600 and v_cash.amount_cents = 80,
    format('5 v 5 cash: 600 at the venue, fee unchanged; got %s', row_to_json(v_cash));
  v_unpaid := tests.player(v_booking.id, 2);
  assert v_unpaid.amount_cents = 680, format('an unpaid share is now 680, got %s', v_unpaid.amount_cents);
end $$;

-- €60 5 v 5 switched to 6 v 6, but only the 10 play: each gave 100 as credit,
-- so each owes a 100 top-up; with 12 playing, nobody owes anything.
do $$
declare
  v_booker uuid := tests.create_user('switch-ten-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_full public.venue_bookings;
  v_start jsonb;
  v_item public.booking_collection_items;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'switch-ten');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_swten_' || i, interval '2 hours');
  end loop;
  perform tests.switch(v_booking.id, 6);
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  for i in 0 .. 9 loop
    v_item := tests.item(v_booking.id, (tests.player(v_booking.id, i)).id);
    assert v_item.kind = 'top_up' and v_item.amount_cents = 100,
      format('player %s: 600 due, 500 kept after the credit, a 100 top-up; got %s', i, row_to_json(v_item));
  end loop;

  -- Twelve play: 500 each, nothing to collect.
  v_venue := tests.create_venue(p_pitches => 1);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_full := tests.booking_with_players(tests.create_user('switch-twelve-booker@futty.test'), v_venue, 'each_pays_own_spot', 9,
                                       tests.cyprus_today() + 4, p_label => 'switch-twelve');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_full.id, i)).id, 'pi_swtw_' || i, interval '2 hours');
  end loop;
  perform tests.switch(v_full.id, 6);
  for i in 10 .. 11 loop
    assert (tests.pay_ago((tests.join_booking(v_full.id, tests.create_user(format('switch-twelve-%s@futty.test', i)))).id, 'pi_swtw_' || i, interval '2 hours')).amount_cents = 580,
      'the new players pay 580';
  end loop;
  perform tests.end_match(v_full.id);
  perform public.start_collection(v_full.id);
  assert not exists (select 1 from public.booking_collection_items where booking_id = v_full.id),
    format('12 played: nothing to collect, got %s',
           (select jsonb_agg(row_to_json(i)) from public.booking_collection_items i where i.booking_id = v_full.id));
end $$;

rollback;
