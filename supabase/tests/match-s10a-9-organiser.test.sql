-- S10A: a mismatch the captains can't settle goes to the organiser, who
-- enters or corrects results in the admin screen (match-record.md decision
-- 1o). A correction that would change a team already through to a played
-- next round is refused.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-9-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  v_fixture uuid := tests.s10a_fixture(v_t, v_teams[1], v_teams[2]);
  v_match uuid;
  v_error text;
  v_cap1 uuid := tests.s10a_captain(v_teams[1]);
  v_cap2 uuid := tests.s10a_captain(v_teams[2]);
begin
  -- The captains can't agree: disputed, and the fixture stays open.
  v_match := tests.s10a_time(v_admin, v_fixture, now() - interval '2 hours');
  perform tests.dispute_result(
    (select captain_profile_id from public.match_sides where match_id = v_match and side = 'a'),
    (select captain_profile_id from public.match_sides where match_id = v_match and side = 'b'), v_match);
  assert (select status from public.matches where id = v_match) = 'disputed', 'disputed';
  update public.matches set result_deadline_at = now() - interval '1 minute' where id = v_match;
  perform tests.s10_final(v_match);
  assert (select status from public.tournament_fixtures where id = v_fixture) = 'scheduled', 'left open for the organiser';

  -- Only an admin decides.
  v_error := tests.s10a_result(v_cap1, v_fixture, 2, 1);
  assert v_error = 'not_admin', 'a captain cannot, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_result(v_admin, v_fixture, 2, 1);
  assert v_error is null, 'decided, got ' || coalesce(v_error, '');
  assert (select (status, home_score, away_score, decided_by) from public.tournament_fixtures where id = v_fixture)
         = ('completed'::text, 2, 1, 'organiser'::text), 'fixture completed by the organiser';
  assert (select (status, confirmed_via, side_a_score, side_b_score) from public.matches where id = v_match)
         = ('confirmed'::text, 'organiser'::text, 2, 1), 'the match follows';

  -- Correcting it.
  v_error := tests.s10a_result(v_admin, v_fixture, 1, 0);
  assert v_error is null, 'corrected, got ' || coalesce(v_error, '');
  assert (select (home_score, away_score) from public.tournament_fixtures where id = v_fixture) = (1, 0), 'corrected';
  assert (select (side_a_score, side_b_score) from public.matches where id = v_match) = (1, 0), 'the match too';

  -- Scores and shootouts are checked as for captains.
  v_error := tests.s10a_result(v_admin, v_fixture, -1, 0);
  assert v_error = 'invalid_score', 'no negatives, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_result(v_admin, v_fixture, 1, 1, 4, 3);
  assert v_error = 'shootout_not_allowed', 'no pens in the groups, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF1'), 1, 0);
  assert v_error = 'teams_not_set', 'a quarter-final without teams, got ' || coalesce(v_error, 'no error');

  perform tests.s10a_play_groups(v_admin, v_t);
  -- After the 1–0 correction A still finishes in placing order (team 1 wins its other two).
  assert (select home_team_id from public.tournament_fixtures where id = tests.s10a_slot(v_t, 'QF1')) = v_teams[1], 'A1';
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF1'), 2, 2);
  assert v_error = 'shootout_required', 'a level knockout needs pens, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF1'), 2, 2, 5, 3);
  assert v_error = 'invalid_shootout', '5–3 refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF1'), 2, 0);
  assert v_error is null, 'QF1 played, got ' || coalesce(v_error, '');

  -- A group correction that would change QF1's teams: refused.
  v_error := tests.s10a_result(v_admin, v_fixture, 0, 5);
  assert v_error = 'next_round_played', 'QF1 already played, got ' || coalesce(v_error, 'no error');
  assert (select (home_score, away_score) from public.tournament_fixtures where id = v_fixture) = (1, 0), 'unchanged';
  -- One that changes nothing for the knockout is fine.
  v_error := tests.s10a_result(v_admin, tests.s10a_fixture(v_t, v_teams[3], v_teams[4]), 2, 0);
  assert v_error is null, 'a harmless correction, got ' || coalesce(v_error, '');
  -- Correcting QF1's winner after SF1 is played is refused too.
  perform tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF3'), 1, 0);
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'SF1'), 1, 0);
  assert v_error is null, 'SF1 played, got ' || coalesce(v_error, '');
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF1'), 0, 2);
  assert v_error = 'next_round_played', 'SF1 played, got ' || coalesce(v_error, 'no error');
  -- A captain logging a next-round match counts as played too.
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF2'), 1, 0);
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF4'), 1, 0);
  v_match := tests.s10a_time(v_admin, tests.s10a_slot(v_t, 'SF2'), now() - interval '2 hours');
  perform tests.s10a_log(tests.s10a_captain((select home_team_id from public.tournament_fixtures
                                             where id = tests.s10a_slot(v_t, 'SF2'))), v_match, 1, 0);
  v_error := tests.s10a_result(v_admin, tests.s10a_slot(v_t, 'QF2'), 0, 1);
  assert v_error = 'next_round_played', 'SF2 logged, got ' || coalesce(v_error, 'no error');
end $$;

rollback;
