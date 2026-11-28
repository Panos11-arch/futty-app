-- S10B: the registration deadline (spec 13 "Tournament entry (S10B)"), run by
-- run-payment-jobs (tournament_deadline_tick).
--   T2: released, 4 of 5 starters and 1 sub paid: 5 × €12.00 = €60.00 back.
--   T5: a sub unpaid: dropped, €0.00 moves, the team stays confirmed.
-- Released spots go in registration order to waiting teams whose starters
-- have all paid; every other waiting team is refunded in full.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-4-admin@futty.test');
  v_t uuid := tests.s10b_tournament(v_admin);
  v_released uuid := tests.s10b_team(v_t, 'S10B-4 T2 Released', 2);
  v_kept uuid := tests.s10b_team(v_t, 'S10B-4 T5 Kept', 1);
  v_r uuid[] := tests.s10a_members(v_released);
  v_k uuid[] := tests.s10a_members(v_kept);
  v_fill uuid[];
  v_w1 uuid;
  v_w2 uuid;
  v_w3 uuid;
  v_team uuid;
  m uuid;
  v_refunded_before integer;
begin
  -- T2's team: 4 of its 5 starters and 1 sub pay.
  foreach m in array v_r[1:4] || v_r[6] loop
    perform tests.s10b_pay(m, v_t);
  end loop;
  -- T5's team: its 5 starters pay, its sub doesn't.
  foreach m in array v_k[1:5] loop
    perform tests.s10b_pay(m, v_t);
  end loop;
  -- 14 more teams, fully paid: 16 spots.
  v_fill := tests.s10a_fill(v_t);
  foreach v_team in array v_fill loop
    if v_team not in (v_released, v_kept) then
      foreach m in array tests.s10a_members(v_team) loop
        perform tests.s10b_pay(m, v_t);
      end loop;
    end if;
  end loop;

  -- Three waiting teams, in this order.
  v_w1 := tests.s10b_team(v_t, 'S10B-4 W1 starters paid, sub not', 1);
  v_w2 := tests.s10b_team(v_t, 'S10B-4 W2 all paid');
  v_w3 := tests.s10b_team(v_t, 'S10B-4 W3 two paid');
  foreach m in array (tests.s10a_members(v_w1))[1:5] loop perform tests.s10b_pay(m, v_t); end loop;
  foreach m in array tests.s10a_members(v_w2) loop perform tests.s10b_pay(m, v_t); end loop;
  foreach m in array (tests.s10a_members(v_w3))[1:2] loop perform tests.s10b_pay(m, v_t); end loop;
  assert (select count(*) from public.tournament_teams where tournament_id = v_t and place = 'waiting') = 3, '3 wait';

  perform tests.s10b_deadline(v_t);

  -- T2: released, its 5 paid players refunded in full: €60.00.
  assert not exists (select 1 from public.tournament_teams where tournament_id = v_t and team_id = v_released), 'released';
  assert (select sum(amount_cents) from public.tournament_entry_payments
          where tournament_id = v_t and team_id = v_released and status = 'refund_due') = 6000,
    'T2: €60.00 to refund, got ' || coalesce((select sum(amount_cents) from public.tournament_entry_payments
          where tournament_id = v_t and team_id = v_released and status = 'refund_due'), 0);
  assert (select count(*) from public.notifications where type = 'tournament_team_released'
          and profile_id = any (v_r) and (data ->> 'tournamentId')::uuid = v_t) = 7, 'all 7 told';

  -- T5: the unpaid sub dropped and told; the team confirmed; nothing moves for it.
  assert not exists (select 1 from public.tournament_squads where tournament_id = v_t and profile_id = v_k[6]), 'sub dropped';
  assert (select count(*) from public.tournament_squads where tournament_id = v_t and team_id = v_kept) = 5, '5 left';
  assert (select confirmed_at is not null and place = 'spot' from public.tournament_teams where tournament_id = v_t and team_id = v_kept), 'confirmed';
  assert exists (select 1 from public.notifications where type = 'tournament_sub_dropped' and profile_id = v_k[6]), 'sub told';
  assert not exists (select 1 from public.tournament_entry_payments where tournament_id = v_t and team_id = v_kept
                     and status <> 'paid'), 'T5: €0.00 moves';

  -- The released spot goes to W1 (first in line, starters all paid); its unpaid sub is dropped.
  assert (select place from public.tournament_teams where tournament_id = v_t and team_id = v_w1) = 'spot', 'W1 moved up';
  assert (select confirmed_at is not null from public.tournament_teams where tournament_id = v_t and team_id = v_w1), 'W1 confirmed';
  assert (select count(*) from public.tournament_squads where tournament_id = v_t and team_id = v_w1) = 5, 'W1 sub dropped';
  assert (select count(*) from public.notifications where type = 'tournament_moved_up'
          and profile_id = any (tests.s10a_members(v_w1))) >= 5, 'W1 told';
  -- W2 paid in full but has no spot left: refunded in full. W3 never had its starters paid: refunded too.
  assert not exists (select 1 from public.tournament_teams where tournament_id = v_t and team_id in (v_w2, v_w3)), 'both out';
  assert (select sum(amount_cents) from public.tournament_entry_payments
          where tournament_id = v_t and team_id = v_w2 and status = 'refund_due') = 6000, 'W2: €60.00 back';
  assert (select sum(amount_cents) from public.tournament_entry_payments
          where tournament_id = v_t and team_id = v_w3 and status = 'refund_due') = 2400, 'W3: €24.00 back';

  -- 16 confirmed spots and nobody waiting.
  assert (select count(*) from public.tournament_teams where tournament_id = v_t and place = 'spot' and confirmed_at is not null) = 16, '16 confirmed';
  assert not exists (select 1 from public.tournament_teams where tournament_id = v_t and place = 'waiting'), 'nobody waits';

  -- The refunds go to Stripe (run-payment-jobs) and into the ledger: Futty absorbs Stripe's fee.
  assert tests.s10b_refund_all() = 5 + 5 + 2, '12 refunds made';
  assert tests.s10b_refunded(v_t) = 6000 + 6000 + 2400, 'refunded in full, got ' || tests.s10b_refunded(v_t);
  assert (select sum(l.futty_cents) from public.money_ledger l join public.tournament_entry_payments p on p.id = l.tournament_payment_id
          where p.tournament_id = v_t and l.kind = 'refund') = -(6000 + 6000 + 2400), 'all from Futty';
  assert not exists (select 1 from public.tournament_entry_payments where tournament_id = v_t and status = 'refund_due'), 'none left';

  -- Running again changes nothing.
  v_refunded_before := tests.s10b_refunded(v_t);
  perform public.tournament_deadline_tick();
  assert tests.s10b_refund_all() = 0, 'no new refunds';
  assert tests.s10b_refunded(v_t) = v_refunded_before, 'idempotent';
end $$;

-- A payment that lands after the deadline job, for a released team: refunded in full.
do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-4b-admin@futty.test');
  v_t uuid := tests.s10b_tournament(v_admin);
  v_team uuid := tests.s10b_team(v_t, 'S10B-4 Late');
  v_m uuid[] := tests.s10a_members(v_team);
  v_plan jsonb;
  m uuid;
begin
  foreach m in array v_m[1:4] loop perform tests.s10b_pay(m, v_t); end loop;
  -- The 5th starts paying before the deadline; Stripe's webhook arrives after the job.
  v_plan := public.plan_tournament_entry(v_t, v_m[5]);
  perform public.attach_tournament_entry_intent((v_plan ->> 'payment_id')::uuid, v_m[5], 'pi_s10b_late');
  perform tests.s10b_deadline(v_t);
  assert not exists (select 1 from public.tournament_teams where tournament_id = v_t and team_id = v_team), 'released';
  perform public.tournament_entry_paid('pi_s10b_late', 1200, 43);
  assert (select status from public.tournament_entry_payments where id = (v_plan ->> 'payment_id')::uuid) = 'refund_due', 'refunded too';
  assert tests.s10b_refund_all() = 5, '4 + the late one';
  assert tests.s10b_refunded(v_t) = 6000, '5 × €12.00';
end $$;

-- A free tournament: nothing to pay, nobody dropped, every team confirmed.
do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-4c-admin@futty.test');
  v_t uuid := tests.s10b_tournament(v_admin, 0, now() + interval '1 day');
  v_team uuid := tests.s10b_team(v_t, 'S10B-4 Free', 2);
begin
  perform tests.s10b_deadline(v_t);
  assert (select count(*) from public.tournament_squads where tournament_id = v_t and team_id = v_team) = 7, 'nobody dropped';
  assert (select confirmed_at is not null from public.tournament_teams where tournament_id = v_t and team_id = v_team), 'confirmed';
end $$;

rollback;
