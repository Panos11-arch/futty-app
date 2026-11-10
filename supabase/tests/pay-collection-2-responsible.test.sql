-- Collection when the booker is responsible (docs/specs/13-payments-bookings.md,
-- "When money is held and taken" steps 3 and 9, "Cash at the venue"; 14, P4c):
--   anything still unpaid 2 hours after the match (a failed top-up, an
--   unticked cash player, a share never paid) is taken from the booker's
--   guarantee hold, and the rest of the hold is released;
--   an unpaid share is covered with its service fee, the total capped at
--   the hold, pitch money first (decided 10 November);
--   a booker whose hold never succeeded owes all of it as debt to the venue,
--   up to the full pitch price.
begin;

-- A failed top-up is taken from the booker's hold: 8 players, one card
-- declined, so 150 is taken and the rest released.
do $$
declare
  v_booker uuid := tests.create_user('resp-topup-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee public.booking_guarantees;
  v_start jsonb;
  v_settle jsonb;
  v_failed public.booking_payment_shares;
  v_capture public.money_ledger;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 7, tests.cyprus_today() + 3,
                                          p_label => 'resp-topup');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_rtop_' || i, interval '2 hours');
  end loop;
  v_guarantee := tests.hold_guarantee(v_booking.id, 'pi_rtop_guarantee');
  assert v_guarantee.status = 'held' and v_guarantee.amount_cents = 6000, 'the 6000 hold is on the booker''s card';

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_failed := tests.player(v_booking.id, 5);
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid, array[v_failed.id]);
  assert (tests.item(v_booking.id, v_failed.id)).status = 'unpaid', 'the declined top-up is still owed';

  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle @> jsonb_build_object('result', 'guarantee', 'action', 'capture', 'capture_cents', 150,
                                        'guarantee_id', v_guarantee.id, 'stripe_intent_id', 'pi_rtop_guarantee'),
    format('150 taken from the hold, got %s', v_settle);
  assert (tests.item(v_booking.id, v_failed.id)).status = 'covered', 'covered by the hold';
  assert not exists (select 1 from public.venue_debts where booking_id = v_booking.id), 'nobody owes anything';
  -- Asking again gives the same work, nothing new.
  assert public.settle_collection((v_start ->> 'collection_id')::uuid) = v_settle, 'the same answer twice';

  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'captured', 150, tests.stripe_fee(150));
  select * into v_capture from public.money_ledger where kind = 'capture' and stripe_id = 'pi_rtop_guarantee';
  assert v_capture.amount_cents = 150 and v_capture.venue_cents = 150 and v_capture.guarantee_id = v_guarantee.id
         and v_capture.stripe_fee_cents = tests.stripe_fee(150) and v_capture.futty_cents = -tests.stripe_fee(150),
    format('the venue gets the 150; Futty pays Stripe; got %s', row_to_json(v_capture));
  assert (select status from public.booking_guarantees where id = v_guarantee.id) = 'collected', 'hold collected';
  assert (select status from public.booking_collections where booking_id = v_booking.id) = 'done', 'done';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';

  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'captured', 150, tests.stripe_fee(150));
  assert (select count(*) from public.money_ledger where kind = 'capture' and stripe_id = 'pi_rtop_guarantee') = 1,
    'recorded once';
end $$;

-- An unticked cash player is covered by the hold (600); a ticked one isn't
-- owed anything.
do $$
declare
  v_owner uuid := tests.create_user('resp-cash-owner@futty.test');
  v_booker uuid := tests.create_user('resp-cash-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_settle jsonb;
  v_unticked public.booking_payment_shares;
  v_ticked public.booking_payment_shares;
  v_item public.booking_collection_items;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'resp-cash');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_rcash_' || i, interval '2 hours',
                          case when i in (3, 4) then 'cash' else 'card' end);
  end loop;
  perform tests.hold_guarantee(v_booking.id, 'pi_rcash_guarantee');
  v_unticked := tests.player(v_booking.id, 3);
  v_ticked := tests.player(v_booking.id, 4);
  assert v_unticked.status = 'paid' and v_unticked.amount_cents = 80 and v_unticked.cash_cents = 600,
    'a cash player paid the 80 fee by card';

  perform tests.end_match(v_booking.id, interval '1 hour');
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_ticked.id);
  perform tests.act_as_postgres();
  perform tests.end_match(v_booking.id);

  v_start := public.start_collection(v_booking.id);
  v_item := tests.item(v_booking.id, v_unticked.id);
  assert v_item.kind = 'unpaid_cash' and v_item.amount_cents = 600 and v_item.pitch_cents = 600 and v_item.fee_cents = 0
         and v_item.status = 'unpaid',
    format('the unticked player owes their 600 cash, got %s', row_to_json(v_item));
  assert (tests.item(v_booking.id, v_ticked.id)).id is null, 'the ticked player owes nothing';

  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle @> jsonb_build_object('action', 'capture', 'capture_cents', 600), format('600 from the hold, got %s', v_settle);
  assert (tests.item(v_booking.id, v_unticked.id)).status = 'covered', 'covered by the hold';
  assert tests.owed(v_unticked.profile_id) = 0, 'the player settles with the booker outside the app';
end $$;

-- Nothing unpaid: the whole hold is released.
do $$
declare
  v_booker uuid := tests.create_user('resp-none-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee public.booking_guarantees;
  v_start jsonb;
  v_settle jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'resp-none');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_rnone_' || i, interval '2 hours');
  end loop;
  v_guarantee := tests.hold_guarantee(v_booking.id, 'pi_rnone_guarantee');
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle @> jsonb_build_object('result', 'guarantee', 'action', 'release', 'capture_cents', 0,
                                        'stripe_intent_id', 'pi_rnone_guarantee'),
    format('the hold is released, got %s', v_settle);
  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'released', 0, 0);
  assert (select status from public.booking_guarantees where id = v_guarantee.id) = 'released', 'released';
  assert (select status from public.booking_collections where booking_id = v_booking.id) = 'done', 'done';
end $$;

-- Unpaid shares are covered with their service fee: 2 players never paid,
-- 2 x 680 = 1360 from the hold, 1200 of it the venue's.
do $$
declare
  v_booker uuid := tests.create_user('resp-unpaid-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_settle jsonb;
  v_item public.booking_collection_items;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'resp-unpaid');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_runpaid_' || i, interval '2 hours');
  end loop;
  perform tests.hold_guarantee(v_booking.id, 'pi_runpaid_guarantee');
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_item := tests.item(v_booking.id, (tests.player(v_booking.id, 9)).id);
  assert v_item.kind = 'unpaid_share' and v_item.amount_cents = 680 and v_item.pitch_cents = 600 and v_item.fee_cents = 80,
    format('a share never paid owes 680, got %s', row_to_json(v_item));
  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle @> jsonb_build_object('action', 'capture', 'capture_cents', 1360, 'futty_cents', 160),
    format('1360 from the hold, 160 of it Futty''s fee, got %s', v_settle);
  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'captured', 1360, tests.stripe_fee(1360));
  assert (select venue_cents from public.money_ledger where kind = 'capture' and stripe_id = 'pi_runpaid_guarantee') = 1200,
    'the venue gets the 1200 pitch money';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- A booker whose hold never succeeded owes whatever is still unpaid, up
-- to 6000: here 9 players never paid (9 x 680 = 6120), so 6000, the pitch
-- money first (5400 to the venue, 600 of the fees to Futty).
do $$
declare
  v_booker uuid := tests.create_user('resp-nohold-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_settle jsonb;
  v_debt public.venue_debts;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'resp-nohold');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_rnohold_0', interval '2 hours');
  perform public.guarantee_hold_failed((select id from public.booking_guarantees where booking_id = v_booking.id),
                                       null, 'card_declined');
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_settle := public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert v_settle ->> 'result' = 'done', format('no hold to take from, got %s', v_settle);

  select * into v_debt from public.venue_debts where booking_id = v_booking.id;
  assert v_debt.profile_id = v_booker and v_debt.owed_to = 'venue' and v_debt.venue_id = v_venue
         and v_debt.amount_cents = 6000 and v_debt.venue_cents = 5400 and v_debt.futty_cents = 600
         and v_debt.reason = 'guarantee_not_held' and v_debt.settled_at is null,
    format('the booker owes 6000 to the venue, got %s', row_to_json(v_debt));
  assert (select count(*) from public.venue_debts where booking_id = v_booking.id) = 1, 'one debt, the booker''s';
  assert (select count(*) from public.booking_collection_items where booking_id = v_booking.id and status = 'debt') = 9,
    'every unpaid share is on the booker''s debt';
  assert exists (select 1 from public.money_ledger where kind = 'debt_created' and booking_id = v_booking.id
                 and amount_cents = 6000), 'the debt is in the ledger';
  assert exists (select 1 from public.notifications where type = 'debt_created' and profile_id = v_booker
                 and body like '%€60.00%'), 'the booker is told';
  assert (select balanced from public.money_balance(v_booking.id)), 'a debt moves no money';
end $$;

-- A smaller gap with no hold: the booker owes exactly what's unpaid.
do $$
declare
  v_booker uuid := tests.create_user('resp-gap-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'resp-gap');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_rgap_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.owed(v_booker) = 680, format('one unpaid share: 680, got %s', tests.owed(v_booker));
  assert tests.owed((tests.player(v_booking.id, 9)).profile_id) = 0, 'the player who didn''t pay owes the booker, not Futty';
end $$;

-- The hold was gone when collection tried to take it (expired or
-- cancelled at Stripe): the booker owes what it would have covered.
do $$
declare
  v_booker uuid := tests.create_user('resp-gone-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 9, tests.cyprus_today() + 3,
                                          p_label => 'resp-gone');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_rgone_' || i, interval '2 hours');
  end loop;
  perform tests.hold_guarantee(v_booking.id, 'pi_rgone_guarantee');
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  perform public.collection_guarantee_done((v_start ->> 'collection_id')::uuid, 'gone', 0, 0);
  assert tests.owed(v_booker) = 680 and (select reason from public.venue_debts where profile_id = v_booker) = 'guarantee_not_held',
    'the booker owes the 680 the hold would have covered';
  assert (select status from public.booking_collections where booking_id = v_booking.id) = 'done', 'done';
end $$;

rollback;
