-- The test helpers that place a game relative to now (tests.set_kickoff,
-- tests.end_match) work at every Cyprus time. A game is its kickoff plus 30
-- minutes and is stored on one Cyprus day, so it never crosses midnight:
--   - normally: kickoff and end exactly as asked;
--   - across midnight, already past it: from midnight to the exact end (a
--     game that's over stays over, ended exactly when asked);
--   - across midnight, still before it: the exact kickoff to midnight (a game
--     to come or under way stays so).
-- Its end is always after its kickoff (a kickoff at 23:59:59.x used to get
-- an end before it). Each case runs with an explicit "now" at the edge times
-- that failed: 00:15 and 20:59:59 Cyprus time.
begin;

create function tests.clock_booking()
returns uuid
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
begin
  v_booking := tests.booking_with_players(tests.create_user('clock-' || gen_random_uuid() || '@futty.test'),
                                          tests.create_venue(), 'each_pays_own_spot', 0, tests.next_weekday(3),
                                          '12:00', '13:00', 'clock');
  perform tests.act_as_postgres();
  return v_booking.id;
end;
$$;

create function tests.clock_game(p_booking uuid, out kickoff timestamptz, out ends timestamptz, out day date,
                                 out start_time time, out end_time time)
language sql
as $$
  select (b.booking_day + b.start_time) at time zone 'Asia/Nicosia', (b.booking_day + b.end_time) at time zone 'Asia/Nicosia',
         b.booking_day, b.start_time, b.end_time
  from public.venue_bookings b where b.id = p_booking
$$;

-- Each game: on one Cyprus day, end after kickoff, end at most midnight.
create function tests.clock_sane(p_booking uuid, p_label text)
returns void
language plpgsql
as $$
declare
  g record := tests.clock_game(p_booking);
begin
  assert g.ends > g.kickoff, format('%s: ends after kickoff, got %s', p_label, row_to_json(g));
  assert g.end_time > g.start_time and g.end_time <= time '24:00', format('%s: one Cyprus day, got %s', p_label, row_to_json(g));
end;
$$;

do $$
declare
  v_booking uuid := tests.clock_booking();
  -- 00:15 and 20:59:59.5 Cyprus time on Wednesday 25 November 2026 (UTC+2), and a plain noon.
  v_midnight timestamptz := timestamptz '2026-11-25 00:00+02';
  v_0015 timestamptz := timestamptz '2026-11-25 00:15+02';
  v_2059 timestamptz := timestamptz '2026-11-25 20:59:59.5+02';
  v_noon timestamptz := timestamptz '2026-11-25 12:00+02';
  g record;
begin
  -- A plain time: exactly as asked, 30 minutes.
  perform tests.set_kickoff(v_booking, v_noon + interval '5 hours', v_noon);
  g := tests.clock_game(v_booking);
  assert (g.kickoff, g.ends) = (v_noon + interval '5 hours', v_noon + interval '5 hours 30 minutes'), format('noon: %s', row_to_json(g));

  -- 00:15: the game that ended 24 hours ago (match-record-2's "deadline is
  -- now") ends exactly then, from midnight.
  perform tests.set_kickoff(v_booking, v_0015 - interval '24 hours 30 minutes', v_0015);
  perform tests.clock_sane(v_booking, '00:15, ended 24 hours ago');
  g := tests.clock_game(v_booking);
  assert g.ends = v_0015 - interval '24 hours', format('ends exactly 24 hours ago, got %s', row_to_json(g));
  assert g.kickoff = v_midnight - interval '1 day' and g.day = date '2026-11-24', format('from midnight, got %s', row_to_json(g));

  -- 00:15: kicked off 10 minutes ago (23:55): still under way, kicked off already.
  perform tests.set_kickoff(v_booking, v_0015 - interval '10 minutes', v_0015);
  perform tests.clock_sane(v_booking, '00:15, 10 minutes ago');
  g := tests.clock_game(v_booking);
  assert g.kickoff <= v_0015 and g.ends > v_0015, format('under way, got %s', row_to_json(g));
  assert g.ends = v_0015 + interval '20 minutes', format('ends when asked, got %s', row_to_json(g));

  -- 00:15: kicked off 40 minutes ago (23:35): over, ended exactly 10 minutes ago.
  perform tests.set_kickoff(v_booking, v_0015 - interval '40 minutes', v_0015);
  perform tests.clock_sane(v_booking, '00:15, 40 minutes ago');
  g := tests.clock_game(v_booking);
  assert g.ends = v_0015 - interval '10 minutes' and g.kickoff <= g.ends, format('over, got %s', row_to_json(g));

  -- 00:15: end_match, ended 5 minutes ago (kickoff 23:40): ends exactly then.
  perform tests.end_match(v_booking, interval '5 minutes', v_0015);
  perform tests.clock_sane(v_booking, '00:15, end_match');
  assert (tests.clock_game(v_booking)).ends = v_0015 - interval '5 minutes', 'end_match ends exactly when asked';

  -- 23:50 the night before: kicks off in 5 minutes (23:55): the exact kickoff, to midnight.
  perform tests.set_kickoff(v_booking, v_midnight - interval '5 minutes', v_midnight - interval '10 minutes');
  perform tests.clock_sane(v_booking, '23:50, in 5 minutes');
  g := tests.clock_game(v_booking);
  assert (g.kickoff, g.ends) = (v_midnight - interval '5 minutes', v_midnight), format('to midnight, got %s', row_to_json(g));

  -- 20:59:59.5: kicks off in 3 hours (23:59:59.5): the exact kickoff, ending after it.
  perform tests.set_kickoff(v_booking, v_2059 + interval '3 hours', v_2059);
  perform tests.clock_sane(v_booking, '20:59:59, in 3 hours');
  g := tests.clock_game(v_booking);
  assert g.kickoff = v_2059 + interval '3 hours', format('the exact kickoff, got %s', row_to_json(g));
  assert g.ends = v_midnight + interval '1 day', format('ends at midnight, got %s', row_to_json(g));

  -- 20:59:59.5: in 5 hours 59 minutes (02:58:59.5 tomorrow): exactly as asked.
  perform tests.set_kickoff(v_booking, v_2059 + interval '5 hours 59 minutes', v_2059);
  g := tests.clock_game(v_booking);
  assert (g.kickoff, g.ends) = (v_2059 + interval '5 hours 59 minutes', v_2059 + interval '6 hours 29 minutes'),
    format('the next day, as asked, got %s', row_to_json(g));

  -- Every half minute of the day, past and future: on one day, ends after kickoff.
  for i in 0..2879 loop
    perform tests.set_kickoff(v_booking, v_midnight + make_interval(secs => i * 30) + interval '0.5 seconds',
                              v_midnight + make_interval(secs => i * 30));
    perform tests.clock_sane(v_booking, format('kickoff at %s', i * 30));
    perform tests.set_kickoff(v_booking, v_midnight + make_interval(secs => i * 30) - interval '20 minutes',
                              v_midnight + make_interval(secs => i * 30));
    perform tests.clock_sane(v_booking, format('20 minutes before %s', i * 30));
  end loop;
end $$;

rollback;
