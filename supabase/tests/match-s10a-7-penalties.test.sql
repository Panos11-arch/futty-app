-- S10A: a drawn knockout match goes to a penalty shootout (3 each, then
-- sudden death), logged with the score; both captains must match on the
-- score and the shootout. Shown as "AP" with the shootout score
-- (match-record.md decision 1o).
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-7-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  v_group_match uuid;
  v_match uuid;
  v_home uuid;
  v_away uuid;
  v_error text;
  v jsonb;
  v_row jsonb;
begin
  -- A group match: no shootout, level or not.
  v_group_match := tests.s10a_time(v_admin, tests.s10a_fixture(v_t, v_teams[1], v_teams[2]), now() - interval '2 hours');
  v_error := tests.s10a_log_error(tests.s10a_captain(v_teams[1]), v_group_match, 1, 1, 4, 3);
  assert v_error = 'shootout_not_allowed', 'not in a group match, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_log_error(tests.s10a_captain(v_teams[1]), v_group_match, 1, 1);
  assert v_error is null, 'a group draw stands, got ' || coalesce(v_error, '');

  perform tests.s10a_play_groups(v_admin, v_t);
  v_match := tests.s10a_time(v_admin, tests.s10a_slot(v_t, 'QF1'), now() - interval '2 hours');
  select home_team_id, away_team_id into v_home, v_away from public.tournament_fixtures where id = tests.s10a_slot(v_t, 'QF1');

  -- Level without a shootout, a shootout with a winner, or penalties on a decided game: refused.
  v_error := tests.s10a_log_error(tests.s10a_captain(v_home), v_match, 1, 1);
  assert v_error = 'shootout_required', 'a level knockout needs pens, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_log_error(tests.s10a_captain(v_home), v_match, 2, 1, 4, 3);
  assert v_error = 'shootout_not_allowed', 'not with a winner, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_log_error(tests.s10a_captain(v_home), v_match, 1, 1, 3, 3);
  assert v_error = 'invalid_shootout', '3–3 has no winner, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_log_error(tests.s10a_captain(v_home), v_match, 1, 1, 5, 3);
  assert v_error = 'invalid_shootout', '5–3 cannot happen in sudden death, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_log_error(tests.s10a_captain(v_home), v_match, 1, 1, 4, null);
  assert v_error = 'invalid_shootout', 'both or neither, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_log_error(tests.s10a_captain(v_home), v_match, 1, 1, -1, 0);
  assert v_error = 'invalid_shootout', 'no negatives, got ' || coalesce(v_error, 'no error');

  -- 3–1 (ended early) and 6–5 (sudden death) are valid shootouts.
  v := tests.s10a_log(tests.s10a_captain(v_home), v_match, 1, 1, 3, 1);
  assert v ->> 'status' = 'waiting', '3–1 logged, got ' || v::text;
  -- The other captain logs a different shootout: a failed try.
  v := tests.s10a_log(tests.s10a_captain(v_away), v_match, 1, 1, 6, 5);
  assert v ->> 'status' = 'mismatch' and (v ->> 'tries')::integer = 1, 'pens must match, got ' || v::text;
  assert (select status from public.matches where id = v_match) <> 'confirmed', 'not confirmed';
  -- Both agree: confirmed with the shootout.
  v := tests.s10a_log(tests.s10a_captain(v_home), v_match, 1, 1, 6, 5);
  assert v ->> 'status' = 'confirmed', 'agreed, got ' || v::text;
  assert (select (status, side_a_score, side_b_score, side_a_pens, side_b_pens) from public.matches where id = v_match)
         = ('confirmed'::text, 1, 1, 6, 5), 'stored with the shootout';

  -- Final: the fixture completes with the shootout; the winner goes through.
  perform tests.s10_final(v_match);
  assert (select (status, home_score, away_score, home_pens, away_pens, decided_by) from public.tournament_fixtures
          where id = tests.s10a_slot(v_t, 'QF1')) = ('completed'::text, 1, 1, 6, 5, 'match'::text), 'fixture completed with AP';
  assert (select home_team_id from public.tournament_fixtures where id = tests.s10a_slot(v_t, 'SF1')) = v_home,
    'the shootout winner reaches SF1';

  -- The matches list carries the shootout, for "AP".
  select r into v_row
  from jsonb_array_elements(tests.s10_json(v_home, format('select public.get_tournament_matches(%L)', v_t))) r
  where r ->> 'slot' = 'QF1';
  assert (v_row ->> 'homePens')::integer = 6 and (v_row ->> 'awayPens')::integer = 5
         and (v_row ->> 'homeScore')::integer = 1 and v_row ->> 'stage' = 'qf', 'AP in the list, got ' || coalesce(v_row::text, 'null');

  -- At the deadline: one captain's shootout stands; two different shootouts are disputed.
  v_match := tests.s10a_time(v_admin, tests.s10a_slot(v_t, 'QF2'), now() - interval '2 hours');
  select home_team_id, away_team_id into v_home, v_away from public.tournament_fixtures where id = tests.s10a_slot(v_t, 'QF2');
  perform tests.s10a_log(tests.s10a_captain(v_home), v_match, 2, 2, 4, 3);
  perform tests.s10a_log(tests.s10a_captain(v_away), v_match, 2, 2, 3, 4);
  update public.matches set result_deadline_at = now() - interval '1 minute' where id = v_match;
  perform tests.act_as_service_role();
  perform public.match_jobs_tick();
  perform tests.act_as_postgres();
  assert (select status from public.matches where id = v_match) = 'disputed', 'different shootouts at the deadline: disputed';

  v_match := tests.s10a_time(v_admin, tests.s10a_slot(v_t, 'QF3'), now() - interval '2 hours');
  select home_team_id into v_home from public.tournament_fixtures where id = tests.s10a_slot(v_t, 'QF3');
  perform tests.s10a_log(tests.s10a_captain(v_home), v_match, 0, 0, 2, 3);
  update public.matches set result_deadline_at = now() - interval '1 minute' where id = v_match;
  perform tests.act_as_service_role();
  perform public.match_jobs_tick();
  perform tests.act_as_postgres();
  assert (select (status, confirmed_via, side_a_pens, side_b_pens) from public.matches where id = v_match)
         = ('confirmed'::text, 'deadline'::text, 2, 3), 'one captain''s shootout stands at the deadline';
end $$;

rollback;
