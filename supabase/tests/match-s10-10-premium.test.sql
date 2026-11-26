-- S10: Player stats is Premium only; the server refuses everyone else
-- (profiles.is_premium). Minors' names and blocks follow the existing rules
-- (match-record.md decision 1n; spec 05 section 16).
begin;

do $$
declare
  cap_h uuid := tests.create_user('s10-10-cap-h@futty.test');
  cap_a uuid := tests.create_user('s10-10-cap-a@futty.test');
  scorer uuid := tests.create_user('s10-10-scorer@futty.test');
  minor uuid := tests.create_user('s10-10-minor@futty.test',
    jsonb_build_object('date_of_birth', (current_date - interval '15 years')::date, 'full_name', 'Minnie Young',
                       'first_name', 'Minnie'));
  blocked uuid := tests.create_user('s10-10-blocked@futty.test');
  basic uuid := tests.create_user('s10-10-basic@futty.test');
  premium uuid := tests.create_user('s10-10-premium@futty.test');
  t_h uuid := tests.s10_team('S10-10 Home', cap_h, array[scorer, minor, blocked]);
  t_a uuid := tests.s10_team('S10-10 Away', cap_a);
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_h, t_a]);
  v_fixture uuid := tests.s10_fixture(v_season, t_h, t_a);
  v_match uuid := tests.s10_schedule(v_fixture, date_trunc('minute', now()) - interval '3 hours');
  v_home boolean := (select home_team_id from public.league_fixtures where id = v_fixture) = t_h;
  v_rows jsonb;
  v_row jsonb;
  v_error text;
begin
  perform tests.make_premium(premium);
  if v_home then perform tests.s10_result(v_fixture, 2, 0); else perform tests.s10_result(v_fixture, 0, 2); end if;
  perform tests.s10_play(v_match, scorer, 8.4, 2);
  perform tests.s10_play(v_match, minor, 7.1, 0, 1);
  perform tests.s10_play(v_match, blocked, 6.8);
  perform tests.s10_play(v_match, cap_a, 5.9);
  insert into public.blocked_users (blocker_id, blocked_id) values (premium, blocked);

  -- Refused without Premium.
  v_error := tests.error_as(basic, format('select public.get_competition_player_stats(%L)', v_season));
  assert v_error = 'premium_required', 'a Basic player is refused, got ' || coalesce(v_error, 'no error');
  update public.profiles set is_premium = false where id = premium;
  v_error := tests.error_as(premium, format('select public.get_competition_player_stats(%L)', v_season));
  assert v_error = 'premium_required', 'refused once Premium ends, got ' || coalesce(v_error, 'no error');
  perform tests.make_premium(premium);

  -- Allowed with Premium.
  v_rows := tests.s10_json(premium, format('select public.get_competition_player_stats(%L)', v_season));
  assert v_rows -> 0 ->> 'profileId' = scorer::text, 'the best rating first';
  select x into v_row from jsonb_array_elements(v_rows) x where x ->> 'profileId' = scorer::text;
  assert (v_row ->> 'rating')::numeric = 8.4, 'rating';
  assert (v_row ->> 'matches')::integer = 1, 'matches';
  assert (v_row ->> 'goals')::integer = 2, 'goals';
  assert (v_row ->> 'cleanSheets')::integer = 1, 'a clean sheet';
  assert (v_row ->> 'goalsConcededPerMatch')::numeric = 0, 'goals conceded per match';
  assert v_row ->> 'teamId' = t_h::text, 'his team';
  select x into v_row from jsonb_array_elements(v_rows) x where x ->> 'profileId' = minor::text;
  assert (v_row ->> 'assists')::integer = 1, 'assists';
  assert v_row ->> 'name' = 'Minnie', 'a minor shows a first name only, got ' || coalesce(v_row ->> 'name', 'null');
  assert not exists (select 1 from jsonb_array_elements(v_rows) x where x ->> 'profileId' = blocked::text),
    'a blocked player is left out';
  select x into v_row from jsonb_array_elements(v_rows) x where x ->> 'profileId' = cap_a::text;
  assert (v_row ->> 'goalsConcededPerMatch')::numeric = 2, 'the other side conceded 2';

  -- Filter by team.
  v_rows := tests.s10_json(premium, format('select public.get_competition_player_stats(%L, %L)', v_season, t_a));
  assert jsonb_array_length(v_rows) = 1 and v_rows -> 0 ->> 'profileId' = cap_a::text, 'one team''s players';

  -- The free Stats tab: no Premium needed; blocks apply too.
  v_rows := tests.s10_json(basic, format('select public.get_competition_stats(%L, %L, %L, 10)', v_season, 'players', 'goals'));
  assert v_rows -> 0 -> 'rows' -> 0 ->> 'profileId' = scorer::text, 'Goals: the scorer';
  assert jsonb_array_length(v_rows -> 0 -> 'rows') = 1, 'zeros are left out';
  v_rows := tests.s10_json(premium, format('select public.get_competition_stats(%L, %L, %L, 10)', v_season, 'players', 'rating'));
  assert not exists (select 1 from jsonb_array_elements(v_rows -> 0 -> 'rows') x where x ->> 'profileId' = blocked::text),
    'a blocked player is left out of Stats';
  v_error := tests.error_as(basic, format('select public.get_competition_stats(%L, %L)', v_season, 'odds'));
  assert v_error = 'invalid_tab', 'an unknown tab is refused';
end $$;

rollback;
