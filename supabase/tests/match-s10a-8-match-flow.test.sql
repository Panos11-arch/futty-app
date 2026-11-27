-- S10A: a fixture with a kick-off time gets exactly one named match (no
-- booking): side a = home, side b = away, each team's captain, always
-- Competitive, the tournament's match length, and the team's squad as its
-- players, not all its members (Anghelo, 27 November). Only a team's own
-- captain logs its side (S13B). log_match_result keeps working exactly as
-- the app calls it today.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-8-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_big uuid := tests.s10a_team('S10A-8 Big', 7);
  v_m uuid[] := tests.s10a_members(v_big);
  v_teams uuid[];
  v_opp uuid;
  v_fixture uuid;
  v_match uuid;
  v_kickoff timestamptz := date_trunc('minute', now()) + interval '2 days';
  v_error text;
  v_side text;
  v_other_cap uuid;
  v record;
begin
  perform tests.s10a_register(v_t, v_big, v_m[1:5]);
  v_teams := tests.s10a_fill(v_t);
  perform tests.s10a_set_groups(v_admin, v_t, v_teams);
  v_fixture := (select id from public.tournament_fixtures where tournament_id = v_t and stage = 'group'
                and v_big in (home_team_id, away_team_id) order by slot limit 1);
  select case when home_team_id = v_big then away_team_id else home_team_id end,
         case when home_team_id = v_big then 'a' else 'b' end
  into v_opp, v_side from public.tournament_fixtures where id = v_fixture;

  -- No time, no match.
  assert not exists (select 1 from public.matches where tournament_fixture_id = v_fixture), 'no match yet';
  -- Only an admin sets times.
  v_error := tests.error_as(v_m[1], format('select public.admin_set_fixture_time(%L, now())', v_fixture));
  assert v_error = 'not_admin', 'a captain cannot, got ' || coalesce(v_error, 'no error');

  v_match := tests.s10a_time(v_admin, v_fixture, v_kickoff);
  assert (select count(*) from public.matches where tournament_fixture_id = v_fixture) = 1, 'one match';
  select * into v from public.matches where id = v_match;
  assert v.kind = 'named' and v.booking_id is null and v.competitive and v.format = '5-a-side', 'named, no booking, Competitive';
  assert v.kickoff_at = v_kickoff and v.ends_at = v_kickoff + interval '50 minutes'
         and v.result_deadline_at = v_kickoff + interval '50 minutes 24 hours', 'the tournament''s 50 minutes';
  assert (select (team_id, captain_profile_id) from public.match_sides where match_id = v_match and side = v_side)
         = (v_big, v_m[1]), 'the team''s side and captain';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side <> v_side)
         = tests.s10a_captain(v_opp), 'the other captain';
  -- The squad plays, not every member.
  assert (select array_agg(profile_id order by profile_id) from public.match_players
          where match_id = v_match and side = v_side and left_at is null)
         = (select array_agg(x order by x) from unnest(v_m[1:5]) x), 'the squad of 5 only';
  assert not exists (select 1 from public.match_players where match_id = v_match and profile_id in (v_m[6], v_m[7])),
    'members outside the squad are not in the match';

  -- Rescheduled: the same match moves and keeps its length.
  perform tests.s10a_time(v_admin, v_fixture, v_kickoff + interval '1 day');
  assert (select count(*) from public.matches where tournament_fixture_id = v_fixture) = 1, 'still one';
  assert (select (kickoff_at, ends_at - kickoff_at) from public.matches where id = v_match)
         = (v_kickoff + interval '1 day', interval '50 minutes'), 'moved';

  -- A squad change before kickoff (by an admin: sign-up is over) follows into the match.
  v_error := tests.error_as(v_admin, format('select public.admin_set_squad(%L, %L, %L)', v_t, v_big, v_m[1:4] || v_m[6]));
  assert v_error is null, 'squad changed, got ' || coalesce(v_error, '');
  assert exists (select 1 from public.match_players where match_id = v_match and profile_id = v_m[6] and left_at is null),
    'the new squad player is in';
  assert exists (select 1 from public.match_players where match_id = v_match and profile_id = v_m[5] and left_at is not null),
    'the removed one has left';

  -- Always Competitive.
  v_error := tests.error_as(v_m[1], format('select public.set_match_competitive(%L, false)', v_match));
  assert v_error = 'tournament_always_competitive', 'no Friendly, got ' || coalesce(v_error, 'no error');

  -- Only each side's own captain logs (after kickoff).
  update public.matches set kickoff_at = now() - interval '2 hours', ends_at = now() - interval '70 minutes',
                            result_deadline_at = now() + interval '22 hours', status = 'played'
  where id = v_match;
  v_error := tests.s10a_log_error(v_m[2], v_match, 1, 0);
  assert v_error = 'not_captain', 'a squad player cannot log, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_log_error(v_m[7], v_match, 1, 0);
  assert v_error = 'not_in_match', 'a member outside the squad cannot, got ' || coalesce(v_error, 'no error');
  v_other_cap := tests.s10a_captain((select team_id from public.tournament_teams where tournament_id = v_t
                                     and team_id not in (v_big, v_opp) limit 1));
  v_error := tests.s10a_log_error(v_other_cap, v_match, 1, 0);
  assert v_error = 'not_in_match', 'another team''s captain cannot, got ' || coalesce(v_error, 'no error');
  assert public.match_side_writer(v_match, v_m[1]) = array[v_side], 'the captain writes only his side';
  v_error := tests.s10a_log_error(v_m[1], v_match, 1, 0);
  assert v_error is null, 'the captain logs, got ' || coalesce(v_error, '');
end $$;

-- log_match_result as the app calls it today (named arguments, no pens),
-- on a game that isn't a tournament's: still one function, still works.
do $$
declare
  v record;
  v_res jsonb;
begin
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'log_match_result') = 1, 'one log_match_result, no overload';
  select * into v from tests.s13b_match(2, 2, false);
  perform tests.act_as(v.cap_a);
  v_res := public.log_match_result(
    p_match_id => v.match,
    p_side_a_score => 2,
    p_side_b_score => 1,
    p_stats => jsonb_build_object('a', tests.s13b_side(v.match, v.a, array[1, 1])));
  perform tests.act_as_postgres();
  assert v_res ->> 'status' = 'waiting', 'logged, got ' || v_res::text;
  perform tests.act_as(v.cap_b);
  v_res := public.log_match_result(
    p_match_id => v.match,
    p_side_a_score => 2,
    p_side_b_score => 1,
    p_stats => jsonb_build_object('b', tests.s13b_side(v.match, v.b, array[1, 0])));
  perform tests.act_as_postgres();
  assert v_res ->> 'status' = 'confirmed', 'confirmed, got ' || v_res::text;
  assert (select (side_a_score, side_b_score, side_a_pens, side_b_pens) from public.matches where id = v.match)
         = (2, 1, null::integer, null::integer), 'no shootout on an ordinary game';
  -- An ordinary game never takes penalties.
  select * into v from tests.s13b_match(1, 1, false);
  assert tests.s10a_log_error(v.cap_a, v.match, 1, 1, 4, 3) = 'shootout_not_allowed', 'pens refused outside a knockout';
end $$;

rollback;
