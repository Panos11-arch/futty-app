-- S10: standings computed from fixtures (match-record.md decision 1n):
-- points, goal difference, goals for, head-to-head points, then team name.
-- Each tiebreak has its own case; forfeits, adjustments, form and zones.
begin;

-- 1. Points first (the lower name would win the last tiebreak).
do $$
declare
  t_z uuid := tests.s10_team('Zulu', tests.create_user('s10-7-1z@futty.test'));
  t_a uuid := tests.s10_team('Alpha', tests.create_user('s10-7-1a@futty.test'));
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_z, t_a]);
  v_f uuid := tests.s10_fixture(v_season, t_z, t_a);
begin
  if (select home_team_id from public.league_fixtures where id = v_f) = t_z then
    perform tests.s10_score(v_f, 1, 0);
  else
    perform tests.s10_score(v_f, 0, 1);
  end if;
  assert tests.s10_order(v_season) = array[t_z, t_a], 'more points first';
  assert (tests.s10_row(v_season, t_z) ->> 'points')::integer = 3, '3 for a win';
  assert (tests.s10_row(v_season, t_a) ->> 'points')::integer = 0, '0 for a loss';
end $$;

-- 2. Goal difference: level on points, the better difference first.
do $$
declare
  t_x uuid := tests.s10_team('Zx', tests.create_user('s10-7-2x@futty.test'));
  t_y uuid := tests.s10_team('Ay', tests.create_user('s10-7-2y@futty.test'));
  t_z uuid := tests.s10_team('Mz', tests.create_user('s10-7-2z@futty.test'));
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_x, t_y, t_z]);
  v_f uuid;
begin
  -- X beat Z 3-0, Y beat Z 1-0, X and Y drew 0-0: both 4 points.
  v_f := tests.s10_fixture(v_season, t_x, t_z);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_x then perform tests.s10_score(v_f, 3, 0);
  else perform tests.s10_score(v_f, 0, 3); end if;
  v_f := tests.s10_fixture(v_season, t_y, t_z);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_y then perform tests.s10_score(v_f, 1, 0);
  else perform tests.s10_score(v_f, 0, 1); end if;
  perform tests.s10_score(tests.s10_fixture(v_season, t_x, t_y), 0, 0);
  assert (tests.s10_row(v_season, t_x) ->> 'points') = (tests.s10_row(v_season, t_y) ->> 'points'), 'level on points';
  assert tests.s10_order(v_season) = array[t_x, t_y, t_z], 'the better goal difference first';
  assert (tests.s10_row(v_season, t_x) ->> 'goal_diff')::integer = 3, 'difference +3';
end $$;

-- 3. Goals for: level on points and difference, more goals first.
do $$
declare
  t_x uuid := tests.s10_team('Zx3', tests.create_user('s10-7-3x@futty.test'));
  t_y uuid := tests.s10_team('Ay3', tests.create_user('s10-7-3y@futty.test'));
  t_z uuid := tests.s10_team('Mz3', tests.create_user('s10-7-3z@futty.test'));
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_x, t_y, t_z]);
  v_f uuid;
begin
  -- X beat Z 3-2, Y beat Z 1-0, X and Y drew 0-0: both 4 points, +1.
  v_f := tests.s10_fixture(v_season, t_x, t_z);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_x then perform tests.s10_score(v_f, 3, 2);
  else perform tests.s10_score(v_f, 2, 3); end if;
  v_f := tests.s10_fixture(v_season, t_y, t_z);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_y then perform tests.s10_score(v_f, 1, 0);
  else perform tests.s10_score(v_f, 0, 1); end if;
  perform tests.s10_score(tests.s10_fixture(v_season, t_x, t_y), 0, 0);
  assert (tests.s10_row(v_season, t_x) ->> 'goal_diff') = (tests.s10_row(v_season, t_y) ->> 'goal_diff'),
    'level on difference';
  assert (tests.s10_order(v_season))[1:2] = array[t_x, t_y], 'more goals scored first';
end $$;

-- 4. Head-to-head: level on points, difference and goals, the winner of
-- their game first.
do $$
declare
  t_w uuid := tests.s10_team('Zeta', tests.create_user('s10-7-4w@futty.test'));
  t_l uuid := tests.s10_team('Alpha4', tests.create_user('s10-7-4l@futty.test'));
  t_c uuid := tests.s10_team('Mid4', tests.create_user('s10-7-4c@futty.test'));
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_w, t_l, t_c]);
  v_f uuid;
begin
  -- W beat L 2-1, C beat W 1-0, L beat C 1-0: W and L both 3 points, 0, 2
  -- scored; C 3 points, 0, 1 scored.
  v_f := tests.s10_fixture(v_season, t_w, t_l);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_w then perform tests.s10_score(v_f, 2, 1);
  else perform tests.s10_score(v_f, 1, 2); end if;
  v_f := tests.s10_fixture(v_season, t_c, t_w);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_c then perform tests.s10_score(v_f, 1, 0);
  else perform tests.s10_score(v_f, 0, 1); end if;
  v_f := tests.s10_fixture(v_season, t_l, t_c);
  if (select home_team_id from public.league_fixtures where id = v_f) = t_l then perform tests.s10_score(v_f, 1, 0);
  else perform tests.s10_score(v_f, 0, 1); end if;
  assert (tests.s10_row(v_season, t_w) ->> 'goals_for') = (tests.s10_row(v_season, t_l) ->> 'goals_for'),
    'level on goals scored';
  assert tests.s10_order(v_season) = array[t_w, t_l, t_c], 'the head-to-head winner first';
  assert (tests.s10_row(v_season, t_w) ->> 'h2h_points')::integer = 3, 'head-to-head points';
end $$;

-- 5. Team name last.
do $$
declare
  t_b uuid := tests.s10_team('Bravo', tests.create_user('s10-7-5b@futty.test'));
  t_a uuid := tests.s10_team('Alpha5', tests.create_user('s10-7-5a@futty.test'));
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_b, t_a]);
begin
  perform tests.s10_score(tests.s10_fixture(v_season, t_a, t_b), 1, 1);
  assert tests.s10_order(v_season) = array[t_a, t_b], 'all level: the team name';
end $$;

-- 6. Forfeits, adjustments, void, form and zones.
do $$
declare
  t_a uuid := tests.s10_team('S10-7 A', tests.create_user('s10-7-6a@futty.test'));
  t_b uuid := tests.s10_team('S10-7 B', tests.create_user('s10-7-6b@futty.test'));
  t_c uuid := tests.s10_team('S10-7 C', tests.create_user('s10-7-6c@futty.test'));
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_a, t_b, t_c]);
  v_ab uuid := tests.s10_fixture(v_season, t_a, t_b);
  v_ac uuid := tests.s10_fixture(v_season, t_a, t_c);
  v_bc uuid := tests.s10_fixture(v_season, t_b, t_c);
  v_row jsonb;
begin
  -- A–B: A forfeits. A–C: 2-2. B–C: void.
  update public.league_fixtures
  set forfeit_result = case when home_team_id = t_a then 'home_forfeited' else 'away_forfeited' end
  where id = v_ab;
  update public.league_fixtures set scheduled_day = current_date - 2 where id = v_ab;
  perform tests.s10_score(v_ac, 2, 2, current_date - 1);
  update public.league_fixtures set forfeit_result = 'void' where id = v_bc;

  v_row := tests.s10_row(v_season, t_b);
  assert (v_row ->> 'won')::integer = 1 and (v_row ->> 'goals_for')::integer = 0, 'a forfeit win has no goals';
  assert (v_row ->> 'played')::integer = 1, 'a void game isn''t played';
  v_row := tests.s10_row(v_season, t_a);
  assert (v_row ->> 'points')::integer = 1, 'a forfeit loss is 0, a draw 1';
  assert v_row -> 'form' = '["D", "L"]'::jsonb, 'form: latest first, got ' || (v_row -> 'form')::text;
  assert (v_row ->> 'zone') = 'division_1', 'Season 1''s top places go to Division 1';

  update public.league_teams set pts_adjustment = -6 where league_id = v_season and team_id = t_b;
  assert (tests.s10_row(v_season, t_b) ->> 'points')::integer = -3, 'the adjustment counts';
end $$;

rollback;
