-- A11 streaks (match-record decision 1i): weeks, Cyprus week boundaries,
-- missed weeks, the week in progress and which matches count.
--
-- Dates are in January and February 2026, when Cyprus is UTC+2. Mondays:
-- 5, 12, 19 and 26 January, 2 and 9 February.
begin;

-- A confirmed 1-0 pickup at p_kickoff that counts for p_profile (checked in).
create function tests.s_play(p_profile uuid, p_kickoff timestamptz)
returns uuid language plpgsql as $$
declare
  v_match uuid := tests.form_match(p_kickoff, 'confirmed', 1, 0);
begin
  perform tests.form_player(v_match, p_profile, 'a', true, true);
  return v_match;
end;
$$;

-- p_profile's streak at p_now, as "current/best".
create function tests.s_streak(p_profile uuid, p_now timestamptz)
returns text language plpgsql as $$
declare
  v text;
begin
  perform tests.act_as_service_role();
  select format('%s/%s', current_weeks, best_weeks) into v from public.player_streak(p_profile, p_now);
  perform tests.act_as_postgres();
  return v;
end;
$$;

do $$
declare
  v_none uuid := tests.create_user('s1-none@futty.test');
  v_edge uuid := tests.create_user('s1-edge@futty.test');
  v_one_miss uuid := tests.create_user('s1-one-miss@futty.test');
  v_two_miss uuid := tests.create_user('s1-two-miss@futty.test');
  v_restart uuid := tests.create_user('s1-restart@futty.test');
  v_now_week uuid := tests.create_user('s1-now-week@futty.test');
  v_count uuid := tests.create_user('s1-count@futty.test');
  v_other uuid := tests.create_user('s1-other@futty.test');
  v_match uuid;
begin
  assert tests.s_streak(v_none, '2026-01-20 10:00+00') = '0/0', 'no matches, no streak';

  -- The Cyprus week boundary: Sunday 23:30 Cyprus (21:30 UTC) is in the week
  -- of Monday 5 January; Monday 00:30 Cyprus (Sunday 22:30 UTC) is in the
  -- week of 12 January. Both are Sunday 11 January in UTC, so a UTC week
  -- would make this one week.
  perform tests.s_play(v_edge, '2026-01-11 21:30+00');
  perform tests.s_play(v_edge, '2026-01-11 22:30+00');
  assert tests.s_streak(v_edge, '2026-01-13 10:00+00') = '2/2', 'two Cyprus weeks, either side of midnight Sunday';

  -- One missed week is allowed and adds nothing: played 5 Jan, missed
  -- 12 Jan, played 19 Jan is a streak of 2.
  perform tests.s_play(v_one_miss, '2026-01-06 18:00+00');
  perform tests.s_play(v_one_miss, '2026-01-20 18:00+00');
  assert tests.s_streak(v_one_miss, '2026-01-21 10:00+00') = '2/2', 'one missed week keeps the streak';
  assert tests.s_streak(v_one_miss, '2026-01-27 10:00+00') = '2/2', 'a week in progress is not held against it';

  -- Two missed weeks in a row end it: played 5 and 12 Jan, missed 19 and
  -- 26 Jan. While 26 Jan is in progress only one week has been missed.
  perform tests.s_play(v_two_miss, '2026-01-06 18:00+00');
  perform tests.s_play(v_two_miss, '2026-01-13 18:00+00');
  assert tests.s_streak(v_two_miss, '2026-01-28 10:00+00') = '2/2', 'one miss so far, 26 Jan still in progress';
  assert tests.s_streak(v_two_miss, '2026-02-02 08:00+00') = '0/2', 'two missed weeks end the streak; best stays';

  -- A new streak after one ended starts from 1; the best is kept.
  perform tests.s_play(v_restart, '2026-01-06 18:00+00');
  perform tests.s_play(v_restart, '2026-01-13 18:00+00');
  perform tests.s_play(v_restart, '2026-01-20 18:00+00');
  perform tests.s_play(v_restart, '2026-02-10 18:00+00');
  assert tests.s_streak(v_restart, '2026-02-11 10:00+00') = '1/3', 'restarted at 1, best 3';

  -- The week in progress counts as soon as a match in it counts.
  perform tests.s_play(v_now_week, '2026-01-06 18:00+00');
  assert tests.s_streak(v_now_week, '2026-01-12 10:00+00') = '1/1', 'before this week''s match';
  perform tests.s_play(v_now_week, '2026-01-13 18:00+00');
  assert tests.s_streak(v_now_week, '2026-01-14 10:00+00') = '2/2', 'this week''s match counts at once';
  assert tests.s_streak(v_now_week, '2026-01-12 10:00+00') = '1/1', 'a match after p_now does not count yet';

  -- Only counted matches count (1b.2, 1b.3): not without a check-in, not a
  -- disputed, no_result or void match, not after leaving; a forfeit counts
  -- for a spot holder without a check-in.
  v_match := tests.form_match('2026-01-06 18:00+00', 'confirmed', 2, 2);
  perform tests.form_player(v_match, v_count, 'a', true, false);
  v_match := tests.form_match('2026-01-13 18:00+00', 'disputed', 2, 1);
  perform tests.form_player(v_match, v_count, 'a', true, true);
  v_match := tests.form_match('2026-01-20 18:00+00', 'no_result');
  perform tests.form_player(v_match, v_count, 'a', true, true);
  v_match := tests.form_match('2026-01-27 18:00+00', 'void');
  perform tests.form_player(v_match, v_count, 'a', true, true);
  v_match := tests.form_match('2026-02-03 18:00+00', 'confirmed', 3, 0);
  perform tests.form_player(v_match, v_count, 'a', true, true, true);
  assert tests.s_streak(v_count, '2026-02-10 10:00+00') = '0/0', 'none of these count';
  v_match := tests.form_match('2026-02-10 18:00+00', 'confirmed', null, null, tests.create_team('S1 A'),
                              tests.create_team('S1 B'), 'b', 'pulled_out');
  perform tests.form_player(v_match, v_count, 'b', true, false);
  assert tests.s_streak(v_count, '2026-02-11 10:00+00') = '1/1', 'a forfeit counts for a spot holder';

  -- Another player's matches are not mine.
  assert tests.s_streak(v_other, '2026-02-11 10:00+00') = '0/0', 'nothing for someone else';
end $$;

rollback;
