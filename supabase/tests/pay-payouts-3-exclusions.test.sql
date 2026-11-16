-- P4d: what never transfers, and what P6, P8 and P12 added to the ledger
-- (docs/specs/13-payments-bookings.md "Payouts", decided 13 and 16
-- November):
--   - a counter (walk-in) booking paid at the counter never transfers;
--   - ticked cash is the venue's already and never transfers;
--   - a debt settled at the venue (debt_cash_received) never transfers,
--     and Futty's part of it comes off the venue's next transfer;
--   - Gipedo Pano captures and switch credit go through the same rules.
begin;

-- A walk-in paid at the counter: never in a transfer.
do $$
declare
  v_owner uuid := tests.create_user('payout-walkin-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_walk_in uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  perform tests.connect_venue(v_venue);
  perform tests.act_as(v_owner);
  v_walk_in := public.add_counter_booking(v_venue, tests.cyprus_today() + 2, '18:00', '19:00', '5-a-side', 'walk_in',
                                          'Andreas', null, p_paid_method => 'cash');
  perform tests.act_as_postgres();
  perform tests.end_match(v_walk_in);
  assert (select count(*) from public.money_ledger where booking_id = v_walk_in and kind = 'counter_paid') = 1, 'paid at the counter';
  assert tests.run_payouts() = 0, 'nothing to transfer';
  assert not exists (select 1 from public.venue_payouts where venue_id = v_venue), 'never';
end $$;

-- Ticked cash: 8 by card and 2 in cash at the venue. The transfer is the
-- 8 card players' 4800; the 1200 cash stays out.
do $$
declare
  v_owner uuid := tests.create_user('payout-cash-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_booking := tests.booking_with_players(tests.create_user('payout-cash-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 9, tests.cyprus_today() + 3, p_label => 'payout-cash');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_pcash_' || i, interval '2 hours',
                          case when i in (8, 9) then 'cash' else 'card' end);
  end loop;
  perform tests.act_as(v_owner);
  perform public.mark_cash_received((tests.player(v_booking.id, 8)).id);
  perform public.mark_cash_received((tests.player(v_booking.id, 9)).id);
  perform tests.act_as_postgres();
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);

  assert tests.run_payouts() = 1, 'one transfer';
  assert tests.payout_amounts(v_venue) = array[4800], format('4800, got %s', tests.payout_amounts(v_venue));
  assert (select sum(venue_cents) from public.money_ledger where booking_id = v_booking.id and kind = 'cash_received') = 1200,
    'the 1200 cash on the ledger, the venue''s already';
  assert not exists (select 1 from public.venue_payout_items i join public.money_ledger l on l.id = i.ledger_id
                     where l.booking_id = v_booking.id and l.kind = 'cash_received'), 'never in a transfer';
  assert tests.transferred(v_booking.id) = tests.venue_earned(v_booking.id), 'the ledger, cash left out';
end $$;

-- A share never paid becomes a 680 debt (600 pitch + 80 fee); the player
-- pays it at the venue. The 680 cash never transfers; Futty's 80 in it
-- comes off the venue's next transfer.
do $$
declare
  v_owner uuid := tests.create_user('payout-settle-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_booking public.venue_bookings;
  v_next public.venue_bookings;
  v_unpaid public.booking_payment_shares;
  v_debt public.venue_debts;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_booking := tests.booking_with_players(tests.create_user('payout-settle-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 9, tests.cyprus_today() + 3, '10:00', '11:00', 'payout-settle');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_pset_' || i, interval '2 hours');
  end loop;
  v_unpaid := tests.player(v_booking.id, 9);
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'collected';
  assert tests.payout_amounts(v_venue) = array[5400], format('the 9 who paid: 5400, got %s', tests.payout_amounts(v_venue));

  select * into v_debt from public.venue_debts where profile_id = v_unpaid.profile_id;
  assert v_debt.amount_cents = 680 and v_debt.futty_cents = 80, format('a 680 debt, got %s', row_to_json(v_debt));
  perform tests.act_as(v_owner);
  perform public.settle_debt(v_debt.id);
  perform tests.act_as_postgres();
  assert (select amount_cents from public.money_ledger where kind = 'debt_cash_received' and debt_id = v_debt.id) = 680,
    'the venue took 680 in person';
  assert tests.run_payouts() = 0, 'nothing to send: the venue owes Futty 80';

  v_next := tests.booking_with_players(tests.create_user('payout-settle-next@futty.test'), v_venue,
                                       'each_pays_own_spot', 9, tests.cyprus_today() + 4, p_label => 'payout-settle-next');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_next.id, i)).id, 'pi_psetn_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_next.id, interval '6 hours');
  v_start := public.start_collection(v_next.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'the next booking';
  assert tests.payout_amounts(v_venue) = array[5400, 5920], format('then 6000 less the 80, got %s', tests.payout_amounts(v_venue));
  assert not exists (select 1 from public.venue_payout_items i join public.money_ledger l on l.id = i.ledger_id
                     where l.kind = 'debt_cash_received'), 'the cash never transfers';
  assert (select settled_at is not null from public.venue_payables where debt_id = v_debt.id), 'what it owed is settled';
end $$;

-- Gipedo Pano, a win: the loser's 6550 hold is taken (6000 to the venue).
-- The same rules: final once settled, then 6000.
create function tests.pp_team(p_captain uuid, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_team uuid := tests.create_team(p_name);
begin
  perform tests.join_team(v_team, p_captain, 'captain');
  return v_team;
end;
$$;

do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_home uuid := tests.create_user('payout-gp-home@futty.test');
  v_away uuid := tests.create_user('payout-gp-away@futty.test');
  v_home_team uuid := tests.pp_team(v_home, 'Payout Home');
  v_away_team uuid := tests.pp_team(v_away, 'Payout Away');
  v_booking public.venue_bookings;
  v_match uuid;
  v_due record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  perform tests.act_as(v_home);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', v_home_team);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_home)).id, 'pi_ppgp_home');
  perform tests.act_as(v_away);
  perform public.offer_opposition((select id from public.squad_posts where venue_booking_id = v_booking.id), v_away_team);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_away)).id, 'pi_ppgp_away');

  perform tests.end_match(v_booking.id, '1 hour');
  v_match := (tests.match_of(v_booking.id)).id;
  perform tests.act_as(v_home);
  perform public.submit_match_result(v_match, 3, 1);
  perform tests.act_as(v_away);
  perform public.respond_to_match_result(v_match, true);
  perform tests.act_as_postgres();
  assert tests.run_payouts() = 0, 'the holds not settled yet: not final';
  assert public.gipedo_settle_from_results() = 2, 'both holds settle';
  assert tests.run_payouts() = 0, 'settlements written but not carried out: not final';

  for v_due in select * from public.gipedo_settlements_due() d where d.booking_id = v_booking.id loop
    if v_due.capture_cents > 0 then
      perform public.gipedo_settlement_done(v_due.settlement_id, 'captured', v_due.capture_cents, tests.stripe_fee(v_due.capture_cents));
    else
      perform public.gipedo_settlement_done(v_due.settlement_id, 'released');
    end if;
  end loop;
  assert tests.run_payouts() = 1, 'settled: one transfer';
  assert tests.payout_amounts(v_venue) = array[6000], format('6000, got %s', tests.payout_amounts(v_venue));
  assert tests.transferred(v_booking.id) = tests.venue_earned(v_booking.id), 'the ledger';
end $$;

-- Switch credit (P12): 10 paid 600 each, switched to 6 v 6 (each gets 100
-- credit at the venue), then 2 more join at 500. The venue's money is
-- 10 x 600 + 2 x 500 = 7000, of which 1000 is credit it holds for players;
-- the credit rows move no venue money. Transferred: 7000, the ledger.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(tests.create_user('payout-switch-booker@futty.test'), v_venue,
                                          'each_pays_own_spot', 9, tests.cyprus_today() + 3, p_label => 'payout-switch');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_psw_' || i, interval '2 hours');
  end loop;
  perform tests.switch(v_booking.id, 6);
  for i in 10 .. 11 loop
    perform tests.pay_ago((tests.join_booking(v_booking.id, tests.create_user(format('payout-switch-%s@futty.test', i)))).id,
                          'pi_psw_' || i, interval '2 hours');
  end loop;
  assert (select sum(amount_cents) from public.money_ledger where booking_id = v_booking.id and kind = 'credit_issued') = 1000,
    '1000 switch credit';
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'one transfer';
  assert tests.payout_amounts(v_venue) = array[7000], format('7000, got %s', tests.payout_amounts(v_venue));
  assert tests.transferred(v_booking.id) = tests.venue_earned(v_booking.id), 'the ledger';
  assert (select coalesce(sum(venue_cents), 0) from public.money_ledger where booking_id = v_booking.id and kind like 'credit%') = 0,
    'credit rows move no venue money';
end $$;

rollback;
