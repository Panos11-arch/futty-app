-- S14 selection (docs/specs/match-record.md decision 1k, 19, 22 and 24
-- November, and the Friendly rule of 25 November):
--   * league team: that league's games only; general team: non-league
--     competitive games only, for All Cyprus, each city and each busy venue
--     (4 or more confirmed, non-league, competitive matches that week);
--   * one team per format, from games in that format only;
--   * Friendly, disputed and next week's games never count;
--   * the best average match rating (at least 1 game), ties: more games,
--     then the earlier sign-up;
--   * Premium only: a non-Premium player is skipped and the next best
--     eligible player is picked;
--   * too few eligible players: the team is still made with the filled
--     slots; from Monday 09:00 Cyprus time, once per week.
begin;

do $$
declare
  -- The week of Monday 2 March 2026 (Cyprus is UTC+2 then).
  v_week date := '2026-03-02';
  v1 uuid := tests.create_venue();
  v2 uuid := tests.create_venue();
  v_league uuid;
  np uuid := tests.totw_user('s14s-np@futty.test', false);
  p1 uuid := tests.totw_user('s14s-p1@futty.test');
  p2 uuid := tests.totw_user('s14s-p2@futty.test');
  p3 uuid := tests.totw_user('s14s-p3@futty.test');
  p4 uuid := tests.totw_user('s14s-p4@futty.test');
  p5 uuid := tests.totw_user('s14s-p5@futty.test');
  p6 uuid := tests.totw_user('s14s-p6@futty.test');
  s7 uuid := tests.totw_user('s14s-s7@futty.test');
  fr uuid := tests.totw_user('s14s-fr@futty.test');
  lg uuid := tests.totw_user('s14s-lg@futty.test');
  dz uuid := tests.totw_user('s14s-dz@futty.test');
  late uuid := tests.totw_user('s14s-late@futty.test');
  m uuid;
  v_team public.team_of_the_week;
  v_all5 public.team_of_the_week;
  v_lineup text[];
  q1 uuid := tests.totw_user('s14s-q1@futty.test');
  q2 uuid := tests.totw_user('s14s-q2@futty.test');
  q3 uuid := tests.totw_user('s14s-q3@futty.test');
  q5 uuid := tests.totw_user('s14s-q5@futty.test', true, '2026-02-01 00:00+00');
  q6 uuid := tests.totw_user('s14s-q6@futty.test', true, '2026-01-01 00:00+00');
  q7 uuid := tests.totw_user('s14s-q7@futty.test', true, '2026-03-01 00:00+00');
  np2 uuid := tests.totw_user('s14s-np2@futty.test', false);
begin
  update public.venues set city = 'Limassol' where id = v1;
  update public.venues set city = ' nicosia ' where id = v2;
  insert into public.leagues (format, scope, capacity, name) values ('5-a-side', 'city', 8, 'S14 League')
  returning id into v_league;

  -- V1 (Limassol): four non-league competitive 5-a-side games: busy.
  m := tests.totw_match('2026-03-02 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, np, 9.5);
  perform tests.totw_play(m, p1, 9.0, 0, 0, 'b');
  m := tests.totw_match('2026-03-03 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, p2, 8.5);
  perform tests.totw_play(m, p3, 8.0, 0, 0, 'b');
  m := tests.totw_match('2026-03-04 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, p4, 7.5);
  m := tests.totw_match('2026-03-05 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, p5, 7.0);
  -- A Friendly game: its 10.0 is never picked, and it doesn't make a venue busy.
  m := tests.totw_match('2026-03-06 18:00+00', '5-a-side', v1, false);
  perform tests.totw_play(m, fr, 10.0);
  -- A disputed game never counts.
  m := tests.totw_match('2026-03-06 19:00+00', '5-a-side', v1, true, null, 'disputed');
  perform tests.totw_play(m, dz, 9.8);
  -- Next week (Monday 00:00 in Cyprus).
  m := tests.totw_match('2026-03-08 22:00+00', '5-a-side', v1);
  perform tests.totw_play(m, late, 9.7);

  -- V2 (Nicosia): three non-league competitive games (two 5-a-side, one
  -- 7-a-side), plus a league game and a Friendly game: not busy.
  m := tests.totw_match('2026-03-03 19:00+00', '5-a-side', v2);
  perform tests.totw_play(m, p6, 6.5);
  m := tests.totw_match('2026-03-04 19:00+00', '5-a-side', v2);
  perform tests.totw_play(m, p6, 6.5);
  m := tests.totw_match('2026-03-05 19:00+00', '7-a-side', v2);
  perform tests.totw_play(m, s7, 8.0);
  m := tests.totw_match('2026-03-06 19:00+00', '5-a-side', v2, true, v_league);
  perform tests.totw_play(m, lg, 9.9);
  m := tests.totw_match('2026-03-07 19:00+00', '5-a-side', v2, false);
  perform tests.totw_play(m, fr, 10.0);

  -- 1. Not before 09:00 on Monday.
  assert tests.totw_tick('2026-03-09 06:59+00') = 0, '08:59 Monday: not yet';
  assert not exists (select 1 from public.team_of_the_week where week_start = v_week), 'no team yet';

  -- 2. Monday 09:00: every scope and format with a game.
  assert tests.totw_tick('2026-03-09 07:00+00') = 7,
    format('All Cyprus 5 and 7, Limassol 5, Nicosia 5 and 7, V1 5, the league 5, got %s',
           (select count(*) from public.team_of_the_week where week_start = v_week));
  assert (select teams from public.team_of_the_week_runs where week_start = v_week) = 7, 'the run counts the teams';

  -- 3. General, All Cyprus, 5-a-side: the top-rated non-Premium player is
  --    skipped and P5, the next best Premium player, is picked. P6 (6.5)
  --    isn't. Friendly, league, disputed and next week's players never are.
  v_all5 := tests.totw_team(v_week, 'general', 'all', '', '5-a-side');
  assert v_all5.id is not null and v_all5.area_name = 'All Cyprus', 'All Cyprus 5-a-side';
  assert v_all5.matches = 6, format('m1-m4 at V1 and two at V2, got %s', v_all5.matches);
  assert (select array_agg(profile_id order by profile_id) from public.team_of_the_week_players
          where team_of_the_week_id = v_all5.id) = (select array_agg(x order by x) from unnest(array[p1, p2, p3, p4, p5]) x),
    format('P1-P5, got %s', tests.totw_lineup(v_all5.id));
  assert not exists (select 1 from public.team_of_the_week_players p where p.profile_id in (np, fr, dz, late)),
    'the non-Premium, Friendly, disputed and next week''s players are in no team';
  assert not exists (select 1 from public.team_of_the_week_players p
                     where p.team_of_the_week_id = v_all5.id and p.profile_id in (lg, p6, s7)),
    'not the league player, not P6 (6.5), not the 7-a-side player';
  assert (select (average_rating, games, player_of_the_week) from public.team_of_the_week_players
          where team_of_the_week_id = v_all5.id and profile_id = p1) = (9.00, 1, true), 'P1: 9.0, 1 game, player of the week';
  assert (select count(*) from public.team_of_the_week_players where player_of_the_week) = 7,
    'one player of the week in each of the seven teams';

  -- 4. Each format from its own games only: 7-a-side has S7 alone (too few
  --    eligible: the team is still made).
  v_team := tests.totw_team(v_week, 'general', 'all', '', '7-a-side');
  assert tests.totw_lineup(v_team.id) = array['fwd:' || s7], format('7-a-side: S7 alone, got %s', tests.totw_lineup(v_team.id));
  assert v_team.matches = 1, '7-a-side: one game';

  -- 5. Cities: Limassol as All Cyprus without V2's; Nicosia from V2 (city
  --    names are trimmed and lower-cased for the key).
  v_team := tests.totw_team(v_week, 'general', 'city', 'limassol', '5-a-side');
  assert v_team.area_name = 'Limassol' and v_team.matches = 4, 'Limassol 5-a-side: four games';
  assert (select count(*) from public.team_of_the_week_players where team_of_the_week_id = v_team.id) = 5, 'Limassol: five';
  v_team := tests.totw_team(v_week, 'general', 'city', 'nicosia', '5-a-side');
  assert (select array_agg(profile_id) from public.team_of_the_week_players where team_of_the_week_id = v_team.id) = array[p6],
    'Nicosia 5-a-side: P6 alone';
  assert (select games from public.team_of_the_week_players where team_of_the_week_id = v_team.id) = 2, 'P6: two games';
  assert (tests.totw_team(v_week, 'general', 'city', 'nicosia', '7-a-side')).id is not null, 'Nicosia 7-a-side';

  -- 6. Busy venues: V1 (4 qualifying games) has a team; V2 (3, plus a league
  --    and a Friendly game) has none.
  v_team := tests.totw_team(v_week, 'general', 'venue', v1::text, '5-a-side');
  assert v_team.id is not null and v_team.venue_id = v1, 'V1 is busy';
  assert not exists (select 1 from public.team_of_the_week where week_start = v_week and area = 'venue' and venue_id = v2),
    'V2 is not busy';

  -- 7. The league team: that league's games only.
  v_team := tests.totw_team(v_week, 'league', 'league', v_league::text, '5-a-side');
  assert v_team.league_id = v_league and v_team.area_name = 'S14 League', 'the league team';
  assert tests.totw_lineup(v_team.id) = array['fwd:' || lg], format('LG alone, got %s', tests.totw_lineup(v_team.id));

  -- 8. Once per week.
  assert tests.totw_tick('2026-03-09 07:15+00') = 0, 'again: nothing';
  assert (select count(*) from public.team_of_the_week where week_start = v_week) = 7, 'still seven';

  -- 9. The week of 9 March. Ties: Q7 (7.0, 2 games) beats Q6 and Q5 (7.0,
  --    1 game); Q6 signed up before Q5. LATE (next week's 9.7) is picked
  --    for the 9th.
  m := tests.totw_match('2026-03-10 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, q1, 9.0);
  perform tests.totw_play(m, q2, 9.0);
  perform tests.totw_play(m, q7, 7.0);
  m := tests.totw_match('2026-03-11 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, q3, 9.0);
  perform tests.totw_play(m, q5, 7.0);
  perform tests.totw_play(m, q6, 7.0);
  perform tests.totw_play(m, q7, 7.0);
  -- Only a non-Premium player in 9-a-side: the team is made, empty.
  m := tests.totw_match('2026-03-12 18:00+00', '9-a-side', v2);
  perform tests.totw_play(m, np2, 9.0);
  assert tests.totw_tick('2026-03-16 07:00+00') > 0, 'the week of 9 March';
  v_team := tests.totw_team('2026-03-09', 'general', 'all', '', '5-a-side');
  assert (select array_agg(profile_id order by profile_id) from public.team_of_the_week_players
          where team_of_the_week_id = v_team.id) = (select array_agg(x order by x) from unnest(array[q1, q2, q3, q7, late]) x),
    format('Q1-Q3, LATE, then Q7 on games; not Q5 or Q6, got %s', tests.totw_lineup(v_team.id));
  v_team := tests.totw_team('2026-03-09', 'general', 'all', '', '9-a-side');
  assert v_team.id is not null, '9-a-side: never hidden';
  assert tests.totw_lineup(v_team.id) = '{}', '9-a-side: no eligible player';

  -- 10. Without Q7, one slot is left for Q5 or Q6 (same rating and games):
  --     Q6 signed up first.
  delete from public.match_players where profile_id = q7;
  delete from public.team_of_the_week where week_start = '2026-03-09';
  delete from public.team_of_the_week_runs where week_start = '2026-03-09';
  perform tests.totw_tick('2026-03-16 07:00+00');
  v_team := tests.totw_team('2026-03-09', 'general', 'all', '', '5-a-side');
  assert exists (select 1 from public.team_of_the_week_players where team_of_the_week_id = v_team.id and profile_id = q6)
         and not exists (select 1 from public.team_of_the_week_players where team_of_the_week_id = v_team.id and profile_id = q5),
    format('Q6 (earlier sign-up) over Q5, got %s', tests.totw_lineup(v_team.id));
end $$;

rollback;
