-- Debt (docs/specs/13-payments-bookings.md, "Debt"; 14, P4c item 4):
--   a player with any unsettled debt, at any venue or to Futty, can't book,
--   join a booking or choose cash anywhere (player_in_debt), but can always
--   pay the debt; paying adds no fee; the venue's staff can mark a debt to
--   their venue settled;
--   the booker's whole-team cancellation charge still unpaid at the
--   original kickoff becomes a debt to Futty (decided 10 November).
begin;

-- Blocked everywhere, then unblocked by paying.
do $$
declare
  v_debtor uuid := tests.create_user('debt-pay-debtor@futty.test');
  v_booker uuid := tests.create_user('debt-pay-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_other public.venue_bookings;
  v_earlier public.booking_payment_shares;
  v_debt public.venue_debts;
  v_plan jsonb;
  v_paid jsonb;
  v_capture public.money_ledger;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_other_venue, '5-a-side', 6000);
  -- A booking the debtor joined before they owed anything.
  v_other := tests.booking_with_players(v_booker, v_other_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                        '14:00', '15:00', 'debt-pay-other');
  perform tests.pay_ago((tests.player(v_other.id, 0)).id, 'pi_dpay_other_0', interval '2 hours');
  v_earlier := tests.join_booking(v_other.id, v_debtor);

  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_debtor, 'venue', v_venue, gen_random_uuid(), 680, 600, 80, 'unpaid_share')
  returning * into v_debt;
  assert public.player_in_debt(v_debtor), 'in debt';

  -- Can't book anywhere, at another venue too.
  perform tests.act_as(v_debtor);
  assert tests.error_of(format($q$ select public.book_slot(%L, %L, '18:00', '19:00', 1, '5-a-side', 5, 'each_pays_own_spot') $q$,
                               v_other_venue, tests.cyprus_today() + 3)) = 'player_in_debt', 'can''t book';
  perform tests.act_as_postgres();
  -- Can't join a booking.
  v_booking := tests.booking_with_players(v_booker, v_other_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          '20:00', '21:00', 'debt-pay-join');
  assert tests.error_of(format('select public.add_booking_share_internal(%L, %L)', v_booking.id, v_debtor))
         = 'player_in_debt', 'can''t join';
  -- Can't choose cash; card is fine.
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'cash', false) $q$, v_earlier.id, v_debtor))
         = 'player_in_debt', 'can''t choose cash';
  assert public.plan_share_payment(v_earlier.id, v_debtor, 'card', false) ->> 'amount_cents' = '680', 'card is allowed';

  -- Paying the debt: exactly what's owed, no fee.
  v_plan := public.plan_debt_payment(v_debt.id, v_debtor);
  assert v_plan @> jsonb_build_object('debt_id', v_debt.id, 'amount_cents', 680, 'venue_cents', 600, 'futty_cents', 80),
    format('680, no fee added, got %s', v_plan);
  assert tests.error_of(format('select public.plan_debt_payment(%L, %L)', v_debt.id, v_booker)) = 'not_your_debt',
    'only the debtor pays it';
  perform public.attach_debt_intent(v_debt.id, v_debtor, 'pi_debt_1', 680, null);
  v_paid := public.debt_paid(v_debt.id, 'pi_debt_1', 680, tests.stripe_fee(680));
  assert v_paid ->> 'result' = 'settled', format('settled, got %s', v_paid);
  select * into v_debt from public.venue_debts where id = v_debt.id;
  assert v_debt.settled_by = 'payment' and v_debt.settled_at is not null and v_debt.paid_intent_id = 'pi_debt_1',
    format('settled by payment, got %s', row_to_json(v_debt));
  select * into v_capture from public.money_ledger where kind = 'capture' and stripe_id = 'pi_debt_1';
  assert v_capture.amount_cents = 680 and v_capture.venue_cents = 600 and v_capture.futty_cents = 80 - tests.stripe_fee(680)
         and v_capture.booking_id = v_debt.booking_id,
    format('the venue gets its 600, Futty its 80 less Stripe''s fee; got %s', row_to_json(v_capture));
  assert exists (select 1 from public.money_ledger where kind = 'debt_settled' and ref = 'debt-settled-' || v_debt.id),
    'the settlement is in the ledger';
  assert exists (select 1 from public.notifications where type = 'debt_settled' and profile_id = v_debtor), 'told';
  assert not public.player_in_debt(v_debtor), 'unblocked';

  -- Unblocked: can book again.
  perform tests.act_as(v_debtor);
  perform public.book_slot(v_other_venue, tests.cyprus_today() + 3, '18:00', '19:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();

  -- The same payment reported twice changes nothing; a second payment is given back.
  assert public.debt_paid(v_debt.id, 'pi_debt_1', 680, tests.stripe_fee(680)) ->> 'result' = 'duplicate', 'duplicate';
  assert public.debt_paid(v_debt.id, 'pi_debt_2', 680, tests.stripe_fee(680)) @> '{"result": "refund"}', 'refunded';
  assert tests.error_of(format('select public.plan_debt_payment(%L, %L)', v_debt.id, v_debtor)) = 'debt_settled',
    'nothing left to pay';
end $$;

-- The venue's staff mark a debt settled; nobody else can.
do $$
declare
  v_owner uuid := tests.create_user('debt-venue-owner@futty.test');
  v_other_owner uuid := tests.create_user('debt-venue-other-owner@futty.test');
  v_debtor uuid := tests.create_user('debt-venue-debtor@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_debt public.venue_debts;
begin
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_debtor, 'venue', v_venue, gen_random_uuid(), 600, 600, 0, 'cash_unpaid')
  returning * into v_debt;

  perform tests.act_as(v_other_owner);
  assert tests.error_of(format('select public.settle_debt(%L)', v_debt.id)) = 'not_venue_staff', 'another venue';
  perform tests.act_as(v_debtor);
  assert tests.error_of(format('select public.settle_debt(%L)', v_debt.id)) = 'not_venue_staff', 'the debtor';
  perform tests.act_as(v_owner);
  perform public.settle_debt(v_debt.id);
  assert tests.error_of(format('select public.settle_debt(%L)', v_debt.id)) = 'debt_settled', 'once';
  perform tests.act_as_postgres();

  select * into v_debt from public.venue_debts where id = v_debt.id;
  assert v_debt.settled_by = 'venue' and v_debt.settled_by_profile = v_owner, 'settled by the venue';
  assert not public.player_in_debt(v_debtor), 'unblocked';
  -- A card payment that lands after the venue settled is given back.
  assert public.debt_paid(v_debt.id, 'pi_debt_late', 600, tests.stripe_fee(600)) @> '{"result": "refund"}', 'refunded';
end $$;

-- Who sees which debts: the player their own, the venue those owed to it.
do $$
declare
  v_owner uuid := tests.create_user('debt-rls-owner@futty.test');
  v_debtor uuid := tests.create_user('debt-rls-debtor@futty.test');
  v_stranger uuid := tests.create_user('debt-rls-stranger@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
begin
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_debtor, 'venue', v_venue, gen_random_uuid(), 600, 600, 0, 'cash_unpaid'),
         (v_debtor, 'futty', null, gen_random_uuid(), 300, 0, 300, 'cancellation_fee');
  perform tests.act_as(v_debtor);
  assert (select count(*) from public.venue_debts) = 2, 'the player sees both of theirs';
  perform tests.act_as(v_owner);
  assert (select count(*) from public.venue_debts) = 1, 'the venue sees only what''s owed to it';
  perform tests.act_as(v_stranger);
  assert (select count(*) from public.venue_debts) = 0, 'nobody else sees any';
  assert tests.error_of($q$ update public.venue_debts set settled_at = now() $q$) like 'permission denied%',
    'nobody writes debts directly';
  perform tests.act_as_postgres();
end $$;

-- The booker's whole-team cancellation charge, still unpaid at the
-- original kickoff, becomes a debt to Futty; it blocks the same way, only a
-- payment settles it, and a late payment of the charge itself settles it too.
do $$
declare
  v_owner uuid := tests.create_user('debt-futty-owner@futty.test');
  v_booker uuid := tests.create_user('debt-futty-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_done jsonb;
  v_fee public.booking_cancellation_fees;
  v_debt public.venue_debts;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                          p_label => 'debt-futty');
  for i in 0 .. 3 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_dfutty_' || i, interval '2 hours');
  end loop;
  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);
  select * into v_fee from public.booking_cancellation_fees where id = (v_done ->> 'fee_id')::uuid;
  assert v_fee.amount_cents = 300, 'the booker owes 3 x 100';
  perform public.cancellation_fee_attempted(v_fee.id, 'pi_fee_declined', 'failed', 'card_declined');

  -- Not before the original kickoff.
  assert public.cancellation_fees_to_debts() = 0, 'still being retried';
  update public.booking_cancellation_fees set stop_at = now() - interval '1 minute' where id = v_fee.id;
  assert public.cancellation_fees_to_debts() = 1, 'one charge became a debt';
  assert public.cancellation_fees_to_debts() = 0, 'once';

  select * into v_debt from public.venue_debts where cancellation_fee_id = v_fee.id;
  assert v_debt.profile_id = v_booker and v_debt.owed_to = 'futty' and v_debt.venue_id is null
         and v_debt.amount_cents = 300 and v_debt.venue_cents = 0 and v_debt.futty_cents = 300
         and v_debt.reason = 'cancellation_fee' and v_debt.booking_id = v_booking.id,
    format('300 owed to Futty, got %s', row_to_json(v_debt));
  assert exists (select 1 from public.notifications where type = 'debt_created' and profile_id = v_booker
                 and body like '%€3.00%' and body like '%Futty%'), 'the booker is told they owe Futty';

  perform tests.act_as(v_booker);
  assert tests.error_of(format($q$ select public.book_slot(%L, %L, '18:00', '19:00', 1, '5-a-side', 5, 'pay_all') $q$,
                               v_venue, tests.cyprus_today() + 4)) = 'player_in_debt', 'blocked like a venue debt';
  perform tests.act_as(v_owner);
  assert tests.error_of(format('select public.settle_debt(%L)', v_debt.id)) = 'not_venue_staff',
    'a venue can''t settle a debt to Futty';
  perform tests.act_as_postgres();

  -- The booker finishes the old charge's 3-D Secure after all: that pays the debt.
  assert public.cancellation_fee_paid(v_fee.id, 'pi_fee_late', 300, tests.stripe_fee(300)) ->> 'result' = 'paid', 'paid';
  select * into v_debt from public.venue_debts where id = v_debt.id;
  assert v_debt.settled_by = 'payment' and v_debt.paid_intent_id = 'pi_fee_late', 'the debt is settled by it';
  assert not public.player_in_debt(v_booker), 'unblocked';
end $$;

-- Paying a debt to Futty: all of it is Futty's.
do $$
declare
  v_booker uuid := tests.create_user('debt-futty-pay-booker@futty.test');
  v_debt public.venue_debts;
begin
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_booker, 'futty', null, gen_random_uuid(), 900, 0, 900, 'cancellation_fee')
  returning * into v_debt;
  perform public.attach_debt_intent(v_debt.id, v_booker, 'pi_futty_debt', 900, null);
  perform public.debt_paid(v_debt.id, 'pi_futty_debt', 900, tests.stripe_fee(900));
  assert (select venue_cents from public.money_ledger where kind = 'capture' and stripe_id = 'pi_futty_debt') = 0
         and (select futty_cents from public.money_ledger where kind = 'capture' and stripe_id = 'pi_futty_debt')
             = 900 - tests.stripe_fee(900), 'Futty''s, less Stripe''s fee';
  assert not public.player_in_debt(v_booker), 'settled';
end $$;

rollback;
