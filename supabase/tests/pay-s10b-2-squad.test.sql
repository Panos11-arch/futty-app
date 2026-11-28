-- S10B: starters and subs, and the waiting list (spec 13 "Tournament entry
-- (S10B)", decided by Panos 28 November). The captain marks each squad
-- member as a starter or a sub until the deadline; an admin changing a squad
-- marks them too. Teams beyond the maximum wait in registration order.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-2-admin@futty.test');
  v_t uuid := tests.s10b_tournament(v_admin);
  v_team uuid := tests.s10a_team('S10B-2 Squad', 7);
  v_m uuid[] := tests.s10a_members(v_team);
  v_error text;
  v_waiting uuid;
  v_later uuid;
  v_full uuid[];
begin
  -- Exactly the format's starters (5), the rest subs, all in the squad.
  v_error := tests.error_as(v_m[1], format('select public.register_team_for_tournament(%L, %L, %L, %L, %L)',
    v_t, v_team, 'kitBlue', v_m[1:7], v_m[5:7]));
  assert v_error = 'starters_count', '4 starters refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_m[1], format('select public.register_team_for_tournament(%L, %L, %L, %L, %L)',
    v_t, v_team, 'kitBlue', v_m[1:6], array[v_m[7]]));
  assert v_error = 'sub_not_in_squad', 'a sub outside the squad refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_m[1], format('select public.register_team_for_tournament(%L, %L, %L, %L, %L)',
    v_t, v_team, 'kitBlue', v_m[1:7], v_m[6:7]));
  assert v_error is null, '5 starters and 2 subs, got ' || coalesce(v_error, '');
  assert (select count(*) from public.tournament_squads where tournament_id = v_t and team_id = v_team and role = 'starter') = 5, '5 starters';
  assert (select array_agg(profile_id order by profile_id) from public.tournament_squads
          where tournament_id = v_t and team_id = v_team and role = 'sub')
         = (select array_agg(x order by x) from unnest(v_m[6:7]) x), 'the 2 subs';

  -- The captain swaps a starter and a sub before the deadline.
  v_error := tests.error_as(v_m[1], format('select public.set_tournament_squad(%L, %L, %L, %L)',
    v_t, v_team, v_m[1:7], array[v_m[5], v_m[7]]));
  assert v_error is null, 'swapped, got ' || coalesce(v_error, '');
  assert (select role from public.tournament_squads where tournament_id = v_t and profile_id = v_m[5]) = 'sub', 'now a sub';
  assert (select role from public.tournament_squads where tournament_id = v_t and profile_id = v_m[6]) = 'starter', 'now a starter';
  v_error := tests.error_as(v_m[1], format('select public.set_tournament_squad(%L, %L, %L, %L)',
    v_t, v_team, v_m[1:7], array[v_m[7]]));
  assert v_error = 'starters_count', '6 starters refused, got ' || coalesce(v_error, 'no error');

  -- Without subs given (S10A's calls), the members after the format's starters are subs.
  v_error := tests.error_as(v_m[1], format('select public.set_tournament_squad(%L, %L, %L)', v_t, v_team, v_m[1:6]));
  assert v_error is null, 'S10A call, got ' || coalesce(v_error, '');
  assert (select role from public.tournament_squads where tournament_id = v_t and profile_id = v_m[6]) = 'sub', 'the 6th is a sub';

  -- After the deadline an admin changes the squad and marks it too.
  update public.tournaments set registration_deadline = now() - interval '1 minute' where id = v_t;
  v_error := tests.error_as(v_m[1], format('select public.set_tournament_squad(%L, %L, %L, %L)',
    v_t, v_team, v_m[1:6], array[v_m[1]]));
  assert v_error = 'deadline_passed', 'captain refused after the deadline, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_set_squad(%L, %L, %L, %L)',
    v_t, v_team, v_m[1:6], array[v_m[2]]));
  assert v_error is null, 'admin marks the sub, got ' || coalesce(v_error, '');
  assert (select role from public.tournament_squads where tournament_id = v_t and profile_id = v_m[2]) = 'sub', 'admin made a sub';
  v_error := tests.error_as(v_admin, format('select public.admin_set_squad(%L, %L, %L, %L)',
    v_t, v_team, v_m[1:6], v_m[1:2]));
  assert v_error = 'starters_count', 'admin keeps 5 starters, got ' || coalesce(v_error, 'no error');

  -- The waiting list: a 17th team waits instead of being refused, in registration order.
  v_t := tests.s10b_tournament(v_admin);
  v_full := tests.s10a_fill(v_t);
  assert (select count(*) from public.tournament_teams where tournament_id = v_t and place = 'spot') = 16, '16 spots';
  v_waiting := tests.s10b_team(v_t, 'S10B-2 First waiting');
  v_later := tests.s10b_team(v_t, 'S10B-2 Second waiting');
  assert (select place from public.tournament_teams where tournament_id = v_t and team_id = v_waiting) = 'waiting', 'waits';
  assert (select place from public.tournament_teams where tournament_id = v_t and team_id = v_later) = 'waiting', 'waits too';
  -- The page counts spots, and says how many wait and where my team is.
  assert (public.tournament_header_json((select t from public.tournaments t where t.id = v_t)) ->> 'teamsCount')::integer = 16,
    'teamsCount is the spots';
  perform tests.act_as(tests.s10a_captain(v_later));
  assert (public.get_tournament(v_t) ->> 'waitingCount')::integer = 2, 'two wait';
  assert (public.get_tournament(v_t) -> 'myTeams' -> 0 ->> 'place') = 'waiting', 'my team waits';
  assert (public.get_tournament(v_t) -> 'myTeams' -> 0 ->> 'waitingPosition')::integer = 2, 'second in line';
  perform tests.act_as_postgres();
end $$;

rollback;
