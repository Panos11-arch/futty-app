-- Venue notifications: the daily summary's contents (docs/specs/13-payments-bookings.md
-- "Venue notifications", decided 17 November, Dimitris; for Panos to confirm).
-- At 20:00 Cyprus time each venue's staff get tomorrow's games per pitch,
-- players joined vs needed, cash expected (app players' cash not yet ticked,
-- and walk-in or phone bookings not yet marked paid, as two figures), blocks
-- and condition flags. Nothing is sent on a day with no game, block or flag.
-- Every count and amount comes from the server, in cents.
begin;

-- 20:00 today in Cyprus, as an instant: the summary for tomorrow is due.
create or replace function tests.summary_time()
returns timestamptz language sql stable as $$
  select (tests.cyprus_today() + time '20:00') at time zone 'Asia/Nicosia'
$$;

-- 1. A full day: the exact contents.
do $$
declare
  v_owner uuid := tests.create_user('vs-owner@futty.test');
  v_b1 uuid := tests.create_user('vs-b1@futty.test');
  v_b2 uuid := tests.create_user('vs-b2@futty.test');
  v_b3 uuid := tests.create_user('vs-b3@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 1;
  v_g1 public.venue_bookings;
  v_g2 public.venue_bookings;
  v_g3 public.venue_bookings;
  v_walk_in uuid;
  v_content jsonb;
  v_game jsonb;
  v_n public.notifications;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  -- Game 1, 19:00: the booker paid by card, one cash player not ticked, one
  -- cash player ticked, one card player not yet paid. 4 of 10.
  v_g1 := tests.booking_with_players(v_b1, v_venue, 'each_pays_own_spot', 3, v_day, '19:00', '20:00', 'vs-g1');
  perform tests.pay_ago((tests.player(v_g1.id, 0)).id, 'pi_vs_g1_0');
  perform tests.pay_ago((tests.player(v_g1.id, 1)).id, 'pi_vs_g1_1', '0', 'cash');
  perform tests.pay_ago((tests.player(v_g1.id, 2)).id, 'pi_vs_g1_2', '0', 'cash');
  perform tests.act_as(v_owner);
  perform public.mark_cash_received((tests.player(v_g1.id, 2)).id);
  perform tests.act_as_postgres();
  -- Game 2, 21:00: the booker by card and one cash player not ticked. 2 of 10.
  v_g2 := tests.booking_with_players(v_b2, v_venue, 'each_pays_own_spot', 1, v_day, '21:00', '22:00', 'vs-g2');
  perform tests.pay_ago((tests.player(v_g2.id, 0)).id, 'pi_vs_g2_0');
  perform tests.pay_ago((tests.player(v_g2.id, 1)).id, 'pi_vs_g2_1', '0', 'cash');
  -- Game 3, cancelled by its booker: left out.
  v_g3 := tests.booking_with_players(v_b3, v_venue, 'each_pays_own_spot', 0, v_day, '15:00', '16:00', 'vs-g3');
  perform tests.pay_ago((tests.player(v_g3.id, 0)).id, 'pi_vs_g3_0');
  perform tests.cancel(v_g3.id, 'whole_team', v_b3);
  -- A walk-in not yet paid (the venue's price, €60.00) and a phone booking
  -- paid in cash at the counter (€45.00).
  perform tests.act_as(v_owner);
  v_walk_in := public.add_counter_booking(v_venue, v_day, '18:00', '19:00', '5-a-side', 'walk_in', 'Walter', null);
  perform public.add_counter_booking(v_venue, v_day, '17:00', '18:00', '5-a-side', 'phone', 'Phoebe', '99123456',
                                     null, 4500, 'cash');
  -- A condition flag for the day, and one that was cleared.
  perform public.flag_conditions(v_venue, v_day, null, null, null, 'Waterlogged');
  perform tests.act_as_postgres();
  insert into public.venue_condition_flags (venue_id, flag_day, note, cleared_at)
  values (v_venue, v_day, 'Old', tests.summary_time() - interval '1 hour');
  -- A block.
  insert into public.venue_blocks (venue_id, block_day, starts_at, ends_at, reason)
  values (v_venue, v_day, '08:00', '09:00', 'Academy');

  v_content := public.venue_daily_summary_content(v_venue, v_day);
  assert (v_content ->> 'gameCount')::integer = 4, format('4 games, got %s', v_content);
  assert (v_content ->> 'appJoined')::integer = 6 and (v_content ->> 'appPlayers')::integer = 20,
    format('6 of 20 players in, got %s', v_content);
  assert (v_content ->> 'appCashCents')::integer = 1200, format('€12.00 app cash, got %s', v_content ->> 'appCashCents');
  assert (v_content ->> 'counterUnpaidCents')::integer = 6000,
    format('€60.00 at the counter, got %s', v_content ->> 'counterUnpaidCents');
  assert (v_content ->> 'blockCount')::integer = 1, 'one block';
  assert (v_content ->> 'flagCount')::integer = 1, 'one flag (the cleared one is left out)';
  assert position(v_g3.id::text in v_content::text) = 0, 'the cancelled game is left out';

  select g into v_game
  from jsonb_array_elements(v_content -> 'pitches') p, jsonb_array_elements(p -> 'games') g
  where g ->> 'bookingId' = v_g1.id::text limit 1;
  assert v_game ->> 'start' = '19:00' and v_game ->> 'end' = '20:00' and v_game ->> 'kind' = 'app'
         and (v_game ->> 'joined')::integer = 4 and (v_game ->> 'players')::integer = 10
         and (v_game ->> 'short')::boolean,
    format('game 1, got %s', v_game);
  select g into v_game
  from jsonb_array_elements(v_content -> 'pitches') p, jsonb_array_elements(p -> 'games') g
  where g ->> 'bookingId' = v_walk_in::text limit 1;
  assert v_game ->> 'kind' = 'walk_in' and v_game ->> 'start' = '18:00' and not (v_game ->> 'paid')::boolean,
    format('the walk-in, got %s', v_game);

  -- The tick sends it at 20:00, once.
  perform public.venue_notifications_tick(tests.summary_time());
  perform public.venue_notifications_tick(tests.summary_time() + interval '5 minutes');
  assert (select count(*) from public.notifications where profile_id = v_owner and type = 'venue_daily_summary') = 1,
    'sent once';
  select * into v_n from public.notifications where profile_id = v_owner and type = 'venue_daily_summary';
  assert v_n.title = 'Tomorrow at ' || (select name from public.venues where id = v_venue), format('title, got %s', v_n.title);
  assert v_n.body = format('%s: 4 games, 6 of 20 players in. Cash expected: €12.00 from app players, '
                           || '€60.00 at the counter. 1 block, 1 conditions flag.',
                           to_char(v_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', v_n.body);
  assert v_n.data ->> 'day' = v_day::text and v_n.data ->> 'venueId' = v_venue::text, 'day and venue in data';
  assert (v_n.data ->> 'appCashCents')::integer = 1200 and (v_n.data ->> 'counterUnpaidCents')::integer = 6000,
    'amounts in data';
end $$;

-- 2. Empty days send nothing; a block or a flag alone is enough; a game
-- added later that evening gets the summary on the next run.
do $$
declare
  v_empty_owner uuid := tests.create_user('vs-empty-owner@futty.test');
  v_block_owner uuid := tests.create_user('vs-block-owner@futty.test');
  v_flag_owner uuid := tests.create_user('vs-flag-owner@futty.test');
  v_late_owner uuid := tests.create_user('vs-late-owner@futty.test');
  v_empty uuid := tests.create_venue(p_owner => v_empty_owner, p_pitches => 1);
  v_block uuid := tests.create_venue(p_owner => v_block_owner, p_pitches => 1);
  v_flag uuid := tests.create_venue(p_owner => v_flag_owner, p_pitches => 1);
  v_late uuid := tests.create_venue(p_owner => v_late_owner, p_pitches => 1, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 1;
  v_body text;
begin
  -- Something the day after tomorrow doesn't count.
  insert into public.venue_blocks (venue_id, block_day, reason) values (v_empty, v_day + 1, 'Later');
  insert into public.venue_blocks (venue_id, block_day, reason) values (v_block, v_day, 'Closed for works');
  insert into public.venue_condition_flags (venue_id, flag_day, starts_at, ends_at, note)
  values (v_flag, v_day, '18:00', '20:00', 'Storm');

  perform public.venue_notifications_tick(tests.summary_time());

  assert not exists (select 1 from public.notifications where profile_id = v_empty_owner and type = 'venue_daily_summary'),
    'an empty day sends nothing';
  assert not exists (select 1 from public.venue_staff_notification_log where venue_id = v_empty),
    'and logs nothing';
  select body into v_body from public.notifications where profile_id = v_block_owner and type = 'venue_daily_summary';
  assert v_body = to_char(v_day, 'FMDay FMDD FMMonth') || ': No games. 1 block.', format('block only, got %s', v_body);
  select body into v_body from public.notifications where profile_id = v_flag_owner and type = 'venue_daily_summary';
  assert v_body = to_char(v_day, 'FMDay FMDD FMMonth') || ': No games. 1 conditions flag.', format('flag only, got %s', v_body);

  -- 21:00: a walk-in is added for tomorrow; the next run sends the summary.
  assert not exists (select 1 from public.notifications where profile_id = v_late_owner and type = 'venue_daily_summary'),
    'nothing yet';
  perform tests.set_price(v_late, '5-a-side', 6000);
  perform tests.act_as(v_late_owner);
  perform public.add_counter_booking(v_late, v_day, '10:00', '11:00', '5-a-side', 'walk_in', 'Late', null, null, 5000);
  perform tests.act_as_postgres();
  perform public.venue_notifications_tick(tests.summary_time() + interval '1 hour');
  select body into v_body from public.notifications where profile_id = v_late_owner and type = 'venue_daily_summary';
  assert v_body = to_char(v_day, 'FMDay FMDD FMMonth') || ': 1 game. Cash expected: €0.00 from app players, '
                  || '€50.00 at the counter.',
    format('late game, got %s', v_body);
end $$;

rollback;
