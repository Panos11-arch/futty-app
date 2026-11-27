-- S10A page: tournament pins (match-record.md decision 1o). A player pins a
-- tournament on the Leagues screen or its page star. Owner only, like S9's
-- league pins (competition_pins), which this leaves unchanged.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-12-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin, false);
  v_t2 uuid := tests.s10a_tournament(v_admin, true);
  v_me uuid := tests.create_user('s10a-12-me@futty.test');
  v_other uuid := tests.create_user('s10a-12-other@futty.test');
begin
  perform tests.act_as(v_me);
  insert into public.tournament_pins (tournament_id) values (v_t);
  assert (select profile_id from public.tournament_pins) = v_me, 'I pin a tournament, as mine';
  assert tests.error_of(format($q$ insert into public.tournament_pins (tournament_id) values (%L) $q$, v_t))
         like '%duplicate key%', 'one pin per tournament';
  assert tests.error_of(format($q$ insert into public.tournament_pins (tournament_id) values (%L) $q$, gen_random_uuid()))
         like '%foreign key%', 'only a real tournament';
  insert into public.tournament_pins (tournament_id) values (v_t2);

  -- Existing league pins are unchanged, side by side.
  insert into public.competition_pins (target_type, scope, format) values ('league', 'limassol', '5-a-side');
  assert (select count(*) from public.competition_pins) = 1, 'a league pin still works';
  assert tests.error_of($q$ insert into public.competition_pins (target_type, scope, format) values ('tournament', 'limassol', '5-a-side') $q$)
         like '%check constraint%', 'competition_pins still takes leagues only';

  perform tests.act_as(v_other);
  assert (select count(*) from public.tournament_pins) = 0, 'another player sees none of my pins';
  assert tests.error_of(format($q$ insert into public.tournament_pins (profile_id, tournament_id) values (%L, %L) $q$, v_me, v_t))
         like '%row-level security%', 'cannot pin for someone else';
  delete from public.tournament_pins where profile_id = v_me;
  assert tests.error_of(format($q$ update public.tournament_pins set tournament_id = %L where profile_id = %L $q$, v_t2, v_me))
         like 'permission denied%', 'nobody updates a pin';

  perform tests.act_as(v_me);
  assert (select count(*) from public.tournament_pins) = 2, 'another player cannot delete my pins';
  delete from public.tournament_pins where tournament_id = v_t2;
  assert (select count(*) from public.tournament_pins) = 1, 'I can unpin';

  perform tests.act_as_anon();
  assert tests.error_of($q$ select * from public.tournament_pins $q$) like 'permission denied%', 'anon cannot read pins';
  assert tests.error_of(format($q$ insert into public.tournament_pins (tournament_id) values (%L) $q$, v_t))
         like 'permission denied%', 'anon cannot pin';

  -- Deleting the tournament removes its pins; the league pin stays.
  perform tests.act_as_postgres();
  delete from public.tournaments where id = v_t;
  assert (select count(*) from public.tournament_pins where profile_id = v_me) = 0, 'cascade on tournament delete';
  assert (select count(*) from public.competition_pins where profile_id = v_me) = 1, 'league pin untouched';
end $$;

rollback;
