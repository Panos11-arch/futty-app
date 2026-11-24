-- S13B: logging after the game. Only a captain logs (the booker of a
-- pickup); a pickup's captain writes both sides and his Confirm makes it
-- final; in a named game each captain writes only his own side and the
-- server refuses goals or assists for anyone else. Each side's goals (with
-- own goals) add up to its score; assists are optional and never more than
-- its goals.
begin;

-- Only the captain logs, only between kickoff and the deadline.
do $$
declare
  s record := tests.s13b_match(5, 5);
  v_stranger uuid := tests.create_user('s13b-stranger-' || gen_random_uuid() || '@futty.test');
  v_none jsonb := jsonb_build_object('a', '{"players": [], "ownGoals": 0}'::jsonb, 'b', '{"players": [], "ownGoals": 0}'::jsonb);
begin
  assert tests.s13b_log_error(s.a[2], s.match, 0, 0, v_none) = 'not_captain', 'a player can''t log';
  assert tests.s13b_log_error(s.b[1], s.match, 0, 0, v_none) = 'not_captain', 'nor the other side in a pickup';
  assert tests.s13b_log_error(v_stranger, s.match, 0, 0, v_none) = 'not_in_match', 'a stranger';
  update public.matches set kickoff_at = now() + interval '1 hour', ends_at = now() + interval '2 hours',
                            status = 'scheduled' where id = s.match;
  assert tests.s13b_log_error(s.cap_a, s.match, 0, 0, v_none) = 'result_window_closed', 'not before kickoff';
  update public.matches set kickoff_at = now() - interval '2 hours', ends_at = now() - interval '1 hour',
                            status = 'played', result_deadline_at = now() where id = s.match;
  assert tests.s13b_log_error(s.cap_a, s.match, 0, 0, v_none) = 'result_window_closed', 'not at the deadline';
  update public.matches set result_deadline_at = now() + interval '1 hour' where id = s.match;
  assert tests.s13b_log_error(s.cap_a, s.match, -1, 0, v_none) = 'invalid_score', 'no negative score';
end $$;

-- A pickup: the booker writes both sides; totals must match, assists are
-- optional and at most the side's goals; his Confirm makes it final.
do $$
declare
  s record := tests.s13b_match(5, 5);
  v_other record := tests.s13b_match(2, 2);
  r jsonb;
begin
  assert tests.s13b_log_error(s.cap_a, s.match, 4, 1, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2]], array[3]), 'b', tests.s13b_side(s.match, array[s.b[2]], array[1])))
    = 'score_mismatch', 'side a''s goals must add up to 4';
  assert tests.s13b_log_error(s.cap_a, s.match, 4, 1, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2]], array[4])))
    = 'stats_required', 'both sides, when he writes both';
  assert tests.s13b_log_error(s.cap_a, s.match, 4, 1, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2], s.a[3]], array[4, 0], array[3, 2]),
    'b', tests.s13b_side(s.match, array[s.b[2]], array[1])))
    = 'too_many_assists', 'five assists for four goals';
  assert tests.s13b_log_error(s.cap_a, s.match, 4, 1, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2]], array[4]),
    'b', tests.s13b_side(v_other.match, array[v_other.b[2]], array[1])))
    = 'not_your_player', 'a player from another match';
  assert tests.s13b_log_error(s.cap_a, s.match, 4, 1, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2], s.b[2]], array[3, 1]),
    'b', tests.s13b_side(s.match, '{}', '{}', null, 1)))
    = 'not_your_player', 'a side b player can''t score for side a';
  assert tests.s13b_log_error(s.cap_a, s.match, 4, 1, jsonb_build_object(
    'a', jsonb_build_object('players', jsonb_build_array(jsonb_build_object('playerId', 'x', 'goals', 4))),
    'b', tests.s13b_side(s.match, '{}', '{}', null, 1))) = 'invalid_stats', 'a bad id';

  -- No assists at all is fine; an own goal counts for the side.
  r := tests.s13b_log(s.cap_a, s.match, 4, 1, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2], s.a[3]], array[2, 1], null, 1),
    'b', tests.s13b_side(s.match, '{}', '{}', null, 1)));
  assert r ->> 'status' = 'confirmed', format('one captain: final at once (%s)', r);
  assert (select (status, side_a_score, side_b_score, confirmed_via) from public.matches where id = s.match)
         = ('confirmed'::text, 4, 1, 'agreed'::text), 'confirmed 4–1';
  assert (select count(*) from public.match_goals where match_id = s.match and side = 'a') = 4, 'four goals for a';
  assert (select count(*) from public.match_goals where match_id = s.match and scorer_player_id is null) = 2,
    'two own goals';
  assert not exists (select 1 from public.match_assists where match_id = s.match), 'no assists';
  assert (select response from public.match_result_submissions where match_id = s.match) = 'accepted',
    'the submission row is answered (sides lock, settlement)';
  assert tests.notified(s.b[3], 'match_result_confirmed', s.match) = 1, 'everyone is told';
  assert tests.s13b_log_error(s.cap_a, s.match, 5, 1, '{}') = 'result_window_closed', 'final: no second score';
end $$;

-- A named game: each captain writes only his side; the other side is his
-- only by its score.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
  r jsonb;
  v_log jsonb;
begin
  assert tests.s13b_log_error(s.cap_a, s.match, 3, 2, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2]], array[3]), 'b', tests.s13b_side(s.match, array[s.b[2]], array[2])))
    = 'not_your_player', 'side b''s goals aren''t his to log';
  assert tests.s13b_log_error(s.cap_a, s.match, 3, 2, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2], s.b[2]], array[2, 1]))) = 'not_your_player',
    'nor a side b player on side a';
  assert tests.s13b_log_error(s.cap_a, s.match, 3, 2, '{}') = 'stats_required', 'his side''s goals are needed';

  r := tests.s13b_log(s.cap_a, s.match, 3, 2, jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[2]], array[3])));
  assert r ->> 'status' = 'waiting', format('waiting for the other captain (%s)', r);
  assert (select status from public.matches where id = s.match) = 'played', 'not confirmed yet';
  assert tests.notified(s.cap_b, 'match_result_submitted', s.match) = 1, 'the other captain is asked to log';

  -- The other captain doesn't see the first score before logging his own.
  perform tests.act_as(s.cap_b);
  v_log := public.get_match_log(s.match);
  perform tests.act_as_postgres();
  assert v_log -> 'writableSides' = '["b"]'::jsonb, 'he writes side b';
  assert v_log -> 'theirEntry' = 'null'::jsonb and v_log -> 'myEntry' = 'null'::jsonb, 'nothing to copy';
  assert jsonb_array_length(v_log -> 'players') = 10, 'every player, for the pitch';
  assert v_log -> 'stats' ? 'b' and not v_log -> 'stats' ? 'a', 'only his side''s stats';
  assert v_log ->> 'canLog' = 'true', 'he can log';

  -- A player sees the match but writes nothing.
  perform tests.act_as(s.a[3]);
  v_log := public.get_match_log(s.match);
  perform tests.act_as_postgres();
  assert v_log -> 'writableSides' = '[]'::jsonb and v_log ->> 'canLog' = 'false', 'a player can''t log';

  r := tests.s13b_log(s.cap_b, s.match, 3, 2, jsonb_build_object('b', tests.s13b_side(s.match, array[s.b[2], s.b[3]], array[1, 1])));
  assert r ->> 'status' = 'confirmed', format('the same score: confirmed (%s)', r);
  assert (select count(*) from public.match_goals where match_id = s.match) = 5, 'each side''s goals';
end $$;

-- Corrections: the same captains, their own sides, for 24 hours after
-- confirmation; never another side's players.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
begin
  perform tests.s13b_log(s.cap_a, s.match, 1, 0, jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[2]], array[1])));
  perform tests.s13b_log(s.cap_b, s.match, 1, 0, jsonb_build_object('b', tests.s13b_side(s.match, '{}', '{}')));
  assert tests.error_as(s.cap_a, format('select public.set_match_stats(%L, %L)', s.match,
           jsonb_build_object('b', tests.s13b_side(s.match, '{}', '{}')))) = 'not_your_player', 'not side b';
  assert tests.error_as(s.a[2], format('select public.set_match_stats(%L, %L)', s.match,
           jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[2]], array[1])))) = 'not_captain', 'not a player';
  assert tests.error_as(s.cap_a, format('select public.set_match_stats(%L, %L)', s.match,
           jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[3]], array[1], array[1])))) is null,
    'he moves the goal and adds an assist';
  assert (select player_id from public.match_assists where match_id = s.match) = tests.player_id(s.match, s.a[3]),
    'the assist is stored';
  perform tests.age_match(s.match, interval '25 hours');
  assert tests.error_as(s.cap_a, format('select public.set_match_stats(%L, %L)', s.match,
           jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[2]], array[1])))) = 'scorers_window_closed',
    'closed after 24 hours';
end $$;

-- Home's list: the caller's games still waiting for his score, or whose
-- scores differ; never a player's, never one already settled.
do $$
declare
  s record := tests.s13b_match(5, 5, false);
  v jsonb;
begin
  perform tests.act_as(s.cap_a);
  v := public.get_my_matches_to_log();
  perform tests.act_as_postgres();
  assert exists (select 1 from jsonb_array_elements(v) e where e ->> 'matchId' = s.match::text and e ->> 'state' = 'log'),
    'his to log';
  perform tests.act_as(s.a[2]);
  assert not exists (select 1 from jsonb_array_elements(public.get_my_matches_to_log()) e
                     where e ->> 'matchId' = s.match::text), 'not a player''s';
  perform tests.act_as_postgres();
  perform tests.s13b_log(s.cap_a, s.match, 1, 0, jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[2]], array[1])));
  perform tests.act_as(s.cap_a);
  assert not exists (select 1 from jsonb_array_elements(public.get_my_matches_to_log()) e
                     where e ->> 'matchId' = s.match::text), 'logged: waiting for the other captain';
  perform tests.act_as_postgres();
  perform tests.s13b_log(s.cap_b, s.match, 2, 0, jsonb_build_object('b', tests.s13b_side(s.match, '{}', '{}')));
  perform tests.act_as(s.cap_a);
  assert exists (select 1 from jsonb_array_elements(public.get_my_matches_to_log()) e
                 where e ->> 'matchId' = s.match::text and e ->> 'state' = 'mismatch'), 'scores differ: back on his list';
  perform tests.act_as_postgres();
end $$;

-- The old calls are gone from the app.
do $$
declare
  s record := tests.s13b_match(2, 2);
begin
  assert tests.error_as(s.cap_a, format('select public.submit_match_result(%L, 1, 0)', s.match)) like '%permission denied%',
    'submit_match_result';
  assert tests.error_as(s.cap_a, format('select public.respond_to_match_result(%L, true)', s.match)) like '%permission denied%',
    'respond_to_match_result';
  assert tests.error_as(s.cap_a, format('select public.set_match_goals(%L, %L)', s.match, '[]')) like '%permission denied%',
    'set_match_goals';
  assert tests.error_as(s.cap_a, format('select public.rate_match_player(%L, %L, 7)', s.match,
                                        tests.player_id(s.match, s.a[2]))) like '%permission denied%', 'rate_match_player';
  assert tests.error_as(s.cap_a, format('select public.get_match_ratings(%L)', s.match)) like '%permission denied%',
    'get_match_ratings';
  assert tests.error_as(s.cap_a, format('select public.match_compute_ratings(%L)', s.match)) like '%permission denied%',
    'internal: computing ratings';
  assert tests.error_as(s.cap_a, 'select * from public.match_score_entries') like '%permission denied%',
    'captains'' scores are read through get_match_log only';
end $$;

rollback;
