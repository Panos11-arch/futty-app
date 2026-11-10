-- Collection when each player pays just their own spot
-- (docs/specs/13-payments-bookings.md, "When money is held and taken" step
-- 9, "Short games", "Cash, debt and venue credit"; 14, P4c): anything still
-- unpaid 2 hours after the match becomes that player's debt to the venue;
-- a booker whose own payment failed owes only their own share.
begin;

-- A failed top-up becomes a 150 debt; the others are charged as normal.
do $$
declare
  v_booker uuid := tests.create_user('own-topup-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_failed public.booking_payment_shares;
  v_debt public.venue_debts;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 7, tests.cyprus_today() + 3,
                                          p_label => 'own-topup');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_otop_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  v_failed := tests.player(v_booking.id, 6);
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid, array[v_failed.id]);
  assert public.settle_collection((v_start ->> 'collection_id')::uuid) ->> 'result' = 'done', 'no hold in this mode';

  select * into v_debt from public.venue_debts where profile_id = v_failed.profile_id;
  assert v_debt.amount_cents = 150 and v_debt.venue_cents = 150 and v_debt.futty_cents = 0 and v_debt.owed_to = 'venue'
         and v_debt.venue_id = v_venue and v_debt.booking_id = v_booking.id and v_debt.reason = 'top_up_failed',
    format('a 150 debt to the venue, got %s', row_to_json(v_debt));
  assert (tests.item(v_booking.id, v_failed.id)).status = 'debt'
         and (tests.item(v_booking.id, v_failed.id)).debt_id = v_debt.id, 'the item points at the debt';
  assert (select count(*) from public.venue_debts where booking_id = v_booking.id) = 1, 'only the failed one owes';
  assert exists (select 1 from public.notifications where type = 'debt_created' and profile_id = v_failed.profile_id
                 and body like '%€1.50%'), 'the player is told what they owe';

  -- Twice: nothing new.
  perform public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert (select count(*) from public.venue_debts where booking_id = v_booking.id) = 1, 'still one debt';
  assert (select count(*) from public.money_ledger where booking_id = v_booking.id and kind = 'debt_created') = 1,
    'recorded once';
end $$;

-- An unticked cash player owes their cash part (750 in a 4 v 4); a cash
-- player the venue ticked owes nothing.
do $$
declare
  v_owner uuid := tests.create_user('own-cash-owner@futty.test');
  v_booker uuid := tests.create_user('own-cash-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_unticked public.booking_payment_shares;
  v_ticked public.booking_payment_shares;
  v_debt public.venue_debts;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 7, tests.cyprus_today() + 3,
                                          p_label => 'own-cash');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_ocash_' || i, interval '2 hours',
                          case when i in (2, 3) then 'cash' else 'card' end);
  end loop;
  v_unticked := tests.player(v_booking.id, 2);
  v_ticked := tests.player(v_booking.id, 3);
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_ticked.id);
  perform tests.act_as_postgres();

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert (tests.item(v_booking.id, v_ticked.id)).id is null, 'ticked: paid in person';
  assert (tests.item(v_booking.id, v_unticked.id)).kind = 'unpaid_cash', 'unticked: still owed';
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);

  select * into v_debt from public.venue_debts where profile_id = v_unticked.profile_id;
  assert v_debt.amount_cents = 750 and v_debt.venue_cents = 750 and v_debt.futty_cents = 0
         and v_debt.reason = 'cash_unpaid',
    format('a short game''s cash part, 750, got %s', row_to_json(v_debt));
  assert tests.owed(v_ticked.profile_id) = 0, 'the ticked player owes nothing';
end $$;

-- The booker's own payment failed: they owe only their own share, 680.
do $$
declare
  v_booker uuid := tests.create_user('own-booker-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_debt public.venue_debts;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'own-booker');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_obook_' || i, interval '2 hours');
  end loop;
  -- The booker's payment never went through (e.g. the hold was cancelled
  -- at Stripe): their share is unpaid again; the booking stays on.
  update public.booking_payment_shares
  set status = 'pending', stripe_payment_intent_id = null, held_at = null, paid_at = null
  where id = (tests.player(v_booking.id, 0)).id;

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  select * into v_debt from public.venue_debts where profile_id = v_booker;
  assert v_debt.amount_cents = 680 and v_debt.venue_cents = 600 and v_debt.futty_cents = 80
         and v_debt.reason = 'unpaid_share' and v_debt.venue_id = v_venue,
    format('the booker owes their own 680, got %s', row_to_json(v_debt));
  assert (select count(*) from public.venue_debts where booking_id = v_booking.id) = 1, 'nobody else owes';
end $$;

-- A pay-for-everyone booking has nothing to collect, and old bookings
-- (before P4a) are never collected.
do $$
declare
  v_booker uuid := tests.create_user('own-payall-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 5, tests.cyprus_today() + 3,
                                          p_label => 'own-payall');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_opayall_0', interval '2 hours');
  perform tests.end_match(v_booking.id);
  assert not exists (select 1 from public.collections_due() where booking_id = v_booking.id), 'not due';
  assert tests.error_of(format('select public.start_collection(%L)', v_booking.id)) = 'nothing_to_collect',
    'refused';
end $$;

rollback;
