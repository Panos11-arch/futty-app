-- A7a (docs/specs/match-record.md section 7, decision 1g.4): team of the week.
--   From Monday 09:00 Cyprus time, once per week, for the week Monday to
--   Sunday before: one team per venue with 4 or more confirmed matches, one
--   per city for the other venues' matches, one per league. Five players:
--   the best keeper, defender, midfielder and forward, then the best of the
--   rest (not keepers). Best = average match rating that week (each match
--   rating needs 3 ratings); ties go to more men of the match, then more
--   goals. Each player picked gets a team_of_the_week notification.
begin;

-- p_profile plays p_match on side a, checked in, at p_position, and is
-- rated p_score by three raters (or only twice when p_raters = 2).
create function tests.a7_totw_player(p_match uuid, p_profile uuid, p_position text, p_score integer,
                                     p_raters integer default 3)
returns void
language plpgsql
as $$
declare
  i integer;
begin
  perform tests.form_player(p_match, p_profile, 'a', true, true);
  update public.match_players set position = p_position where match_id = p_match and profile_id = p_profile;
  for i in 1..p_raters loop
    insert into public.match_ratings (match_id, rater_profile_id, rated_player_id, score)
    values (p_match, tests.create_user(format('a7t-r-%s@futty.test', left(gen_random_uuid()::text, 8))),
            tests.player_id(p_match, p_profile), p_score);
  end loop;
end;
$$;

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

do $$
declare
  -- The week of Monday 9 November 2026 (Cyprus is UTC+2 in November).
  v_monday date := '2026-11-09';
  v1 uuid := tests.create_venue();
  v2 uuid := tests.create_venue();
  k1 uuid := tests.create_user('a7t-k1@futty.test');
  k2 uuid := tests.create_user('a7t-k2@futty.test');
  d1 uuid := tests.create_user('a7t-d1@futty.test');
  d2 uuid := tests.create_user('a7t-d2@futty.test');
  mid uuid := tests.create_user('a7t-m1@futty.test');
  f1 uuid := tests.create_user('a7t-f1@futty.test');
  f2 uuid := tests.create_user('a7t-f2@futty.test');
  o1 uuid := tests.create_user('a7t-o1@futty.test');
  late uuid := tests.create_user('a7t-late@futty.test');
  g1 uuid := tests.create_user('a7t-g1@futty.test');
  g2 uuid := tests.create_user('a7t-g2@futty.test');
  few uuid := tests.create_user('a7t-few@futty.test');
  m1 uuid := tests.form_match('2026-11-09 18:00+00', 'confirmed', 2, 1, p_venue => v1);
  m2 uuid := tests.form_match('2026-11-11 18:00+00', 'confirmed', 2, 1, p_venue => v1);
  m3 uuid := tests.form_match('2026-11-13 18:00+00', 'confirmed', 2, 1, p_venue => v1);
  -- Sunday 23:30 in Cyprus: still this week.
  m4 uuid := tests.form_match('2026-11-15 21:30+00', 'confirmed', 2, 1, p_venue => v1);
  -- Monday 00:00 in Cyprus: next week.
  m5 uuid := tests.form_match('2026-11-15 22:00+00', 'confirmed', 2, 1, p_venue => v1);
  m6 uuid := tests.form_match('2026-11-12 18:00+00', 'confirmed', 1, 0, p_venue => v2);
  v_league uuid;
  v_fixture uuid;
  v_t public.team_of_the_week;
  v_players text[];
begin
  update public.venues set city = 'Nicosia' where id in (v1, v2);
  insert into public.leagues (format, scope, capacity, name) values ('5-a-side', 'city', 8, 'Nicosia 5s')
  returning id into v_league;
  insert into public.league_fixtures (league_id) values (v_league) returning id into v_fixture;
  update public.matches set league_fixture_id = v_fixture where id = m6;

  -- v1 (4 matches this week).
  perform tests.a7_totw_player(m1, k1, 'gk', 7);
  perform tests.a7_totw_player(m1, d1, 'd1', 8);
  perform tests.a7_totw_player(m1, f1, 'f1', 9);
  perform tests.a7_totw_player(m2, k2, 'gk', 6);
  perform tests.a7_totw_player(m2, d2, 'd2', 8);
  perform tests.a7_totw_player(m2, f2, 'f1', 9);
  perform tests.a7_totw_player(m3, mid, 'm1', 6);
  perform tests.a7_totw_player(m3, o1, null, 8);
  perform tests.a7_totw_player(m4, f2, 'f2', 8);
  perform tests.a7_totw_player(m5, late, 'f1', 10);
  -- d2 and d1 tie on 8.00: d2 was man of the match in m2.
  insert into public.motm_votes (match_id, voter_profile_id, nominee_player_id)
  values (m2, k2, tests.player_id(m2, d2));
  -- v2 (1 match): pooled into Nicosia. g1 and g2 tie on rating and awards;
  -- g1 scored. few has only 2 ratings.
  perform tests.a7_totw_player(m6, g1, null, 7);
  perform tests.a7_totw_player(m6, g2, null, 7);
  perform tests.a7_totw_player(m6, few, 'gk', 10, 2);
  insert into public.match_goals (match_id, side, sort, scorer_player_id, entered_by)
  values (m6, 'a', 1, tests.player_id(m6, g1), g1);

  -- 1. Not before 09:00 on Monday.
  assert tests.a7_tick('2026-11-16 06:59+00') = 0, '08:59 Monday: not yet';
  assert not exists (select 1 from public.team_of_the_week_runs where week_start = v_monday), 'no run yet';

  -- 2. Monday 09:00: v1, Nicosia (v2's match) and the league.
  assert tests.a7_tick('2026-11-16 07:00+00') = 3, 'three teams';
  assert (select teams from public.team_of_the_week_runs where week_start = v_monday) = 3, 'run recorded';

  select * into v_t from public.team_of_the_week where week_start = v_monday and scope = 'venue';
  assert v_t.venue_id = v1 and v_t.matches = 4, format('v1, 4 matches (m5 is next week), got %s', v_t);
  select array_agg(format('%s:%s:%s', p.sort, p.position_group, p.profile_id) order by p.sort) into v_players
  from public.team_of_the_week_players p where p.team_of_the_week_id = v_t.id;
  assert v_players = array[format('1:gk:%s', k1), format('2:def:%s', d2), format('3:mid:%s', mid),
                           format('4:fwd:%s', f1), format('5:fwd:%s', f2)],
    format('keeper k1, defender d2 (award), midfielder, forward f1 (9.00), then f2 (8.50) over o1 and d1, got %s', v_players);
  assert (select average_rating from public.team_of_the_week_players where team_of_the_week_id = v_t.id and profile_id = f2)
         = 8.50 and (select rated_matches from public.team_of_the_week_players
                     where team_of_the_week_id = v_t.id and profile_id = f2) = 2,
    'f2: (9 + 8) / 2 over 2 matches; position from the latest (f2 = forward)';
  assert not exists (select 1 from public.team_of_the_week_players where profile_id = late), 'm5 is next week';

  select * into v_t from public.team_of_the_week where week_start = v_monday and scope = 'city';
  assert v_t.city_key = 'nicosia' and v_t.matches = 1, format('Nicosia: v2''s match only, got %s', v_t);
  select array_agg(p.profile_id::text order by p.sort) into v_players
  from public.team_of_the_week_players p where p.team_of_the_week_id = v_t.id;
  assert v_players = array[g1::text, g2::text], format('g1 (a goal) before g2; few has 2 ratings, got %s', v_players);

  select * into v_t from public.team_of_the_week where week_start = v_monday and scope = 'league';
  assert v_t.league_id = v_league and v_t.name = 'Nicosia 5s', format('the league, got %s', v_t);

  -- 3. Notifications: one per team a player is in.
  assert tests.notified(k1, 'team_of_the_week') = 1, 'k1 told once';
  assert tests.notified(g1, 'team_of_the_week') = 2, 'g1: Nicosia and the league';
  assert tests.notified(d1, 'team_of_the_week') = 0 and tests.notified(few, 'team_of_the_week') = 0, 'not picked';
  assert (tests.last_notification(k1, 'team_of_the_week')).body
         = format('You''re in the team of the week: %s.', (select name from public.venues where id = v1)),
    format('the words, got %s', (tests.last_notification(k1, 'team_of_the_week')).body);

  -- 4. Once per week.
  assert tests.a7_tick('2026-11-16 07:15+00') = 0, 'again on Monday: nothing';
  assert tests.a7_tick('2026-11-18 12:00+00') = 0, 'Wednesday: nothing';
  assert tests.notified(k1, 'team_of_the_week') = 1, 'no second notification';

  -- 5. The next week: m5 (Monday 00:00) is v1's only match, so Nicosia's.
  assert tests.a7_tick('2026-11-23 07:00+00') = 1, 'the week of 16 November: one team';
  assert (select array_agg(p.profile_id) from public.team_of_the_week_players p
          join public.team_of_the_week t on t.id = p.team_of_the_week_id
          where t.week_start = '2026-11-16' and t.scope = 'city') = array[late], 'late, in Nicosia';

  -- A week with nobody rated: a run, no team.
  assert tests.a7_tick('2026-12-07 07:00+00') = 0, 'the week of 30 November: no team';
  assert exists (select 1 from public.team_of_the_week_runs where week_start = '2026-11-30'), 'but it ran';
  assert not exists (select 1 from public.team_of_the_week where week_start = '2026-11-30'), 'no empty teams';

  -- 6. match_jobs_tick runs it.
  perform tests.act_as_service_role();
  assert public.match_jobs_tick() ? 'team_of_the_week', 'counted by match_jobs_tick';
  perform tests.act_as_postgres();
end $$;

-- 7. A venue with no city still gets a team once it has 4 matches.
do $$
declare
  v uuid := tests.create_venue();
  p uuid := tests.create_user('a7t2-p@futty.test');
  v_m uuid;
  i integer;
begin
  for i in 1..4 loop
    v_m := tests.form_match(make_timestamptz(2026, 11, 2 + i, 18, 0, 0, 'UTC'), 'confirmed', 1, 0, p_venue => v);
    perform tests.a7_totw_player(v_m, p, 'gk', 7);
  end loop;
  assert tests.a7_tick('2026-11-09 07:00+00') = 1, 'one venue team';
  assert (select scope from public.team_of_the_week where week_start = '2026-11-02') = 'venue', 'by venue';
  assert (select average_rating from public.team_of_the_week_players p
          join public.team_of_the_week t on t.id = p.team_of_the_week_id where t.week_start = '2026-11-02') = 7.00, 'avg 7';
end $$;

rollback;
