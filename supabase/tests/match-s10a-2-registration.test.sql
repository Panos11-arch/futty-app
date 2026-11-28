-- S10A: a captain registers his team with a squad of 5 to 7 (starters plus
-- up to 2 subs); he changes it until the registration deadline, then only
-- an admin can, and every change is logged (Anghelo, 27 November;
-- match-record.md decision 1o).
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-2-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin, true, now() + interval '1 day');
  v_soon uuid := tests.s10a_tournament(v_admin, false);
  v_big uuid := tests.s10a_team('S10A-2 Big', 8);
  v_other uuid := tests.s10a_team('S10A-2 Other', 5);
  v_m uuid[] := tests.s10a_members(v_big);
  v_om uuid[] := tests.s10a_members(v_other);
  v_stranger uuid := tests.create_user('s10a-2-stranger@futty.test');
  v_late uuid := tests.s10a_team('S10A-2 Late', 5);
  v_error text;
  v_full uuid;
begin
  -- Only the team's captain.
  v_error := tests.error_as(v_m[2], format('select public.register_team_for_tournament(%L, %L, %L, %L)',
                                           v_t, v_big, 'kitBlue', v_m[1:5]));
  assert v_error = 'not_captain', 'a player cannot register, got ' || coalesce(v_error, 'no error');

  -- Not before sign-up opens.
  v_error := tests.s10a_register(v_soon, v_big);
  assert v_error = 'registration_closed', 'coming soon refuses, got ' || coalesce(v_error, 'no error');

  -- Squad size 5 to 7, members only, a known kit colour.
  v_error := tests.s10a_register(v_t, v_big, v_m[1:4]);
  assert v_error = 'squad_size', '4 refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_register(v_t, v_big, v_m[1:8]);
  assert v_error = 'squad_size', '8 refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_register(v_t, v_big, v_m[1:4] || v_stranger);
  assert v_error = 'not_team_member', 'a stranger refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_register(v_t, v_big, v_m[1:5], 'kitPink');
  assert v_error = 'invalid_kit_colour', 'unknown colour refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_register(v_t, v_big, v_m[1:4] || v_m[1]);
  assert v_error = 'squad_size', 'a repeated player does not count twice, got ' || coalesce(v_error, 'no error');

  v_error := tests.s10a_register(v_t, v_big, v_m[1:7], 'kitBlue');
  assert v_error is null, '7 registered, got ' || coalesce(v_error, '');
  assert (select kit_colour from public.tournament_teams where tournament_id = v_t and team_id = v_big) = 'kitBlue', 'kit';
  assert (select count(*) from public.tournament_squads where tournament_id = v_t and team_id = v_big) = 7, 'squad of 7';
  assert (select count(*) from public.tournament_squad_changes
          where tournament_id = v_t and team_id = v_big and change = 'added' and not by_admin) = 7, 'each logged';
  v_error := tests.s10a_register(v_t, v_big, v_m[1:5]);
  assert v_error = 'already_registered', 'once, got ' || coalesce(v_error, 'no error');

  -- One squad per player per tournament.
  perform tests.join_team(v_other, v_m[2]);
  v_error := tests.s10a_register(v_t, v_other, v_om[1:4] || v_m[2]);
  assert v_error = 'player_in_other_squad', 'in two squads refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_register(v_t, v_other, v_om);
  assert v_error is null, 'without him, got ' || coalesce(v_error, '');

  -- Squads aren't public (read through get_tournament, own team only); changes go through functions.
  v_error := tests.error_as(v_stranger, 'select count(*) from public.tournament_squads');
  assert v_error like 'permission denied%', 'squads not readable directly, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_stranger, 'select count(*) from public.tournament_squad_changes');
  assert v_error like 'permission denied%', 'nor their log, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(tests.s10a_captain(v_big), format(
    'insert into public.tournament_squads (tournament_id, team_id, profile_id) values (%L, %L, %L)', v_t, v_big, v_m[8]));
  assert v_error like 'permission denied%', 'no direct write, got ' || coalesce(v_error, 'no error');

  -- Before the deadline the captain changes it.
  v_error := tests.error_as(tests.s10a_captain(v_big), format('select public.set_tournament_squad(%L, %L, %L)',
                                                            v_t, v_big, v_m[1:5] || v_m[8]));
  assert v_error is null, 'changed, got ' || coalesce(v_error, '');
  assert (select array_agg(profile_id order by profile_id) from public.tournament_squads where tournament_id = v_t and team_id = v_big)
         = (select array_agg(x order by x) from unnest(v_m[1:5] || v_m[8]) x), 'the new squad';
  assert (select count(*) from public.tournament_squad_changes where tournament_id = v_t and team_id = v_big
          and change = 'removed' and profile_id in (v_m[6], v_m[7])) = 2, 'removals logged';
  v_error := tests.error_as(v_m[2], format('select public.set_tournament_squad(%L, %L, %L)', v_t, v_big, v_m[1:5]));
  assert v_error = 'not_captain', 'a player cannot, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(tests.s10a_captain(v_big), format('select public.set_tournament_squad(%L, %L, %L)',
                                                            v_t, v_big, v_m[1:3]));
  assert v_error = 'squad_size', 'still 5 to 7, got ' || coalesce(v_error, 'no error');

  -- After the deadline: the captain can't, nor can a new team register; an admin can (an injury).
  update public.tournaments set registration_deadline = now() - interval '1 minute' where id = v_t;
  v_error := tests.error_as(tests.s10a_captain(v_big), format('select public.set_tournament_squad(%L, %L, %L)',
                                                            v_t, v_big, v_m[1:5]));
  assert v_error = 'deadline_passed', 'captain refused after the deadline, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10a_register(v_t, v_late);
  assert v_error = 'deadline_passed', 'late registration refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_set_squad(%L, %L, %L)', v_t, v_big, v_m[1:5] || v_m[7]));
  assert v_error is null, 'admin changes it, got ' || coalesce(v_error, '');
  assert exists (select 1 from public.tournament_squad_changes where tournament_id = v_t and team_id = v_big
                 and profile_id = v_m[7] and change = 'added' and by_admin and changed_by = v_admin), 'logged as admin';
  assert exists (select 1 from public.tournament_squad_changes where tournament_id = v_t and team_id = v_big
                 and profile_id = v_m[8] and change = 'removed' and by_admin), 'removal logged as admin';
  v_error := tests.error_as(v_admin, format('select public.admin_set_squad(%L, %L, %L)', v_t, v_big, v_m[1:4]));
  assert v_error = 'squad_size', 'admin keeps the size too, got ' || coalesce(v_error, 'no error');

  -- Full at 16: since S10B a 17th team waits (spec 13 "Tournament entry (S10B)").
  v_full := tests.s10a_tournament(v_admin);
  perform tests.s10a_fill(v_full);
  v_error := tests.s10a_register(v_full, v_late);
  assert v_error is null, '17th waits, got ' || coalesce(v_error, '');
  assert (select place from public.tournament_teams where tournament_id = v_full and team_id = v_late) = 'waiting', 'waiting';
end $$;

rollback;
