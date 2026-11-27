-- S10A: the admin sets or draws 4 groups of 4 (A–D); each team plays the
-- other three once; 3 points a win, 1 a draw (match-record.md decision 1o).
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-3-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_d uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[];
  v_dteams uuid[];
  v_error text;
  v_late uuid := tests.s10a_team('S10A-3 Late');
  v_groups jsonb;
begin
  -- Not before 16 teams.
  perform tests.s10a_register(v_t, tests.s10a_team('S10A-3 One'));
  v_error := tests.error_as(v_admin, format('select public.admin_draw_groups(%L)', v_t));
  assert v_error = 'teams_missing', 'needs 16, got ' || coalesce(v_error, 'no error');

  v_teams := tests.s10a_fill(v_t);
  -- Each registered team exactly once, four to a group.
  v_error := tests.error_as(v_admin, format('select public.admin_set_groups(%L, %L)', v_t,
    jsonb_build_object('A', to_jsonb(v_teams[1:4]), 'B', to_jsonb(v_teams[5:8]),
                       'C', to_jsonb(v_teams[9:12]), 'D', to_jsonb(v_teams[12:15]))));
  assert v_error = 'invalid_groups', 'a team twice refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_set_groups(%L, %L)', v_t,
    jsonb_build_object('A', to_jsonb(v_teams[1:4]), 'B', to_jsonb(v_teams[5:8]),
                       'C', to_jsonb(v_teams[9:12]), 'D', to_jsonb(v_teams[13:15] || v_late))));
  assert v_error = 'invalid_groups', 'an unregistered team refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_set_groups(%L, %L)', v_t,
    jsonb_build_object('A', to_jsonb(v_teams[1:5]), 'B', to_jsonb(v_teams[6:8]),
                       'C', to_jsonb(v_teams[9:12]), 'D', to_jsonb(v_teams[13:16]))));
  assert v_error = 'invalid_groups', 'four to a group, got ' || coalesce(v_error, 'no error');

  v_error := tests.s10a_set_groups(v_admin, v_t, v_teams);
  assert v_error is null, 'groups set, got ' || coalesce(v_error, '');
  assert (select status from public.tournaments where id = v_t) = 'groups', 'group stage';
  assert (select count(*) from public.tournament_fixtures where tournament_id = v_t and stage = 'group') = 24,
    '24 group fixtures';
  assert not exists (
    select 1 from public.tournament_teams tt
    where tt.tournament_id = v_t
      and (select count(*) from public.tournament_fixtures f
           where f.tournament_id = v_t and f.stage = 'group' and tt.team_id in (f.home_team_id, f.away_team_id)
             and f.group_letter = tt.group_letter) <> 3), 'every team plays 3, in its own group';
  assert (select count(distinct (least(home_team_id::text, away_team_id::text), greatest(home_team_id::text, away_team_id::text)))
          from public.tournament_fixtures where tournament_id = v_t and stage = 'group') = 24, 'each pair once';
  assert tests.s10a_placed(v_t, 'A', 1) = v_teams[1] and tests.s10a_placed(v_t, 'D', 4) = v_teams[16], 'placed in order';
  -- The knockout slots exist, teams not known yet.
  assert (select array_agg(slot order by slot) from public.tournament_fixtures where tournament_id = v_t and stage <> 'group')
         = array['F', 'QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2'], 'QF1–4, SF1–2 and the final';
  assert not exists (select 1 from public.tournament_fixtures where tournament_id = v_t and stage <> 'group'
                     and (home_team_id is not null or away_team_id is not null)), 'knockout teams not set yet';

  -- Sign-up is over, and groups are set once.
  v_error := tests.s10a_register(v_t, v_late);
  assert v_error = 'registration_closed', 'no late team, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_set_groups(v_admin, v_t, v_teams);
  assert v_error = 'invalid_status', 'groups set once, got ' || coalesce(v_error, 'no error');

  -- 3 points a win, 1 a draw.
  perform tests.s10a_score(tests.s10a_fixture(v_t, v_teams[1], v_teams[2]), 2, 0);
  perform tests.s10a_score(tests.s10a_fixture(v_t, v_teams[3], v_teams[4]), 1, 1);
  assert (select array_agg(points order by team_id) from public.tournament_group_standings(v_t, 'A') s
          where s.team_id = any (v_teams[1:4]))
         = (select array_agg(x.p order by x.t) from (values (v_teams[1], 3), (v_teams[2], 0), (v_teams[3], 1), (v_teams[4], 1)) x(t, p)),
         '3, 0, 1, 1';
  assert (select (played, won, drawn, lost, goals_for, goals_against, goal_diff)
          from public.tournament_group_standings(v_t, 'A') s where s.team_id = v_teams[1]) = (1, 1, 0, 0, 2, 0, 2),
         'counts';

  -- A draw: random, four of four, the same fixtures.
  v_dteams := tests.s10a_fill(v_d);
  perform tests.act_as(v_admin);
  v_groups := public.admin_draw_groups(v_d);
  perform tests.act_as_postgres();
  assert (select array_agg(k order by k) from jsonb_object_keys(v_groups) k) = array['A', 'B', 'C', 'D'], 'four groups';
  assert (select count(*) from public.tournament_teams where tournament_id = v_d and group_letter is not null) = 16,
    'every team drawn';
  assert (select bool_and(n = 4) from (select count(*) as n from public.tournament_teams where tournament_id = v_d
                                      group by group_letter) g), 'four in each';
  assert (select count(*) from public.tournament_fixtures where tournament_id = v_d and stage = 'group') = 24, '24 fixtures';
end $$;

rollback;
