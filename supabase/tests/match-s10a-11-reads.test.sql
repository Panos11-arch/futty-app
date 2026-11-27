-- S10A: what the tournament page reads (match-record.md decision 1o). A
-- tournament before sign-up shows "Coming soon" (no dates: the app shows
-- "Coming soon" instead of a date; header only). The knockout shows its
-- sources ("A1", "Winner QF1") until the teams are known. The competition
-- page's awards, stats, player stats (Premium) and power rankings read a
-- tournament as they read a season.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-11-admin@futty.test');
  v_soon uuid := tests.s10a_tournament(v_admin, false);
  v_t uuid := tests.s10a_tournament(v_admin, true, now() + interval '3 days');
  v_user uuid := tests.create_user('s10a-11-user@futty.test');
  v_premium uuid := tests.create_user('s10a-11-premium@futty.test');
  v_big uuid := tests.s10a_team('S10A-11 Big', 6);
  v_m uuid[] := tests.s10a_members(v_big);
  v_teams uuid[];
  v jsonb;
  v_row jsonb;
  v_error text;
  v_match uuid;
  v_fixture uuid;
begin
  perform tests.make_premium(v_premium);

  -- The list: both, the coming-soon one with no dates.
  v := tests.s10_json(v_user, 'select public.list_tournaments()');
  select r into v_row from jsonb_array_elements(v) r where r ->> 'id' = v_soon::text;
  assert v_row ->> 'status' = 'coming_soon' and (v_row ->> 'comingSoon')::boolean
         and v_row -> 'startDate' = 'null'::jsonb and v_row -> 'endDate' = 'null'::jsonb, 'coming soon, no dates: ' || v_row::text;
  assert v_row ->> 'name' = 'S10A Cup' and v_row ->> 'area' = 'Limassol' and v_row ->> 'format' = '5-a-side'
         and (v_row ->> 'maxTeams')::integer = 16 and (v_row ->> 'teamsCount')::integer = 0
         and (v_row ->> 'entryFeeCents')::integer = 500, 'header fields';
  assert exists (select 1 from jsonb_array_elements(v) r where r ->> 'id' = v_t::text and r ->> 'status' = 'registration'),
    'the open one';
  perform tests.act_as_anon();
  v_error := tests.error_of('select public.list_tournaments()');
  perform tests.act_as_postgres();
  assert v_error like 'permission denied%', 'anon refused, got ' || coalesce(v_error, 'no error');

  -- Coming soon: header only.
  v := tests.s10_json(v_user, format('select public.get_tournament(%L)', v_soon));
  assert (v ->> 'comingSoon')::boolean and not (v ? 'teams') and not (v ? 'myTeams'), 'header only: ' || v::text;
  v_error := tests.error_as(v_user, format('select public.get_tournament(%L)', gen_random_uuid()));
  assert v_error = 'tournament_not_found', 'unknown id, got ' || coalesce(v_error, 'no error');

  -- In registration: my team and squad, the deadline, the fee, the squad limits.
  perform tests.s10a_register(v_t, v_big, v_m[1:6], 'kitGreen');
  v := tests.s10_json(v_m[1], format('select public.get_tournament(%L)', v_t));
  assert not (v ->> 'comingSoon')::boolean and v ->> 'status' = 'registration', 'registration';
  assert (v ->> 'entryFeeCents')::integer = 500 and (v ->> 'squadMin')::integer = 5 and (v ->> 'squadMax')::integer = 7
         and v ->> 'registrationDeadline' is not null, 'fee, squad limits, deadline';
  assert jsonb_array_length(v -> 'myTeams') = 1 and v -> 'myTeams' -> 0 ->> 'teamId' = v_big::text
         and v -> 'myTeams' -> 0 ->> 'kitColour' = 'kitGreen'
         and jsonb_array_length(v -> 'myTeams' -> 0 -> 'squad') = 6
         and (v -> 'myTeams' -> 0 ->> 'canEditSquad')::boolean and (v -> 'myTeams' -> 0 ->> 'isCaptain')::boolean,
         'my team: ' || (v -> 'myTeams')::text;
  v := tests.s10_json(v_m[2], format('select public.get_tournament(%L)', v_t));
  assert jsonb_array_length(v -> 'myTeams') = 1 and not (v -> 'myTeams' -> 0 ->> 'canEditSquad')::boolean,
    'a squad player sees it, cannot edit';
  v := tests.s10_json(v_user, format('select public.get_tournament(%L)', v_t));
  assert jsonb_array_length(v -> 'myTeams') = 0, 'a stranger sees no squad';
  assert jsonb_array_length(v -> 'teams') = 1 and v -> 'teams' -> 0 ->> 'kitColour' = 'kitGreen'
         and not (v -> 'teams' -> 0 ? 'squad'), 'teams listed without squads';

  -- Knockout sources before the teams are known.
  v_teams := tests.s10a_fill(v_t);
  perform tests.s10a_set_groups(v_admin, v_t, v_teams);
  v := tests.s10_json(v_user, format('select public.get_tournament_knockout(%L)', v_t));
  assert jsonb_array_length(v) = 7, '7 knockout slots';
  select r into v_row from jsonb_array_elements(v) r where r ->> 'slot' = 'QF1';
  assert v_row ->> 'homeSource' = 'A1' and v_row ->> 'awaySource' = 'D2' and v_row -> 'homeTeamId' = 'null'::jsonb,
    'QF1 = A1 v D2: ' || v_row::text;
  select r into v_row from jsonb_array_elements(v) r where r ->> 'slot' = 'SF1';
  assert v_row ->> 'homeSource' = 'Winner QF1' and v_row ->> 'awaySource' = 'Winner QF3', 'SF1 sources';
  select r into v_row from jsonb_array_elements(v) r where r ->> 'slot' = 'SF2';
  assert v_row ->> 'homeSource' = 'Winner QF2' and v_row ->> 'awaySource' = 'Winner QF4', 'SF2 sources';
  select r into v_row from jsonb_array_elements(v) r where r ->> 'slot' = 'F';
  assert v_row ->> 'homeSource' = 'Winner SF1' and v_row ->> 'awaySource' = 'Winner SF2', 'final sources';

  -- Standings: four groups of four.
  v := tests.s10_json(v_user, format('select public.get_tournament_standings(%L)', v_t));
  assert jsonb_array_length(v -> 'groups') = 4
         and (select bool_and(jsonb_array_length(g -> 'rows') = 4) from jsonb_array_elements(v -> 'groups') g),
         'four groups of four';
  assert v -> 'groups' -> 0 ->> 'group' = 'A' and v -> 'groups' -> 0 -> 'rows' -> 0 ? 'kitColour'
         and v -> 'groups' -> 0 -> 'rows' -> 0 ? 'points' and v -> 'groups' -> 0 ? 'needsDraw', 'row shape';

  -- Matches: the whole list, or one team's.
  v := tests.s10_json(v_user, format('select public.get_tournament_matches(%L)', v_t));
  assert jsonb_array_length(v) = 31, '24 group + 7 knockout';
  v := tests.s10_json(v_user, format('select public.get_tournament_matches(%L, %L)', v_t, v_big));
  assert jsonb_array_length(v) = 3, 'a team''s 3 group games';
  assert (select bool_and(r ->> 'stage' = 'group' and r ? 'group' and r ? 'homePens') from jsonb_array_elements(v) r),
    'stage, group, pens';

  -- The competition page's tabs read a tournament.
  v_fixture := (select id from public.tournament_fixtures where tournament_id = v_t and v_big in (home_team_id, away_team_id)
                order by slot limit 1);
  v_match := tests.s10a_time(v_admin, v_fixture, now() - interval '3 hours');
  update public.matches set status = 'confirmed', side_a_score = 1, side_b_score = 0, confirmed_via = 'agreed',
                            confirmed_at = now() - interval '2 hours' where id = v_match;
  perform tests.s10_play(v_match, v_m[2], 8.5, 1);
  perform tests.s10_play(v_match, v_m[3], 7.0);

  v_error := tests.error_as(v_user, format('select public.get_competition_player_stats(%L)', v_t));
  assert v_error = 'premium_required', 'player stats Premium only, got ' || coalesce(v_error, 'no error');
  v := tests.s10_json(v_premium, format('select public.get_competition_player_stats(%L)', v_t));
  assert jsonb_array_length(v) = 2 and v -> 0 ->> 'profileId' = v_m[2]::text, 'Premium reads them: ' || v::text;
  -- Blocked players are left out.
  insert into public.blocked_users (blocker_id, blocked_id) values (v_premium, v_m[2]);
  v := tests.s10_json(v_premium, format('select public.get_competition_player_stats(%L)', v_t));
  assert jsonb_array_length(v) = 1 and v -> 0 ->> 'profileId' = v_m[3]::text, 'blocked left out';

  v := tests.s10_json(v_user, format('select public.get_competition_stats(%L, ''players'')', v_t));
  assert jsonb_array_length(v) = 5, 'players stats cards';
  v := tests.s10_json(v_user, format('select public.get_competition_stats(%L, ''teams'')', v_t));
  assert (select r -> 'rows' -> 0 ->> 'teamId' from jsonb_array_elements(v) r where r ->> 'category' = 'goals_scored')
         = (select home_team_id::text from public.tournament_fixtures where id = v_fixture),
         'the home side scored: ' || v::text;
  v := tests.s10_json(v_user, format('select public.get_competition_stats(%L, ''performances'')', v_t));
  assert (select r -> 'rows' -> 0 ->> 'profileId' from jsonb_array_elements(v) r where r ->> 'category' = 'rating')
         = v_m[2]::text, 'best performance';
  v := tests.s10_json(v_user, format('select public.get_competition_awards(%L)', v_t));
  assert v -> 'team' ->> 'format' = '5-a-side', 'awards read the tournament''s format';
end $$;

-- The power rankings tab lists the tournament's 16 teams.
do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-11b-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  v_n integer;
begin
  perform tests.act_as(tests.s10a_captain(v_teams[1]));
  select count(*) into v_n from public.get_competition_power_ranking(v_t);
  perform tests.act_as_postgres();
  assert v_n = 16, '16 teams, got ' || v_n;
end $$;

rollback;
