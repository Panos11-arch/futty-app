-- S11: which reads that rank players need Premium (match-record.md decision
-- 1n item 7, decided by Anghelo on 27 November; for Panos's OK). Only the
-- full Player stats table (get_competition_player_stats) is Premium; the
-- server refuses everyone else (premium_required, profiles.is_premium). The
-- Stats tab, Player and Team of the season, the competition's power
-- ranking, the venue and city leaderboards, the venue page's top players
-- and Team of the Week are free to every signed-in player. Nothing here is
-- open to a signed-out caller.
--
-- The app can't make anyone Premium: authenticated has no update on
-- profiles.is_premium (baseline.test.sql, pay-guards-3-window.test.sql).
begin;

do $$
declare
  cap_h uuid := tests.create_user('s11-1-cap-h@futty.test');
  cap_a uuid := tests.create_user('s11-1-cap-a@futty.test');
  scorer uuid := tests.create_user('s11-1-scorer@futty.test');
  basic uuid := tests.create_user('s11-1-basic@futty.test');
  premium uuid := tests.create_user('s11-1-premium@futty.test');
  ended uuid := tests.create_user('s11-1-ended@futty.test');
  t_h uuid := tests.s10_team('S11-1 Home', cap_h, array[scorer]);
  t_a uuid := tests.s10_team('S11-1 Away', cap_a);
  v_season uuid := tests.s10_season(tests.s10_league(), array[t_h, t_a]);
  v_fixture uuid := tests.s10_fixture(v_season, t_h, t_a);
  v_match uuid := tests.s10_schedule(v_fixture, date_trunc('minute', now()) - interval '3 hours');
  v_venue uuid := tests.create_venue();
  v_free text[] := array[
    format('select public.get_competition_stats(%L, %L)', v_season, 'players'),
    format('select public.get_competition_stats(%L, %L)', v_season, 'teams'),
    format('select public.get_competition_stats(%L, %L)', v_season, 'performances'),
    format('select public.get_competition_awards(%L)', v_season),
    format('select public.get_competition_awards(%L, 1)', v_season),
    format('select to_jsonb(array(select public.get_competition_power_ranking(%L)))', v_season),
    format('select to_jsonb(array(select l.profile_id from public.stats_leaderboards l where l.scope_key = %L))', v_venue),
    'select to_jsonb(array(select p.profile_id from public.team_of_the_week_players p))',
    format('select public.venue_highlights(%L)', v_venue)];
  v_sql text;
  v_rows jsonb;
  v_error text;
  m uuid;
  i integer;
begin
  perform tests.make_premium(premium);
  perform tests.make_premium(ended);
  update public.profiles set is_premium = false where id = ended;
  if (select home_team_id from public.league_fixtures where id = v_fixture) = t_h then
    perform tests.s10_result(v_fixture, 1, 0);
  else
    perform tests.s10_result(v_fixture, 0, 1);
  end if;
  perform tests.s10_play(v_match, scorer, 8.0, 1);
  -- Three Competitive games at a venue, so its leaderboard and top players have a row.
  for i in 1 .. 3 loop
    m := tests.totw_match(now() - make_interval(days => i + 1), '5-a-side', v_venue);
    perform tests.totw_play(m, scorer, 7.5, 1);
  end loop;

  -- 1. Player stats: Premium only.
  v_error := tests.error_as(basic, format('select public.get_competition_player_stats(%L)', v_season));
  assert v_error = 'premium_required', 'Basic is refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(ended, format('select public.get_competition_player_stats(%L, %L)', v_season, t_h));
  assert v_error = 'premium_required', 'ended Premium is refused, with a team filter too, got ' || coalesce(v_error, 'no error');
  v_rows := tests.s10_json(premium, format('select public.get_competition_player_stats(%L)', v_season));
  assert exists (select 1 from jsonb_array_elements(v_rows) x where x ->> 'profileId' = scorer::text),
    'Premium gets the table, got ' || v_rows::text;

  -- 2. Every other ranking read is free: a Basic player gets data.
  foreach v_sql in array v_free loop
    v_error := tests.error_as(basic, v_sql);
    assert v_error is null, format('free for Basic: %s, got %s', v_sql, v_error);
  end loop;
  v_rows := tests.s10_json(basic, format('select public.get_competition_stats(%L, %L, %L, 10)', v_season, 'players', 'goals'));
  assert v_rows -> 0 -> 'rows' -> 0 ->> 'profileId' = scorer::text, 'Stats tab: Basic sees the top scorer';
  v_rows := tests.s10_json(basic, format(
    'select to_jsonb(array(select l.profile_id from public.stats_leaderboards l where l.scope = %L and l.scope_key = %L))',
    'venue', v_venue));
  assert v_rows ? scorer::text, 'venue leaderboard: Basic sees it, got ' || v_rows::text;
  v_rows := tests.s10_json(basic, format('select public.venue_highlights(%L) -> %L', v_venue, 'top_players'));
  assert v_rows -> 0 ->> 'profile_id' = scorer::text, 'venue top players: Basic sees them, got ' || v_rows::text;

  -- 3. Nothing is open to a signed-out caller.
  perform tests.act_as_anon();
  v_error := tests.error_of(format('select public.get_competition_player_stats(%L)', v_season));
  assert v_error like 'permission denied%', 'anon: Player stats, got ' || coalesce(v_error, 'no error');
  foreach v_sql in array v_free loop
    v_error := tests.error_of(v_sql);
    assert v_error like 'permission denied%' or v_error = 'not_authenticated',
      format('anon refused: %s, got %s', v_sql, coalesce(v_error, 'no error'));
  end loop;
  perform tests.act_as_postgres();
end $$;

rollback;
