-- P4d: no transfer until the venue has signed and finished onboarding; each
-- transfer once, retried, and reversed only by hand; the daily check flags
-- books that don't balance and a missing transfer
-- (docs/specs/13-payments-bookings.md "Payouts", decided 16 November).
begin;

-- A collected booking, 10 at €60, at a new venue with an owner.
create function tests.pp_collected(p_label text, out venue uuid, out owner uuid, out booking uuid)
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  owner := tests.create_user(format('pp4-%s-owner@futty.test', p_label));
  venue := tests.create_venue(p_owner => owner, p_pitches => 1);
  perform tests.set_price(venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(tests.create_user(format('pp4-%s-booker@futty.test', p_label)), venue,
                                          'each_pays_own_spot', 9, tests.cyprus_today() + 3, p_label => 'pp4-' || p_label);
  booking := v_booking.id;
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(booking, i)).id, format('pi_pp4_%s_%s', p_label, i), interval '2 hours');
  end loop;
  perform tests.end_match(booking);
  v_start := public.start_collection(booking);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
end;
$$;

-- Onboarding: nothing until the venue is live and its account can receive
-- payouts; then everything it earned so far, at once. The overview follows.
do $$
declare
  g record;
  v_overview jsonb;
  v_account text;
begin
  select * into g from tests.pp_collected('onboard');
  perform tests.act_as(g.owner);
  v_overview := public.venue_payouts_overview(g.venue);
  perform tests.act_as_postgres();
  assert v_overview -> 'account' ->> 'status' = 'not_started' and (v_overview ->> 'ready_cents')::integer = 0
         and v_overview -> 'payouts' = '[]'::jsonb and not (v_overview ->> 'can_receive')::boolean
         and v_overview -> 'payouts_from' = 'null'::jsonb
         and v_overview -> 'before_payouts' -> 0 @> jsonb_build_object('booking_id', g.booking, 'venue_cents', 6000),
    format('not started; payouts not started at the venue, so the booking shows as before payouts; got %s', v_overview);
  assert tests.run_payouts() = 0, 'no account: nothing';

  -- The account exists, onboarding not finished.
  perform tests.act_as_service_role();
  v_account := public.connect_account_created(g.venue, 'acct_pp4onboard', false);
  assert public.connect_account_created(g.venue, 'acct_other', false) = 'acct_pp4onboard', 'one account per venue and mode';
  perform tests.act_as_postgres();
  assert tests.run_payouts() = 0, 'onboarding not finished: nothing';
  perform tests.act_as(g.owner);
  assert public.venue_payouts_overview(g.venue) -> 'account' ->> 'status' = 'in_progress', 'in progress';
  perform tests.act_as_service_role();
  perform public.connect_account_updated('acct_pp4onboard', true, false, false, 2, 'requirements.past_due', false);
  perform tests.act_as(g.owner);
  assert public.venue_payouts_overview(g.venue) -> 'account' @> '{"status": "needs_information", "requirements_due": 2}',
    'needs information';
  perform tests.act_as_postgres();
  assert tests.run_payouts() = 0, 'still nothing';

  -- Onboarding finished, but the venue hasn't signed (not live).
  update public.venues set is_live = false where id = g.venue;
  perform tests.act_as_service_role();
  assert public.connect_account_updated('acct_pp4onboard', true, true, true, 0, null, false) ->> 'result' = 'updated', 'updated';
  assert public.connect_account_updated('acct_unknown', true, true, true, 0, null, false) ->> 'result' = 'unknown', 'unknown account';
  perform tests.act_as_postgres();
  assert tests.run_payouts() = 0, 'not live: nothing';
  perform tests.act_as(g.owner);
  v_overview := public.venue_payouts_overview(g.venue);
  perform tests.act_as_postgres();
  assert v_overview -> 'account' @> '{"status": "ready", "venue_live": false}', format('ready, not live, got %s', v_overview);

  -- Live, but Futty payouts haven't started at the venue (payouts_from).
  update public.venues set is_live = true where id = g.venue;
  assert tests.run_payouts() = 0, 'payouts_from not set: nothing';
  -- Panos starts payouts there: the 6000 goes out.
  update public.venues set payouts_from = now() - interval '1 day' where id = g.venue;
  assert tests.run_payouts() = 1, 'live, onboarded, payouts started: one transfer';
  assert tests.payout_amounts(g.venue) = array[6000], format('6000, got %s', tests.payout_amounts(g.venue));
  assert (select stripe_account_id from public.venue_payouts where venue_id = g.venue) = 'acct_pp4onboard', 'to its account';
  perform tests.act_as(g.owner);
  v_overview := public.venue_payouts_overview(g.venue);
  perform tests.act_as_postgres();
  assert (v_overview ->> 'ready_cents')::integer = 0 and jsonb_array_length(v_overview -> 'payouts') = 1
         and v_overview -> 'payouts' -> 0 @> '{"amount_cents": 6000, "status": "sent", "bookings": 1}',
    format('one payout listed, got %s', v_overview);

  -- The venue disconnects Futty: no more transfers; the founders are told.
  perform tests.act_as_service_role();
  assert public.connect_account_deauthorized('acct_pp4onboard') ->> 'result' = 'deauthorized', 'deauthorized';
  perform public.connect_account_deauthorized('acct_pp4onboard');
  perform public.connect_account_updated('acct_pp4onboard', true, true, true, 0, null, false);
  perform tests.act_as_postgres();
  assert not public.venue_can_receive_payouts(g.venue, false), 'can''t receive any more, even if Stripe says payouts are on';
  assert (select count(*) from public.admin_alerts where kind = 'connect_deauthorized'
          and details ->> 'stripe_account_id' = 'acct_pp4onboard') = 1, 'alerted once';
  perform tests.act_as(g.owner);
  assert public.venue_payouts_overview(g.venue) -> 'account' ->> 'status' = 'disconnected', 'disconnected';
  perform tests.act_as_postgres();
end $$;

-- A transfer: retried with back-off, alerted at the third failure, sent
-- once, refused for the wrong amount; reversed in full in Stripe, it's
-- recorded and alerted, and the money goes again on the next run.
do $$
declare
  g record;
  v_run uuid;
  v_payout public.venue_payouts;
  i integer;
begin
  select * into g from tests.pp_collected('life');
  perform tests.connect_venue(g.venue);
  v_run := public.prepare_payouts(false);
  select * into v_payout from public.venue_payouts where venue_id = g.venue;
  assert v_payout.status = 'pending' and v_payout.amount_cents = 6000, 'one pending transfer';
  assert (select count(*) from public.payouts_due(false) where payout_id = v_payout.id) = 1, 'due now';
  perform public.prepare_payouts(false);
  assert (select count(*) from public.venue_payouts where venue_id = g.venue) = 1, 'preparing again adds nothing';

  for i in 1 .. 3 loop
    perform public.payout_errored(v_payout.id, 'balance_insufficient');
  end loop;
  select * into v_payout from public.venue_payouts where id = v_payout.id;
  assert v_payout.attempts = 3 and v_payout.next_attempt_at > now() and v_payout.last_error = 'balance_insufficient',
    format('three failures, backing off, got %s', row_to_json(v_payout));
  assert not exists (select 1 from public.payouts_due(false) where payout_id = v_payout.id), 'not due during the back-off';
  assert (select count(*) from public.admin_alerts where kind = 'payout_failing' and booking_id = g.booking) = 1,
    'the founders are alerted at the third';

  assert tests.error_of(format('select public.payout_sent(%L, %L, 5999)', v_payout.id, 'tr_life')) = 'amount_mismatch',
    'the wrong amount is refused';
  assert public.payout_sent(v_payout.id, 'tr_life', 6000) ->> 'result' = 'sent', 'sent';
  assert public.payout_sent(v_payout.id, 'tr_life', 6000) ->> 'result' = 'duplicate', 'twice: nothing new';
  assert tests.error_of(format('select public.payout_sent(%L, %L, 6000)', v_payout.id, 'tr_other')) = 'payout_not_pending',
    'another transfer for it is refused';
  assert (select count(*) from public.money_ledger where kind = 'payout' and booking_id = g.booking) = 1, 'one ledger row';
  perform public.finish_payout_run(v_run);

  -- Someone reverses half of it in Stripe: recorded and alerted; nothing else.
  assert public.payout_reversed('tr_life', 'trr_half', 3000, 3000) ->> 'result' = 'partial', 'partial';
  assert public.payout_reversed('tr_life', 'trr_half', 3000, 3000) ->> 'result' = 'duplicate', 'once';
  assert (select status from public.venue_payouts where id = v_payout.id) = 'sent', 'still sent';
  -- Then the rest: reversed in full; the venue's money goes again.
  assert public.payout_reversed('tr_life', 'trr_rest', 3000, 6000) ->> 'result' = 'reversed', 'reversed';
  assert public.payout_reversed('tr_unknown', 'trr_x', 100, 100) ->> 'result' = 'unknown', 'not ours';
  assert (select status from public.venue_payouts where id = v_payout.id) = 'reversed', 'reversed';
  assert (select count(*) from public.money_ledger where kind = 'payout_reversed' and booking_id = g.booking) = 2, 'both recorded';
  assert (select count(*) from public.admin_alerts where kind = 'payout_reversed' and booking_id = g.booking) = 2, 'both alerted';
  assert tests.transferred(g.booking) = 0, 'nothing counts as sent';
  assert tests.run_payouts() = 1, 'sent again on the next run';
  assert tests.transferred(g.booking) = 6000, '6000';
  assert (select balanced from public.money_balance(g.booking)), 'the books still balance';
end $$;

-- The daily check: a booking whose books don't balance, and money that was
-- due before the last payout run that no transfer covered.
do $$
declare
  g record;
  v_result jsonb;
begin
  select * into g from tests.pp_collected('check');
  perform tests.connect_venue(g.venue);
  perform tests.run_payouts();
  v_result := public.reconcile_money();
  assert (v_result ->> 'unbalanced')::integer = 0 and (v_result ->> 'missing_transfers')::integer = 0,
    format('all paid: all well, got %s', v_result);

  -- Undo that transfer, as if the job had skipped the venue; a payout run
  -- finished after the money was due: a missing transfer.
  delete from public.venue_payout_items i using public.venue_payouts p
  where p.id = i.payout_id and p.booking_id = g.booking;
  delete from public.money_ledger where kind = 'payout' and booking_id = g.booking;
  delete from public.venue_payouts where booking_id = g.booking;
  insert into public.payout_runs (started_at, finished_at, livemode)
  values (now() + interval '1 minute', now() + interval '2 minutes', false);
  v_result := public.reconcile_money();
  assert (v_result ->> 'missing_transfers')::integer = 1, format('the missing transfer, got %s', v_result);
  assert (select details ->> 'unpaid_cents' from public.admin_alerts where kind = 'payout_missing' and booking_id = g.booking) = '6000',
    'alerted with what is unpaid';
  perform public.reconcile_money();
  assert (select count(*) from public.admin_alerts where kind = 'payout_missing' and booking_id = g.booking) = 1, 'once';

  perform tests.run_payouts();
  v_result := public.reconcile_money();
  assert (v_result ->> 'missing_transfers')::integer = 0, format('sent: nothing missing, got %s', v_result);

  -- A booking whose books don't balance (a capture that doesn't add up,
  -- written past the ledger's own check).
  alter table public.money_ledger drop constraint money_ledger_split_check;
  insert into public.money_ledger (booking_id, kind, amount_cents, stripe_intent_id, stripe_id, venue_cents, reason)
  values (g.booking, 'capture', 680, 'pi_pp4_broken', 'pi_pp4_broken', 100, 'test_broken');
  v_result := public.reconcile_money();
  assert (v_result ->> 'unbalanced')::integer = 1, format('the broken booking, got %s', v_result);
  assert exists (select 1 from public.admin_alerts where kind = 'books_unbalanced' and booking_id = g.booking), 'alerted';
  perform public.reconcile_money();
  assert (select count(*) from public.admin_alerts where kind = 'books_unbalanced' and booking_id = g.booking) = 1, 'once';
end $$;

rollback;
