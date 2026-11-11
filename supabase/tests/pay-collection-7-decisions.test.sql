-- The five decisions of 10 November on PR #36 (docs/specs/13-payments-bookings.md,
-- "When money is held and taken" step 9, "Short games", "Cash at the venue",
-- "Debt"):
--   1. the booker gave up their spot: a short game's leftover cents go to
--      the first player who joined;
--   2. money taken from the booker's hold: the booker is told
--      (guarantee_charged), with the names of the unpaid spots;
--   3. a venue marks settled a debt that includes Futty's fee: the debt is
--      cleared and Futty's part comes off the venue's next payout
--      (venue_payables);
--   4. booker responsible: an unticked cash player is told the booker will
--      be charged; just my spot: they remain in debt to the venue;
--   5. a late-cancelled share whose card part was never taken counts toward
--      the pitch price, and that card part is collected like any unpaid
--      amount: from the booker's hold, or as the player's debt.
begin;

-- 1. The booker cancelled their own spot (middle window: credit, so no
-- longer holding a spot). 9 players are left: 666 each, and the 6 leftover
-- cents on the first to join (672), so top-ups of 72 and 66.
do $$
declare
  v_booker uuid := tests.create_user('dec-leftover-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'dec-leftover');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_dleft_' || i, interval '2 hours');
  end loop;
  perform tests.cancel(v_booking.id, 'my_spot', v_booker);
  assert (tests.player(v_booking.id, 0)).status = 'credited', 'the booker gave up their spot';

  perform tests.end_match(v_booking.id);
  perform public.start_collection(v_booking.id);
  assert (tests.item(v_booking.id, (tests.player(v_booking.id, 0)).id)).id is null, 'nothing for the booker';
  assert (tests.item(v_booking.id, (tests.player(v_booking.id, 1)).id)).amount_cents = 72, 'the first to join: 672 - 600';
  for i in 2 .. 9 loop
    assert (tests.item(v_booking.id, (tests.player(v_booking.id, i)).id)).amount_cents = 66,
      format('player %s: 666 - 600', i);
  end loop;
end $$;

-- 2. The booker is told what was taken from their hold, and for whom.
do $$
declare
  v_booker uuid := tests.create_user('dec-charged-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_note public.notifications;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'dec-charged');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_dchg_' || i, interval '2 hours');
  end loop;
  update public.profiles set full_name = 'Andreas Georgiou' where id = (tests.player(v_booking.id, 8)).profile_id;
  update public.profiles set full_name = 'Eleni Pavlou' where id = (tests.player(v_booking.id, 9)).profile_id;
  perform tests.hold_guarantee(v_booking.id, 'pi_dchg_guarantee');
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert not exists (select 1 from public.notifications where type = 'guarantee_charged'), 'not before it''s taken';

  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'captured', 1360, tests.stripe_fee(1360));
  select * into v_note from public.notifications where type = 'guarantee_charged' and profile_id = v_booker;
  assert v_note.body = '€13.60 was taken from your hold for unpaid spots: Andreas Georgiou, Eleni Pavlou.',
    format('the decided words, got %s', v_note.body);
  assert v_note.data @> jsonb_build_object('bookingId', v_booking.id, 'amountCents', 1360), format('got %s', v_note.data);
  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'captured', 1360, tests.stripe_fee(1360));
  assert (select count(*) from public.notifications where type = 'guarantee_charged') = 1, 'told once';
end $$;

-- 2. A released hold isn't a charge: no message.
do $$
declare
  v_booker uuid := tests.create_user('dec-release-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'dec-release');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_drel_' || i, interval '2 hours');
  end loop;
  perform tests.hold_guarantee(v_booking.id, 'pi_drel_guarantee');
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'released', 0, 0);
  assert not exists (select 1 from public.notifications where type = 'guarantee_charged' and profile_id = v_booker),
    'nothing taken, nothing to tell';
end $$;

-- 3. The venue marks settled a 680 debt (600 the venue's, 80 Futty's fee):
-- cleared for the player; the 80 comes off the venue's next payout.
do $$
declare
  v_owner uuid := tests.create_user('dec-payable-owner@futty.test');
  v_debtor uuid := tests.create_user('dec-payable-debtor@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_with_fee public.venue_debts;
  v_no_fee public.venue_debts;
  v_payable public.venue_payables;
  v_entry public.money_ledger;
begin
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_debtor, 'venue', v_venue, gen_random_uuid(), 680, 600, 80, 'unpaid_share')
  returning * into v_with_fee;
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_debtor, 'venue', v_venue, gen_random_uuid(), 600, 600, 0, 'cash_unpaid')
  returning * into v_no_fee;

  perform tests.act_as(v_owner);
  perform public.settle_debt(v_with_fee.id);
  perform public.settle_debt(v_no_fee.id);
  perform tests.act_as_postgres();

  assert not public.player_in_debt(v_debtor), 'the player''s debt is fully cleared';
  select * into v_payable from public.venue_payables where debt_id = v_with_fee.id;
  assert v_payable.venue_id = v_venue and v_payable.amount_cents = 80 and v_payable.reason = 'venue_settled_debt_fee'
         and v_payable.booking_id = v_with_fee.booking_id and v_payable.settled_at is null,
    format('the venue owes Futty its 80, got %s', row_to_json(v_payable));
  select * into v_entry from public.money_ledger where kind = 'venue_payable' and ref = 'venue-payable-debt-' || v_with_fee.id;
  assert v_entry.amount_cents = 80 and v_entry.venue_cents = -80 and v_entry.futty_cents = 80,
    format('in the ledger: from the venue to Futty, got %s', row_to_json(v_entry));
  assert (select balanced from public.money_balance(v_with_fee.booking_id)), 'the books balance';
  assert not exists (select 1 from public.venue_payables where debt_id = v_no_fee.id), 'no fee in it, nothing owed';
end $$;

-- 3. A debt paid by card in the app: Futty got its fee from the payment;
-- the venue owes nothing.
do $$
declare
  v_debtor uuid := tests.create_user('dec-paid-debtor@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_debt public.venue_debts;
begin
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_debtor, 'venue', v_venue, gen_random_uuid(), 680, 600, 80, 'unpaid_share')
  returning * into v_debt;
  perform public.attach_debt_intent(v_debt.id, v_debtor, 'pi_dec_paid', 680, null);
  perform public.debt_paid(v_debt.id, 'pi_dec_paid', 680, tests.stripe_fee(680));
  assert not exists (select 1 from public.venue_payables where debt_id = v_debt.id), 'nothing off the payout';
end $$;

-- 4. The after-match cash prompt: responsible mode names the booker who
-- will be charged; just my spot keeps "remain in debt to [venue]".
do $$
declare
  v_booker uuid := tests.create_user('dec-prompt-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_responsible public.venue_bookings;
  v_own public.venue_bookings;
  v_name text;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.profiles set full_name = 'Nikos Christou' where id = v_booker;
  select name into v_name from public.venues where id = v_venue;
  v_responsible := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                              '12:00', '13:00', 'dec-prompt-resp');
  v_own := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                      '14:00', '15:00', 'dec-prompt-own');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_responsible.id, i)).id, 'pi_dpr_' || i, interval '2 hours',
                          case when i = 1 then 'cash' else 'card' end);
    perform tests.pay_ago((tests.player(v_own.id, i)).id, 'pi_dpo_' || i, interval '2 hours',
                          case when i = 1 then 'cash' else 'card' end);
  end loop;
  perform tests.set_kickoff(v_responsible.id, now() - interval '90 minutes');
  perform tests.set_kickoff(v_own.id, now() - interval '40 minutes');

  assert public.send_cash_prompts() = 2, 'one in each booking';
  assert (select body from public.notifications where type = 'cash_unpaid_prompt'
          and profile_id = (tests.player(v_responsible.id, 1)).profile_id)
         = 'Pay €6.00 by card now, or Nikos Christou will be charged for your spot.', 'responsible: the booker is charged';
  assert (select body from public.notifications where type = 'cash_unpaid_prompt'
          and profile_id = (tests.player(v_own.id, 1)).profile_id)
         = format('Pay €6.00 by card now, or remain in debt to %s.', v_name), 'just my spot: debt to the venue';
end $$;

-- 5. A late cancellation whose card part was never taken (the hold went
-- before it could be): it still counts toward the pitch price, and its
-- 680 is collected. Just my spot: the player's debt.
do $$
declare
  v_booker uuid := tests.create_user('dec-nottaken-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_late public.booking_payment_shares;
  v_line public.booking_cancellation_lines;
  v_start jsonb;
  v_item public.booking_collection_items;
  v_debt public.venue_debts;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'dec-nottaken');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_dnt_' || i, interval '2 hours');
  end loop;
  -- Held 10 minutes ago, not yet taken.
  v_late := tests.pay_ago((tests.player(v_booking.id, 9)).id, 'pi_dnt_9', interval '10 minutes');
  assert v_late.status = 'authorized', 'held only';
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours');
  perform tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  select * into v_line from public.booking_cancellation_lines where share_id = v_late.id;
  assert v_line.action = 'keep' and v_line.needs_capture, format('kept, still to take; got %s', row_to_json(v_line));
  -- The hold was gone when the cancellation tried to take it.
  perform public.cancellation_line_not_taken(v_line.id);
  assert (tests.player(v_booking.id, 9)).status = 'forfeited', 'still a late cancellation';

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert (v_start ->> 'joined_players')::integer = 9, '9 still hold a spot';
  assert (select count(*) from public.booking_collection_items where booking_id = v_booking.id and kind = 'top_up') = 0,
    'it counts toward the pitch price: no top-ups for the other 9';
  v_item := tests.item(v_booking.id, v_late.id);
  assert v_item.kind = 'unpaid_share' and v_item.amount_cents = 680 and v_item.pitch_cents = 600 and v_item.fee_cents = 80
         and v_item.profile_id = v_late.profile_id,
    format('the 680 never taken is collected, got %s', row_to_json(v_item));

  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  select * into v_debt from public.venue_debts where profile_id = v_late.profile_id;
  assert v_debt.amount_cents = 680 and v_debt.venue_cents = 600 and v_debt.reason = 'unpaid_share',
    format('the player''s debt to the venue, got %s', row_to_json(v_debt));
end $$;

-- 5. The same in responsible mode: taken from the booker's hold.
do $$
declare
  v_booker uuid := tests.create_user('dec-nottaken-r-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_late public.booking_payment_shares;
  v_start jsonb;
  v_settle jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'dec-nottaken-r');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_dntr_' || i, interval '2 hours');
  end loop;
  v_late := tests.pay_ago((tests.player(v_booking.id, 9)).id, 'pi_dntr_9', interval '10 minutes');
  perform tests.hold_guarantee(v_booking.id, 'pi_dntr_guarantee');
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours');
  perform tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  perform public.cancellation_line_not_taken((select id from public.booking_cancellation_lines where share_id = v_late.id));

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle @> jsonb_build_object('action', 'capture', 'capture_cents', 680, 'futty_cents', 80),
    format('680 from the booker''s hold, got %s', v_settle);
  assert tests.owed(v_late.profile_id) = 0, 'the player owes nothing in the app';
end $$;

rollback;
