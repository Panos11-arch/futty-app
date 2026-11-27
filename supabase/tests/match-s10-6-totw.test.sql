-- S10: a league game feeds its league's Team of the Week and not the
-- general one (match-record.md decisions 1k and 1n; Panos, 26 November).
begin;

do $$
declare
  cap_h uuid := tests.totw_user('s10-6-cap-h@futty.test');
  cap_a uuid := tests.totw_user('s10-6-cap-a@futty.test');
  star uuid := tests.totw_user('s10-6-star@futty.test');
  t_h uuid := tests.s10_team('S10-6 Home', cap_h, array[star]);
  t_a uuid := tests.s10_team('S10-6 Away', cap_a);
  v_hub uuid := tests.s10_league();
  v_season uuid := tests.s10_season(v_hub, array[t_h, t_a]);
  v_fixture uuid := tests.s10_fixture(v_season, t_h, t_a);
  -- A Wednesday evening in the week of Monday 16 November 2026.
  v_kickoff timestamptz := '2026-11-18 20:00 Asia/Nicosia';
  v_match uuid;
begin
  v_match := tests.s10_schedule(v_fixture, v_kickoff);
  perform tests.s10_result(v_fixture, 2, 0);
  perform tests.s10_play(v_match, star, 9.1, 2);
  perform tests.s10_play(v_match, cap_h, 7.0);
  perform tests.s10_play(v_match, cap_a, 6.0);

  perform tests.totw_tick('2026-11-23 10:00 Asia/Nicosia');

  assert exists (
    select 1 from public.team_of_the_week w
    join public.team_of_the_week_players p on p.team_of_the_week_id = w.id
    where w.week_start = '2026-11-16' and w.league_id = v_season and p.profile_id = star
  ), 'the league game feeds the league''s Team of the Week';
  assert not exists (
    select 1 from public.team_of_the_week w
    join public.team_of_the_week_players p on p.team_of_the_week_id = w.id
    where w.week_start = '2026-11-16' and w.league_id is null and p.profile_id = star
  ), 'and not the general one';
end $$;

rollback;
