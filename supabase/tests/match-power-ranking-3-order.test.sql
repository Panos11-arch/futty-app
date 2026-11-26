-- S14b power ranking (match-record.md decision 1m): games apply in kickoff
-- order, once each; a game that becomes final late, or a corrected result,
-- recalculates from that game on; formats are kept apart; a fixture with no
-- time kicks off at 00:00 Cyprus time on its day (no day: when it was
-- created); a deleted team drops out and its opponents are recalculated.
begin;

-- Kickoff order when an earlier game becomes final later; a correction
-- recalculates that game and every later one; the job is idempotent.
do $$
declare
  a uuid := tests.create_team('PR3 A');
  b uuid := tests.create_team('PR3 B');
  c uuid := tests.create_team('PR3 C');
  v_late uuid;
  v_g1 uuid;
  v_g3 uuid;
  v_rows integer;
  v_sum numeric;
begin
  -- g1 (10 days ago, final) is applied first.
  v_g1 := tests.pr_match(a, b, 1, 0, now() - interval '10 days');
  -- An earlier game (12 days ago) whose score check is still open.
  v_late := tests.pr_match(a, c, 1, 0, now() - interval '12 days');
  update public.matches set score_check = 'pending', score_check_since = now() - interval '1 hour' where id = v_late;
  perform tests.pr_tick();
  assert tests.pr_rows(v_late) = 0 and (tests.pr_row(v_g1, a)).points_before = 1000, 'g1 applied alone';

  -- The earlier game becomes final: it goes first and g1 is redone after it.
  update public.matches set score_check_since = now() - interval '25 hours' where id = v_late;
  perform tests.pr_tick();
  assert (tests.pr_row(v_late, a)).points_after = 1010, 'the earlier game first: +10';
  assert (tests.pr_row(v_g1, a)).points_before = 1010, 'g1 redone from 1010';
  assert round((tests.pr_row(v_g1, a)).change, 3) = round(20 * (1 - 1 / (power(10::numeric, -10 / 600.0) + 1)), 3),
    format('g1 with a 10-point lead: %s', (tests.pr_row(v_g1, a)).change);
  assert (tests.pr_row(v_g1, a)).seq > (tests.pr_row(v_late, a)).seq, 'applied in kickoff order';

  -- Idempotent: a second run changes nothing.
  select count(*), sum(points_after) into v_rows, v_sum from public.power_ranking_history;
  assert tests.pr_tick() = 0, 'nothing to do';
  assert (select count(*) from public.power_ranking_history) = v_rows
         and (select sum(points_after) from public.power_ranking_history) = v_sum, 'unchanged';

  -- A later game, then g1's result is corrected (a service_role correction).
  v_g3 := tests.pr_match(a, b, 2, 2, now() - interval '5 days');
  perform tests.pr_tick();
  assert (tests.pr_row(v_g3, b)).points_before = (tests.pr_row(v_g1, b)).points_after, 'g3 follows g1';
  update public.matches set side_a_score = 0, side_b_score = 3 where id = v_g1;
  assert (select count(*) from public.power_ranking_dirty) > 0, 'the correction is queued';
  perform tests.pr_tick();
  assert (tests.pr_row(v_g1, a)).result = 'L' and (tests.pr_row(v_g1, b)).result = 'W', 'g1 recalculated';
  assert (tests.pr_row(v_g3, b)).points_before = (tests.pr_row(v_g1, b)).points_after
         and (tests.pr_row(v_g3, b)).points_before > 1000, 'g3 recalculated from the corrected g1';
  assert tests.pr_points(a) = (tests.pr_row(v_g3, a)).points_after, 'current points follow the replay';
  assert (select count(*) from public.power_ranking_dirty) = 0, 'queue drained';

  -- A corrected game that stops counting (now disputed) drops out.
  update public.matches set status = 'disputed' where id = v_g1;
  perform tests.pr_tick();
  assert tests.pr_rows(v_g1) = 0, 'disputed after all: removed';
  assert (tests.pr_row(v_g3, b)).points_before = 1000, 'g3 recalculated without g1';
end $$;

-- A corrected league fixture recalculates from it on.
do $$
declare
  v_league uuid := tests.pr_league('7-a-side');
  e uuid := tests.create_team('PR3 E');
  f uuid := tests.create_team('PR3 F');
  v_first uuid;
  v_second uuid;
begin
  v_first := tests.pr_fixture(v_league, e, f, 2, 0, current_date - 20);
  v_second := tests.pr_fixture(tests.pr_league('7-a-side'), e, f, 0, 0, current_date - 13);
  perform tests.pr_tick();
  assert (tests.pr_row(v_second, e)).points_before = 1020, 'second follows the first';

  update public.league_fixtures set home_score = 0, away_score = 2 where id = v_first;
  perform tests.pr_tick();
  assert (tests.pr_row(v_first, e)).change = -20, 'first recalculated';
  assert (tests.pr_row(v_second, e)).points_before = 980, 'second recalculated from it';
end $$;

-- Formats are kept apart.
do $$
declare
  a uuid := tests.create_team('PR3 FA');
  b uuid := tests.create_team('PR3 FB');
  v_five uuid;
  v_seven uuid;
begin
  v_five := tests.pr_match(a, b, 1, 0, now() - interval '9 days', '5-a-side');
  v_seven := tests.pr_match(a, b, 0, 1, now() - interval '8 days', '7-a-side');
  perform tests.pr_tick();
  assert tests.pr_points(a, '5-a-side') = 1010 and tests.pr_points(b, '5-a-side') = 990, '5-a-side';
  assert tests.pr_points(a, '7-a-side') = 990 and tests.pr_points(b, '7-a-side') = 1010, '7-a-side apart';
  assert (tests.pr_row(v_seven, a)).points_before = 1000, '7-a-side starts at 1000';
  assert tests.pr_points(a, '11-a-side') = 1000, 'no 11-a-side games: 1000';
end $$;

-- A fixture with no time kicks off at 00:00 Cyprus time on its day; with
-- no day, when it was created. The order holds.
do $$
declare
  v_league uuid := tests.pr_league('9-a-side');
  e uuid := tests.create_team('PR3 NE');
  f uuid := tests.create_team('PR3 NF');
  g uuid := tests.create_team('PR3 NG');
  v_day date := current_date - 30;
  v_evening uuid;
  v_no_time uuid;
  v_no_day uuid;
begin
  v_evening := tests.pr_fixture(v_league, e, g, 1, 0, v_day, '20:00');
  v_no_time := tests.pr_fixture(v_league, e, f, 1, 0, v_day, null);
  v_no_day := tests.pr_fixture(tests.pr_league('9-a-side'), e, f, 1, 0, null, null);
  update public.league_fixtures set created_at = now() - interval '2 days' where id = v_no_day;
  perform tests.pr_tick();

  assert (tests.pr_row(v_no_time, e)).kickoff_at = (v_day::timestamp at time zone 'Asia/Nicosia'),
    format('no time: 00:00 Cyprus time, got %s', (tests.pr_row(v_no_time, e)).kickoff_at);
  assert (tests.pr_row(v_no_time, e)).points_before = 1000
         and (tests.pr_row(v_evening, e)).points_before = 1020, 'the 00:00 game goes before the 20:00 one';
  assert (tests.pr_row(v_no_day, e)).kickoff_at = now() - interval '2 days', 'no day: when it was created';
  assert (tests.pr_row(v_no_day, e)).points_before = (tests.pr_row(v_evening, e)).points_after, 'and goes last';
end $$;

-- A deleted team: its games have to go first (foreign keys), and then it
-- drops out; its opponents are recalculated without it, and nothing breaks.
do $$
declare
  x uuid := tests.create_team('PR3 X');
  y uuid := tests.create_team('PR3 Y');
  z uuid := tests.create_team('PR3 Z');
  v_xy uuid;
  v_yz uuid;
  v_error text;
begin
  v_xy := tests.pr_match(x, y, 0, 3, now() - interval '20 days');
  v_yz := tests.pr_match(y, z, 1, 1, now() - interval '10 days');
  perform tests.pr_tick();
  assert (tests.pr_row(v_yz, y)).points_before = 1010, 'y won against x first';

  -- A team with games can't be deleted.
  v_error := tests.error_of(format('delete from public.teams where id = %L', x));
  assert v_error like '%violates foreign key constraint%', format('team with games: %s', v_error);

  -- Its game removed, then the team.
  delete from public.matches where id = v_xy;
  delete from public.teams where id = x;
  assert (select count(*) from public.power_ranking_history where team_id = x or opponent_team_id = x) = 0,
    'its history is gone';
  perform tests.pr_tick();
  assert (tests.pr_row(v_yz, y)).points_before = 1000, 'y recalculated without the deleted team';
  assert tests.pr_points(y) = 1000 and tests.pr_points(z) = 1000, 'draw between equals';
  assert tests.error_of(format('select * from public.power_ranking_list(%L, now())', '5-a-side')) is null,
    'the ranking still reads';
end $$;

rollback;
