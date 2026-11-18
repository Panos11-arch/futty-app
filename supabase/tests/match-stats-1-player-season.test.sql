-- A7a (docs/specs/match-record.md section 7, decision 1g): a player's
-- season stats (player_season_stats).
--   Confirmed matches only; a player counts only if they checked in (1b.2),
--   or held a spot in a confirmed forfeit (1b.3), which is a loss for the
--   side that forfeited (1g.3). Seasons: the calendar year in Cyprus time
--   (league games included), each league, and all time (1g.2). A match
--   rating counts once its window has closed and it has 3 ratings; a man of
--   the match once voting has closed (ties shared).
begin;

-- Three raters each give p_profile p_score in p_match (written directly:
-- the rules for who may rate are A5a's tests).
create function tests.a7_rated(p_match uuid, p_profile uuid, p_score integer)
returns void
language plpgsql
as $$
declare
  i integer;
  v_rater uuid;
begin
  for i in 1..3 loop
    v_rater := tests.create_user(format('a7-rater-%s@futty.test', left(gen_random_uuid()::text, 8)));
    insert into public.match_ratings (match_id, rater_profile_id, rated_player_id, score)
    values (p_match, v_rater, tests.player_id(p_match, p_profile), p_score);
  end loop;
end;
$$;

-- A goal in p_match for p_scorer's side (assisted by p_assist, if given).
create function tests.a7_goal(p_match uuid, p_scorer uuid, p_assist uuid default null)
returns void
language sql
as $$
  insert into public.match_goals (match_id, side, sort, scorer_player_id, assist_player_id, entered_by)
  select p_match, mp.side,
         (select count(*) + 1 from public.match_goals g where g.match_id = p_match),
         mp.id, case when p_assist is not null then tests.player_id(p_match, p_assist) end, p_scorer
  from public.match_players mp where mp.match_id = p_match and mp.profile_id = p_scorer;
$$;

-- A man of the match vote in p_match for p_nominee.
create function tests.a7_vote(p_match uuid, p_voter uuid, p_nominee uuid)
returns void
language sql
as $$
  insert into public.motm_votes (match_id, voter_profile_id, nominee_player_id)
  values (p_match, p_voter, tests.player_id(p_match, p_nominee));
$$;

-- p_profile's season row, as a signed-in player reads it.
create function tests.a7_season(p_reader uuid, p_profile uuid, p_kind text, p_year integer default null,
                                p_league uuid default null)
returns public.player_season_stats
language plpgsql
as $$
declare
  v public.player_season_stats;
begin
  perform tests.act_as(p_reader);
  select * into v from public.player_season_stats s
  where s.profile_id = p_profile and s.season_kind = p_kind
    and s.season_year is not distinct from p_year and s.league_id is not distinct from p_league;
  perform tests.act_as_postgres();
  return v;
end;
$$;

do $$
declare
  p uuid := tests.create_user('a7s1-p@futty.test');
  q uuid := tests.create_user('a7s1-q@futty.test');
  o1 uuid := tests.create_user('a7s1-o1@futty.test');
  o2 uuid := tests.create_user('a7s1-o2@futty.test');
  reader uuid := tests.create_user('a7s1-reader@futty.test');
  ta uuid := tests.create_team('A7S1 A');
  tb uuid := tests.create_team('A7S1 B');
  v_league uuid;
  v_fixture uuid;
  m1 uuid := tests.form_match('2026-03-02 18:00+00', 'confirmed', 3, 1, ta, tb);
  m2 uuid := tests.form_match('2026-04-10 18:00+00', 'confirmed', 1, 1);
  m3 uuid := tests.form_match('2026-05-01 18:00+00', 'confirmed', null, null, ta, tb, 'a', 'pulled_out');
  m4 uuid := tests.form_match('2026-06-01 18:00+00', 'confirmed', 0, 2);
  m5 uuid := tests.form_match('2026-06-08 18:00+00', 'disputed', 2, 0);
  -- 00:30 on 1 January 2026 in Cyprus: the 2026 season, not 2025.
  m6 uuid := tests.form_match('2025-12-31 22:30+00', 'confirmed', 0, 1);
  m7 uuid := tests.form_match('2025-06-01 18:00+00', 'confirmed', 2, 0);
  m8 uuid := tests.form_match('2026-07-01 18:00+00', 'confirmed', 2, 0, ta, tb);
  v_s public.player_season_stats;
begin
  insert into public.leagues (format, scope, capacity, name) values ('5-a-side', 'city', 8, 'A7 League')
  returning id into v_league;
  insert into public.league_fixtures (league_id, home_team_id, away_team_id) values (v_league, ta, tb)
  returning id into v_fixture;
  update public.matches set league_fixture_id = v_fixture where id = m8;

  -- m1: a 3-1 win. p scores twice and sets up q; rated 8; man of the match.
  perform tests.form_player(m1, p, 'a', true, true);
  perform tests.form_player(m1, q, 'a', true, true);
  perform tests.form_player(m1, o1, 'b', true, true);
  perform tests.form_player(m1, o2, 'b', true, true);
  perform tests.a7_goal(m1, p);
  perform tests.a7_goal(m1, p);
  perform tests.a7_goal(m1, q, p);
  perform tests.a7_goal(m1, o1);
  perform tests.a7_rated(m1, p, 8);
  perform tests.a7_vote(m1, q, p);
  perform tests.a7_vote(m1, o1, p);
  perform tests.a7_vote(m1, o2, q);
  -- m2: a 1-1 draw. m3: p's side forfeited; p held a spot but never came.
  perform tests.form_player(m2, p, 'a', true, true);
  perform tests.form_player(m3, p, 'a', true, false);
  -- m4: p held a spot but didn't check in: doesn't count. m5: disputed.
  perform tests.form_player(m4, p, 'a', true, false);
  perform tests.form_player(m5, p, 'a', true, true);
  -- m6: a 0-1 loss just after midnight on New Year's Day. m7: a 2025 win.
  perform tests.form_player(m6, p, 'a', true, true);
  perform tests.form_player(m7, p, 'a', true, true);
  -- m8: a league win.
  perform tests.form_player(m8, p, 'a', true, true);

  insert into public.player_level_history (profile_id, match_id, reason, level_before, level_after, created_at) values
    (p, m1, 'result', 3.00, 3.20, '2026-03-03 10:00+00'),
    (p, m8, 'result', 3.20, 3.35, '2026-07-02 10:00+00');

  -- 1. The 2026 season: m1 W, m2 D, m3 L (forfeit), m6 L, m8 W.
  v_s := tests.a7_season(reader, p, 'year', 2026);
  assert v_s.appearances = 5, format('5 appearances in 2026, got %s', v_s.appearances);
  assert (v_s.won, v_s.drawn, v_s.lost) = (2, 1, 2), format('W2 D1 L2, got %s %s %s', v_s.won, v_s.drawn, v_s.lost);
  assert v_s.win_pct = 40, format('40%% wins, got %s', v_s.win_pct);
  assert v_s.goals = 2 and v_s.assists = 1, format('2 goals, 1 assist, got %s, %s', v_s.goals, v_s.assists);
  assert v_s.motm = 1, format('1 man of the match, got %s', v_s.motm);
  assert v_s.average_rating = 8.00 and v_s.rated_matches = 1,
    format('average rating 8.00 over 1 match, got %s over %s', v_s.average_rating, v_s.rated_matches);
  assert v_s.level_start = 3.00 and v_s.level_end = 3.35,
    format('level 3.00 to 3.35, got %s to %s', v_s.level_start, v_s.level_end);

  -- 2. 2025, the league and all time.
  v_s := tests.a7_season(reader, p, 'year', 2025);
  assert v_s.appearances = 1 and v_s.won = 1 and v_s.win_pct = 100, format('2025: one win, got %s', v_s);
  assert v_s.average_rating is null and v_s.level_start is null, '2025: no rating, no level change';
  v_s := tests.a7_season(reader, p, 'league', null, v_league);
  assert v_s.appearances = 1 and v_s.won = 1, format('the league: one win, got %s', v_s);
  v_s := tests.a7_season(reader, p, 'all');
  assert v_s.appearances = 6 and v_s.won = 3, format('all time: 6 appearances, 3 wins, got %s', v_s);
  assert (select count(*) from public.player_season_stats where profile_id = p and season_kind = 'league') = 1,
    'a league row only for leagues';

  -- 3. q: one appearance, no goals of their own but one scored; 0 men of
  -- the match (1 vote to p's 2). Opponents count from their side.
  v_s := tests.a7_season(reader, q, 'year', 2026);
  assert v_s.appearances = 1 and v_s.goals = 1 and v_s.assists = 0 and v_s.motm = 0, format('q, got %s', v_s);
  v_s := tests.a7_season(reader, o1, 'year', 2026);
  assert v_s.lost = 1 and v_s.goals = 1 and v_s.win_pct = 0, format('o1 lost and scored, got %s', v_s);
end $$;

-- 4. A rating and a man of the match count only once their windows close;
-- tied votes are shared.
do $$
declare
  p uuid := tests.create_user('a7s1w-p@futty.test');
  q uuid := tests.create_user('a7s1w-q@futty.test');
  r uuid := tests.create_user('a7s1w-r@futty.test');
  m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 1, 0);
  v_s public.player_season_stats;
  v_year integer := extract(year from now() at time zone 'Asia/Nicosia');
begin
  update public.matches set confirmed_at = now() - interval '1 hour' where id = m;
  perform tests.form_player(m, p, 'a', true, true);
  perform tests.form_player(m, q, 'a', true, true);
  perform tests.form_player(m, r, 'b', true, true);
  perform tests.a7_rated(m, p, 6);
  perform tests.a7_vote(m, q, p);
  perform tests.a7_vote(m, p, q);

  v_s := tests.a7_season(r, p, 'year', v_year);
  assert v_s.appearances = 1 and v_s.average_rating is null and v_s.motm = 0,
    format('windows open: no rating, no man of the match yet, got %s', v_s);

  update public.matches set confirmed_at = now() - interval '24 hours' where id = m;
  v_s := tests.a7_season(r, p, 'year', v_year);
  assert v_s.average_rating = 6.00 and v_s.motm = 1, format('windows closed, got %s', v_s);
  v_s := tests.a7_season(r, q, 'year', v_year);
  assert v_s.motm = 1, format('a tie is shared, got %s', v_s);
  v_s := tests.a7_season(r, r, 'year', v_year);
  assert v_s.motm = 0 and v_s.average_rating is null, format('r: neither, got %s', v_s);

  -- Two ratings aren't a match rating.
  delete from public.match_ratings where match_id = m
    and rater_profile_id = (select rater_profile_id from public.match_ratings where match_id = m limit 1);
  v_s := tests.a7_season(r, p, 'year', v_year);
  assert v_s.average_rating is null and v_s.rated_matches = 0, format('2 ratings: none, got %s', v_s);

  -- A guest never gets stats; a player who left doesn't count.
  perform tests.guest_player(m, 'a', 'Guest');
  assert not exists (select 1 from public.match_stat_players where match_id = m and profile_id is null), 'no guests';
  update public.match_players set left_at = now() - interval '1 day' where match_id = m and profile_id = q;
  assert not exists (select 1 from public.match_stat_players where match_id = m and profile_id = q), 'left: not counted';
end $$;

rollback;
