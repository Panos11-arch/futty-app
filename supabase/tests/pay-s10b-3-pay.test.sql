-- S10B: paying the entry fee (spec 13 "Tournament entry (S10B)"). Each squad
-- member pays the tournament's fee himself, charged at once, all to Futty:
-- no service fee, no venue part. Worked example T1: 5 starters + 2 subs all
-- pay, 7 × €12.00 = €84.00 taken, all Futty's, no venue row.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-3-admin@futty.test');
  v_t uuid := tests.s10b_tournament(v_admin);
  v_team uuid := tests.s10b_team(v_t, 'S10B-3 Full', 2);
  v_m uuid[] := tests.s10a_members(v_team);
  v_stranger uuid := tests.create_user('s10b-3-stranger@futty.test');
  v_plan jsonb;
  v_pay uuid;
  v_error text;
  v_free uuid;
  v_free_team uuid;
  v_debtor_team uuid;
  v_intent text;
  v_page jsonb;
  m uuid;
begin
  -- The plan comes from the server: the tournament's fee, nothing added.
  v_plan := public.plan_tournament_entry(v_t, v_m[1]);
  assert (v_plan ->> 'amount_cents')::integer = 1200, 'the fee, €12.00, got ' || (v_plan ->> 'amount_cents');
  assert (v_plan ->> 'payment_id') is not null, 'a payment row';
  assert (select amount_cents from public.tournament_entry_payments where id = (v_plan ->> 'payment_id')::uuid) = 1200, 'stored';
  assert (select status from public.tournament_entry_payments where id = (v_plan ->> 'payment_id')::uuid) = 'pending', 'pending';
  -- Starting again reuses the pending payment (one per player).
  assert (public.plan_tournament_entry(v_t, v_m[1]) ->> 'payment_id') = (v_plan ->> 'payment_id'), 'the same payment';

  -- T1: all seven pay. €84.00 taken, all Futty's, no venue part.
  foreach m in array v_m[1:7] loop
    perform tests.s10b_pay(m, v_t);
  end loop;
  assert tests.s10b_taken(v_t) = 8400, 'T1: €84.00 taken, got ' || tests.s10b_taken(v_t);
  assert (select sum(l.venue_cents) from public.money_ledger l
          join public.tournament_entry_payments p on p.id = l.tournament_payment_id where p.tournament_id = v_t) = 0, 'no venue part';
  assert (select sum(l.futty_cents + l.stripe_fee_cents) from public.money_ledger l
          join public.tournament_entry_payments p on p.id = l.tournament_payment_id where p.tournament_id = v_t) = 8400,
    'Futty + Stripe = taken';
  assert not exists (select 1 from public.money_ledger l join public.tournament_entry_payments p on p.id = l.tournament_payment_id
                     where p.tournament_id = v_t and l.booking_id is not null), 'no booking';
  assert (select count(*) from public.tournament_entry_payments where tournament_id = v_t and status = 'paid') = 7, '7 paid';

  -- The daily check covers them: Futty + Stripe + refunds = taken, with no venue part.
  assert (select bool_and((public.tournament_entry_balance(p.id)).balanced)
          from public.tournament_entry_payments p where p.tournament_id = v_t and p.status = 'paid'), 'each balances';
  assert (public.reconcile_money() ->> 'unbalanced')::integer = 0, 'the daily check finds nothing wrong';
  assert (public.reconcile_money() ->> 'tournament_entries_checked')::integer >= 7, 'and counts them';
  assert not exists (select 1 from public.admin_alerts where kind = 'books_unbalanced' and booking_id is null), 'no alert';

  -- A repeated webhook records nothing twice.
  v_intent := (select stripe_intent_id from public.tournament_entry_payments where tournament_id = v_t and profile_id = v_m[1]);
  perform public.tournament_entry_paid(v_intent, 1200, 43);
  assert tests.s10b_taken(v_t) = 8400, 'still €84.00';

  -- Refused: paying twice, not in a squad, a free tournament, after the deadline.
  v_error := tests.s10b_start_error(v_m[1], v_t);
  assert v_error = 'already_paid', 'paid once, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10b_start_error(v_stranger, v_t);
  assert v_error = 'not_in_squad', 'a stranger, got ' || coalesce(v_error, 'no error');
  v_free := tests.s10b_tournament(v_admin, 0, null, false);
  perform tests.act_as(v_admin);
  perform public.admin_open_registration(v_free);
  perform tests.act_as_postgres();
  v_free_team := tests.s10b_team(v_free, 'S10B-3 Free');
  v_error := tests.s10b_start_error(tests.s10a_captain(v_free_team), v_free);
  assert v_error = 'no_fee', 'nothing to pay, got ' || coalesce(v_error, 'no error');

  -- Money owed blocks it, as it blocks booking.
  v_debtor_team := tests.s10b_team(v_t, 'S10B-3 Debtor');
  -- A Futty debt (a cancellation fee) is money owed, as on Payments' "You owe".
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (tests.s10a_captain(v_debtor_team), 'futty', null, gen_random_uuid(), 500, 0, 500, 'cancellation_fee');
  v_error := tests.s10b_start_error(tests.s10a_captain(v_debtor_team), v_t);
  assert v_error = 'player_in_debt', 'in debt, got ' || coalesce(v_error, 'no error');

  -- The squad on the page: each member's role and paid tick; the unpaid
  -- member can pay, with the amount and the deadline from the server.
  perform tests.act_as((tests.s10a_members(v_debtor_team))[2]);
  v_page := public.get_tournament(v_t);
  perform tests.act_as_postgres();
  assert (v_page -> 'myTeams' -> 0 -> 'squad' -> 0 ->> 'role') in ('starter', 'sub'), 'role shown';
  assert (select bool_and(not (e ->> 'paid')::boolean) from jsonb_array_elements(v_page -> 'myTeams' -> 0 -> 'squad') e), 'nobody paid yet';
  assert (v_page -> 'myEntry' ->> 'canPay')::boolean, 'I can pay';
  assert (v_page -> 'myEntry' ->> 'amount_cents')::integer = 1200, 'Pay €12.00';
  assert (v_page -> 'myEntry' ->> 'deadline') is not null, 'by the deadline';
  perform tests.act_as(v_m[3]);
  v_page := public.get_tournament(v_t);
  perform tests.act_as_postgres();
  assert (select bool_and((e ->> 'paid')::boolean) from jsonb_array_elements(v_page -> 'myTeams' -> 0 -> 'squad') e), 'all ticked';
  assert not (v_page -> 'myEntry' ->> 'canPay')::boolean, 'paid: nothing to pay';

  -- Payments are private: a player reads only his own; nobody writes directly.
  v_error := tests.error_as(v_stranger, 'select count(*) from public.tournament_entry_payments');
  assert v_error is null, 'readable through RLS, got ' || coalesce(v_error, '');
  perform tests.act_as(v_stranger);
  assert (select count(*) from public.tournament_entry_payments) = 0, 'a stranger sees none';
  perform tests.act_as(v_m[2]);
  assert (select count(*) from public.tournament_entry_payments) = 1, 'his own only';
  perform tests.act_as_postgres();
  v_error := tests.error_as(v_m[2], format('update public.tournament_entry_payments set status = ''paid'' where profile_id = %L', v_m[2]));
  assert v_error like 'permission denied%', 'no direct write, got ' || coalesce(v_error, 'no error');

  -- The webhook's functions are the server's only.
  v_error := tests.error_as(v_m[2], format('select public.tournament_entry_paid(%L, 1200, 0)', v_intent));
  assert v_error like 'permission denied%', 'not for players, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_m[2], format('select public.plan_tournament_entry(%L, %L)', v_t, v_m[2]));
  assert v_error like 'permission denied%', 'the plan is the server''s, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_m[2], 'select public.tournament_deadline_tick()');
  assert v_error like 'permission denied%', 'nor the deadline job, got ' || coalesce(v_error, 'no error');
end $$;

-- A failed payment, and a waiting team paying while it waits.
do $$
declare
  v_admin uuid := tests.s10a_admin('s10b-3b-admin@futty.test');
  v_t uuid := tests.s10b_tournament(v_admin);
  v_team uuid := tests.s10b_team(v_t, 'S10B-3 Failing');
  v_cap uuid := tests.s10a_captain(v_team);
  v_plan jsonb;
  v_waiting uuid;
  v_error text;
begin
  v_plan := public.plan_tournament_entry(v_t, v_cap);
  perform public.attach_tournament_entry_intent((v_plan ->> 'payment_id')::uuid, v_cap, 'pi_s10b_failed');
  perform public.tournament_entry_failed('pi_s10b_failed');
  assert (select status from public.tournament_entry_payments where id = (v_plan ->> 'payment_id')::uuid) = 'failed', 'failed';
  assert tests.s10b_taken(v_t) = 0, 'nothing taken';
  assert (public.plan_tournament_entry(v_t, v_cap) ->> 'payment_id') <> (v_plan ->> 'payment_id'), 'a new try';

  -- A waiting team's players may pay while they wait.
  perform tests.s10a_fill(v_t);
  v_waiting := tests.s10b_team(v_t, 'S10B-3 Waiting');
  v_error := tests.s10b_start_error(tests.s10a_captain(v_waiting), v_t);
  assert v_error is null, 'waiting may pay, got ' || coalesce(v_error, '');

  -- Nobody can start a payment once the deadline has passed, waiting teams included.
  update public.tournaments set registration_deadline = now() - interval '1 second' where id = v_t;
  v_error := tests.s10b_start_error((tests.s10a_members(v_waiting))[2], v_t);
  assert v_error = 'deadline_passed', 'after the deadline, got ' || coalesce(v_error, 'no error');
  v_error := tests.s10b_start_error((tests.s10a_members(v_team))[2], v_t);
  assert v_error = 'deadline_passed', 'a spot team too, got ' || coalesce(v_error, 'no error');
end $$;

rollback;
