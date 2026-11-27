-- S10: a scheduled league fixture has exactly one match (match-record.md
-- decision 1n; Panos, 26 November).
begin;

do $$
declare
  cap_h uuid := tests.create_user('s10-1-cap-h@futty.test');
  cap_a uuid := tests.create_user('s10-1-cap-a@futty.test');
  cap_c uuid := tests.create_user('s10-1-cap-c@futty.test');
  p_h uuid := tests.create_user('s10-1-p-h@futty.test');
  p_a uuid := tests.create_user('s10-1-p-a@futty.test');
  t_h uuid := tests.s10_team('S10-1 Home', cap_h, array[p_h]);
  t_a uuid := tests.s10_team('S10-1 Away', cap_a, array[p_a]);
  t_c uuid := tests.s10_team('S10-1 Third', cap_c);
  v_hub uuid := tests.s10_league();
  v_season uuid := tests.s10_season(v_hub, array[t_h, t_a, t_c]);
  v_fixture uuid := tests.s10_fixture(v_season, t_h, t_a);
  v_other uuid := tests.s10_fixture(v_season, t_a, t_c);
  v_f public.league_fixtures;
  v_kickoff timestamptz := date_trunc('hour', now()) + interval '2 days';
  v_match uuid;
  v_m public.matches;
begin
  select * into v_f from public.league_fixtures where id = v_fixture;
  assert v_f.match_flow, 'a new fixture''s result comes from its match';

  -- Unscheduled: no match.
  assert tests.s10_match(v_fixture) is null, 'an unscheduled fixture has no match';
  update public.league_fixtures set scheduled_day = (v_kickoff at time zone 'Asia/Nicosia')::date where id = v_fixture;
  assert tests.s10_match(v_fixture) is null, 'a day without a time makes no match';

  -- Day and time: exactly one named, Competitive match.
  v_match := tests.s10_schedule(v_fixture, v_kickoff);
  assert v_match is not null, 'a scheduled fixture has a match';
  assert (select count(*) from public.matches where league_fixture_id = v_fixture) = 1, 'exactly one match';
  select * into v_m from public.matches where id = v_match;
  assert v_m.kind = 'named', 'a named game';
  assert v_m.booking_id is null, 'no booking';
  assert v_m.competitive, 'always Competitive';
  assert v_m.status = 'scheduled', 'scheduled';
  assert v_m.format = '5-a-side' and v_m.players_per_side = 5, 'the league''s format';
  assert v_m.kickoff_at = v_kickoff, 'kicks off at the fixture''s day and time (Cyprus)';
  assert v_m.ends_at = v_kickoff + interval '60 minutes', 'lasts league_match_minutes (60)';
  assert v_m.result_deadline_at = v_m.ends_at + interval '24 hours', 'the result deadline is the end + 24 hours';
  assert (select team_id from public.match_sides where match_id = v_match and side = 'a') = v_f.home_team_id,
    'side a is the home team';
  assert (select team_id from public.match_sides where match_id = v_match and side = 'b') = v_f.away_team_id,
    'side b is the away team';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'a')
         = case when v_f.home_team_id = t_h then cap_h else cap_a end, 'side a''s captain is the home captain';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'b')
         = case when v_f.away_team_id = t_h then cap_h else cap_a end, 'side b''s captain is the away captain';
  assert (select label from public.match_sides where match_id = v_match and side = 'a')
         = (select name from public.teams where id = v_f.home_team_id), 'sides carry the team names';
  assert (select count(*) from public.match_players where match_id = v_match and left_at is null) = 4,
    'every member of both teams plays';
  assert (select side from public.match_players where match_id = v_match and profile_id = p_h)
         = case when v_f.home_team_id = t_h then 'a' else 'b' end, 'each on his team''s side';
  assert exists (select 1 from public.match_check_in_codes where match_id = v_match), 'a check-in code';

  -- Agreeing the same day and time again changes nothing.
  perform tests.s10_schedule(v_fixture, v_kickoff);
  assert (select count(*) from public.matches where league_fixture_id = v_fixture) = 1, 'still one match';

  -- Rescheduled: the match follows and keeps its length.
  perform tests.s10_schedule(v_fixture, v_kickoff + interval '1 day 2 hours');
  select * into v_m from public.matches where id = v_match;
  assert v_m.kickoff_at = v_kickoff + interval '1 day 2 hours', 'the kickoff moves';
  assert v_m.ends_at = v_m.kickoff_at + interval '60 minutes', 'the end moves with it';
  assert v_m.result_deadline_at = v_m.ends_at + interval '24 hours', 'and the deadline';
  assert (select count(*) from public.matches where league_fixture_id = v_fixture) = 1, 'still one match';

  -- A new length applies only to matches created after it changes.
  update public.app_rules set league_match_minutes = 90;
  perform tests.s10_schedule(v_other, v_kickoff);
  assert (select ends_at - kickoff_at from public.matches where league_fixture_id = v_other) = interval '90 minutes',
    'a new match uses the new length';
  perform tests.s10_schedule(v_fixture, v_kickoff + interval '3 days');
  assert (select ends_at - kickoff_at from public.matches where id = v_match) = interval '60 minutes',
    'an existing match keeps its length';

  -- A second match for the fixture is refused.
  assert tests.error_of(format(
    'insert into public.matches (league_fixture_id, kind, format, players_per_side, kickoff_at, ends_at, result_deadline_at)
     values (%L, ''named'', ''5-a-side'', 5, now(), now() + interval ''1 hour'', now() + interval ''25 hours'')',
    v_fixture)) like '%matches_league_fixture_key%', 'exactly one match per fixture';
end $$;

-- A fixture made before S10 (match_flow false) never gets a match.
do $$
declare
  cap_x uuid := tests.create_user('s10-1-cap-x@futty.test');
  cap_y uuid := tests.create_user('s10-1-cap-y@futty.test');
  t_x uuid := tests.s10_team('S10-1 X', cap_x);
  t_y uuid := tests.s10_team('S10-1 Y', cap_y);
  v_hub uuid := tests.s10_league();
  v_fixture uuid;
begin
  insert into public.league_fixtures (league_id, home_team_id, away_team_id, match_flow)
  values (v_hub, t_x, t_y, false) returning id into v_fixture;
  perform tests.s10_schedule(v_fixture, now() + interval '1 day');
  assert tests.s10_match(v_fixture) is null, 'an old-path fixture has no match';
end $$;

rollback;
