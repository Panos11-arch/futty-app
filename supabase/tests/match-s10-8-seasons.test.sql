-- S10: seasons are child rows of the city league; a new season never
-- deletes anything (match-record.md decision 1n; 26 November, needs
-- Panos's OK).
begin;

-- 1. A full sign-up starts Season 1 as a child row; sign-up opens again.
do $$
declare
  caps uuid[] := array[tests.create_user('s10-8-c1@futty.test'), tests.create_user('s10-8-c2@futty.test'),
                       tests.create_user('s10-8-c3@futty.test')];
  teams uuid[] := '{}';
  v_hub uuid := tests.s10_league('5-a-side', 3);
  v_season uuid;
  v_error text;
  i integer;
begin
  for i in 1 .. 3 loop
    teams := teams || tests.s10_team('S10-8 Team ' || i, caps[i]);
  end loop;
  for i in 1 .. 3 loop
    v_error := tests.error_as(caps[i], format('select public.register_team_for_league(%L, %L)', v_hub, teams[i]));
    assert v_error is null, 'sign-up ' || i || ': ' || coalesce(v_error, '');
  end loop;

  select id into v_season from public.leagues where parent_league_id = v_hub and kind = 'season';
  assert v_season is not null, 'the full sign-up starts Season 1';
  assert (select name from public.leagues where id = v_season) = 'Season 1', 'named Season 1';
  assert (select season_number from public.leagues where id = v_season) = 1, 'number 1';
  assert (select count(*) from public.league_teams where league_id = v_season) = 3, 'with the registered teams';
  assert (select count(*) from public.league_fixtures where league_id = v_season) = 3, 'and its fixtures';
  assert not exists (select 1 from public.league_teams where league_id = v_hub), 'the sign-up rows moved';
  assert (select stage from public.leagues where id = v_hub) = 'signup', 'the city league is back in sign-up';

  -- The same teams can sign up for the next season; a full sign-up waits
  -- while Season 1 is unfinished.
  for i in 1 .. 3 loop
    v_error := tests.error_as(caps[i], format('select public.register_team_for_league(%L, %L)', v_hub, teams[i]));
    assert v_error is null, 'signs up again for Season 2: ' || coalesce(v_error, '');
  end loop;
  assert (select count(*) from public.leagues where parent_league_id = v_hub and kind = 'season') = 1,
    'no second season while Season 1 is unfinished';
  v_error := tests.error_as(caps[1], format('select public.start_league_season(%L)', v_hub));
  assert v_error = 'season_in_progress', 'starting one is refused, got ' || coalesce(v_error, 'no error');

  -- A season row never takes a registration.
  v_error := tests.error_as(caps[1], format('select public.register_team_for_league(%L, %L)', v_season, teams[1]));
  assert v_error in ('league_not_open', 'already_joined'), 'a season row isn''t joinable, got ' || coalesce(v_error, 'no error');
end $$;

-- 2. A season change keeps everything; the champion is recorded; the new
-- season works (standings, join, matches, Team of the Week, power ranking).
do $$
declare
  caps uuid[] := '{}';
  teams uuid[] := '{}';
  v_hub uuid := tests.s10_league('5-a-side', 12);
  v_s1 uuid;
  v_s2 uuid;
  v_s3 uuid;
  v_div1 uuid;
  v_div2 uuid;
  v_fixture uuid;
  v_match uuid;
  v_fixtures integer;
  v_error text;
  v_winner uuid;
  v_new_cap uuid := tests.create_user('s10-8-late-cap@futty.test');
  v_new_team uuid;
  v_final timestamptz;
  i integer;
begin
  for i in 1 .. 12 loop
    caps := caps || tests.create_user('s10-8-big-' || i || '@futty.test');
    teams := teams || tests.s10_team('S10-8 Club ' || lpad(i::text, 2, '0'), caps[i]);
  end loop;
  v_s1 := tests.s10_season(v_hub, teams);

  -- Club 05 wins a game in Season 1, through its match.
  v_fixture := tests.s10_fixture(v_s1, teams[5], teams[6]);
  v_match := tests.s10_schedule(v_fixture, date_trunc('minute', now()) - interval '3 hours');
  if (select home_team_id from public.league_fixtures where id = v_fixture) = teams[5] then
    perform tests.s10_result(v_fixture, 2, 0);
  else
    perform tests.s10_result(v_fixture, 0, 2);
  end if;
  perform tests.s10_final(v_match);
  v_fixtures := (select count(*) from public.league_fixtures where league_id = v_s1);
  assert v_fixtures = 66, 'a round robin of 12';

  v_error := tests.error_as(caps[1], format('select public.end_season_to_divisions(%L)', v_hub));
  assert v_error is null, 'Season 1 ends: ' || coalesce(v_error, '');

  assert (select champion_team_id from public.leagues where id = v_s1) = teams[5], 'the champion is recorded';
  assert (select ended_at from public.leagues where id = v_s1) is not null, 'Season 1 is finished';
  assert (select count(*) from public.league_fixtures where league_id = v_s1) = v_fixtures, 'every past fixture stays';
  assert (select count(*) from public.league_teams where league_id = v_s1) = 12, 'and its table';
  assert exists (select 1 from public.matches where id = v_match and league_fixture_id = v_fixture), 'and its match';
  assert (select status from public.league_fixtures where id = v_fixture) = 'completed', 'with its result';

  select id into v_s2 from public.leagues where parent_league_id = v_hub and season_number = 2;
  select id into v_div1 from public.leagues where parent_league_id = v_s2 and name = 'Division 1';
  select id into v_div2 from public.leagues where parent_league_id = v_s2 and name = 'Division 2';
  assert v_div1 is not null and v_div2 is not null, 'Season 2 has Division 1 and 2';
  assert (select count(*) from public.league_teams where league_id = v_div1) = 10, 'the top 10 in Division 1';
  assert (select count(*) from public.league_teams where league_id = v_div2) = 2, 'the rest in Division 2';
  assert exists (select 1 from public.league_teams where league_id = v_div1 and team_id = teams[5]),
    'the champion is in Division 1';
  assert not exists (select 1 from public.league_teams lt where lt.league_id in (v_div1, v_div2) and lt.played <> 0),
    'the new season starts empty';
  assert not exists (select 1 from public.league_standings(v_div1) s where s.played <> 0), 'its standings are empty';
  assert (select stage from public.leagues where id = v_hub) = 'divisions', 'the city league moves to divisions';

  -- The join flow: a new team waits in the pool.
  v_new_team := tests.s10_team('S10-8 Late', v_new_cap);
  v_error := tests.error_as(v_new_cap, format('select public.register_team_for_league(%L, %L)', v_hub, v_new_team));
  assert v_error is null, 'a new team joins the pool: ' || coalesce(v_error, '');

  -- A game in the new season: its match, the power ranking and the league
  -- Team of the Week all see it.
  v_fixture := tests.s10_fixture(v_div1, teams[1], teams[2]);
  v_match := tests.s10_schedule(v_fixture, date_trunc('minute', now()) - interval '3 hours');
  assert v_match is not null, 'a fixture in the new season has a match';
  perform tests.s10_result(v_fixture, 1, 0);
  perform tests.s10_play(v_match, caps[1], 7.5);
  v_final := tests.s10_final_at(v_match);
  perform tests.s10_final(v_match);
  perform tests.pr_tick(v_final);
  assert tests.pr_rows(v_fixture) = 2, 'the power ranking counts it';
  assert exists (select 1 from public.match_stat_players where match_id = v_match and league_id = v_div1),
    'its stats belong to the division (the league Team of the Week''s area)';

  -- Promotion and relegation: Season 3, Division 1's winner is the champion.
  v_winner := (select s.team_id from public.league_standings(v_div1) s where s.pos = 1);
  v_error := tests.error_as(caps[1], format('select public.apply_promotion_relegation(%L)', v_hub));
  assert v_error is null, 'promotion and relegation: ' || coalesce(v_error, '');
  assert (select champion_team_id from public.leagues where id = v_s2) = v_winner, 'Season 2''s champion';
  select id into v_s3 from public.leagues where parent_league_id = v_hub and season_number = 3;
  assert v_s3 is not null, 'Season 3 exists';
  assert (select count(*) from public.league_teams lt
          join public.leagues d on d.id = lt.league_id
          where d.parent_league_id = v_s3 and d.name = 'Division 1'
            and lt.team_id in (select team_id from public.league_teams where league_id = v_div2)) = 2,
    'Division 2''s top 2 go up';
  assert (select count(*) from public.league_teams lt
          join public.leagues d on d.id = lt.league_id
          where d.parent_league_id = v_s3 and d.name = 'Division 2') = 2, 'Division 1''s bottom 2 go down';
  assert (select count(*) from public.league_teams where league_id = v_div1) = 10, 'Season 2''s tables stay';
  assert (select count(*) from public.league_fixtures where league_id = v_s1) = v_fixtures, 'Season 1 stays too';
end $$;

rollback;
