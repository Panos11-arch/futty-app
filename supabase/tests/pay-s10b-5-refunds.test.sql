-- S10B: refunds (spec 13 "Tournament entry (S10B)").
--   T4: the captain removes a paid player before the deadline: €12.00 back.
--   T6: a team of 6 that all paid withdraws before the deadline: 6 × €12.00 = €72.00 back.
--   T3: the organiser cancels after the deadline: a confirmed team of 6 who all paid gets 6 × €12.00 = €72.00 back.
-- After the deadline there are no other refunds: an admin's replacement plays
-- on the paid spot of the player he replaces, who isn't refunded.
begin;

-- T4 and T6, before the deadline.
do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-5-admin@futty.test');
  v_t uuid := tests.s10b_tournament(v_admin);
  v_team uuid := tests.s10b_team(v_t, 'S10B-5 Removes', 2);
  v_m uuid[] := tests.s10a_members(v_team);
  v_out uuid := tests.s10b_team(v_t, 'S10B-5 Withdraws', 1);
  v_o uuid[] := tests.s10a_members(v_out);
  v_waiting uuid;
  v_error text;
  m uuid;
begin
  -- T4: the captain removes a paid sub before the deadline: €12.00 back.
  foreach m in array v_m[1:7] loop perform tests.s10b_pay(m, v_t); end loop;
  v_error := tests.error_as(v_m[1], format('select public.set_tournament_squad(%L, %L, %L, %L)',
    v_t, v_team, v_m[1:6], array[v_m[6]]));
  assert v_error is null, 'removed, got ' || coalesce(v_error, '');
  assert (select status from public.tournament_entry_payments where tournament_id = v_t and profile_id = v_m[7]) = 'refund_due', 'due';
  assert tests.s10b_refund_all() = 1, 'one refund';
  assert tests.s10b_refunded(v_t) = 1200, 'T4: €12.00, got ' || tests.s10b_refunded(v_t);
  assert exists (select 1 from public.notifications where type = 'tournament_entry_refunded' and profile_id = v_m[7]), 'told';

  -- T6: a team of 6 that all paid withdraws: €72.00 back; it's gone and can register again.
  foreach m in array v_o[1:6] loop perform tests.s10b_pay(m, v_t); end loop;
  v_error := tests.error_as(v_o[2], format('select public.withdraw_tournament_team(%L, %L)', v_t, v_out));
  assert v_error = 'not_captain', 'only the captain, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_o[1], format('select public.withdraw_tournament_team(%L, %L)', v_t, v_out));
  assert v_error is null, 'withdrawn, got ' || coalesce(v_error, '');
  assert not exists (select 1 from public.tournament_teams where tournament_id = v_t and team_id = v_out), 'gone';
  assert tests.s10b_refund_all() = 6, 'six refunds';
  assert tests.s10b_refunded(v_t) = 1200 + 7200, 'T6: €72.00 more, got ' || tests.s10b_refunded(v_t);

  -- When a spot frees before the deadline, the first waiting team moves up at once and is told.
  perform tests.s10a_fill(v_t);
  v_waiting := tests.s10b_team(v_t, 'S10B-5 First waiting');
  perform tests.s10b_team(v_t, 'S10B-5 Second waiting');
  v_error := tests.error_as(tests.s10a_captain(v_team), format('select public.withdraw_tournament_team(%L, %L)', v_t, v_team));
  assert v_error is null, 'withdrawn, got ' || coalesce(v_error, '');
  assert (select place from public.tournament_teams where tournament_id = v_t and team_id = v_waiting) = 'spot', 'moved up';
  assert (select count(*) from public.notifications where type = 'tournament_moved_up'
          and profile_id = any (tests.s10a_members(v_waiting))) = 5, 'told';

  -- A withdrawn team registers again at the back of the waiting list.
  v_error := tests.error_as(v_o[1], format('select public.register_team_for_tournament(%L, %L, %L, %L, %L)',
    v_t, v_out, 'kitRed', v_o[1:6], array[v_o[6]]));
  assert v_error is null, 'registers again, got ' || coalesce(v_error, '');
  assert (select place from public.tournament_teams where tournament_id = v_t and team_id = v_out) = 'waiting', 'waits';
  perform tests.act_as(v_o[1]);
  assert (public.get_tournament(v_t) -> 'myTeams' -> 0 ->> 'waitingPosition')::integer = 2, 'at the back';
  perform tests.act_as_postgres();

  -- After the deadline a team can't withdraw.
  update public.tournaments set registration_deadline = now() - interval '1 second' where id = v_t;
  v_error := tests.error_as(tests.s10a_captain(v_waiting), format('select public.withdraw_tournament_team(%L, %L)', v_t, v_waiting));
  assert v_error = 'deadline_passed', 'too late, got ' || coalesce(v_error, 'no error');
end $$;

-- After the deadline: an admin's replacement, then T3 (the organiser cancels).
do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-5b-admin@futty.test');
  v_t uuid := tests.s10b_tournament(v_admin);
  v_team uuid := tests.s10b_team(v_t, 'S10B-5 Confirmed', 1);
  v_m uuid[] := tests.s10a_members(v_team);
  v_new uuid := tests.create_user('s10b-5-replacement@futty.test');
  v_error text;
  v_page jsonb;
  m uuid;
begin
  foreach m in array v_m[1:6] loop perform tests.s10b_pay(m, v_t); end loop;
  perform tests.s10b_deadline(v_t);
  assert tests.s10b_refund_all() = 0, 'nothing back at the deadline';

  -- An injury: the admin swaps the sub for a new member. No refund; the replacement pays nothing.
  perform tests.join_team(v_team, v_new);
  v_error := tests.error_as(v_admin, format('select public.admin_set_squad(%L, %L, %L, %L)',
    v_t, v_team, v_m[1:5] || v_new, array[v_new]));
  assert v_error is null, 'replaced, got ' || coalesce(v_error, '');
  assert (select status from public.tournament_entry_payments where tournament_id = v_t and profile_id = v_m[6]) = 'paid', 'not refunded';
  assert tests.s10b_refund_all() = 0, 'no refund after the deadline';
  v_error := tests.s10b_start_error(v_new, v_t);
  assert v_error = 'deadline_passed', 'he pays nothing, got ' || coalesce(v_error, 'no error');
  perform tests.act_as(v_new);
  v_page := public.get_tournament(v_t);
  perform tests.act_as_postgres();
  assert (select (e ->> 'paid')::boolean from jsonb_array_elements(v_page -> 'myTeams' -> 0 -> 'squad') e
          where (e ->> 'profileId')::uuid = v_new), 'shown as paid: the spot is paid';

  -- T3: the organiser cancels: every paid player gets it all back, the replaced one included.
  v_error := tests.error_as(v_m[1], format('select public.admin_cancel_tournament(%L)', v_t));
  assert v_error = 'not_admin', 'only an admin, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('select public.admin_cancel_tournament(%L)', v_t));
  assert v_error is null, 'cancelled, got ' || coalesce(v_error, '');
  assert (select status from public.tournaments where id = v_t) = 'cancelled', 'status';
  assert tests.s10b_refund_all() = 6, 'six refunds';
  assert tests.s10b_refunded(v_t) = 7200, 'T3: €72.00 back, got ' || tests.s10b_refunded(v_t);
  assert (select count(*) from public.notifications where type = 'tournament_cancelled'
          and (data ->> 'tournamentId')::uuid = v_t) >= 6, 'everyone told';
  v_error := tests.error_as(v_admin, format('select public.admin_cancel_tournament(%L)', v_t));
  assert v_error = 'invalid_status', 'once, got ' || coalesce(v_error, 'no error');
end $$;

-- Cancelling voids the tournament's matches; a finished tournament can't be cancelled.
do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-5c-admin@futty.test');
  v_t uuid := tests.s10a_tournament(v_admin);
  v_teams uuid[] := tests.s10a_groups(v_admin, v_t);
  v_match uuid;
  v_error text;
begin
  v_match := tests.s10a_time(v_admin, tests.s10a_fixture(v_t, v_teams[1], v_teams[2]), now() + interval '3 days');
  v_error := tests.error_as(v_admin, format('select public.admin_cancel_tournament(%L)', v_t));
  assert v_error is null, 'cancelled, got ' || coalesce(v_error, '');
  assert (select status from public.matches where id = v_match) = 'void', 'match voided';
  update public.tournaments set status = 'finished' where id = v_t;
  v_error := tests.error_as(v_admin, format('select public.admin_cancel_tournament(%L)', v_t));
  assert v_error = 'invalid_status', 'finished refused, got ' || coalesce(v_error, 'no error');
end $$;

rollback;
