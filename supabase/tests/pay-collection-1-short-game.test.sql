-- Short games and top-ups (docs/specs/13-payments-bookings.md, "Short
-- games, top-ups and 6 v 6"; 14, P4c):
--   "joined" = every player holding a spot; each joined player's pitch part
--   = pitch price / joined players, the leftover cents on the booker's
--   share; the difference from what they paid is a top-up charged to their
--   saved card 2 hours after the match, with no extra fee;
--   a late-cancelled share's kept pitch money counts toward the pitch price
--   (decided 10 November): the others pay only what's still missing;
--   6 hours before kickoff, in a short game, everyone in the booking gets
--   "You're 8 of 10. If nobody else joins, each player pays €1.50 extra
--   after the match.", once.
begin;

-- €60 5 v 5 played 4 v 4: a top-up of 150 for each of the 8 players.
do $$
declare
  v_booker uuid := tests.create_user('short-eight-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_item public.booking_collection_items;
  v_books record;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 7, tests.cyprus_today() + 3,
                                          p_label => 'short-eight');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_short8_' || i, interval '2 hours');
  end loop;

  -- Not before 2 hours after the match.
  perform tests.end_match(v_booking.id, interval '1 hour');
  assert tests.error_of(format('select public.start_collection(%L)', v_booking.id)) = 'collection_not_due',
    'collection waits until 2 hours after the match';

  perform tests.end_match(v_booking.id, interval '2 hours');
  v_start := public.start_collection(v_booking.id);
  assert (v_start ->> 'joined_players')::integer = 8, format('8 joined, got %s', v_start);
  assert (select count(*) from public.booking_collection_items where booking_id = v_booking.id) = 8, '8 items';
  for i in 0 .. 7 loop
    v_item := tests.item(v_booking.id, (tests.player(v_booking.id, i)).id);
    assert v_item.kind = 'top_up' and v_item.amount_cents = 150 and v_item.pitch_cents = 150 and v_item.fee_cents = 0
           and v_item.status = 'pending',
      format('player %s: a 150 top-up with no fee, got %s', i, row_to_json(v_item));
  end loop;

  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid);
  assert public.settle_collection((v_start ->> 'collection_id')::uuid) ->> 'result' = 'done', 'nothing left to collect';
  assert (select status from public.booking_collections where booking_id = v_booking.id) = 'done', 'collection done';

  -- The venue gets 600 + 150 from each; Futty absorbs Stripe's fee on the top-up.
  v_books := tests.share_books((tests.player(v_booking.id, 1)).id);
  assert v_books.venue = 750 and v_books.stripe = tests.stripe_fee(680) + tests.stripe_fee(150)
         and v_books.futty = 80 - tests.stripe_fee(680) - tests.stripe_fee(150),
    format('venue 750, Futty 80 less both Stripe fees; got %s', v_books);
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
  assert (select taken_cents from public.money_balance(v_booking.id)) = 8 * 680 + 8 * 150, 'taken: 8 x 680 + 8 x 150';
  assert (select count(*) from public.notifications where type = 'top_up_charged'
          and data ->> 'bookingId' = v_booking.id::text and body like '%€1.50%') = 8, 'each of the 8 is told';

  -- Running collection twice changes nothing the second time.
  assert public.start_collection(v_booking.id) ->> 'collection_id' = v_start ->> 'collection_id', 'the same collection';
  assert public.settle_collection((v_start ->> 'collection_id')::uuid) ->> 'result' = 'done', 'still done';
  assert (select count(*) from public.booking_collection_items where booking_id = v_booking.id) = 8, 'no new items';
  assert (select count(*) from public.money_ledger where booking_id = v_booking.id and kind = 'capture') = 16,
    'no new money movements';
  assert not exists (select 1 from public.collections_due() where booking_id = v_booking.id), 'never due again';
end $$;

-- 9 players: 666 each and 672 for the booker (the 6 leftover cents), so
-- top-ups of 66 and 72.
do $$
declare
  v_booker uuid := tests.create_user('short-nine-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 8, tests.cyprus_today() + 3,
                                          p_label => 'short-nine');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_short9_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);

  assert (tests.item(v_booking.id, (tests.player(v_booking.id, 0)).id)).amount_cents = 72, 'the booker: 672 - 600 = 72';
  for i in 1 .. 8 loop
    assert (tests.item(v_booking.id, (tests.player(v_booking.id, i)).id)).amount_cents = 66,
      format('player %s: 666 - 600 = 66', i);
  end loop;
  assert (select sum(amount_cents) from public.booking_collection_items where booking_id = v_booking.id) = 600,
    'together they pay the missing 600';
end $$;

-- A full game: nothing to collect.
do $$
declare
  v_booker uuid := tests.create_user('short-full-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'short-full');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_full_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert not exists (select 1 from public.booking_collection_items where booking_id = v_booking.id), 'no items';
  assert public.settle_collection((v_start ->> 'collection_id')::uuid) ->> 'result' = 'done', 'done at once';
end $$;

-- Late cancellations (decided 10 November): their kept pitch money counts
-- toward the €60. Two of 10 cancel less than 6 hours before kickoff and
-- nobody takes their spots: the 8 left owe only the 4800 still missing, so
-- no top-ups. The venue gets exactly €60.
do $$
declare
  v_booker uuid := tests.create_user('short-late-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'short-late');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_late_' || i, interval '2 hours');
  end loop;
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours');
  perform tests.cancel(v_booking.id, 'my_spot', (tests.player(v_booking.id, 8)).profile_id);
  perform tests.cancel(v_booking.id, 'my_spot', (tests.player(v_booking.id, 9)).profile_id);
  assert (tests.player(v_booking.id, 9)).status = 'forfeited', 'a late cancellation keeps the money';

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert (v_start ->> 'joined_players')::integer = 8, '8 still hold a spot';
  assert not exists (select 1 from public.booking_collection_items where booking_id = v_booking.id),
    'the forfeited 1200 covers the two empty spots: no top-ups';
end $$;

-- One late cancellation and two more empty spots: the 7 left owe the 5400
-- still missing (771 each, 774 for the booker), top-ups of 171 and 174.
do $$
declare
  v_booker uuid := tests.create_user('short-mix-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 7, tests.cyprus_today() + 3,
                                          p_label => 'short-mix');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_mix_' || i, interval '2 hours');
  end loop;
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours');
  perform tests.cancel(v_booking.id, 'my_spot', (tests.player(v_booking.id, 7)).profile_id);
  perform tests.end_match(v_booking.id);
  perform public.start_collection(v_booking.id);

  assert (tests.item(v_booking.id, (tests.player(v_booking.id, 0)).id)).amount_cents = 174, 'the booker: 774 - 600';
  for i in 1 .. 6 loop
    assert (tests.item(v_booking.id, (tests.player(v_booking.id, i)).id)).amount_cents = 171,
      format('player %s: 771 - 600', i);
  end loop;
  assert (tests.item(v_booking.id, (tests.player(v_booking.id, 7)).id)).id is null, 'nothing for the forfeited share';
end $$;

-- 6 hours before kickoff: "You're 8 of 10", to everyone in the booking, once.
do $$
declare
  v_booker uuid := tests.create_user('warn-eight-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_full public.venue_bookings;
  v_far public.venue_bookings;
  v_all public.venue_bookings;
  v_note public.notifications;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 7, tests.cyprus_today() + 3,
                                          '12:00', '13:00', 'warn-eight');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_warn8_0', interval '2 hours');
  -- A full game, a short game still 7 hours away and a pay-for-everyone game: no warning.
  v_full := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                       '14:00', '15:00', 'warn-full');
  perform tests.pay_ago((tests.player(v_full.id, 0)).id, 'pi_warnfull_0', interval '2 hours');
  v_far := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 7, tests.cyprus_today() + 3,
                                      '16:00', '17:00', 'warn-far');
  perform tests.pay_ago((tests.player(v_far.id, 0)).id, 'pi_warnfar_0', interval '2 hours');
  v_all := tests.booking_with_players(v_booker, v_venue, 'pay_all', 7, tests.cyprus_today() + 3,
                                      '18:00', '19:00', 'warn-all');
  perform tests.pay_ago((tests.player(v_all.id, 0)).id, 'pi_warnall_0', interval '2 hours');

  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours 59 minutes');
  perform tests.set_kickoff(v_full.id, now() + interval '4 hours');
  perform tests.set_kickoff(v_far.id, now() + interval '7 hours');
  perform tests.set_kickoff(v_all.id, now() + interval '3 hours');

  assert public.send_short_game_warnings() = 1, 'one short game is due';
  assert (select count(*) from public.notifications where type = 'short_game_warning'
          and data ->> 'bookingId' = v_booking.id::text) = 8, 'all 8 in the booking are told';
  select * into v_note from public.notifications
  where type = 'short_game_warning' and profile_id = (tests.player(v_booking.id, 3)).profile_id;
  assert v_note.title = 'You''re 8 of 10'
         and v_note.body = 'If nobody else joins, each player pays €1.50 extra after the match.',
    format('the spec''s words, got %s / %s', v_note.title, v_note.body);
  assert v_note.data @> jsonb_build_object('joined', 8, 'players', 10, 'extraCents', 150,
           'actions', jsonb_build_array('request_venue_player', 'post_public_request')),
    format('with the buttons to request a player, got %s', v_note.data);
  assert not exists (select 1 from public.notifications where type = 'short_game_warning'
                     and data ->> 'bookingId' in (v_full.id::text, v_far.id::text, v_all.id::text)), 'nobody else';

  assert public.send_short_game_warnings() = 0, 'once';
  assert (select count(*) from public.notifications where type = 'short_game_warning') = 8, 'no repeats';
end $$;

rollback;
