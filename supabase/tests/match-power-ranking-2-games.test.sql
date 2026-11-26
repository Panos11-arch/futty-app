-- S14b power ranking (match-record.md decision 1m): which games count.
-- Only confirmed, competitive games between two registered Futty teams,
-- once final (the moment levels move); league fixtures between two
-- registered teams count at K 40. Pickups, one-team games, Friendly games,
-- forfeits, disputed, void and no-result games never count. A Rejected
-- score never counts; corrected and final, it does. A league fixture with
-- its own match row counts once.
begin;

do $$
declare
  v_kick timestamptz := now() - interval '10 days';
  a uuid := tests.create_team('PR2 A');
  b uuid := tests.create_team('PR2 B');
  c uuid := tests.create_team('PR2 C');
  d uuid := tests.create_team('PR2 D');
  v_counted uuid;
  v_pickup uuid;
  v_one_team uuid;
  v_friendly uuid;
  v_forfeit uuid;
  v_disputed uuid;
  v_void uuid;
  v_no_result uuid;
  v_recent uuid;
  v_rejected uuid;
  v_pending uuid;
  v_same_team uuid;
  v_row public.power_ranking_history;
begin
  -- Counted: two registered teams, competitive, confirmed, final.
  v_counted := tests.pr_match(a, b, 2, 1, v_kick);
  -- Never counted.
  v_pickup := tests.form_match(v_kick, 'confirmed', 3, 0);
  v_one_team := tests.form_match(v_kick, 'confirmed', 3, 0, c);
  update public.match_sides set team_id = c where match_id = v_one_team and side = 'a';
  v_friendly := tests.pr_match(c, d, 3, 0, v_kick);
  update public.matches set competitive = false where id = v_friendly;
  v_forfeit := tests.form_match(v_kick, 'confirmed', null, null, c, d, 'a', 'no_show');
  v_disputed := tests.form_match(v_kick, 'disputed', 3, 0, c, d);
  v_void := tests.form_match(v_kick, 'void', 3, 0, c, d);
  v_no_result := tests.form_match(v_kick, 'no_result', null, null, c, d);
  v_same_team := tests.pr_match(c, c, 3, 0, v_kick);
  -- Not final yet: confirmed within the last 24 hours.
  v_recent := tests.pr_match(c, d, 3, 0, now() - interval '3 hours');
  -- A lone captain's score: rejected, and pending within its 24 hours.
  v_rejected := tests.pr_match(c, d, 3, 0, v_kick);
  update public.matches set score_check = 'rejected', score_check_since = v_kick + interval '2 hours'
  where id = v_rejected;
  v_pending := tests.pr_match(c, d, 4, 0, v_kick);
  update public.matches set score_check = 'pending', score_check_since = now() - interval '1 hour' where id = v_pending;

  perform tests.pr_tick();

  assert tests.pr_rows(v_counted) = 2, 'a two-team competitive match counts';
  v_row := tests.pr_row(v_counted, a);
  assert v_row.category = 'non_league' and v_row.k = 20 and v_row.change = 10 and v_row.points_after = 1010
         and v_row.result = 'W' and v_row.opponent_team_id = b and v_row.goals_for = 2 and v_row.goals_against = 1
         and v_row.expected = 0.5 and v_row.source = 'match',
    format('winner: %s', v_row);
  assert tests.pr_points(b) = 990, 'loser -10';

  assert tests.pr_rows(v_pickup) = 0, 'pickup ignored';
  assert tests.pr_rows(v_one_team) = 0, 'one registered team ignored';
  assert tests.pr_rows(v_friendly) = 0, 'a game switched to Friendly counts for nothing';
  assert tests.pr_rows(v_forfeit) = 0, 'forfeit ignored';
  assert tests.pr_rows(v_disputed) = 0, 'disputed ignored';
  assert tests.pr_rows(v_void) = 0, 'void ignored';
  assert tests.pr_rows(v_no_result) = 0, 'no result ignored';
  assert tests.pr_rows(v_same_team) = 0, 'a team against itself ignored';
  assert tests.pr_rows(v_recent) = 0, 'not final yet';
  assert tests.pr_rows(v_rejected) = 0, 'a Rejected score never counts';
  assert tests.pr_rows(v_pending) = 0, 'a pending score check waits';
  assert tests.pr_points(c) = 1000 and tests.pr_points(d) = 1000, 'c and d untouched';

  -- 24 hours of silence count as accepted: the pending game counts.
  update public.matches set score_check_since = now() - interval '25 hours' where id = v_pending;
  -- The rejected score is corrected: the check opens again, then is accepted.
  update public.matches set side_a_score = 1, side_b_score = 1, score_check = 'pending',
                            score_check_since = now() - interval '2 hours'
  where id = v_rejected;
  perform tests.pr_tick();
  assert tests.pr_rows(v_pending) = 2, 'the pending check passed its 24 hours: counted';
  assert tests.pr_rows(v_rejected) = 0, 'corrected, but its new check is still open';
  update public.matches set score_check = 'accepted', score_check_at = now() where id = v_rejected;
  perform tests.pr_tick();
  assert tests.pr_rows(v_rejected) = 2, 'corrected and final: counted';
  assert (tests.pr_row(v_rejected, c)).result = 'D' and (tests.pr_row(v_rejected, c)).goals_for = 1,
    'with the corrected score';
end $$;

-- League fixtures: K 40 between two registered teams; forfeits, void and
-- one-team fixtures never count; a fixture with a match row counts once.
do $$
declare
  v_league uuid := tests.pr_league('5-a-side');
  e uuid := tests.create_team('PR2 E');
  f uuid := tests.create_team('PR2 F');
  g uuid := tests.create_team('PR2 G');
  v_fixture uuid;
  v_forfeit uuid;
  v_void uuid;
  v_one_team uuid;
  v_unfinished uuid;
  v_linked_fixture uuid;
  v_linked_match uuid;
  v_row public.power_ranking_history;
begin
  v_fixture := tests.pr_fixture(v_league, e, f, 2, 0, current_date - 20);
  v_forfeit := tests.pr_fixture(v_league, e, g, null, null, current_date - 19, '20:00', 'home_forfeited');
  v_void := tests.pr_fixture(v_league, f, g, null, null, current_date - 19, '20:00', 'void');
  v_one_team := tests.pr_fixture(v_league, e, null, 2, 0, current_date - 19);
  v_unfinished := tests.pr_fixture(tests.pr_league('5-a-side'), f, g, 2, 0, current_date - 19);
  update public.league_fixtures set status = 'agreed' where id = v_unfinished;

  -- The same league game as a fixture and as a match row (league_fixture_id).
  v_linked_fixture := tests.pr_fixture(tests.pr_league('5-a-side'), f, g, 1, 0, current_date - 15);
  v_linked_match := tests.pr_match(f, g, 1, 0, (current_date - 15 + time '20:00') at time zone 'Asia/Nicosia');
  update public.matches set league_fixture_id = v_linked_fixture where id = v_linked_match;

  perform tests.pr_tick();

  v_row := tests.pr_row(v_fixture, e);
  assert v_row.source = 'league_fixture' and v_row.category = 'league' and v_row.k = 40 and v_row.change = 20,
    format('league win +20: %s', v_row);
  assert (tests.pr_row(v_fixture, f)).change = -20, 'league loss -20';
  assert tests.pr_rows(v_forfeit) = 0, 'league forfeit ignored';
  assert tests.pr_rows(v_void) = 0, 'void fixture ignored';
  assert tests.pr_rows(v_one_team) = 0, 'one-team fixture ignored';
  assert tests.pr_rows(v_unfinished) = 0, 'fixture not completed: ignored';

  assert tests.pr_rows(v_linked_fixture) = 2 and tests.pr_rows(v_linked_match) = 0,
    'a league game with a match row counts once, as the fixture';
  assert (select count(*) from public.power_ranking_history where team_id = g) = 1, 'g: one game';
end $$;

rollback;
