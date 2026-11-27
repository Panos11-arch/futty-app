-- S10A: semi-finals changed (decided by Anghelo and Panos, 24 November):
-- SF1 = winner QF1 v winner QF3; SF2 = winner QF2 v winner QF4, so a
-- group's two teams can only meet in the final. Then the final; closing
-- records the champion (match-record.md decision 1o).
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-6-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  v_error text;
  g text;
  v_half1 uuid[];
  v_half2 uuid[];
begin
  perform tests.s10a_play_groups(v_admin, v_t);

  -- A group's top two are in different halves (QF1 + QF3 v QF2 + QF4).
  select array_agg(x) into v_half1 from public.tournament_fixtures f,
    lateral unnest(array[f.home_team_id, f.away_team_id]) x where f.tournament_id = v_t and f.slot in ('QF1', 'QF3');
  select array_agg(x) into v_half2 from public.tournament_fixtures f,
    lateral unnest(array[f.home_team_id, f.away_team_id]) x where f.tournament_id = v_t and f.slot in ('QF2', 'QF4');
  foreach g in array array['A', 'B', 'C', 'D'] loop
    assert (tests.s10a_placed(v_t, g, 1) = any (v_half1)) <> (tests.s10a_placed(v_t, g, 2) = any (v_half1)),
      'group ' || g || '''s top two in different halves';
  end loop;

  -- QF1: A1 wins; QF2: B1 wins (away); QF3: 2–2, B2 wins 4–3 on penalties; QF4: C2 wins.
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF1'), 1, 0);
  assert v_error is null, 'QF1, got ' || coalesce(v_error, '');
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF2'), 0, 1);
  assert v_error is null, 'QF2, got ' || coalesce(v_error, '');
  -- SF1 needs QF3 too.
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'SF1')
         = (v_teams[1], null::uuid), 'SF1 home = winner QF1, away waits for QF3';
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF3'), 2, 2, 4, 3);
  assert v_error is null, 'QF3, got ' || coalesce(v_error, '');
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF4'), 3, 1);
  assert v_error is null, 'QF4, got ' || coalesce(v_error, '');

  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'SF1')
         = (v_teams[1], v_teams[6]), 'SF1 = winner QF1 (A1) v winner QF3 (B2, on penalties)';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'SF2')
         = (v_teams[5], v_teams[10]), 'SF2 = winner QF2 (B1) v winner QF4 (C2)';
  -- B1 and B2 are in different semi-finals: they can only meet in the final.

  -- Not closed before the final.
  v_error := tests.error_as(v_admin, format('select public.admin_close_tournament(%L)', v_t));
  assert v_error = 'final_not_played', 'needs the final, got ' || coalesce(v_error, 'no error');

  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'SF1'), 0, 2);
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'SF2'), 1, 0);
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'F')
         = (v_teams[6], v_teams[5]), 'final = winner SF1 v winner SF2: B2 v B1';
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'F'), 1, 1, 5, 6);
  assert v_error is null, 'final, got ' || coalesce(v_error, '');

  v_error := tests.error_as(v_admin, format('select public.admin_close_tournament(%L)', v_t));
  assert v_error is null, 'closed, got ' || coalesce(v_error, '');
  assert (select (status, champion_team_id) from public.tournaments where id = v_t) = ('finished'::text, v_teams[5]),
    'finished, B1 champion on penalties';
end $$;

rollback;
