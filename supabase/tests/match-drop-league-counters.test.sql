-- The old league_teams counters (played, won, drawn, lost, goals_for,
-- goals_against) are gone; standings come from fixtures (league_standings).
-- pts_adjustment stays. The old score path (fixtures made before S10) still
-- runs without them, and the computed standings follow it.
begin;

-- 1. The columns and league_refresh_counters are gone; pts_adjustment stays.
do $$
begin
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'league_teams'
      and column_name in ('played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against')
  ), 'the counter columns are dropped';
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'league_teams' and column_name = 'pts_adjustment'
  ), 'pts_adjustment stays';
  assert to_regprocedure('public.league_refresh_counters(uuid)') is null, 'league_refresh_counters is dropped';
end $$;

-- 2. The old path: agreed scores, a dispute and an unscheduled fixture.
do $$
declare
  cap_a uuid := tests.create_user('drop-counters-a@futty.test');
  cap_b uuid := tests.create_user('drop-counters-b@futty.test');
  cap_c uuid := tests.create_user('drop-counters-c@futty.test');
  t_a uuid := tests.s10_team('DC Alpha', cap_a);
  t_b uuid := tests.s10_team('DC Bravo', cap_b);
  t_c uuid := tests.s10_team('DC Charlie', cap_c);
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_a, t_b, t_c]);
  v_ab uuid := tests.s10_fixture(v_season, t_a, t_b);
  v_ac uuid := tests.s10_fixture(v_season, t_a, t_c);
  v_bc uuid := tests.s10_fixture(v_season, t_b, t_c);
  v_f public.league_fixtures;
  v_home_cap uuid;
  v_away_cap uuid;
  v_error text;
  v_row jsonb;
begin
  -- Made before S10: the old path.
  update public.league_fixtures
  set match_flow = false, status = 'agreed',
      scheduled_day = (now() at time zone 'Asia/Nicosia')::date - 1, scheduled_time = '18:00'
  where id in (v_ab, v_ac);
  update public.league_fixtures set match_flow = false, created_at = now() - interval '8 days' where id = v_bc;

  -- A–B: both captains agree 2-1 for the home team.
  select * into v_f from public.league_fixtures where id = v_ab;
  v_home_cap := case v_f.home_team_id when t_a then cap_a else cap_b end;
  v_away_cap := case v_f.home_team_id when t_a then cap_b else cap_a end;
  v_error := tests.error_as(v_home_cap, format('select public.submit_fixture_score(%L, 2, 1)', v_ab));
  assert v_error is null, 'home captain submits, got ' || coalesce(v_error, '');
  v_error := tests.error_as(v_away_cap, format('select public.submit_fixture_score(%L, 2, 1)', v_ab));
  assert v_error is null, 'away captain submits, got ' || coalesce(v_error, '');
  assert (select status from public.league_fixtures where id = v_ab) = 'completed', 'agreed scores complete it';
  v_row := tests.s10_row(v_season, v_f.home_team_id);
  assert (v_row ->> 'won')::integer = 1 and (v_row ->> 'goals_for')::integer = 2
         and (v_row ->> 'goals_against')::integer = 1, 'the standings count the win, got ' || v_row::text;

  -- A–C: the home team changes its score on a third attempt (its third
  -- dispute): it forfeits and loses 6 points.
  select * into v_f from public.league_fixtures where id = v_ac;
  v_home_cap := case v_f.home_team_id when t_a then cap_a else cap_c end;
  v_away_cap := case v_f.home_team_id when t_a then cap_c else cap_a end;
  update public.teams set dispute_count = 2 where id = v_f.home_team_id;
  v_error := tests.error_as(v_home_cap, format('select public.submit_fixture_score(%L, 1, 0)', v_ac));
  assert v_error is null, 'first attempt, got ' || coalesce(v_error, '');
  v_error := tests.error_as(v_away_cap, format('select public.submit_fixture_score(%L, 0, 0)', v_ac));
  assert v_error is null, 'second attempt, got ' || coalesce(v_error, '');
  v_error := tests.error_as(v_home_cap, format('select public.submit_fixture_score(%L, 2, 0)', v_ac));
  assert v_error is null, 'third attempt, got ' || coalesce(v_error, '');
  select * into v_f from public.league_fixtures where id = v_ac;
  assert v_f.score_locked and v_f.forfeit_result = 'home_forfeited', 'the team that changed its score forfeits';
  assert (select pts_adjustment from public.league_teams where league_id = v_season and team_id = v_f.home_team_id)
         = -6, 'its third dispute costs 6 points';
  v_row := tests.s10_row(v_season, v_f.away_team_id);
  assert (v_row ->> 'won')::integer >= 1, 'the other team gets the win';

  -- B–C: never scheduled, nobody proposed a date: a draw after 7 days.
  select * into v_f from public.league_fixtures where id = v_bc;
  v_error := tests.error_as(cap_b, format('select public.resolve_unscheduled_fixture(%L)', v_bc));
  assert v_error is null, 'resolved, got ' || coalesce(v_error, '');
  assert (select status from public.league_fixtures where id = v_bc) = 'completed', 'the fixture is completed';
  assert (tests.s10_row(v_season, t_c) ->> 'drawn')::integer = 1, 'the standings count the draw';
end $$;

-- 3. Registering still returns the new row.
do $$
declare
  cap uuid := tests.create_user('drop-counters-r@futty.test');
  t uuid := tests.s10_team('DC Reg', cap);
  v_hub uuid := tests.s10_league();
  v_error text;
begin
  v_error := tests.error_as(cap, format('select public.register_team_for_league(%L, %L)', v_hub, t));
  assert v_error is null, 'registered, got ' || coalesce(v_error, '');
  assert (select pts_adjustment from public.league_teams where league_id = v_hub and team_id = t) = 0,
    'starts with no adjustment';
end $$;

rollback;
