-- S10: the Power rankings tab lists the competition's teams in app-wide
-- order, with the same points as Rankings and the change since Monday
-- (match-record.md decisions 1m and 1n).
begin;

do $$
declare
  t_a uuid := tests.s10_team('S10-12 A', tests.create_user('s10-12-a@futty.test'));
  t_b uuid := tests.s10_team('S10-12 B', tests.create_user('s10-12-b@futty.test'));
  t_c uuid := tests.s10_team('S10-12 C', tests.create_user('s10-12-c@futty.test'));
  t_idle uuid := tests.s10_team('S10-12 Idle', tests.create_user('s10-12-idle@futty.test'));
  t_out uuid := tests.s10_team('S10-12 Outside', tests.create_user('s10-12-out@futty.test'));
  viewer uuid := tests.create_user('s10-12-viewer@futty.test');
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_a, t_b, t_c, t_idle]);
  v_today date := tests.cyprus_today();
  v_f uuid;
  r record;
begin
  -- Last week: A beat B. This week: C beat A.
  v_f := tests.s10_fixture(v_season, t_a, t_b);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_a then
    perform tests.s10_score(v_f, 1, 0, v_today - 7);
  else
    perform tests.s10_score(v_f, 0, 1, v_today - 7);
  end if;
  v_f := tests.s10_fixture(v_season, t_c, t_a);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_c then
    perform tests.s10_score(v_f, 2, 0, v_today);
  else
    perform tests.s10_score(v_f, 0, 2, v_today);
  end if;
  perform tests.pr_tick(now());

  perform tests.act_as(viewer);
  assert (select array_agg(team_id order by "position") from public.get_competition_power_ranking(v_season))
         = array[t_c, t_idle, t_a, t_b], 'app-wide points order: C, Idle (1000), A, B';
  for r in select * from public.get_competition_power_ranking(v_season) loop
    assert r.points = tests.pr_points(r.team_id), 'the same points as everywhere in the app';
  end loop;
  -- On Monday: A (1020), C and Idle (1000, by name), B (980).
  assert (select position_change from public.get_competition_power_ranking(v_season) where team_id = t_c) = 1,
    'C rose a place since Monday';
  assert (select position_change from public.get_competition_power_ranking(v_season) where team_id = t_idle) = 1,
    'Idle rose a place without playing';
  assert (select position_change from public.get_competition_power_ranking(v_season) where team_id = t_a) = -2,
    'A fell two places';
  assert (select position_change from public.get_competition_power_ranking(v_season) where team_id = t_b) = 0,
    'B stayed';
  assert (select app_rank from public.get_competition_power_ranking(v_season) where team_id = t_a) is null,
    'not listed in Rankings before 3 games';
  assert (select points from public.get_competition_power_ranking(v_season) where team_id = t_idle) = 1000,
    'a team without a game shows the start points';
  assert (select last_results from public.get_competition_power_ranking(v_season) where team_id = t_a)
         = array['L', 'W'], 'last results, latest first';
  assert not exists (select 1 from public.get_competition_power_ranking(v_season) where team_id = t_out),
    'only this competition''s teams';
  perform tests.act_as_postgres();
end $$;

rollback;
