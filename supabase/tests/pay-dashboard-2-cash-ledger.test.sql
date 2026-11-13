-- Cash in the ledger (docs/specs/13-payments-bookings.md "Venue dashboard",
-- decided 13 November): when staff tick a cash player as paid, the share's
-- pitch part at that moment is recorded once as a cash_received ledger row
-- (venue_cents), so revenue can be read from money_ledger. The venue already
-- holds that money, so the balance check (and P4d's payouts) leave
-- cash_received and counter_paid out by name.
begin;

do $$
declare
  v_owner uuid := tests.create_user('cash-ledger-owner@futty.test');
  v_booker uuid := tests.create_user('cash-ledger-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
  v_by_card public.booking_payment_shares;
  v_before jsonb;
  v_after jsonb;
  v_balance record;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'cash-ledger');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_cledger_' || i, interval '2 hours',
                          case when i in (1, 2) then 'cash' else 'card' end);
  end loop;
  v_cash := tests.player(v_booking.id, 1);
  v_by_card := tests.player(v_booking.id, 2);
  assert v_cash.cash_cents = 600, format('a cash player owes 600 at the venue, got %s', v_cash.cash_cents);

  select jsonb_agg(to_jsonb(a) order by a.share_id) into v_before from public.collection_amounts(v_booking.id) a;

  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_cash.id);
  perform public.mark_cash_received(v_cash.id);
  perform tests.act_as_postgres();

  assert (select count(*) from public.money_ledger where share_id = v_cash.id and kind = 'cash_received') = 1,
    'one row, however many ticks';
  assert (select amount_cents = 600 and venue_cents = 600 and futty_cents = 0 and stripe_fee_cents = 0
                 and credit_cents = 0 and stripe_id is null and ref = 'cash:' || v_cash.id
                 and booking_id = v_booking.id and reason = 'cash_received_at_venue'
          from public.money_ledger where share_id = v_cash.id and kind = 'cash_received'),
    'the pitch part, all the venue''s, no Stripe';

  -- Collection amounts are what they were.
  select jsonb_agg(to_jsonb(a) order by a.share_id) into v_after from public.collection_amounts(v_booking.id) a;
  assert (select jsonb_agg(e - 'cash_received' order by e ->> 'share_id') from jsonb_array_elements(v_after) e)
       = (select jsonb_agg(e - 'cash_received' order by e ->> 'share_id') from jsonb_array_elements(v_before) e),
    'amounts unchanged by the tick';

  -- After the match, the other cash player pays it by card in the app
  -- instead: a Stripe capture, not cash. Ticking it afterwards adds nothing.
  perform tests.end_match(v_booking.id, interval '10 minutes');
  perform public.attach_cash_intent(v_by_card.id, v_by_card.profile_id, 'pi_cledger_card', 600, null);
  perform public.cash_paid_by_card(v_by_card.id, 'pi_cledger_card', 600, tests.stripe_fee(600));
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_by_card.id);
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.money_ledger where share_id = v_by_card.id and kind = 'cash_received'),
    'paid by card in the app is not cash';

  -- The books still balance: cash never went through Stripe.
  select * into v_balance from public.money_balance(v_booking.id);
  assert v_balance.balanced, format('balanced, got %s', to_jsonb(v_balance));
end $$;

-- The ledger accepts the new kinds only in their own shape.
do $$
declare
  v_booking uuid := gen_random_uuid();
begin
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, kind, amount_cents, ref, reason, venue_cents)
                                   values (%L, 'cash_received', 600, 'x1', 'r', 600) $q$, v_booking))
         like '%money_ledger_split_check%', 'cash_received needs its share';
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, share_id, kind, amount_cents, ref, reason, venue_cents, futty_cents)
                                   values (%L, gen_random_uuid(), 'cash_received', 600, 'x2', 'r', 520, 80) $q$, v_booking))
         like '%money_ledger_split_check%', 'cash is all the venue''s';
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, kind, amount_cents, ref, reason, venue_cents)
                                   values (%L, 'counter_paid', 500, 'x3', 'r', 400) $q$, v_booking))
         like '%money_ledger_split_check%', 'counter_paid is the whole amount, either way';
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, kind, amount_cents, ref, reason, venue_cents)
                                   values (%L, 'counter_paid', 0, 'x4', 'r', 0) $q$, v_booking))
         like '%money_ledger_split_check%', 'never zero';
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, kind, amount_cents, ref, reason, venue_cents)
                                   values (%L, 'counter_paid', 500, 'x5', 'r', -500) $q$, v_booking)) is null,
    'a reversal';
end $$;

rollback;
