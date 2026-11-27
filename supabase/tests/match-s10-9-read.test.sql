-- S10: what the competition page reads (match-record.md decision 1n):
-- the header, Season ▾, the overview card, Featured match, Titles, the
-- standings, the matches with their matchday, and the empty states.
begin;

do $$
declare
  caps uuid[] := '{}';
  t uuid[] := '{}';
  viewer uuid := tests.create_user('s10-9-viewer@futty.test');
  premium uuid := tests.create_user('s10-9-premium@futty.test');
  v_hub uuid := tests.s10_league();
  v_season uuid;
  v_season2 uuid;
  v_other uuid := tests.s10_league();
  v_page jsonb;
  v_rows jsonb;
  v_error text;
  i integer;
begin
  perform tests.make_premium(premium);
  for i in 1 .. 5 loop
    caps := caps || tests.create_user('s10-9-cap-' || i || '@futty.test');
    t := t || tests.s10_team('S10-9 ' || chr(64 + i), caps[i]);  -- A, B, C, D, E
  end loop;
  v_season := tests.s10_season(v_hub, t);
  update public.leagues set start_date = '2026-11-02', season_weeks = 6 where id = v_season;

  -- Empty: no results yet.
  v_page := tests.s10_json(viewer, format('select public.get_competition(%L)', v_hub));
  assert v_page ->> 'id' = v_hub::text, 'the city league';
  assert v_page ->> 'format' = '5-a-side', 'its format';
  assert v_page -> 'featured' = 'null'::jsonb, 'no featured match yet';
  assert v_page -> 'titles' = '[]'::jsonb, 'no titles yet';
  assert jsonb_array_length(v_page -> 'seasons') = 1, 'one season';
  assert v_page -> 'season' ->> 'id' = v_season::text, 'the current season';
  assert v_page -> 'season' ->> 'endDate' = '2026-12-13', 'the end: start + 6 weeks';
  assert not (v_page ? 'followers'), 'no followers count (pins are private)';
  assert (v_page ->> 'isPinned')::boolean = false, 'not pinned';
  insert into public.competition_pins (profile_id, target_type, scope, format)
  select viewer, 'league', lower(btrim(scope)), format from public.leagues where id = v_hub;
  assert (tests.s10_json(viewer, format('select public.get_competition(%L)', v_hub)) ->> 'isPinned')::boolean,
    'pinned';
  assert tests.s10_json(premium, format('select public.get_competition_player_stats(%L)', v_season)) = '[]'::jsonb,
    'no player stats yet';
  assert not exists (
    select 1 from jsonb_array_elements(tests.s10_json(viewer,
      format('select public.get_competition_stats(%L, %L)', v_season, 'players'))) c
    where jsonb_array_length(c -> 'rows') > 0), 'no stats yet';
  v_rows := tests.s10_json(viewer, format('select public.get_competition_awards(%L)', v_season));
  assert v_rows -> 'player' = 'null'::jsonb and v_rows -> 'team' -> 'players' = '[]'::jsonb, 'no awards yet';

  -- A, B, C, D, E in that order: each beats E by a smaller margin.
  perform tests.s10_score(tests.s10_fixture(v_season, t[1], t[5]), 0, 0, '2026-11-03');
  update public.league_fixtures set home_score = case when home_team_id = t[1] then 5 else 0 end,
                                    away_score = case when away_team_id = t[1] then 5 else 0 end
  where id = tests.s10_fixture(v_season, t[1], t[5]);
  update public.league_fixtures set status = 'completed', scheduled_day = '2026-11-04',
         home_score = case when home_team_id = t[2] then 4 else 0 end, away_score = case when away_team_id = t[2] then 4 else 0 end
  where id = tests.s10_fixture(v_season, t[2], t[5]);
  update public.league_fixtures set status = 'completed', scheduled_day = '2026-11-05',
         home_score = case when home_team_id = t[3] then 3 else 0 end, away_score = case when away_team_id = t[3] then 3 else 0 end
  where id = tests.s10_fixture(v_season, t[3], t[5]);
  update public.league_fixtures set status = 'completed', scheduled_day = '2026-11-10',
         home_score = case when home_team_id = t[4] then 1 else 0 end, away_score = case when away_team_id = t[4] then 1 else 0 end
  where id = tests.s10_fixture(v_season, t[4], t[5]);
  assert tests.s10_order(v_season) = t, 'A, B, C, D, E';

  -- Standings.
  v_rows := tests.s10_json(viewer, format('select public.get_competition_standings(%L)', v_season));
  assert v_rows ->> 'rules'
         = 'Teams level on points: goal difference, then goals scored, then head-to-head points, then team name.',
    'the rules in words';
  assert jsonb_array_length(v_rows -> 'tables') = 1, 'one table';
  assert v_rows -> 'tables' -> 0 -> 'rows' -> 0 ->> 'teamId' = t[1]::text, 'A on top';
  assert v_rows -> 'tables' -> 0 -> 'rows' -> 0 ->> 'zone' = 'division_1', 'with its zone';

  -- Matches: matchday = week of the season, "Not scheduled" for no day.
  perform tests.act_as(viewer);
  assert (select count(*) from public.get_competition_matches(v_season)) = 10, 'every fixture';
  assert (select matchday from public.get_competition_matches(v_season)
          where fixture_id = tests.s10_fixture(v_season, t[1], t[5])) = 1, 'Tuesday 3 November: matchday 1';
  assert (select matchday from public.get_competition_matches(v_season)
          where fixture_id = tests.s10_fixture(v_season, t[4], t[5])) = 2, 'Tuesday 10 November: matchday 2';
  assert (select matchday from public.get_competition_matches(v_season)
          where fixture_id = tests.s10_fixture(v_season, t[1], t[2])) is null, 'no day: not scheduled';
  assert (select count(*) from public.get_competition_matches(v_season, t[5])) = 4, 'one team''s fixtures';
  perform tests.act_as_postgres();

  -- Featured: the best combined position; ties go to the earlier kickoff.
  perform tests.s10_schedule(tests.s10_fixture(v_season, t[1], t[4]), now() + interval '2 days');  -- 1 + 4
  perform tests.s10_schedule(tests.s10_fixture(v_season, t[2], t[3]), now() + interval '1 day');   -- 2 + 3
  perform tests.s10_schedule(tests.s10_fixture(v_season, t[3], t[4]), now() + interval '1 hour');  -- 3 + 4
  v_page := tests.s10_json(viewer, format('select public.get_competition(%L)', v_hub));
  assert v_page -> 'featured' ->> 'fixtureId' = tests.s10_fixture(v_season, t[2], t[3])::text,
    'tied on 5: the earlier kickoff';
  assert v_page -> 'featured' ->> 'kind' = 'upcoming', 'an upcoming match';
  assert v_page -> 'featured' ->> 'matchId' is not null, 'with its match';
  perform tests.s10_schedule(tests.s10_fixture(v_season, t[1], t[3]), now() + interval '3 days');  -- 1 + 3
  v_page := tests.s10_json(viewer, format('select public.get_competition(%L)', v_hub));
  assert v_page -> 'featured' ->> 'fixtureId' = tests.s10_fixture(v_season, t[1], t[3])::text,
    'the best combined position wins';

  -- None upcoming: the latest result.
  update public.league_fixtures set forfeit_result = 'void'
  where league_id = v_season and status <> 'completed';
  v_page := tests.s10_json(viewer, format('select public.get_competition(%L)', v_hub));
  assert v_page -> 'featured' ->> 'fixtureId' = tests.s10_fixture(v_season, t[4], t[5])::text, 'the latest result';
  assert v_page -> 'featured' ->> 'kind' = 'result', 'a result';
  assert (v_page -> 'featured' -> 'home' ->> 'score') is not null, 'with its score';

  -- Titles: the finished season's champion, the title holder.
  v_error := tests.error_as(caps[1], format('select public.end_season_to_divisions(%L)', v_season));
  assert v_error is null, 'Season 1 ends: ' || coalesce(v_error, '');
  v_page := tests.s10_json(viewer, format('select public.get_competition(%L)', v_hub));
  v_season2 := (v_page -> 'season' ->> 'id')::uuid;
  assert v_season2 <> v_season, 'the page opens on Season 2';
  assert jsonb_array_length(v_page -> 'seasons') = 2, 'Season ▾ lists both seasons';
  assert jsonb_array_length(v_page -> 'titles') = 1, 'one title';
  assert v_page -> 'titles' -> 0 ->> 'teamId' = t[1]::text, 'A won it';
  assert (v_page -> 'titles' -> 0 ->> 'holder')::boolean, 'the title holder';
  assert jsonb_array_length(v_page -> 'season' -> 'tables') = 2, 'Season 2 has two divisions';
  v_page := tests.s10_json(viewer, format('select public.get_competition(%L, %L)', v_hub, v_season));
  assert v_page -> 'season' ->> 'id' = v_season::text, 'an earlier season can be shown';
  v_error := tests.error_as(viewer, format('select public.get_competition(%L, %L)', v_other, v_season));
  assert v_error = 'competition_not_found', 'another league''s season is refused, got ' || coalesce(v_error, 'no error');

  -- The new season's empty states.
  assert tests.s10_json(premium, format('select public.get_competition_player_stats(%L)', v_season2)) = '[]'::jsonb,
    'Season 2 has no player stats';
  v_rows := tests.s10_json(viewer, format('select public.get_competition_standings(%L)', v_season2));
  assert not exists (select 1 from jsonb_array_elements(v_rows -> 'tables') x,
                     jsonb_array_elements(x -> 'rows') r where (r ->> 'played')::integer > 0), 'nothing played';

  -- Signed-in players only.
  perform tests.act_as_anon();
  v_error := tests.error_of(format('select public.get_competition(%L)', v_hub));
  perform tests.act_as_postgres();
  assert v_error like '%permission denied%', 'anon is refused, got ' || coalesce(v_error, 'no error');
  assert not has_function_privilege('authenticated', 'public.league_standings(uuid)', 'execute'),
    'the internal standings are service_role only';
  assert not has_function_privilege('authenticated', 'public.league_fixture_sync_match(uuid)', 'execute'),
    'the match sync is service_role only';
end $$;

rollback;
