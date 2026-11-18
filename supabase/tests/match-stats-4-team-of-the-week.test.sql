-- A7a (docs/specs/match-record.md section 7, decision 1g.4, agreed 18
-- November): one team of the week for all of Futty.
--   From Monday 09:00 Cyprus time, once per week, from every confirmed match
--   of the week before. Points per match by position (no position counts as
--   a midfielder): forward 3 per goal, 2 per assist; midfielder 3 per assist,
--   2 per goal, 1 if their side scored 3 or more; defender 4 for a clean
--   sheet, 2 per goal, 1 per assist, 1 if they conceded 1 or fewer; keeper 5
--   for a clean sheet, 2 if they conceded 1 or fewer; everyone 1 for a win
--   and 3 for man of the match. A forfeit is 3-0; the side that forfeited
--   gets nothing. Score = average points per game. Team: the best keeper,
--   defender, midfielder and forward, then the best other non-keeper. Ties:
--   men of the match, then average rating, then goals.
begin;

create function tests.a7_tick(p_now timestamptz)
returns integer
language plpgsql
as $$
declare
  v integer;
begin
  perform tests.act_as_service_role();
  v := public.team_of_the_week_tick(p_now);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- p_profile plays p_match on p_side, checked in (or only holding a spot), at p_position.
create function tests.a7_play(p_match uuid, p_profile uuid, p_side text, p_position text, p_checked_in boolean default true)
returns void
language plpgsql
as $$
begin
  perform tests.form_player(p_match, p_profile, p_side, true, p_checked_in);
  update public.match_players set position = p_position where match_id = p_match and profile_id = p_profile;
end;
$$;

create function tests.a7_goal(p_match uuid, p_scorer uuid, p_assist uuid default null)
returns void
language sql
as $$
  insert into public.match_goals (match_id, side, sort, scorer_player_id, assist_player_id, entered_by)
  select p_match, mp.side, (select count(*) + 1 from public.match_goals g where g.match_id = p_match), mp.id,
         case when p_assist is not null then tests.player_id(p_match, p_assist) end, p_scorer
  from public.match_players mp where mp.match_id = p_match and mp.profile_id = p_scorer;
$$;

do $$
declare
  -- The week of Monday 2 March 2026 (Cyprus is UTC+2 then), far from the
  -- seed's own games.
  v_week date := '2026-03-02';
  k uuid := tests.create_user('a7t-k@futty.test');
  k2 uuid := tests.create_user('a7t-k2@futty.test');
  k3 uuid := tests.create_user('a7t-k3@futty.test');
  x uuid := tests.create_user('a7t-x@futty.test');
  d uuid := tests.create_user('a7t-d@futty.test');
  d2 uuid := tests.create_user('a7t-d2@futty.test');
  m uuid := tests.create_user('a7t-m@futty.test');
  o uuid := tests.create_user('a7t-o@futty.test');
  f uuid := tests.create_user('a7t-f@futty.test');
  f2 uuid := tests.create_user('a7t-f2@futty.test');
  late uuid := tests.create_user('a7t-late@futty.test');
  z uuid := tests.create_user('a7t-z@futty.test');
  m1 uuid := tests.form_match('2026-03-02 18:00+00', 'confirmed', 3, 0);
  m2 uuid := tests.form_match('2026-03-04 18:00+00', 'confirmed', 1, 2);
  -- m3: side b forfeits; Saturday.
  m3 uuid := tests.form_match('2026-03-07 18:00+00', 'confirmed', null, null, tests.create_team('A7T A'),
                              tests.create_team('A7T B'), 'b', 'pulled_out');
  -- m4: Monday 00:00 in Cyprus, next week. m5: disputed.
  m4 uuid := tests.form_match('2026-03-08 22:00+00', 'confirmed', 5, 0);
  m5 uuid := tests.form_match('2026-03-05 18:00+00', 'disputed', 9, 0);
  v_team public.team_of_the_week;
  v_players text[];
  i integer;
  v_rater uuid;
begin
  -- m1, a 3-0 win: F scores twice (one set up by M); O (no position) scores, set up by M; F is man of the match.
  perform tests.a7_play(m1, k, 'a', 'gk');
  perform tests.a7_play(m1, d, 'a', 'd1');
  perform tests.a7_play(m1, m, 'a', 'm1');
  perform tests.a7_play(m1, f, 'a', 'f1');
  perform tests.a7_play(m1, o, 'a', null);
  perform tests.a7_play(m1, k2, 'b', 'gk');
  perform tests.a7_goal(m1, f);
  perform tests.a7_goal(m1, f, m);
  perform tests.a7_goal(m1, o, m);
  insert into public.motm_votes (match_id, voter_profile_id, nominee_player_id)
  values (m1, k2, tests.player_id(m1, f)), (m1, k, tests.player_id(m1, f));
  -- K has a match rating of 7.
  for i in 1..3 loop
    v_rater := tests.create_user(format('a7t-r%s@futty.test', i));
    insert into public.match_ratings (match_id, rater_profile_id, rated_player_id, score)
    values (m1, v_rater, tests.player_id(m1, k), 7);
  end loop;
  -- m2, side a loses 1-2: F2 scores; D2 concedes 2; D plays for side b (a 2-1 win, conceded 1).
  perform tests.a7_play(m2, d2, 'a', 'd1');
  perform tests.a7_play(m2, f2, 'a', 'f1');
  perform tests.a7_play(m2, d, 'b', 'd1');
  perform tests.a7_goal(m2, f2);
  -- m3, a forfeit: K3 held a spot on the winning side (counts, 1b.3); X on the side that forfeited.
  perform tests.a7_play(m3, k3, 'a', 'gk', false);
  perform tests.a7_play(m3, x, 'b', 'gk', false);
  -- m4 (next week) and m5 (disputed) never count.
  perform tests.a7_play(m4, late, 'a', 'f1');
  perform tests.a7_goal(m4, late);
  perform tests.a7_play(m5, z, 'a', 'f1');
  perform tests.a7_goal(m5, z);

  -- 1. Points per match.
  perform tests.act_as_service_role();
  assert (select array_agg(format('%s:%s', p.position_group, p.points) order by p.points desc, p.position_group)
          from public.team_of_the_week_points p where p.match_id = m1 and p.profile_id <> k2)
         = array['fwd:10', 'gk:8', 'mid:8', 'def:6', 'mid:4'],
    format('m1: F 6+1+3, K 5+2+1, M 6+1+1, D 4+1+1, O (a midfielder) 2+1+1, got %s',
           (select array_agg(format('%s:%s', p.position_group, p.points) order by p.points desc, p.position_group)
            from public.team_of_the_week_points p where p.match_id = m1 and p.profile_id <> k2));
  assert (select points from public.team_of_the_week_points where match_id = m1 and profile_id = k2) = 0, 'K2 conceded 3 and lost';
  assert (select points from public.team_of_the_week_points where match_id = m2 and profile_id = d) = 2, 'D: conceded 1, won';
  assert (select points from public.team_of_the_week_points where match_id = m2 and profile_id = d2) = 0, 'D2: conceded 2, lost';
  assert (select points from public.team_of_the_week_points where match_id = m3 and profile_id = k3) = 8,
    'K3: a forfeit is a 3-0 win: clean sheet 5 + 2 + win 1';
  assert (select points from public.team_of_the_week_points where match_id = m3 and profile_id = x) = 0, 'X forfeited: nothing';
  perform tests.act_as_postgres();

  -- 2. Not before 09:00 on Monday.
  assert tests.a7_tick('2026-03-09 06:59+00') = 0, '08:59 Monday: not yet';
  assert not exists (select 1 from public.team_of_the_week_runs where week_start = v_week), 'no run yet';

  -- 3. Monday 09:00: one team.
  assert tests.a7_tick('2026-03-09 07:00+00') = 1, 'one team';
  select * into v_team from public.team_of_the_week where week_start = v_week;
  assert v_team.matches = 3, format('m1, m2, m3 (not m4 next week, not the disputed m5), got %s', v_team.matches);
  select array_agg(format('%s:%s:%s', p.sort, p.position_group, p.profile_id) order by p.sort) into v_players
  from public.team_of_the_week_players p where p.team_of_the_week_id = v_team.id;
  assert v_players = array[format('1:gk:%s', k), format('2:def:%s', d), format('3:mid:%s', m), format('4:fwd:%s', f),
                           format('5:mid:%s', o)],
    format('K (8, rated 7) over K3 (8, no rating); D (6 + 2 over 2 games = 4); M (8); F (10); then O (4) over F2 (3), got %s',
           v_players);
  assert (select (average_points, games, clean_sheets) from public.team_of_the_week_players
          where team_of_the_week_id = v_team.id and profile_id = d) = (4.00, 2, 1), 'D: average per game';
  assert (select (goals, assists, motm) from public.team_of_the_week_players
          where team_of_the_week_id = v_team.id and profile_id = f) = (2, 0, 1), 'F''s week';
  assert (select average_rating from public.team_of_the_week_players
          where team_of_the_week_id = v_team.id and profile_id = k) = 7.00, 'K''s rating';

  -- 4. Notifications, once each.
  assert tests.notified(k, 'team_of_the_week') = 1 and tests.notified(o, 'team_of_the_week') = 1, 'picked: told';
  assert tests.notified(k3, 'team_of_the_week') = 0 and tests.notified(late, 'team_of_the_week') = 0
         and tests.notified(z, 'team_of_the_week') = 0, 'not picked';
  assert (tests.last_notification(f, 'team_of_the_week')).body = 'You''re in Futty''s team of the week.', 'the words';

  -- 5. Once per week.
  assert tests.a7_tick('2026-03-09 07:15+00') = 0, 'again on Monday: nothing';
  assert tests.a7_tick('2026-03-11 12:00+00') = 0, 'Wednesday: nothing';
  assert tests.notified(k, 'team_of_the_week') = 1, 'no second notification';

  -- 6. The next week: m4's scorer alone, as a forward.
  assert tests.a7_tick('2026-03-16 07:00+00') = 1, 'the week of 9 March';
  assert (select array_agg(p.profile_id) from public.team_of_the_week_players p
          join public.team_of_the_week t on t.id = p.team_of_the_week_id where t.week_start = '2026-03-09') = array[late],
    'late, alone';

  -- 7. A week with no confirmed match: a run, no team.
  assert tests.a7_tick('2026-02-23 07:00+00') = 0, 'the week of 16 February: no team';
  assert exists (select 1 from public.team_of_the_week_runs where week_start = '2026-02-16'), 'but it ran';
  assert not exists (select 1 from public.team_of_the_week where week_start = '2026-02-16'), 'no empty team';

  -- 8. match_jobs_tick runs it.
  perform tests.act_as_service_role();
  assert public.match_jobs_tick() ? 'team_of_the_week', 'counted by match_jobs_tick';
  perform tests.act_as_postgres();
end $$;

rollback;
