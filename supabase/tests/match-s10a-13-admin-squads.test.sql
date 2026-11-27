-- S10A follow-up: an admin reads every team's squad in a tournament (the
-- squad, the members who could be added, the squad size and the change
-- log) so he can change one with admin_set_squad (Panos, 27 November;
-- match-record.md decision 1o). Admins only; names follow A5.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-13-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin, true, now() + interval '1 day');
  v_empty uuid := tests.s10a_tournament(v_admin, true);
  v_big uuid := tests.s10a_team('S10A-13 Big', 7);
  v_other uuid := tests.s10a_team('S10A-13 Other', 5);
  v_m uuid[] := tests.s10a_members(v_big);
  v_om uuid[] := tests.s10a_members(v_other);
  v_minor uuid := tests.create_user('s10a-13-minor@futty.test',
    jsonb_build_object('date_of_birth', (current_date - interval '15 years')::date, 'full_name', 'Minnie Young',
                       'first_name', 'Minnie'));
  v_both uuid := tests.create_user('s10a-13-both@futty.test');
  v_stranger uuid := tests.create_user('s10a-13-stranger@futty.test');
  v jsonb;
  v_team jsonb;
  v_error text;
begin
  -- The minor plays for Big; v_both is in both teams, and in Other's squad.
  perform tests.join_team(v_big, v_minor);
  perform tests.join_team(v_big, v_both);
  perform tests.join_team(v_other, v_both);
  assert tests.s10a_register(v_t, v_big, v_m[1:4] || v_minor) is null, 'Big registered';
  assert tests.s10a_register(v_t, v_other, v_om[1:4] || v_both, 'kitBlue') is null, 'Other registered';

  -- Admins only: a player, a captain and a stranger get not_admin; anon is refused.
  foreach v_error in array array[
    tests.error_as(v_m[2], format('select public.admin_get_tournament_squads(%L)', v_t)),
    tests.error_as(tests.s10a_captain(v_big), format('select public.admin_get_tournament_squads(%L)', v_t)),
    tests.error_as(v_stranger, format('select public.admin_get_tournament_squads(%L)', v_t))
  ] loop
    assert v_error = 'not_admin', 'a non-admin is refused, got ' || coalesce(v_error, 'no error');
  end loop;
  perform tests.act_as_anon();
  v_error := tests.error_of(format('select public.admin_get_tournament_squads(%L)', v_t));
  perform tests.act_as_postgres();
  assert v_error like 'permission denied%', 'anon is refused, got ' || coalesce(v_error, 'no error');

  v_error := tests.error_as(v_admin, format('select public.admin_get_tournament_squads(%L)', gen_random_uuid()));
  assert v_error = 'tournament_not_found', 'an unknown tournament, got ' || coalesce(v_error, 'no error');

  -- No teams yet: an empty list, with the squad size.
  perform tests.act_as(v_admin);
  v := public.admin_get_tournament_squads(v_empty);
  assert v -> 'teams' = '[]'::jsonb, 'no teams: ' || v::text;
  assert (v ->> 'squadMin')::int = 5 and (v ->> 'squadMax')::int = 7, 'squad 5 to 7: ' || v::text;

  -- Every registered team, with its squad, candidates and log.
  v := public.admin_get_tournament_squads(v_t);
  perform tests.act_as_postgres();
  assert jsonb_array_length(v -> 'teams') = 2, 'both teams: ' || v::text;
  select t into v_team from jsonb_array_elements(v -> 'teams') t where t ->> 'teamId' = v_big::text;
  assert v_team ->> 'teamName' = 'S10A-13 Big', 'the name';
  assert v_team ->> 'kitColour' = 'kitRed', 'the kit';
  assert (select array_agg((p ->> 'profileId')::uuid order by (p ->> 'profileId')) from jsonb_array_elements(v_team -> 'squad') p)
         = (select array_agg(x order by x) from unnest(v_m[1:4] || v_minor) x), 'Big''s squad: ' || (v_team -> 'squad')::text;
  -- Candidates: Big's members not in any squad; v_both is in Other's, so not offered.
  assert (select array_agg((p ->> 'profileId')::uuid order by (p ->> 'profileId')) from jsonb_array_elements(v_team -> 'candidates') p)
         = (select array_agg(x order by x) from unnest(v_m[5:7]) x), 'Big''s candidates: ' || (v_team -> 'candidates')::text;
  assert not exists (select 1 from jsonb_array_elements(v_team -> 'candidates') p where (p ->> 'profileId')::uuid = v_both),
    'a player in another squad is not offered';
  -- The captain's registration is logged: 5 added, not by an admin.
  assert jsonb_array_length(v_team -> 'changes') = 5, 'five changes: ' || (v_team -> 'changes')::text;
  assert not exists (select 1 from jsonb_array_elements(v_team -> 'changes') c
                     where c ->> 'change' <> 'added' or (c ->> 'byAdmin')::boolean
                        or (c -> 'changedBy' ->> 'profileId')::uuid <> tests.s10a_captain(v_big)), 'by the captain';
  -- A5: the minor shows his first name only, in the squad and the log.
  assert (select p ->> 'name' from jsonb_array_elements(v_team -> 'squad') p where (p ->> 'profileId')::uuid = v_minor) = 'Minnie',
    'minor first name in the squad';
  assert (select c -> 'player' ->> 'name' from jsonb_array_elements(v_team -> 'changes') c
          where (c -> 'player' ->> 'profileId')::uuid = v_minor) = 'Minnie', 'and in the log';
  assert position('Young' in v::text) = 0, 'never the surname: ' || v::text;

  -- After admin_set_squad: the new squad, and the log shows the admin's change first.
  perform tests.act_as(v_admin);
  perform public.admin_set_squad(v_t, v_big, v_m[1:4] || v_m[5]);
  v := public.admin_get_tournament_squads(v_t);
  perform tests.act_as_postgres();
  select t into v_team from jsonb_array_elements(v -> 'teams') t where t ->> 'teamId' = v_big::text;
  assert (select array_agg((p ->> 'profileId')::uuid order by (p ->> 'profileId')) from jsonb_array_elements(v_team -> 'squad') p)
         = (select array_agg(x order by x) from unnest(v_m[1:5]) x), 'the new squad';
  -- The minor is now a candidate, by first name.
  assert (select p ->> 'name' from jsonb_array_elements(v_team -> 'candidates') p where (p ->> 'profileId')::uuid = v_minor) = 'Minnie',
    'minor first name in the candidates: ' || (v_team -> 'candidates')::text;
  assert jsonb_array_length(v_team -> 'changes') = 7, 'two more changes';
  assert (select count(*) from (select c from jsonb_array_elements(v_team -> 'changes') with ordinality e(c, n) where n <= 2) x
          where (x.c ->> 'byAdmin')::boolean and (x.c -> 'changedBy' ->> 'profileId')::uuid = v_admin) = 2,
    'the admin''s two changes come first: ' || (v_team -> 'changes')::text;
  assert exists (select 1 from jsonb_array_elements(v_team -> 'changes') c
                 where c ->> 'change' = 'removed' and (c -> 'player' ->> 'profileId')::uuid = v_minor and (c ->> 'byAdmin')::boolean),
    'the removal, by an admin';
  assert exists (select 1 from jsonb_array_elements(v_team -> 'changes') c
                 where c ->> 'change' = 'added' and (c -> 'player' ->> 'profileId')::uuid = v_m[5] and (c ->> 'byAdmin')::boolean),
    'the addition, by an admin';
end;
$$;

rollback;
