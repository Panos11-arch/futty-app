-- S10A: group ties are broken by points, goal difference, goals scored,
-- head-to-head between the teams still level, then the organiser's draw
-- (match-record.md decision 1o). A tie for 1st or 2nd that only the draw
-- can break holds the quarter-finals until the admin enters it.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-4-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  t1 uuid := v_teams[1];
  t2 uuid := v_teams[2];
  t3 uuid := v_teams[3];
  t4 uuid := v_teams[4];
  v_error text;
  v_rules text;
begin
  -- Goal difference: T1 and T2 on 5 points, T1 +3, T2 +1; T4 above T3 on goal difference too.
  perform tests.s10a_pair(v_t, t1, t2, 0, 0);
  perform tests.s10a_pair(v_t, t3, t4, 0, 0);
  perform tests.s10a_pair(v_t, t1, t3, 3, 0);
  perform tests.s10a_pair(v_t, t2, t4, 1, 0);
  perform tests.s10a_pair(v_t, t1, t4, 0, 0);
  perform tests.s10a_pair(v_t, t2, t3, 0, 0);
  assert tests.s10a_order(v_t, 'A') = array[t1, t2, t4, t3], 'goal difference';

  -- Goals scored: T1 and T2 on 5 points and +2; T1 scored 5, T2 4.
  perform tests.s10a_pair(v_t, t1, t2, 2, 2);
  perform tests.s10a_pair(v_t, t3, t4, 0, 0);
  perform tests.s10a_pair(v_t, t1, t3, 3, 1);
  perform tests.s10a_pair(v_t, t2, t4, 2, 0);
  perform tests.s10a_pair(v_t, t1, t4, 0, 0);
  perform tests.s10a_pair(v_t, t2, t3, 0, 0);
  assert tests.s10a_order(v_t, 'A') = array[t1, t2, t3, t4], 'goals scored';

  -- Head-to-head, two teams: T1 and T2 on 6 points, +2, 3 scored; T2 beat T1.
  perform tests.s10a_pair(v_t, t1, t2, 0, 1);
  perform tests.s10a_pair(v_t, t3, t4, 0, 0);
  perform tests.s10a_pair(v_t, t1, t3, 2, 0);
  perform tests.s10a_pair(v_t, t2, t4, 2, 0);
  perform tests.s10a_pair(v_t, t1, t4, 1, 0);
  perform tests.s10a_pair(v_t, t2, t3, 0, 1);
  assert (select (points, goal_diff, goals_for) from public.tournament_group_standings(v_t, 'A') where team_id = t1)
         = (select (points, goal_diff, goals_for) from public.tournament_group_standings(v_t, 'A') where team_id = t2),
         'level before head-to-head';
  assert tests.s10a_order(v_t, 'A') = array[t2, t1, t3, t4], 'head-to-head';
  assert not (select bool_or(needs_draw) from public.tournament_group_standings(v_t, 'A')), 'no draw needed';

  -- Head-to-head, three teams (a mini-table): T1, T2 and T3 on 4 points, +1, 5 scored.
  -- Between them T1 has 4 points (beat T2, drew T3), T2 3, T3 1.
  perform tests.s10a_pair(v_t, t1, t2, 4, 2);
  perform tests.s10a_pair(v_t, t3, t4, 4, 0);
  perform tests.s10a_pair(v_t, t1, t3, 1, 1);
  perform tests.s10a_pair(v_t, t2, t4, 0, 0);
  perform tests.s10a_pair(v_t, t1, t4, 0, 1);
  perform tests.s10a_pair(v_t, t2, t3, 3, 0);
  assert (select count(distinct (points, goal_diff, goals_for)) from public.tournament_group_standings(v_t, 'A')
          where team_id in (t1, t2, t3)) = 1, 'three level';
  assert tests.s10a_order(v_t, 'A') = array[t1, t2, t3, t4], 'mini-table head-to-head';

  -- Level on everything: the organiser's draw.
  perform tests.s10a_pair(v_t, t1, t2, 0, 0);
  perform tests.s10a_pair(v_t, t3, t4, 0, 0);
  perform tests.s10a_pair(v_t, t1, t3, 0, 0);
  perform tests.s10a_pair(v_t, t2, t4, 0, 0);
  perform tests.s10a_pair(v_t, t1, t4, 0, 0);
  perform tests.s10a_pair(v_t, t2, t3, 0, 0);
  assert (select bool_and(needs_draw) from public.tournament_group_standings(v_t, 'A')), 'a draw is needed';
  v_error := tests.error_as(v_admin, format('select public.admin_set_draw_order(%L, %L, %L)', v_t, 'A',
                                            array[t3, t1, t4, v_teams[5]]));
  assert v_error = 'invalid_groups', 'teams of the group only, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_set_draw_order(%L, %L, %L)', v_t, 'A',
                                            array[t3, t1, t4, t2]));
  assert v_error is null, 'draw entered, got ' || coalesce(v_error, '');
  assert tests.s10a_order(v_t, 'A') = array[t3, t1, t4, t2], 'the draw decides';
  assert not (select bool_or(needs_draw) from public.tournament_group_standings(v_t, 'A')), 'no draw needed now';

  -- The draw only orders teams still level: a real difference wins over it.
  perform tests.s10a_pair(v_t, t2, t4, 1, 0);
  assert (tests.s10a_order(v_t, 'A'))[1] = t2, 'points first, then the draw';

  -- A tie only for 3rd and 4th doesn't hold the knockout.
  perform tests.s10a_pair(v_t, t1, t2, 1, 0);
  perform tests.s10a_pair(v_t, t3, t4, 0, 0);
  perform tests.s10a_pair(v_t, t1, t3, 1, 0);
  perform tests.s10a_pair(v_t, t2, t4, 1, 0);
  perform tests.s10a_pair(v_t, t1, t4, 1, 0);
  perform tests.s10a_pair(v_t, t2, t3, 1, 0);
  update public.tournament_teams set draw_rank = null where tournament_id = v_t;
  assert (select count(distinct (points, goal_diff, goals_for, h2h_points)) from public.tournament_group_standings(v_t, 'A')
          where team_id in (t3, t4)) = 1, 'T3 and T4 level on everything';
  assert not (select bool_or(needs_draw) from public.tournament_group_standings(v_t, 'A')), '3rd/4th tie needs no draw';

  -- The Rules line, word for word.
  v_rules := tests.s10_json(t1, format('select public.get_tournament_standings(%L)', v_t)) ->> 'rules';
  assert v_rules = 'Teams level on points: goal difference, then goals scored, then head-to-head, then the organiser''s draw.',
    'rules text, got ' || coalesce(v_rules, 'null');
end $$;

-- A group needing the draw holds the quarter-finals until it's entered.
do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-4b-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  v_error text;
  f record;
begin
  -- A, B and C finish in placing order; every D game is 0–0.
  for f in select id, group_letter from public.tournament_fixtures where tournament_id = v_t and stage = 'group'
  loop
    if f.group_letter = 'D' then
      v_error := tests.s10a_result(v_admin, f.id, 0, 0);
      assert v_error is null, 'D result, got ' || coalesce(v_error, '');
    end if;
  end loop;
  perform tests.s10a_play_groups(v_admin, v_t);
  assert (select status from public.tournaments where id = v_t) = 'groups', 'held: D needs the draw';
  assert (select home_team_id from public.tournament_fixtures where tournament_id = v_t and slot = 'QF1') is null,
    'QF1 not filled';
  v_error := tests.error_as(v_admin, format('select public.admin_set_draw_order(%L, %L, %L)', v_t, 'D',
                                            array[v_teams[16], v_teams[15], v_teams[14], v_teams[13]]));
  assert v_error is null, 'draw entered, got ' || coalesce(v_error, '');
  assert (select status from public.tournaments where id = v_t) = 'knockout', 'knockout now';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'QF1')
         = (v_teams[1], v_teams[15]), 'QF1 = A1 v D2 (D2 by the draw)';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'QF4')
         = (v_teams[10], v_teams[16]), 'QF4 = C2 v D1 (D1 by the draw)';
end $$;

rollback;
