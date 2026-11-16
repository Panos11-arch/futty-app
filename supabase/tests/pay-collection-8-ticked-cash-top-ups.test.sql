-- A cash player ticked as paid is topped up by card like everyone else
-- (docs/specs/13-payments-bookings.md, "Short games, top-ups and 6 v 6",
-- decided 16 November): they saved a card when joining, so the difference
-- between their pitch part and the cash they paid is charged with the other
-- top-ups, after a switch to fewer players and in any short game. A failed
-- top-up takes the normal path: the booker's hold in responsible mode, the
-- player's debt in just my spot.
begin;

-- €60 6 v 6, ten players, one paying 500 in cash, ticked; switched to 5 v 5:
-- the ticked cash player pays a 100 top-up, like the card players.
do $$
declare
  v_owner uuid := tests.create_user('tcash-down-owner@futty.test');
  v_booker uuid := tests.create_user('tcash-down-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
  v_start jsonb;
  v_item public.booking_collection_items;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_6v6_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                              p_label => 'tcash-down');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_tcdown_' || i, interval '2 hours',
                          case when i = 3 then 'cash' else 'card' end);
  end loop;
  v_cash := tests.player(v_booking.id, 3);
  assert v_cash.cash_cents = 500, format('6 v 6 cash: 500, got %s', v_cash.cash_cents);
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_cash.id);
  perform tests.act_as_postgres();

  perform tests.switch(v_booking.id, 5);
  assert (tests.last_notification(v_cash.profile_id, 'booking_switched')).body like '%You''ll pay €1.00 more after the match.%',
    'the ticked cash player is told they pay €1.00 more';

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_item := tests.item(v_booking.id, v_cash.id);
  assert v_item.kind = 'top_up' and v_item.amount_cents = 100 and v_item.pitch_cents = 100 and v_item.fee_cents = 0
         and v_item.status = 'pending',
    format('the ticked cash player: a 100 top-up with no fee, got %s', row_to_json(v_item));
  assert (select stripe_payment_method_id from public.collection_top_ups_due((v_start ->> 'collection_id')::uuid)
          where share_id = v_cash.id) = 'pm_pi_tcdown_3',
    'charged to the card they saved when joining';
  for i in 0 .. 9 loop
    assert (tests.item(v_booking.id, (tests.player(v_booking.id, i)).id)).amount_cents = 100,
      format('player %s: a 100 top-up', i);
  end loop;

  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid);
  assert public.settle_collection((v_start ->> 'collection_id')::uuid) ->> 'result' = 'done', 'collected';
  assert (tests.item(v_booking.id, v_cash.id)).status = 'paid', 'the top-up was taken';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Responsible mode, the same switch: the ticked cash player's card declines
-- the 100 top-up, so the booker's hold covers it.
do $$
declare
  v_owner uuid := tests.create_user('tcash-resp-owner@futty.test');
  v_booker uuid := tests.create_user('tcash-resp-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
  v_start jsonb;
  v_settle jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_6v6_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                              p_label => 'tcash-resp');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_tcresp_' || i, interval '2 hours',
                          case when i = 3 then 'cash' else 'card' end);
  end loop;
  v_cash := tests.player(v_booking.id, 3);
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_cash.id);
  perform tests.act_as_postgres();
  perform tests.switch(v_booking.id, 5);
  perform tests.hold_guarantee(v_booking.id, 'pi_tcresp_guarantee');

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert (tests.item(v_booking.id, v_cash.id)).kind = 'top_up' and (tests.item(v_booking.id, v_cash.id)).amount_cents = 100,
    'a 100 top-up';
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid, array[v_cash.id]);
  assert (tests.item(v_booking.id, v_cash.id)).status = 'unpaid', 'the declined top-up is still owed';

  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle @> jsonb_build_object('result', 'guarantee', 'action', 'capture', 'capture_cents', 100),
    format('100 taken from the hold, got %s', v_settle);
  assert (tests.item(v_booking.id, v_cash.id)).status = 'covered', 'covered by the hold';
  assert tests.owed(v_cash.profile_id) = 0, 'the player owes no debt';
end $$;

-- €60 5 v 5 played by 9: 6000 / 9 = 666 each, the 6 leftover cents on the
-- booker (672). A ticked cash player paid 600, so pays a 66 top-up; a cash
-- player who paid by card after the match paid the 666 due then and owes
-- nothing more; an unticked one still owes their 666 cash.
do $$
declare
  v_owner uuid := tests.create_user('tcash-nine-owner@futty.test');
  v_booker uuid := tests.create_user('tcash-nine-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_ticked public.booking_payment_shares;
  v_by_card public.booking_payment_shares;
  v_unticked public.booking_payment_shares;
  v_start jsonb;
  v_item public.booking_collection_items;
  v_amounts record;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 8, tests.cyprus_today() + 3,
                                          p_label => 'tcash-nine');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_tcnine_' || i, interval '2 hours',
                          case when i in (2, 3, 4) then 'cash' else 'card' end);
  end loop;
  v_ticked := tests.player(v_booking.id, 2);
  v_by_card := tests.player(v_booking.id, 3);
  v_unticked := tests.player(v_booking.id, 4);
  assert v_ticked.cash_cents = 600, format('5 v 5 cash: 600, got %s', v_ticked.cash_cents);
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_ticked.id);
  perform tests.act_as_postgres();

  perform tests.end_match(v_booking.id, interval '10 minutes');
  select * into v_amounts from public.collection_amounts(v_booking.id) a where a.share_id = v_by_card.id;
  assert v_amounts.due_pitch_cents = 666, format('666 due from each of the 9, got %s', v_amounts.due_pitch_cents);
  perform public.attach_cash_intent(v_by_card.id, v_by_card.profile_id, 'pi_tcnine_cash', 666, null);
  assert public.cash_paid_by_card(v_by_card.id, 'pi_tcnine_cash', 666, tests.stripe_fee(666)) ->> 'result' = 'paid',
    'paid the 666 by card';

  select * into v_amounts from public.collection_amounts(v_booking.id) a where a.share_id = v_ticked.id;
  assert v_amounts.paid_pitch_cents = 600 and v_amounts.due_pitch_cents = 666,
    format('ticked: 600 paid of 666, got %s', row_to_json(v_amounts));
  select * into v_amounts from public.collection_amounts(v_booking.id) a where a.share_id = v_by_card.id;
  assert v_amounts.paid_pitch_cents = 666, format('paid by card: 666 paid, got %s', row_to_json(v_amounts));

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_item := tests.item(v_booking.id, v_ticked.id);
  assert v_item.kind = 'top_up' and v_item.amount_cents = 66 and v_item.pitch_cents = 66 and v_item.fee_cents = 0
         and v_item.status = 'pending',
    format('the ticked cash player: a 66 top-up with no fee, got %s', row_to_json(v_item));
  assert (tests.item(v_booking.id, v_by_card.id)).id is null, 'paid by card after the match: nothing more';
  v_item := tests.item(v_booking.id, v_unticked.id);
  assert v_item.kind = 'unpaid_cash' and v_item.amount_cents = 666,
    format('unticked: 666 cash still owed, got %s', row_to_json(v_item));
  assert (tests.item(v_booking.id, (tests.player(v_booking.id, 0)).id)).amount_cents = 72,
    'the booker: 672 due, 600 paid, a 72 top-up';
  assert (tests.item(v_booking.id, (tests.player(v_booking.id, 1)).id)).amount_cents = 66, 'a card player: 66';

  -- The ticked player's card declines: in just my spot it is their debt.
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid, array[v_ticked.id]);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert (select amount_cents = 66 and venue_cents = 66 and futty_cents = 0 and reason = 'top_up_failed'
                 and booking_id = v_booking.id and venue_id = v_venue
          from public.venue_debts where profile_id = v_ticked.profile_id),
    format('a 66 debt to the venue, got %s',
           (select row_to_json(d) from public.venue_debts d where d.profile_id = v_ticked.profile_id));
  assert (tests.item(v_booking.id, v_ticked.id)).status = 'debt', 'the item is a debt';
  assert tests.owed(v_by_card.profile_id) = 0, 'the player who paid by card owes nothing';
end $$;

-- Responsible mode, 9 players: the ticked cash player's 66 top-up, declined,
-- is taken from the booker's hold.
do $$
declare
  v_owner uuid := tests.create_user('tcash-nresp-owner@futty.test');
  v_booker uuid := tests.create_user('tcash-nresp-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_ticked public.booking_payment_shares;
  v_start jsonb;
  v_settle jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 8, tests.cyprus_today() + 3,
                                          p_label => 'tcash-nresp');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_tcnresp_' || i, interval '2 hours',
                          case when i = 2 then 'cash' else 'card' end);
  end loop;
  perform tests.hold_guarantee(v_booking.id, 'pi_tcnresp_guarantee');
  v_ticked := tests.player(v_booking.id, 2);
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_ticked.id);
  perform tests.act_as_postgres();

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert (tests.item(v_booking.id, v_ticked.id)).kind = 'top_up' and (tests.item(v_booking.id, v_ticked.id)).amount_cents = 66,
    'a 66 top-up';
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid, array[v_ticked.id]);
  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle @> jsonb_build_object('result', 'guarantee', 'action', 'capture', 'capture_cents', 66),
    format('66 taken from the hold, got %s', v_settle);
  assert (tests.item(v_booking.id, v_ticked.id)).status = 'covered', 'covered by the hold';
  assert tests.owed(v_ticked.profile_id) = 0, 'the player owes no debt';
end $$;

rollback;
