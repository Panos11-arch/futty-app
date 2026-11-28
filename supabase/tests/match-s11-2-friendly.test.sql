-- S11: a game switched to Friendly never ranks a player publicly (decided by
-- Panos and Anghelo, 25 November; match-record.md decision 1l "Game type").
-- This covers the competition page's player rankings: Player stats, the
-- Stats tab (Players and Performances), Player of the season and Team of
-- the season or of a matchday. The player's own season stats still count it.
--
-- League games are always Competitive today (set_match_competitive refuses
-- Friendly on one: league_always_competitive). That check lives in the
-- function, not in a trigger, so the test switches the game straight in the
-- table as postgres: the rankings must leave it out even if one ever is.
--
-- The other public rankings are tested where they were built:
--   Team of the Week and Player of the week  match-s14-totw-1-select
--   venue and city leaderboards, venue top players  match-s14-friendly-public
--   power ranking (teams)  match-power-ranking-2-games
begin;

do $$
declare
  cap_h uuid := tests.totw_user('s11-2-cap-h@futty.test');
  star uuid := tests.totw_user('s11-2-star@futty.test');
  steady uuid := tests.totw_user('s11-2-steady@futty.test');
  viewer uuid := tests.totw_user('s11-2-viewer@futty.test');  -- Premium, for Player stats
  t_h uuid := tests.s10_team('S11-2 Home', cap_h, array[star, steady]);
  t_o uuid[] := array[tests.s10_team('S11-2 A', tests.create_user('s11-2-a@futty.test')),
                      tests.s10_team('S11-2 B', tests.create_user('s11-2-b@futty.test')),
                      tests.s10_team('S11-2 C', tests.create_user('s11-2-c@futty.test')),
                      tests.s10_team('S11-2 D', tests.create_user('s11-2-d@futty.test'))];
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_h] || t_o);
  -- A Monday, so each game (start + 1 day, + 7 per week) falls in its own
  -- Monday-to-Sunday matchday. From a Sunday start (today a Saturday) game 1
  -- would land on the next Monday, matchday 2, and every game would shift.
  v_start date := date_trunc('week', (now() at time zone 'Asia/Nicosia')::date - 27)::date;
  v_matches uuid[] := '{}';
  v_fixture uuid;
  v_match uuid;
  v_friendly uuid;
  v_a jsonb;
  v_rows jsonb;
  i integer;
begin
  -- Four weekly games, matchdays 1 to 4. The home team wins each 2-0 and
  -- all its members are checked in (so each has 4 matches). star is rated
  -- in games 1-3 (9.5, 2 goals each); steady in games 1, 2 and 4 (7.0).
  update public.leagues set start_date = v_start, season_weeks = 6 where id = v_season;
  for i in 1 .. 4 loop
    v_fixture := tests.s10_fixture(v_season, t_h, t_o[i]);
    v_match := tests.s10_schedule(v_fixture, (v_start + (i - 1) * 7 + 1 + time '20:00') at time zone 'Asia/Nicosia');
    if (select home_team_id from public.league_fixtures where id = v_fixture) = t_h then
      perform tests.s10_result(v_fixture, 2, 0);
    else
      perform tests.s10_result(v_fixture, 0, 2);
    end if;
    if i <= 3 then perform tests.s10_play(v_match, star, 9.5, 2); end if;
    if i <> 3 then perform tests.s10_play(v_match, steady, 7.0); end if;
    v_matches := v_matches || v_match;
  end loop;
  v_friendly := v_matches[3];

  -- Control: while every game is Competitive, star tops everything.
  v_a := tests.s10_json(viewer, format('select public.get_competition_awards(%L)', v_season));
  assert v_a -> 'player' ->> 'profileId' = star::text, 'control: star is Player of the season, got ' || v_a::text;
  v_rows := tests.s10_json(viewer, format('select public.get_competition_player_stats(%L)', v_season));
  assert (select (x ->> 'matches')::integer from jsonb_array_elements(v_rows) x where x ->> 'profileId' = star::text) = 4,
    'control: four matches in Player stats';

  -- Game 3 becomes Friendly, straight in the table.
  update public.matches set competitive = false where id = v_friendly;
  assert not (select is_competitive from public.matches where id = v_friendly), 'game 3 is Friendly';

  -- 1. Player stats (Premium): game 3 is gone.
  v_rows := tests.s10_json(viewer, format('select public.get_competition_player_stats(%L)', v_season));
  assert (select (x ->> 'matches')::integer from jsonb_array_elements(v_rows) x where x ->> 'profileId' = star::text) = 3,
    'Player stats: three matches, got ' || v_rows::text;
  assert (select (x ->> 'goals')::integer from jsonb_array_elements(v_rows) x where x ->> 'profileId' = star::text) = 4,
    'Player stats: four goals';

  -- 2. The Stats tab: Players (goals) and Performances (most goals in a match).
  v_rows := tests.s10_json(viewer, format('select public.get_competition_stats(%L, %L, %L, 10)', v_season, 'players', 'goals'));
  assert (select (x ->> 'value')::integer from jsonb_array_elements(v_rows -> 0 -> 'rows') x
          where x ->> 'profileId' = star::text) = 4, 'Stats, Goals: four, got ' || v_rows::text;
  v_rows := tests.s10_json(viewer, format('select public.get_competition_stats(%L, %L, %L, 10)', v_season, 'performances', 'goals'));
  assert not exists (select 1 from jsonb_array_elements(v_rows -> 0 -> 'rows') x where x ->> 'matchId' = v_friendly::text),
    'Stats, Performances: no row from the Friendly game';

  -- 3. Player of the season: star now has two rated Competitive matches (three needed).
  v_a := tests.s10_json(viewer, format('select public.get_competition_awards(%L)', v_season));
  assert v_a -> 'player' ->> 'profileId' = steady::text,
    'Player of the season: steady, with three rated Competitive matches, got ' || coalesce(v_a -> 'player' ->> 'profileId', 'none');

  -- 4. Team of matchday 3: its only game is Friendly; nobody is picked.
  v_a := tests.s10_json(viewer, format('select public.get_competition_awards(%L, 3)', v_season));
  assert coalesce(jsonb_array_length(v_a -> 'team' -> 'players'), 0) = 0,
    'Team of matchday 3: empty, got ' || coalesce(v_a -> 'team', 'null'::jsonb)::text;
  assert not (v_a -> 'matchdays') @> '[3]'::jsonb, 'matchday 3 leaves the picker, got ' || (v_a -> 'matchdays')::text;

  -- 5. star's own season still counts the Friendly game (personal progress).
  assert (select (appearances, goals) from public.player_season_stats where profile_id = star and season_kind = 'all')
         = (4, 6), 'star''s own stats keep the Friendly game, got ' ||
         (select (appearances, goals)::text from public.player_season_stats where profile_id = star and season_kind = 'all');
end $$;

rollback;
