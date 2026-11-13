-- What the dashboard's Today screen reads (05 section 12, launch items 1
-- and 11a; 13 "Cash at the venue"): the day per pitch with every booking,
-- walk-in, owner block, venue block and condition flag; a booking's roster
-- with each player's payment choice and state (the same states as
-- booking_detail), their amounts and who has checked in. And the "allow 6 v 6
-- on 5-a-side pitches" setting.
begin;

-- The day board.
do $$
declare
  v_owner uuid := tests.create_user('board-owner@futty.test');
  v_booker uuid := tests.create_user('board-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 2;
  v_app public.venue_bookings;
  v_gone public.venue_bookings;
  v_counter uuid;
  v_block_booking uuid;
  v_flag uuid;
  v_board jsonb;
  v_entry jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_app := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, v_day, '12:00', '13:00', 'board');
  v_gone := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '14:00', '15:00', 'board-g');
  update public.venue_bookings set status = 'cancelled' where id = v_gone.id;
  perform tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day + 1, '12:00', '13:00', 'board-t');
  perform tests.pay_ago((tests.player(v_app.id, 0)).id, 'pi_board_0', interval '2 hours');
  perform tests.pay_ago((tests.player(v_app.id, 1)).id, 'pi_board_1', interval '2 hours', 'cash');
  -- A cash player who hasn't paid the fee yet: staff can still tick their
  -- cash (mark_cash_received accepts pending), so it counts.
  update public.booking_payment_shares set payment_method = 'cash' where id = (tests.player(v_app.id, 2)).id;

  perform tests.act_as(v_owner);
  v_counter := public.add_counter_booking(v_venue, v_day, '18:00', '19:00', '5-a-side', 'phone', 'Maria',
                                          '+35799000002', p_charged_cents => 5500);
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format,
                                     booking_type, created_by, amount_cents, note)
  values (v_venue, v_day, '08:00', '10:00', 1, 0, '5-a-side', 'owner_block', v_owner, 0, 'Academy')
  returning id into v_block_booking;
  insert into public.venue_blocks (venue_id, block_day, starts_at, ends_at, reason, created_by)
  values (v_venue, v_day, '21:00', '23:00', 'Maintenance', v_owner);
  v_flag := public.flag_conditions(v_venue, v_day, null, null, null, 'Rain');

  v_board := public.venue_day_board(v_venue, v_day);
  perform tests.act_as_postgres();

  assert v_board ->> 'day' = v_day::text and (v_board ->> 'venue_id')::uuid = v_venue, 'the day asked for';
  assert jsonb_array_length(v_board -> 'pitches') = 2, format('both pitches, got %s', v_board -> 'pitches');
  assert jsonb_array_length(v_board -> 'bookings') = 3,
    format('the app game, the walk-in and the owner block; not cancelled or other days: got %s', v_board -> 'bookings');

  select e into v_entry from jsonb_array_elements(v_board -> 'bookings') e where (e ->> 'id')::uuid = v_app.id;
  assert v_entry ->> 'kind' = 'app' and v_entry ->> 'start_time' = '12:00:00' and v_entry ->> 'end_time' = '13:00:00'
         and v_entry ->> 'payment_mode' = 'each_pays_own_spot' and (v_entry ->> 'capacity')::integer = 10
         and (v_entry ->> 'joined')::integer = 4 and (v_entry ->> 'unpaid')::integer = 2
         and (v_entry ->> 'cash_to_tick')::integer = 2
         and v_entry ->> 'booker_name' = public.profile_display_name(v_booker)
         and jsonb_array_length(v_entry -> 'pitch_ids') = 1,
    format('the app game, got %s', v_entry);

  select e into v_entry from jsonb_array_elements(v_board -> 'bookings') e where (e ->> 'id')::uuid = v_counter;
  assert v_entry ->> 'kind' = 'counter' and v_entry ->> 'source' = 'phone' and v_entry ->> 'contact_name' = 'Maria'
         and (v_entry ->> 'charged_cents')::integer = 5500 and (v_entry ->> 'venue_price_cents')::integer = 6000
         and v_entry -> 'paid_method' = 'null'::jsonb,
    format('the phone booking, got %s', v_entry);

  select e into v_entry from jsonb_array_elements(v_board -> 'bookings') e where (e ->> 'id')::uuid = v_block_booking;
  assert v_entry ->> 'kind' = 'owner_block' and v_entry ->> 'note' = 'Academy', format('the owner block, got %s', v_entry);

  assert jsonb_array_length(v_board -> 'blocks') = 1 and v_board -> 'blocks' -> 0 ->> 'reason' = 'Maintenance',
    format('the venue block, got %s', v_board -> 'blocks');
  assert jsonb_array_length(v_board -> 'flags') = 1 and (v_board -> 'flags' -> 0 ->> 'id')::uuid = v_flag
         and v_board -> 'flags' -> 0 ->> 'note' = 'Rain', format('the flag, got %s', v_board -> 'flags');

  -- A cleared flag is no longer shown.
  perform tests.act_as(v_owner);
  perform public.clear_conditions(v_flag);
  assert jsonb_array_length(public.venue_day_board(v_venue, v_day) -> 'flags') = 0, 'cleared flags go';
  perform tests.act_as_postgres();
end $$;

-- A booking's roster.
do $$
declare
  v_owner uuid := tests.create_user('roster-owner@futty.test');
  v_booker uuid := tests.create_user('roster-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_roster jsonb;
  v_counter uuid;
  v_match uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 4, tests.cyprus_today() + 2,
                                          '12:00', '13:00', 'roster');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_roster_0', interval '2 hours');          -- in app
  perform tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_roster_1', interval '2 hours', 'cash');  -- cash
  perform tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_roster_2', interval '2 hours', 'cash');  -- cash, ticked
  -- player 3 hasn't paid; player 4 is covered.
  update public.booking_payment_shares set status = 'covered' where id = (tests.player(v_booking.id, 4)).id;

  perform tests.act_as(v_owner);
  perform public.mark_cash_received((tests.player(v_booking.id, 2)).id);
  perform tests.act_as_postgres();

  v_match := (tests.match_of(v_booking.id)).id;
  assert v_match is not null, 'the booking has its match';
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
  values (v_match, (tests.player(v_booking.id, 1)).profile_id, 'qr', (tests.player(v_booking.id, 1)).profile_id);

  perform tests.act_as(v_owner);
  v_roster := public.venue_booking_roster(v_booking.id);
  perform tests.act_as_postgres();

  assert v_roster ->> 'kind' = 'app' and v_roster ->> 'payment_mode' = 'each_pays_own_spot'
         and (v_roster ->> 'collection_started')::boolean = false and (v_roster ->> 'can_run_collection')::boolean = false,
    format('an app booking before its match, got %s', v_roster - 'players');
  assert jsonb_array_length(v_roster -> 'players') = 5, 'every player';
  assert (select jsonb_agg(p ->> 'state' order by ord) from jsonb_array_elements(v_roster -> 'players') with ordinality as t(p, ord))
         = '["in_app", "cash", "cash_paid", "unpaid", "covered"]'::jsonb,
    format('each player''s state, in join order, got %s', v_roster -> 'players');
  assert (select jsonb_agg(p ->> 'payment_method' order by ord) from jsonb_array_elements(v_roster -> 'players') with ordinality as t(p, ord))
         = '["card", "cash", "cash", "card", "card"]'::jsonb, 'their payment choice';
  assert (v_roster -> 'players' -> 1 ->> 'cash_cents')::integer = 600
         and (v_roster -> 'players' -> 0 ->> 'amount_cents')::integer = 680
         and (v_roster -> 'players' -> 0 ->> 'pitch_cents')::integer = 600
         and (v_roster -> 'players' -> 0 ->> 'fee_cents')::integer = 80, 'the amounts, from the server';
  assert (v_roster -> 'players' -> 0 ->> 'is_booker')::boolean
         and v_roster -> 'players' -> 0 ->> 'name' = public.profile_display_name(v_booker), 'the booker first, by name';
  assert (select jsonb_agg((p ->> 'checked_in')::boolean order by ord) from jsonb_array_elements(v_roster -> 'players') with ordinality as t(p, ord))
         = '[false, true, false, false, false]'::jsonb, 'who has checked in';

  -- After the match, before collection: staff can run it early.
  perform tests.end_match(v_booking.id, interval '10 minutes');
  perform tests.act_as(v_owner);
  assert (public.venue_booking_roster(v_booking.id) ->> 'can_run_collection')::boolean, 'can run collection now';
  perform tests.act_as_postgres();

  -- A walk-in's roster is its contact and payment.
  perform tests.act_as(v_owner);
  v_counter := public.add_counter_booking(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', '5-a-side', 'walk_in',
                                          'Andreas', '+35799000003', p_paid_method => 'cash');
  v_roster := public.venue_booking_roster(v_counter);
  perform tests.act_as_postgres();
  assert v_roster ->> 'kind' = 'counter' and v_roster ->> 'source' = 'walk_in'
         and v_roster -> 'contact' ->> 'name' = 'Andreas' and v_roster -> 'contact' ->> 'phone' = '+35799000003'
         and (v_roster ->> 'charged_cents')::integer = 6000 and (v_roster ->> 'venue_price_cents')::integer = 6000
         and v_roster ->> 'paid_method' = 'cash' and jsonb_array_length(v_roster -> 'players') = 0,
    format('the walk-in, got %s', v_roster);
end $$;

-- "Allow 6 v 6 on 5-a-side pitches".
do $$
declare
  v_owner uuid := tests.create_user('six-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 2;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  assert tests.error_of(format($q$ select public.booking_slot_checked(%L, %L, '12:00', '13:00', '5-a-side', 6, false) $q$,
                               v_venue, v_day)) = 'six_a_side_not_allowed', 'off by default';
  perform tests.act_as(v_owner);
  perform public.set_venue_allows_6v6(v_venue, true);
  perform tests.act_as_postgres();
  assert (select allows_6v6_on_5s from public.venues where id = v_venue), 'on';
  assert tests.error_of(format($q$ select public.booking_slot_checked(%L, %L, '12:00', '13:00', '5-a-side', 6, false) $q$,
                               v_venue, v_day)) is null, 'now offered';
  perform tests.act_as(v_owner);
  perform public.set_venue_allows_6v6(v_venue, false);
  assert tests.error_of(format('select public.set_venue_allows_6v6(%L, null)', v_venue)) = 'invalid_setting', 'on or off';
  perform tests.act_as_postgres();
  assert not (select allows_6v6_on_5s from public.venues where id = v_venue), 'off again';
end $$;

rollback;
