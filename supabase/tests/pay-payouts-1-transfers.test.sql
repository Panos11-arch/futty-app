-- P4d: transfers equal the ledger (docs/specs/13-payments-bookings.md
-- "Payouts", decided 16 November): one Stripe transfer per booking, once
-- its money is final, of what money_ledger.venue_cents says the venue
-- earned on it. Every P4a-P4c scenario: each pays, a short game's top-ups,
-- a failed top-up from the booker's hold, a debt paid later, pay-all, and
-- cancellations in each window.
begin;

-- Each pays, 10 at €60: nothing before collection, then 6000 once.
do $$
declare
  v_owner uuid := tests.create_user('payout-full-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_payout public.venue_payouts;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_booking := tests.booking_with_players(tests.create_user('payout-full-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 9, tests.cyprus_today() + 3, p_label => 'payout-full');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_pfull_' || i, interval '2 hours');
  end loop;
  assert tests.run_payouts() = 0, 'nothing before the match';
  perform tests.end_match(v_booking.id);
  assert tests.run_payouts() = 0, 'nothing before collection';

  v_start := public.start_collection(v_booking.id);
  assert public.settle_collection((v_start ->> 'collection_id')::uuid) ->> 'result' = 'done', 'collected';
  assert tests.run_payouts() = 1, 'one transfer after collection';
  select * into v_payout from public.venue_payouts where booking_id = v_booking.id;
  assert v_payout.amount_cents = 6000 and v_payout.status = 'sent' and v_payout.venue_id = v_venue
         and v_payout.stripe_account_id = 'acct_' || replace(v_venue::text, '-', ''),
    format('6000 to the venue''s account, got %s', row_to_json(v_payout));
  assert v_payout.amount_cents = tests.venue_earned(v_booking.id), 'the ledger''s venue_cents';
  assert (select amount_cents = 6000 and stripe_id = v_payout.stripe_transfer_id and venue_cents = 0 and futty_cents = 0
                 and reason = 'venue_payout'
          from public.money_ledger where booking_id = v_booking.id and kind = 'payout'),
    'one payout row in the ledger, outside the books';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books still balance';

  assert tests.run_payouts() = 0, 'never twice';
  assert tests.transferred(v_booking.id) = 6000, '6000 in all';
end $$;

-- A short game, 8 at €60: 8 x 600 + 8 x 150 top-ups = 6000.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_booking := tests.booking_with_players(tests.create_user('payout-short-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 7, tests.cyprus_today() + 3, p_label => 'payout-short');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_pshort_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert tests.run_payouts() = 0, 'top-ups still to charge: not final';
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'one transfer';
  assert tests.payout_amounts(v_venue) = array[6000], format('6000, got %s', tests.payout_amounts(v_venue));
  assert tests.transferred(v_booking.id) = tests.venue_earned(v_booking.id), 'the ledger';
end $$;

-- Responsible, 8 at €60, one top-up declined: the hold covers its 150 and
-- the venue still gets 6000, once the hold is taken.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_settle jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_booking := tests.booking_with_players(tests.create_user('payout-hold-booker@futty.test'), v_venue,
                                          'each_pays_responsible', 7, tests.cyprus_today() + 3, p_label => 'payout-hold');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_phold_' || i, interval '2 hours');
  end loop;
  perform tests.hold_guarantee(v_booking.id, 'pi_phold_guarantee');
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid, array[(tests.player(v_booking.id, 5)).id]);
  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle ->> 'capture_cents' = '150', format('150 from the hold, got %s', v_settle);
  assert tests.run_payouts() = 0, 'the hold not taken yet: not final';
  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'captured', 150, tests.stripe_fee(150));
  assert tests.run_payouts() = 1, 'one transfer';
  assert tests.payout_amounts(v_venue) = array[6000], format('6000, got %s', tests.payout_amounts(v_venue));
  assert tests.transferred(v_booking.id) = tests.venue_earned(v_booking.id), 'the ledger';
end $$;

-- Just my spot, 8 at €60, one top-up declined: a 150 debt. The venue gets
-- 5850 after collection; when the player pays the debt by card, the 150
-- goes in a further transfer on the next run.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_failed public.booking_payment_shares;
  v_debt public.venue_debts;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_booking := tests.booking_with_players(tests.create_user('payout-debt-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 7, tests.cyprus_today() + 3, p_label => 'payout-debt');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_pdebt_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_failed := tests.player(v_booking.id, 6);
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid, array[v_failed.id]);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'collected';
  assert tests.payout_amounts(v_venue) = array[5850], format('5850, got %s', tests.payout_amounts(v_venue));

  select * into v_debt from public.venue_debts where profile_id = v_failed.profile_id;
  perform public.attach_debt_intent(v_debt.id, v_failed.profile_id, 'pi_pdebt_paid', v_debt.amount_cents, null);
  perform public.debt_paid(v_debt.id, 'pi_pdebt_paid', v_debt.amount_cents, tests.stripe_fee(v_debt.amount_cents));
  assert tests.run_payouts() = 1, 'the late money: a further transfer';
  assert tests.payout_amounts(v_venue) = array[150, 5850], format('then 150, got %s', tests.payout_amounts(v_venue));
  assert (select count(*) from public.venue_payouts where booking_id = v_booking.id) = 2, 'both for this booking';
  assert tests.transferred(v_booking.id) = tests.venue_earned(v_booking.id) and tests.transferred(v_booking.id) = 6000,
    'the ledger: 6000';
end $$;

-- Pay-all: the booker paid the whole €60 and the fee. Final when its
-- collection would run (2 hours after the match): then 6000.
do $$
declare
  v_booker uuid := tests.create_user('payout-all-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3, p_label => 'payout-all');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_pall_0', interval '2 hours');
  assert (tests.player(v_booking.id, 0)).status = 'paid', 'paid';
  perform tests.end_match(v_booking.id, interval '1 hour');
  assert tests.run_payouts() = 0, 'an hour after the match: not yet';
  perform tests.end_match(v_booking.id);
  assert tests.run_payouts() = 1, 'then once';
  assert tests.payout_amounts(v_venue) = array[6000], format('6000, got %s', tests.payout_amounts(v_venue));
  assert tests.transferred(v_booking.id) = tests.venue_earned(v_booking.id), 'the ledger';
end $$;

-- Cancellations, 10 at €60: one cancels in the free hour (released: nothing
-- for the venue), one in the middle window (€1 kept, the rest credit at the
-- venue: the venue's money), one late (their 600 counts toward the pitch
-- price). The transfer is what the ledger says, the credit money in it.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_free public.booking_payment_shares;
  v_middle public.booking_payment_shares;
  v_late public.booking_payment_shares;
  v_done jsonb;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_booking := tests.booking_with_players(tests.create_user('payout-cancel-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 9, tests.cyprus_today() + 3, p_label => 'payout-cancel');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_pcan_' || i, interval '2 hours');
  end loop;
  v_free := tests.pay_ago((tests.player(v_booking.id, 9)).id, 'pi_pcan_9', interval '5 minutes');
  v_middle := tests.player(v_booking.id, 8);
  v_late := tests.player(v_booking.id, 7);

  perform tests.act_as_service_role();
  v_done := tests.cancel(v_booking.id, 'my_spot', v_free.profile_id);
  perform tests.act_as_postgres();
  perform public.cancellation_line_done((tests.line(v_done, v_free.id)).id, 'released');
  perform tests.act_as_service_role();
  perform tests.cancel(v_booking.id, 'my_spot', v_middle.profile_id);
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours');
  perform tests.act_as_service_role();
  perform tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  perform tests.act_as_postgres();
  assert (tests.player(v_booking.id, 8)).status = 'credited' and (tests.player(v_booking.id, 7)).status = 'forfeited',
    format('credited and forfeited, got %s, %s', (tests.player(v_booking.id, 8)).status, (tests.player(v_booking.id, 7)).status);

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'one transfer';
  assert tests.transferred(v_booking.id) = tests.venue_earned(v_booking.id),
    format('the ledger: %s, sent %s', tests.venue_earned(v_booking.id), tests.transferred(v_booking.id));
  assert (select venue from tests.share_books(v_middle.id)) > 0
         and (select credit from tests.share_books(v_middle.id)) > 0, 'the credited share''s money is the venue''s';
  assert (select coalesce(sum(venue_cents), 0) from public.money_ledger where share_id = v_free.id) = 0,
    'nothing from the free-hour cancel';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

rollback;
