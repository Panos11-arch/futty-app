-- P4d review fixes (PR #81; docs/specs/13-payments-bookings.md "Payouts",
-- decided 16 November):
--   - no payouts at a venue while payouts_from is null; bookings created
--     before it never transfer and are never "missing";
--   - payouts_from is set only by service_role;
--   - an account from the other Stripe mode is skipped, and onboarding in
--     the current mode replaces it;
--   - a payout Futty's available balance can't cover yet is waiting: no
--     attempt counted, no alert, due again on the next run; the daily check
--     reports the total waiting and the oldest.
begin;

-- A collected booking, 10 at €60, at a connected venue (test mode).
create function tests.pp6_collected(p_label text, out venue uuid, out owner uuid, out booking uuid)
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  owner := tests.create_user(format('pp6-%s-owner@futty.test', p_label));
  venue := tests.create_venue(p_owner => owner, p_pitches => 2);
  perform tests.set_price(venue, '5-a-side', 6000);
  perform tests.connect_venue(venue);
  v_booking := tests.booking_with_players(tests.create_user(format('pp6-%s-booker@futty.test', p_label)), venue,
                                          'each_pays_own_spot', 9, tests.cyprus_today() + 3, p_label => 'pp6-' || p_label);
  booking := v_booking.id;
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(booking, i)).id, format('pi_pp6_%s_%s', p_label, i), interval '2 hours');
  end loop;
  perform tests.end_match(booking);
  v_start := public.start_collection(booking);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
end;
$$;

-- payouts_from null: nothing, however ready the venue is.
do $$
declare
  g record;
begin
  select * into g from tests.pp6_collected('none');
  update public.venues set payouts_from = null where id = g.venue;
  assert not public.venue_can_receive_payouts(g.venue, false), 'not before payouts start';
  assert tests.run_payouts() = 0, 'nothing';
  assert not exists (select 1 from public.venue_payouts where venue_id = g.venue), 'no payout prepared';
  assert (public.booking_money_breakdown(g.booking) ->> 'before_payouts')::boolean, 'shown as before Futty payouts';
end $$;

-- A booking created before payouts_from never transfers, and the daily
-- check doesn't call it missing; one created after it does transfer.
do $$
declare
  g record;
  v_after public.venue_bookings;
  v_start jsonb;
  v_result jsonb;
  v_overview jsonb;
  i integer;
begin
  select * into g from tests.pp6_collected('before');
  update public.venue_bookings set created_at = now() - interval '3 days' where id = g.booking;
  update public.venues set payouts_from = now() - interval '2 days' where id = g.venue;

  v_after := tests.booking_with_players(tests.create_user('pp6-after-booker@futty.test'), g.venue, 'each_pays_own_spot', 9,
                                        tests.cyprus_today() + 4, '10:00', '11:00', 'pp6-after');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_after.id, i)).id, 'pi_pp6_after_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_after.id, interval '6 hours');
  v_start := public.start_collection(v_after.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);

  assert tests.run_payouts() = 1, 'one transfer: the booking after payouts started';
  assert tests.transferred(v_after.id) = 6000, 'the later booking: 6000';
  assert tests.transferred(g.booking) = 0, 'the earlier booking: never';
  assert tests.run_payouts() = 0, 'and never later';

  insert into public.payout_runs (started_at, finished_at, livemode) values (now() + interval '1 minute', now() + interval '2 minutes', false);
  v_result := public.reconcile_money();
  assert (v_result ->> 'missing_transfers')::integer = 0, format('not missing, got %s', v_result);
  assert not exists (select 1 from public.admin_alerts where kind = 'payout_missing' and booking_id = g.booking), 'no alert';
  delete from public.payout_runs where started_at > now();

  perform tests.act_as(g.owner);
  v_overview := public.venue_payouts_overview(g.venue);
  perform tests.act_as_postgres();
  assert v_overview -> 'before_payouts' = jsonb_build_array(jsonb_build_object(
           'booking_id', g.booking, 'label', public.booking_label((select b from public.venue_bookings b where b.id = g.booking)),
           'venue_cents', 6000)),
    format('the Payouts screen lists it as before Futty payouts, got %s', v_overview -> 'before_payouts');
  assert (public.booking_money_breakdown(g.booking) ->> 'before_payouts')::boolean
         and not (public.booking_money_breakdown(v_after.id) ->> 'before_payouts')::boolean, 'each booking says which';
end $$;

-- Only service_role sets payouts_from: the owner can't, whatever they try.
do $$
declare
  g record;
begin
  select * into g from tests.pp6_collected('guard');
  perform tests.act_as(g.owner);
  assert tests.error_of(format('update public.venues set payouts_from = now() where id = %L', g.venue)) is not null,
    'the owner can''t write it';
  perform tests.act_as_postgres();
  -- Even through a function that runs as the database, with a user's session.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', g.owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  assert tests.error_of(format('update public.venues set payouts_from = null where id = %L', g.venue)) = 'payouts_from_service_role_only',
    'refused for a signed-in session';
  perform tests.act_as_service_role();
  update public.venues set payouts_from = now() where id = g.venue;
  perform tests.act_as_postgres();
  assert (select payouts_from from public.venues where id = g.venue) = now(), 'service_role can';
end $$;

-- The switch to live keys: a test-mode account is skipped by a live run,
-- and onboarding on live keys replaces it; its unsent payouts are dropped
-- and the money goes to the live account.
do $$
declare
  g record;
  v_overview jsonb;
begin
  select * into g from tests.pp6_collected('live');
  perform public.prepare_payouts(false);
  assert (select count(*) from public.venue_payouts where venue_id = g.venue and status = 'pending') = 1,
    'a test-mode payout, not sent yet';

  assert tests.run_payouts(true) = 0, 'a live run sends nothing to a test-mode account (or any)';
  assert not public.venue_can_receive_payouts(g.venue, true), 'the test account can''t receive live payouts';
  perform tests.act_as(g.owner);
  v_overview := public.venue_payouts_overview(g.venue);
  perform tests.act_as_postgres();
  assert v_overview -> 'account' ->> 'status' = 'not_started', format('on live keys: set up again, got %s', v_overview -> 'account');

  assert (public.connect_account_for_venue(g.venue, g.owner) ->> 'livemode')::boolean = false, 'the account it has is test mode';
  assert public.connect_account_created(g.venue, 'acct_pp6live', true) = 'acct_pp6live', 'replaced by a live account';
  assert public.connect_account_created(g.venue, 'acct_pp6again', true) = 'acct_pp6live', 'one live account per venue';
  assert (select (stripe_account_id, livemode, payouts_enabled) from public.venue_stripe_accounts where venue_id = g.venue)
         = ('acct_pp6live'::text, true, false), 'live, onboarding not finished';
  assert not exists (select 1 from public.venue_payouts where venue_id = g.venue), 'the unsent test payout is dropped';
  assert tests.run_payouts(true) = 0, 'onboarding not finished: nothing';

  assert public.connect_account_updated('acct_pp6live', true, true, true, 0, null, true) ->> 'result' = 'updated', 'onboarded';
  perform tests.run_payouts(false);
  assert not exists (select 1 from public.venue_payouts where venue_id = g.venue), 'a test run sends nothing to the live account';
  assert tests.run_payouts(true) = 1, 'the live run sends it';
  assert (select (stripe_account_id, amount_cents) from public.venue_payouts where venue_id = g.venue)
         = ('acct_pp6live'::text, 6000), 'to the live account, 6000';
end $$;

-- Waiting for Stripe's available balance: no attempt, no alert, due on the
-- next run; the daily check reports what's waiting and the oldest.
do $$
declare
  g record;
  h record;
  v_old public.venue_payouts;
  v_new public.venue_payouts;
  v_result jsonb;
begin
  select * into g from tests.pp6_collected('wait1');
  select * into h from tests.pp6_collected('wait2');
  perform public.prepare_payouts(false);
  select * into v_old from public.venue_payouts where venue_id = g.venue;
  select * into v_new from public.venue_payouts where venue_id = h.venue;
  update public.venue_payouts set created_at = now() - interval '1 hour' where id = v_old.id;

  perform public.payout_waiting(v_old.id);
  perform public.payout_waiting(v_old.id);
  perform public.payout_waiting(v_new.id);
  select * into v_old from public.venue_payouts where id = v_old.id;
  assert v_old.status = 'pending' and v_old.attempts = 0 and v_old.waiting_since is not null and v_old.last_error is null
         and v_old.next_attempt_at <= now(),
    format('waiting: no attempt counted, due again at once, got %s', row_to_json(v_old));
  assert not exists (select 1 from public.admin_alerts where kind = 'payout_failing'), 'no alert';
  assert (select count(*) from public.payouts_due(false) where payout_id in (v_old.id, v_new.id)) = 2, 'both due on the next run';
  assert (select payout_id from public.payouts_due(false) where payout_id in (v_old.id, v_new.id) limit 1) = v_old.id,
    'oldest first';

  v_result := public.reconcile_money();
  assert (v_result ->> 'waiting_for_balance_cents')::integer = 12000, format('12000 waiting, got %s', v_result);
  assert v_result -> 'oldest_waiting' @> jsonb_build_object('payout_id', v_old.id, 'amount_cents', 6000),
    format('the oldest waiting payout, got %s', v_result -> 'oldest_waiting');

  perform tests.act_as(g.owner);
  assert (public.venue_payouts_overview(g.venue) ->> 'waiting_for_balance_cents')::integer = 6000, 'the screen knows';
  perform tests.act_as_postgres();

  assert public.payout_sent(v_old.id, 'tr_pp6wait', 6000) ->> 'result' = 'sent', 'sent once the balance allows';
  assert (select waiting_since from public.venue_payouts where id = v_old.id) is null, 'no longer waiting';
  v_result := public.reconcile_money();
  assert (v_result ->> 'waiting_for_balance_cents')::integer = 6000 and v_result -> 'oldest_waiting' ->> 'payout_id' = v_new.id::text,
    format('only the other waits, got %s', v_result);
end $$;

rollback;
