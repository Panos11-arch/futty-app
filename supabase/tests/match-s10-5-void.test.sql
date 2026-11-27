-- S10: a voided or forfeited fixture cancels its match: no stats, no
-- levels, and a result that had already counted leaves the power ranking
-- (match-record.md decision 1n; Panos, 26 November).
begin;

do $$
declare
  cap_h uuid := tests.create_user('s10-5-cap-h@futty.test');
  cap_a uuid := tests.create_user('s10-5-cap-a@futty.test');
  cap_c uuid := tests.create_user('s10-5-cap-c@futty.test');
  p_h uuid := tests.create_user('s10-5-p-h@futty.test');
  t_h uuid := tests.s10_team('S10-5 Home', cap_h, array[p_h]);
  t_a uuid := tests.s10_team('S10-5 Away', cap_a);
  t_c uuid := tests.s10_team('S10-5 Third', cap_c);
  v_hub uuid := tests.s10_league();
  v_season uuid := tests.s10_season(v_hub, array[t_h, t_a, t_c]);
  v_counted uuid := tests.s10_fixture(v_season, t_h, t_a);
  v_future uuid := tests.s10_fixture(v_season, t_h, t_c);
  v_forfeit uuid := tests.s10_fixture(v_season, t_a, t_c);
  v_f public.league_fixtures;
  v_match uuid;
  v_final timestamptz;
begin
  -- Voided before it's played: the match is void.
  v_match := tests.s10_schedule(v_future, now() + interval '2 days');
  update public.league_fixtures set forfeit_result = 'void' where id = v_future;
  assert (select status from public.matches where id = v_match) = 'void', 'a void fixture''s match is void';

  -- Forfeited before it's played: the match is void; the win counts.
  v_match := tests.s10_schedule(v_forfeit, now() + interval '2 days');
  select * into v_f from public.league_fixtures where id = v_forfeit;
  update public.league_fixtures set forfeit_result = 'home_forfeited' where id = v_forfeit;
  assert (select status from public.matches where id = v_match) = 'void', 'a forfeited fixture''s match is void';
  assert (tests.s10_row(v_season, v_f.away_team_id) ->> 'points')::integer = 3, 'the other team gets the win';

  -- Counted, then voided: it leaves the power ranking and the stats.
  v_match := tests.s10_schedule(v_counted, date_trunc('minute', now()) - interval '3 hours');
  perform tests.s10_result(v_counted, 3, 0);
  perform tests.s10_play(v_match, p_h, 8.0, 2);
  v_final := tests.s10_final_at(v_match);
  perform tests.s10_final(v_match);
  assert (select status from public.league_fixtures where id = v_counted) = 'completed', 'counted';
  perform tests.pr_tick(v_final);
  assert tests.pr_rows(v_counted) = 2, 'in the power ranking';
  assert exists (select 1 from public.match_stat_players where match_id = v_match), 'in the stats';

  update public.league_fixtures set forfeit_result = 'void' where id = v_counted;
  assert (select status from public.matches where id = v_match) = 'void', 'the match is void';
  perform tests.pr_tick(v_final + interval '1 minute');
  assert tests.pr_rows(v_counted) = 0, 'it leaves the power ranking';
  assert not exists (select 1 from public.match_stat_players where match_id = v_match), 'and the stats';
  assert (tests.s10_row(v_season, t_h) ->> 'played')::integer = 0, 'and the standings';
end $$;

rollback;
