-- S10: Player and Team of the season (or of a matchday) and the Stats tab
-- (match-record.md decisions 1k item 4 and 1n). Eligibility follows
-- app_rules.competition_awards_premium_only (waiting on Panos): both
-- settings are tested.
begin;

do $$
declare
  cap_h uuid := tests.totw_user('s10-11-cap-h@futty.test');
  h uuid[] := array[
    tests.totw_user('s10-11-h1@futty.test'),
    tests.totw_user('s10-11-h2@futty.test'),
    tests.totw_user('s10-11-h3@futty.test'),
    tests.totw_user('s10-11-h4@futty.test', false, '2025-01-01 00:00+00'),  -- not Premium, earliest sign-up
    tests.totw_user('s10-11-h5@futty.test'),
    tests.totw_user('s10-11-h6@futty.test')];
  viewer uuid := tests.create_user('s10-11-viewer@futty.test');
  t_h uuid := tests.s10_team('S10-11 Home', cap_h, h);
  t_o uuid[] := array[tests.s10_team('S10-11 A', tests.create_user('s10-11-a@futty.test')),
                      tests.s10_team('S10-11 B', tests.create_user('s10-11-b@futty.test')),
                      tests.s10_team('S10-11 C', tests.create_user('s10-11-c@futty.test'))];
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_h] || t_o);
  v_days date[] := array['2026-11-03', '2026-11-10', '2026-11-17']::date[];
  v_fixture uuid;
  v_match uuid;
  v_a jsonb;
  v_ids text[];
  v_rows jsonb;
  i integer;
begin
  update public.leagues set start_date = '2026-11-02', season_weeks = 6 where id = v_season;
  for i in 1 .. 3 loop
    v_fixture := tests.s10_fixture(v_season, t_h, t_o[i]);
    v_match := tests.s10_schedule(v_fixture, (v_days[i] + time '20:00') at time zone 'Asia/Nicosia');
    -- The home team wins 3-0 (home and away fall either way round).
    if (select home_team_id from public.league_fixtures where id = v_fixture) = t_h then
      perform tests.s10_result(v_fixture, 3, 0);
    else
      perform tests.s10_result(v_fixture, 0, 3);
    end if;
    if i < 3 then
      perform tests.s10_play(v_match, h[1], 9.0);
      perform tests.s10_play(v_match, h[5], 6.5);
      perform tests.s10_play(v_match, h[6], 5.0);
    end if;
    perform tests.s10_play(v_match, h[2], 8.0, 0, 1);
    perform tests.s10_play(v_match, h[3], 7.0, 3);
    perform tests.s10_play(v_match, h[4], 8.0);
  end loop;

  -- Everyone eligible (the default).
  v_a := tests.s10_json(viewer, format('select public.get_competition_awards(%L)', v_season));
  assert not (v_a ->> 'premiumOnly')::boolean, 'everyone is eligible by default';
  assert v_a -> 'matchdays' = '[1, 2, 3]'::jsonb, 'three matchdays, got ' || (v_a -> 'matchdays')::text;
  -- h1 has the best rating but only 2 matches; h2 and h4 tie on 8.0 over 3:
  -- the earlier sign-up wins.
  assert v_a -> 'player' ->> 'profileId' = h[4]::text, 'Player of the season: 3 matches, ties to the earlier sign-up';
  assert (v_a -> 'player' ->> 'matches')::integer = 3, 'with his matches';
  select array_agg(x ->> 'profileId' order by x ->> 'profileId') into v_ids
  from jsonb_array_elements(v_a -> 'team' -> 'players') x;
  assert v_ids = (select array_agg(u::text order by u::text) from unnest(array[h[1], h[2], h[3], h[4], h[5]]) u),
    'Team of the season: the best five average ratings';
  assert (select x ->> 'slot' from jsonb_array_elements(v_a -> 'team' -> 'players') x
          where x ->> 'profileId' = h[3]::text) = 'fwd', 'the most goals per game up front';
  assert v_a -> 'team' -> 'shape' = '{"keepers": 1, "defenders": 1, "midfielders": 2, "strikers": 1}'::jsonb,
    '5-a-side shape';

  -- One matchday: only its players; too few fill what they can.
  v_a := tests.s10_json(viewer, format('select public.get_competition_awards(%L, 3)', v_season));
  assert jsonb_array_length(v_a -> 'team' -> 'players') = 3, 'matchday 3 had three rated players';
  assert not exists (select 1 from jsonb_array_elements(v_a -> 'team' -> 'players') x where x ->> 'profileId' = h[1]::text),
    'h1 didn''t play matchday 3';

  -- Premium only.
  update public.app_rules set competition_awards_premium_only = true;
  v_a := tests.s10_json(viewer, format('select public.get_competition_awards(%L)', v_season));
  assert (v_a ->> 'premiumOnly')::boolean, 'Premium only';
  assert v_a -> 'player' ->> 'profileId' = h[2]::text, 'the non-Premium player is skipped';
  assert not exists (select 1 from jsonb_array_elements(v_a -> 'team' -> 'players') x where x ->> 'profileId' = h[4]::text),
    'and left out of the team';
  assert jsonb_array_length(v_a -> 'team' -> 'players') = 5, 'the next best fills his place';
  update public.app_rules set competition_awards_premium_only = false;

  -- Stats: Players, Teams and Performances.
  v_rows := tests.s10_json(viewer, format('select public.get_competition_stats(%L, %L)', v_season, 'players'));
  assert (select array_agg(c ->> 'category' order by ord) from jsonb_array_elements(v_rows) with ordinality x(c, ord))
         = array['rating', 'goals', 'assists', 'motm', 'clean_sheets'], 'the Players cards';
  assert jsonb_array_length(v_rows -> 0 -> 'rows') = 3, 'the top 3';
  assert v_rows -> 0 -> 'rows' -> 0 ->> 'profileId' = h[1]::text, 'Average rating: h1';
  assert v_rows -> 1 -> 'rows' -> 0 ->> 'profileId' = h[3]::text, 'Goals: h3';
  assert (v_rows -> 1 -> 'rows' -> 0 ->> 'value')::integer = 9, 'nine goals';
  v_rows := tests.s10_json(viewer, format('select public.get_competition_stats(%L, %L)', v_season, 'teams'));
  assert v_rows -> 1 -> 'rows' -> 0 ->> 'teamId' = t_h::text, 'Goals scored: the home team';
  assert (v_rows -> 1 -> 'rows' -> 0 ->> 'value')::integer = 9, 'nine scored';
  assert (v_rows -> 2 ->> 'category') = 'goals_conceded' and (v_rows -> 2 -> 'rows' -> 0 ->> 'value')::integer = 0,
    'Goals conceded: the fewest first';
  assert (v_rows -> 3 -> 'rows' -> 0 ->> 'value')::integer = 3, 'Clean sheets: three';
  v_rows := tests.s10_json(viewer, format('select public.get_competition_stats(%L, %L)', v_season, 'performances'));
  assert v_rows -> 0 -> 'rows' -> 0 ->> 'profileId' = h[1]::text, 'Highest match rating: h1';
  assert (v_rows -> 1 -> 'rows' -> 0 ->> 'value')::integer = 3, 'Most goals in a match: 3';
  assert v_rows -> 1 -> 'rows' -> 0 ->> 'homeTeamName' is not null, 'with the match';
  v_rows := tests.s10_json(viewer, format('select public.get_competition_stats(%L, %L, %L, 10)', v_season, 'players', 'rating'));
  assert jsonb_array_length(v_rows) = 1 and jsonb_array_length(v_rows -> 0 -> 'rows') = 6, 'See all: every rated player';
end $$;

rollback;
