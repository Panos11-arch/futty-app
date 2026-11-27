-- S10A: tournament games count in the power ranking: group K 40, knockout
-- K 50 (match-record.md decision 1m). Shootouts switched on (decided by
-- Panos, 25 November): a shootout winner scores W 0.75 and the loser 0.5.
-- The test S14b left out: between equal teams, a knockout shootout win is
-- +12.5 for the winner and 0 for the loser.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-10-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  v_a1 uuid := v_teams[1];
  v_a2 uuid := v_teams[2];
  v_qf3 uuid;
  v_home uuid;
  v_away uuid;
  v_group uuid;
  v_match uuid;
  v_error text;
  g text;
  f record;
begin
  assert (public.app_rules_now()).power_ranking_shootouts, 'shootout weighting on';

  -- Group A: A1 beats A2 1–0; every other A game, and every B, C and D game, is 0–0.
  v_group := tests.s10a_fixture(v_t, v_a1, v_a2);
  perform tests.s10a_result(v_admin, v_group, 1, 0);
  for f in select id from public.tournament_fixtures where tournament_id = v_t and stage = 'group' and status <> 'completed'
  loop
    perform tests.s10a_result(v_admin, f.id, 0, 0);
  end loop;
  -- Every group needs the organiser's draw: placing order.
  foreach g in array array['A', 'B', 'C', 'D'] loop
    v_error := tests.error_as(v_admin, format('select public.admin_set_draw_order(%L, %L, %L)', v_t, g,
      (select array_agg(team_id order by group_pos) from public.tournament_teams where tournament_id = v_t and group_letter = g)));
    assert v_error is null, 'draw ' || g || ', got ' || coalesce(v_error, '');
  end loop;
  assert (select status from public.tournaments where id = v_t) = 'knockout', 'knockout';

  -- QF3 = B2 v C1: both still on 1000 (only draws). 1–1, home wins 5–4 on penalties.
  v_qf3 := tests.s10a_slot(v_t, 'QF3');
  select home_team_id, away_team_id into v_home, v_away from public.tournament_fixtures where id = v_qf3;
  v_error := tests.s10a_result(v_admin, v_qf3, 1, 1, 5, 4);
  assert v_error is null, 'QF3, got ' || coalesce(v_error, '');

  perform tests.pr_tick(now() + interval '1 hour');

  -- The group win between equal teams: K 40, +20 and −20.
  assert (tests.pr_row(v_group, v_a1)).k = 40 and (tests.pr_row(v_group, v_a1)).category = 'tournament_group',
    'group K 40';
  assert (tests.pr_row(v_group, v_a1)).source = 'tournament_fixture', 'counted from the fixture';
  assert round((tests.pr_row(v_group, v_a1)).change, 2) = 20 and round((tests.pr_row(v_group, v_a2)).change, 2) = -20,
    'equal teams, group win +20 / −20';

  -- The knockout shootout between equal teams: +12.5 and 0.
  assert (tests.pr_row(v_qf3, v_home)).points_before = 1000 and (tests.pr_row(v_qf3, v_away)).points_before = 1000,
    'equal teams before QF3';
  assert (tests.pr_row(v_qf3, v_home)).k = 50 and (tests.pr_row(v_qf3, v_home)).category = 'tournament_knockout',
    'knockout K 50';
  assert (tests.pr_row(v_qf3, v_home)).w = 0.75 and (tests.pr_row(v_qf3, v_away)).w = 0.5, 'W 0.75 and 0.5';
  assert round((tests.pr_row(v_qf3, v_home)).change, 2) = 12.5, 'shootout winner +12.5, got '
    || (tests.pr_row(v_qf3, v_home)).change;
  assert round((tests.pr_row(v_qf3, v_away)).change, 2) = 0, 'shootout loser 0, got ' || (tests.pr_row(v_qf3, v_away)).change;
  assert (tests.pr_row(v_qf3, v_home)).points_after = 1012.5 and (tests.pr_row(v_qf3, v_away)).points_after = 1000,
    'points after: 1012.5 and 1000';

  -- With the weighting off, a shootout is a draw: 0 each.
  update public.app_rules set power_ranking_shootouts = false;
  perform tests.act_as_service_role();
  perform public.power_ranking_replay('5-a-side', '-infinity', now() + interval '1 hour');
  perform tests.act_as_postgres();
  assert round((tests.pr_row(v_qf3, v_home)).change, 2) = 0 and (tests.pr_row(v_qf3, v_home)).w = 0.5, 'off: a draw';
  update public.app_rules set power_ranking_shootouts = true;

  -- A tournament match counts once, through its fixture.
  -- QF4 kicks off after every other game here. The group games and QF3 have
  -- no kick-off time, so they count at completed_at, which is the same now()
  -- for all of them in this transaction; the replay then orders them by their
  -- random fixture ids. A QF4 before them (as it once was, at now() - 2 hours)
  -- gave its winner +25 first, and that team's later group draws moved points
  -- to its group-mates in a random order, so QF3's opponent was sometimes not
  -- on 1000 and the corrected win below wasn't exactly +25.
  v_match := tests.s10a_time(v_admin, tests.s10a_slot(v_t, 'QF4'), now() + interval '1 hour');
  perform tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF4'), 2, 0);
  perform tests.pr_tick(now() + interval '3 days');
  assert tests.pr_rows(v_match) = 0, 'not as a match';
  assert tests.pr_rows(tests.s10a_slot(v_t, 'QF4')) = 2, 'once, as the fixture';

  -- A correction replays it.
  perform tests.s10a_result(v_admin, v_qf3, 2, 1);
  perform tests.pr_tick(now() + interval '3 days');
  assert (tests.pr_row(v_qf3, v_home)).w = 1 and round((tests.pr_row(v_qf3, v_home)).change, 2) = 25,
    'corrected to a win: +25';
end $$;

rollback;
