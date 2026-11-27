-- S10A: the quarter-finals are fixed, never random: QF1 = A1 v D2, QF2 =
-- A2 v B1, QF3 = B2 v C1, QF4 = C2 v D1 (match-record.md decision 1o).
-- They follow the final tables, and a correction refills them while the
-- quarter-final isn't played.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-5-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  v_error text;
begin
  -- Before every group game is played, nothing is filled.
  perform tests.s10a_result(v_admin, tests.s10a_fixture(v_t, v_teams[1], v_teams[2]), 1, 0);
  assert (select status from public.tournaments where id = v_t) = 'groups', 'still groups';
  assert (select home_team_id from public.tournament_fixtures where tournament_id = v_t and slot = 'QF1') is null,
    'QF1 waits';

  -- Each group finishes in placing order: A = teams 1–4, B = 5–8, C = 9–12, D = 13–16.
  perform tests.s10a_play_groups(v_admin, v_t);
  assert (select status from public.tournaments where id = v_t) = 'knockout', 'knockout';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'QF1')
         = (v_teams[1], v_teams[14]), 'QF1 = A1 v D2';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'QF2')
         = (v_teams[2], v_teams[5]), 'QF2 = A2 v B1';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'QF3')
         = (v_teams[6], v_teams[9]), 'QF3 = B2 v C1';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'QF4')
         = (v_teams[10], v_teams[13]), 'QF4 = C2 v D1';
  assert not exists (select 1 from public.tournament_fixtures where tournament_id = v_t and stage in ('sf', 'final')
                     and (home_team_id is not null or away_team_id is not null)), 'semis and final wait';

  -- A correction that changes group A's order refills QF1 and QF2 (not played yet).
  v_error := tests.s10a_result(v_admin, tests.s10a_fixture(v_t, v_teams[1], v_teams[2]), 0, 3);
  assert v_error is null, 'corrected, got ' || coalesce(v_error, '');
  assert (tests.s10a_order(v_t, 'A'))[1:2] = array[v_teams[2], v_teams[1]], 'A2 tops A now';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'QF1')
         = (v_teams[2], v_teams[14]), 'QF1 = the new A1 v D2';
  assert (select (home_team_id, away_team_id) from public.tournament_fixtures where tournament_id = v_t and slot = 'QF2')
         = (v_teams[1], v_teams[5]), 'QF2 = the new A2 v B1';
  -- Never random: entering the same results again changes nothing.
  v_error := tests.s10a_result(v_admin, tests.s10a_fixture(v_t, v_teams[5], v_teams[6]), 1, 0);
  assert (select array_agg((home_team_id, away_team_id)::text order by slot) from public.tournament_fixtures
          where tournament_id = v_t and stage = 'qf')
         = array[(v_teams[2], v_teams[14])::text, (v_teams[1], v_teams[5])::text,
                 (v_teams[6], v_teams[9])::text, (v_teams[10], v_teams[13])::text], 'same pairs';
end $$;

rollback;
