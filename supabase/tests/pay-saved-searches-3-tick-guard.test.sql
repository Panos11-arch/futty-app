-- Guard: pay_saved_searches re-creates venue_notifications_tick to call
-- saved_searches_tick. It must still do everything it did before: the
-- new-booking, cancellation and short-game notices and the daily summary,
-- each counted in what it returns, plus the new saved_search_match count.
begin;

do $$
declare
  v_owner uuid := tests.create_user('ssg-owner@futty.test');
  v_booker uuid := tests.create_user('ssg-booker@futty.test');
  v_short_booker uuid := tests.create_user('ssg-short@futty.test');
  v_summary_owner uuid := tests.create_user('ssg-summary-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 2;
  v_b public.venue_bookings;
  v_short public.venue_bookings;
  v_result jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);

  -- What it returns: the same keys as before, and the new one.
  v_result := public.venue_notifications_tick(tests.kickoff_of(
    (tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '09:00', '10:00', 'ssg-0')).id) - interval '1 day');
  assert (select array_agg(k order by k) from jsonb_object_keys(v_result) k)
         = array['booking_cancelled', 'daily_summary', 'new_booking', 'saved_search_match', 'short_game'],
    format('keys, got %s', v_result);

  -- A new booking.
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '19:00', '20:00', 'ssg-1');
  perform tests.pay_ago((tests.player(v_b.id, 0)).id, 'pi_ssg_1');
  v_result := public.venue_notifications_tick(tests.kickoff_of(v_b.id) - interval '1 day');
  assert (v_result ->> 'new_booking')::integer >= 1, format('new booking, got %s', v_result);
  assert exists (select 1 from public.notifications where profile_id = v_owner and type = 'venue_new_booking'
                 and data ->> 'bookingId' = v_b.id::text), 'the owner heard of the booking';

  -- Its cancellation by the booker.
  perform tests.cancel(v_b.id, 'whole_team', v_booker);
  v_result := public.venue_notifications_tick(tests.kickoff_of(v_b.id) - interval '1 day');
  assert (v_result ->> 'booking_cancelled')::integer = 1, format('cancellation, got %s', v_result);
  assert exists (select 1 from public.notifications where profile_id = v_owner and type = 'venue_booking_cancelled'),
    'the owner heard of the cancellation';

  -- A short game.
  v_short := tests.booking_with_players(v_short_booker, v_venue, 'each_pays_own_spot', 7, v_day, '12:00', '13:00', 'ssg-s');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_short.id, i)).id, 'pi_ssg_s_' || i);
  end loop;
  perform tests.set_kickoff(v_short.id, now() + interval '5 hours');
  perform public.send_short_game_warnings();
  v_result := public.venue_notifications_tick(tests.kickoff_of(v_short.id) - interval '5 hours');
  assert (v_result ->> 'short_game')::integer = 1, format('short game, got %s', v_result);
  assert exists (select 1 from public.notifications where profile_id = v_owner and type = 'venue_short_game'),
    'the owner heard the game is short';

  -- Tomorrow's summary, from 20:00 Cyprus time. Its own venue: after 20:00
  -- the short game above (moved to 5 hours from now) may fall tomorrow, and
  -- an earlier run would already have sent that venue's summary.
  v_venue := tests.create_venue(p_owner => v_summary_owner, p_pitches => 1, p_open => '07:00', p_close => '24:00');
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 1, '18:00', '19:00', 'ssg-t');
  perform tests.pay_ago((tests.player(v_b.id, 0)).id, 'pi_ssg_t');
  v_result := public.venue_notifications_tick((tests.cyprus_today() + time '20:30') at time zone 'Asia/Nicosia');
  assert (v_result ->> 'daily_summary')::integer >= 1, format('daily summary, got %s', v_result);
  assert exists (select 1 from public.notifications where profile_id = v_summary_owner and type = 'venue_daily_summary'),
    'the owner got the summary';
end $$;

rollback;
