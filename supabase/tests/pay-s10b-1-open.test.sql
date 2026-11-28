-- S10B: opening sign-up and moving the deadline (spec 13 "Tournament entry
-- (S10B)", decided by Panos 28 November). A fee needs a deadline, in the
-- future and before the first match; the fee is fixed from Open sign-up;
-- the deadline moves later only, and every team is told.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-1-admin@futty.test');
  v_t uuid;
  v_free uuid;
  v_team uuid;
  v_waiting uuid;
  v_error text;
  v_deadline timestamptz;
  v_t2 uuid;
  v_t3 uuid;
  v_teams uuid[];
begin
  -- A fee without a deadline can't open.
  v_t := tests.s10b_tournament(v_admin, 1200, null, false);
  v_error := tests.error_as(v_admin, format('select public.admin_open_registration(%L)', v_t));
  assert v_error = 'deadline_required', 'no deadline refused, got ' || coalesce(v_error, 'no error');

  -- Nor with one already past.
  perform tests.act_as(v_admin);
  perform public.admin_update_tournament(v_t, jsonb_build_object('registrationDeadline', now() - interval '1 hour'));
  perform tests.act_as_postgres();
  v_error := tests.error_as(v_admin, format('select public.admin_open_registration(%L)', v_t));
  assert v_error = 'deadline_past', 'past deadline refused, got ' || coalesce(v_error, 'no error');

  -- Nor one on or after the first match: the start date (Cyprus) ...
  perform tests.act_as(v_admin);
  perform public.admin_update_tournament(v_t, jsonb_build_object(
    'startDate', (now() at time zone 'Asia/Nicosia')::date + 3, 'endDate', (now() at time zone 'Asia/Nicosia')::date + 4,
    'registrationDeadline', ((((now() at time zone 'Asia/Nicosia')::date + 3) + time '10:00') at time zone 'Asia/Nicosia')));
  perform tests.act_as_postgres();
  v_error := tests.error_as(v_admin, format('select public.admin_open_registration(%L)', v_t));
  assert v_error = 'deadline_after_start', 'deadline on the first day refused, got ' || coalesce(v_error, 'no error');

  -- ... the day before is fine.
  perform tests.act_as(v_admin);
  perform public.admin_update_tournament(v_t, jsonb_build_object(
    'registrationDeadline', ((((now() at time zone 'Asia/Nicosia')::date + 2) + time '20:00') at time zone 'Asia/Nicosia')));
  perform tests.act_as_postgres();
  v_error := tests.error_as(v_admin, format('select public.admin_open_registration(%L)', v_t));
  assert v_error is null, 'opened, got ' || coalesce(v_error, '');

  -- The fee is fixed from Open sign-up.
  v_error := tests.error_as(v_admin, format('select public.admin_update_tournament(%L, %L)', v_t, '{"entryFeeCents":1500}'));
  assert v_error = 'fee_fixed', 'fee change refused, got ' || coalesce(v_error, 'no error');
  assert (select entry_fee_cents from public.tournaments where id = v_t) = 1200, 'still €12.00';
  -- The same fee sent again isn't a change.
  v_error := tests.error_as(v_admin, format('select public.admin_update_tournament(%L, %L)', v_t, '{"entryFeeCents":1200,"name":"S10B Cup 2"}'));
  assert v_error is null, 'unchanged fee with another field, got ' || coalesce(v_error, '');

  -- A free tournament opens without a deadline.
  v_free := tests.s10b_tournament(v_admin, 0, null, false);
  v_error := tests.error_as(v_admin, format('select public.admin_open_registration(%L)', v_free));
  assert v_error is null, 'free opens without a deadline, got ' || coalesce(v_error, '');

  -- Moving the deadline: later only, still in the future and before the first match.
  v_t2 := tests.s10b_tournament(v_admin);
  v_team := tests.s10b_team(v_t2, 'S10B-1 Spot');
  v_deadline := (select registration_deadline from public.tournaments where id = v_t2);
  v_error := tests.error_as(v_admin, format('select public.admin_update_tournament(%L, %L)', v_t2,
    jsonb_build_object('registrationDeadline', v_deadline - interval '1 hour')));
  assert v_error = 'deadline_earlier', 'earlier refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_update_tournament(%L, %L)', v_t2,
    jsonb_build_object('startDate', (v_deadline at time zone 'Asia/Nicosia')::date + 1,
                       'registrationDeadline', ((((v_deadline at time zone 'Asia/Nicosia')::date + 1) + time '12:00') at time zone 'Asia/Nicosia'))));
  assert v_error = 'deadline_after_start', 'past the first match refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_update_tournament(%L, %L)', v_t2,
    jsonb_build_object('registrationDeadline', v_deadline + interval '1 day')));
  assert v_error is null, 'later accepted, got ' || coalesce(v_error, '');
  assert (select registration_deadline from public.tournaments where id = v_t2) = v_deadline + interval '1 day', 'moved';
  -- Every squad member of every registered team is told.
  assert (select count(*) from public.notifications n
          where n.type = 'tournament_deadline_moved' and (n.data ->> 'tournamentId')::uuid = v_t2
            and n.profile_id = any (tests.s10a_members(v_team))) = 5, 'the team is told';
  -- The same deadline again is no move, and nobody is told twice.
  v_error := tests.error_as(v_admin, format('select public.admin_update_tournament(%L, %L)', v_t2,
    jsonb_build_object('registrationDeadline', v_deadline + interval '1 day')));
  assert v_error is null, 'same deadline, got ' || coalesce(v_error, '');
  assert (select count(*) from public.notifications n
          where n.type = 'tournament_deadline_moved' and (n.data ->> 'tournamentId')::uuid = v_t2) = 5, 'told once';

  -- Waiting teams are told too.
  perform tests.s10a_fill(v_t2);
  v_waiting := tests.s10b_team(v_t2, 'S10B-1 Waiting');
  assert (select place from public.tournament_teams where tournament_id = v_t2 and team_id = v_waiting) = 'waiting', 'waits';
  v_error := tests.error_as(v_admin, format('select public.admin_update_tournament(%L, %L)', v_t2,
    jsonb_build_object('registrationDeadline', v_deadline + interval '2 days')));
  assert v_error is null, 'moved again, got ' || coalesce(v_error, '');
  assert (select count(*) from public.notifications n
          where n.type = 'tournament_deadline_moved' and (n.data ->> 'tournamentId')::uuid = v_t2
            and n.profile_id = any (tests.s10a_members(v_waiting))) = 1 * 5, 'the waiting team is told';

  -- A match can't kick off on or before the deadline (the first match comes after it).
  v_t3 := tests.s10b_tournament(v_admin);
  v_teams := tests.s10a_groups(v_admin, v_t3);
  v_error := tests.error_as(v_admin, format('select public.admin_set_fixture_time(%L, %L)',
    tests.s10a_fixture(v_t3, v_teams[1], v_teams[2]), (select registration_deadline from public.tournaments where id = v_t3)));
  assert v_error = 'kickoff_before_deadline', 'kick-off at the deadline refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_set_fixture_time(%L, %L)',
    tests.s10a_fixture(v_t3, v_teams[1], v_teams[2]), (select registration_deadline + interval '1 day' from public.tournaments where id = v_t3)));
  assert v_error is null, 'after the deadline, got ' || coalesce(v_error, '');
end $$;

rollback;
