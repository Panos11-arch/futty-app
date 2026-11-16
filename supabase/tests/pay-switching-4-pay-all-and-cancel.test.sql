-- P12: pay-all switching, and cancelling after a switch
-- (docs/specs/13-payments-bookings.md, "Switching after booking", decided
-- 16 November):
--   when the booker paid for everyone, switching moves no money: the fee
--   stays as it was at booking; if they cancel later, the €1 per player kept
--   counts the players they paid for at booking;
--   after a 5 v 5 -> 6 v 6 switch a cancellation works from what's left
--   after the credit: the venue cancels, 580 goes back to the card and the
--   100 credit stays; the player cancels in the middle window, 480 credit; the
--   player cancels late, 500 counts toward the pitch price.
begin;

-- Pay-all 5 v 5 (6550) switched to 6 v 6 and back is refused; nothing moves.
do $$
declare
  v_booker uuid := tests.create_user('switch-payall-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_moves integer;
  v_booker_share public.booking_payment_shares;
  v_plan jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 9, tests.cyprus_today() + 3,
                                          p_label => 'switch-payall');
  v_booker_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swpa_0', interval '2 hours');
  assert v_booker_share.amount_cents = 6550, format('the booker paid 6550, got %s', v_booker_share.amount_cents);
  select count(*) into v_moves from public.money_ledger where booking_id = v_booking.id;

  perform tests.switch(v_booking.id, 6);
  assert (select capacity from public.venue_bookings where id = v_booking.id) = 12, '12 spots';
  assert (select count(*) from public.money_ledger where booking_id = v_booking.id) = v_moves, 'no money moves';
  assert not exists (select 1 from public.venue_credits where source_booking_id = v_booking.id), 'no credit';
  v_booker_share := tests.player(v_booking.id, 0);
  assert v_booker_share.amount_cents = 6550 and v_booker_share.fee_cents = 550 and v_booker_share.switch_credit_cents = 0,
    'the booker''s payment and fee stay as at booking';
  assert (select service_fee_cents_per_player from public.venue_bookings where id = v_booking.id)
         = public.money_fee_per_player_cents('pay_all'), 'the fee per player is unchanged';
  assert (select count(*) from public.notifications where type = 'booking_switched'
          and data ->> 'bookingId' = v_booking.id::text and body like '%no money changes%') = 10, 'all ten are told';
  -- Spot 11 joins covered.
  assert (tests.join_booking(v_booking.id, tests.create_user('switch-payall-11@futty.test'))).status = 'covered',
    'the 11th player plays covered';

  -- Cancelled in the middle window: €1 x the 10 players paid for at booking.
  v_plan := tests.plan(v_booking.id, 'whole_team', v_booker);
  assert (tests.quote_line(v_plan, v_booker_share.id) ->> 'kept_cents')::integer = 10 * public.rule_cancel_fee_cents()
         and (tests.quote_line(v_plan, v_booker_share.id) ->> 'credit_cents')::integer = 6550 - 10 * public.rule_cancel_fee_cents(),
    format('1000 kept and 5550 credit, got %s', tests.quote_line(v_plan, v_booker_share.id));
end $$;

-- Pay-all 6 v 6 (6660) switched to 5 v 5: nothing moves, and a middle-window
-- cancel keeps €1 x 12.
do $$
declare
  v_booker uuid := tests.create_user('switch-payall6-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_moves integer;
  v_booker_share public.booking_payment_shares;
  v_plan jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_6v6_with_players(v_booker, v_venue, 'pay_all', 9, tests.cyprus_today() + 3,
                                              p_label => 'switch-payall6');
  v_booker_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swpa6_0', interval '2 hours');
  assert v_booker_share.amount_cents = 6660, format('the booker paid 6660, got %s', v_booker_share.amount_cents);
  select count(*) into v_moves from public.money_ledger where booking_id = v_booking.id;

  perform tests.switch(v_booking.id, 5);
  assert (select capacity from public.venue_bookings where id = v_booking.id) = 10, '10 spots';
  assert (select count(*) from public.money_ledger where booking_id = v_booking.id) = v_moves, 'no money moves';
  assert (tests.player(v_booking.id, 0)).amount_cents = 6660, 'the booker''s payment is unchanged';
  perform tests.end_match(v_booking.id);
  assert tests.error_of(format('select public.start_collection(%L)', v_booking.id)) = 'nothing_to_collect',
    'no top-ups for pay-all';

  -- (A fresh booking for the cancel, as the match above is over.)
  v_venue := tests.create_venue(p_pitches => 1);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_6v6_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3,
                                              p_label => 'switch-payall6b');
  v_booker_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swpa6b_0', interval '2 hours');
  perform tests.switch(v_booking.id, 5);
  v_plan := tests.plan(v_booking.id, 'whole_team', v_booker);
  assert (tests.quote_line(v_plan, v_booker_share.id) ->> 'kept_cents')::integer = 12 * public.rule_cancel_fee_cents(),
    format('1200 kept (12 players paid for), got %s', tests.quote_line(v_plan, v_booker_share.id));
end $$;

-- After 5 v 5 -> 6 v 6 (each paid 680, got 100 credit): the venue cancels.
do $$
declare
  v_booker uuid := tests.create_user('switch-venue-booker@futty.test');
  v_owner uuid := tests.create_user('switch-venue-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_player public.booking_payment_shares;
  v_cancel jsonb;
  v_line public.booking_cancellation_lines;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'switch-venue');
  for i in 0 .. 2 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_swven_' || i, interval '2 hours');
  end loop;
  perform tests.switch(v_booking.id, 6);
  v_player := tests.player(v_booking.id, 1);

  v_cancel := tests.cancel(v_booking.id, 'venue', v_owner);
  v_line := tests.line(v_cancel, v_player.id);
  assert v_line.paid_cents = 580 and v_line.refund_cents = 580 and v_line.action = 'refund_choice',
    format('580 back to the card, got %s', row_to_json(v_line));
  assert (select remaining_cents from public.venue_credits where source_share_id = v_player.id and source = 'format_switch') = 100,
    'the 100 credit stays';
end $$;

-- After the switch: a player cancels in the middle window (480 credit), and
-- one cancels late (500 counts toward the pitch price).
do $$
declare
  v_booker uuid := tests.create_user('switch-mine-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_middle public.booking_payment_shares;
  v_late public.booking_payment_shares;
  v_cancel jsonb;
  v_line public.booking_cancellation_lines;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'switch-mine');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_swmine_' || i, interval '2 hours');
  end loop;
  perform tests.switch(v_booking.id, 6);
  v_middle := tests.player(v_booking.id, 8);
  v_late := tests.player(v_booking.id, 9);

  -- Middle window: 580 left, €1 kept, 480 credit.
  v_cancel := tests.cancel(v_booking.id, 'my_spot', v_middle.profile_id);
  v_line := tests.line(v_cancel, v_middle.id);
  assert v_line."window" = 'middle' and v_line.value_cents = 580 and v_line.kept_cents = public.rule_cancel_fee_cents()
         and v_line.credit_cents = 580 - public.rule_cancel_fee_cents(),
    format('580 left: 100 kept, 480 credit; got %s', row_to_json(v_line));
  assert (select amount_cents from public.venue_credits where source_share_id = v_middle.id and source = 'player_cancelled') = 480,
    'a 480 credit for cancelling';
  assert (select amount_cents from public.venue_credits where source_share_id = v_middle.id and source = 'format_switch') = 100,
    'beside the 100 from the switch';

  -- Late: keeps all 580; 500 of it is pitch money toward the €60.
  perform tests.set_kickoff(v_booking.id, now() + public.rule_refund_cutoff() - interval '1 hour');
  v_cancel := tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  v_line := tests.line(v_cancel, v_late.id);
  assert v_line."window" = 'late' and v_line.kept_cents = 580, format('late: all 580 kept, got %s', row_to_json(v_line));

  -- 8 still in: each owes 600 - 500; the late cancel's 500 counts, so the 8
  -- pay 6000 - 500 = 5500 together (not 5400 as if it had kept 600).
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert (v_start ->> 'joined_players')::integer = 8, format('8 joined, got %s', v_start);
  assert (select sum(amount_cents) from public.booking_collection_items where booking_id = v_booking.id and kind = 'top_up')
         = 5500 - 8 * 500,
    format('top-ups of 1500 in all, got %s',
           (select sum(amount_cents) from public.booking_collection_items where booking_id = v_booking.id));
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

rollback;
