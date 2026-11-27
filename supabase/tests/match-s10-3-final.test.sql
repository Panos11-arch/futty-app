-- S10: a league match's final result fills its fixture at the moment levels
-- move, and the power ranking counts it then (match-record.md decisions
-- 1m and 1n; Panos, 26 November).
begin;

do $$
declare
  cap_h uuid := tests.create_user('s10-3-cap-h@futty.test');
  cap_a uuid := tests.create_user('s10-3-cap-a@futty.test');
  cap_c uuid := tests.create_user('s10-3-cap-c@futty.test');
  t_h uuid := tests.s10_team('S10-3 Home', cap_h);
  t_a uuid := tests.s10_team('S10-3 Away', cap_a);
  t_c uuid := tests.s10_team('S10-3 Third', cap_c);
  v_hub uuid := tests.s10_league();
  v_season uuid := tests.s10_season(v_hub, array[t_h, t_a, t_c]);
  v_fixture uuid := tests.s10_fixture(v_season, t_h, t_a);
  v_disputed uuid := tests.s10_fixture(v_season, t_h, t_c);
  v_f public.league_fixtures;
  v_match uuid;
  v_home_cap uuid;
  v_away_cap uuid;
  v_final timestamptz;
  v_error text;
  v jsonb;
begin
  -- Agreed late: kicked off 3 hours ago, so it's ready to log.
  v_match := tests.s10_schedule(v_fixture, date_trunc('minute', now()) - interval '3 hours');
  select * into v_f from public.league_fixtures where id = v_fixture;
  v_home_cap := case when v_f.home_team_id = t_h then cap_h else cap_a end;
  v_away_cap := case when v_f.home_team_id = t_h then cap_a else cap_h end;

  -- The old path is refused: captains log on the match.
  v_error := tests.error_as(v_home_cap, format('select public.submit_fixture_score(%L, 2, 1)', v_fixture));
  assert v_error = 'use_match_flow', 'the old score path is refused, got ' || coalesce(v_error, 'no error');

  -- Both captains agree 2:1 (home first) on Log the score.
  v := tests.log_result(v_home_cap, v_match, 2, 1);
  assert v ->> 'status' = 'waiting', 'the first captain waits for the other: ' || v::text;
  v := tests.log_result(v_away_cap, v_match, 2, 1);
  assert v ->> 'status' = 'confirmed', 'two matching scores confirm the match: ' || v::text;

  -- Confirmed but not final: the fixture waits.
  assert tests.apply_levels(v_match) = 'not_yet', 'not final yet';
  select * into v_f from public.league_fixtures where id = v_fixture;
  assert v_f.status = 'agreed' and v_f.home_score is null, 'the fixture waits for the final moment';
  perform tests.pr_tick(now());
  assert tests.pr_rows(v_fixture) = 0, 'the power ranking doesn''t count it yet';

  -- Final: the score is copied (side a = home) and the fixture completed.
  v_final := tests.s10_final_at(v_match);
  assert tests.s10_final(v_match) in ('applied', 'skipped'), 'levels run at the final moment';
  select * into v_f from public.league_fixtures where id = v_fixture;
  assert v_f.status = 'completed', 'the fixture is completed';
  assert v_f.home_score = 2 and v_f.away_score = 1, 'the fixture has the match''s score';
  assert v_f.score_locked, 'and it is locked';
  perform tests.pr_tick(v_final);
  assert tests.pr_rows(v_fixture) = 2, 'the power ranking counts it at the same moment';
  assert (select won from public.league_teams where league_id = v_season and team_id = v_f.home_team_id) = 1,
    'the old counters follow';

  -- Disputed: the fixture stays open (the organiser decides).
  v_match := tests.s10_schedule(v_disputed, date_trunc('minute', now()) - interval '3 hours');
  select * into v_f from public.league_fixtures where id = v_disputed;
  perform tests.dispute_result(case when v_f.home_team_id = t_h then cap_h else cap_c end,
                               case when v_f.home_team_id = t_h then cap_c else cap_h end, v_match);
  assert (select status from public.matches where id = v_match) = 'disputed', 'the match is disputed';
  perform tests.act_as_service_role();
  perform public.apply_match_levels(v_match, now() + interval '5 days');
  perform tests.act_as_postgres();
  select * into v_f from public.league_fixtures where id = v_disputed;
  assert v_f.status = 'agreed' and v_f.home_score is null and v_f.forfeit_result is null,
    'a disputed match leaves the fixture open';
end $$;

-- A match forfeit becomes the fixture's forfeit; the match is then void.
do $$
declare
  cap_h uuid := tests.create_user('s10-3-ff-h@futty.test');
  cap_a uuid := tests.create_user('s10-3-ff-a@futty.test');
  t_h uuid := tests.s10_team('S10-3 FF Home', cap_h);
  t_a uuid := tests.s10_team('S10-3 FF Away', cap_a);
  v_hub uuid := tests.s10_league();
  v_season uuid := tests.s10_season(v_hub, array[t_h, t_a]);
  v_fixture uuid := tests.s10_fixture(v_season, t_h, t_a);
  v_match uuid := tests.s10_schedule(v_fixture, date_trunc('minute', now()) - interval '3 hours');
  v_f public.league_fixtures;
begin
  update public.matches
  set status = 'confirmed', forfeit_side = 'b', forfeit_reason = 'no_show', confirmed_via = 'forfeit',
      confirmed_at = kickoff_at + interval '2 hours'
  where id = v_match;
  perform tests.s10_final(v_match);
  select * into v_f from public.league_fixtures where id = v_fixture;
  assert v_f.forfeit_result = 'away_forfeited' and v_f.status = 'completed', 'side b''s forfeit is the away team''s';
  assert (select status from public.matches where id = v_match) = 'void', 'the match is void (no stats)';
  assert (tests.s10_row(v_season, v_f.home_team_id) ->> 'points')::integer = 3, 'the home team gets the win';
end $$;

rollback;
