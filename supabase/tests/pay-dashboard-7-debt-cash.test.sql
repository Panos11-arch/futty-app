-- A debt settled at the venue (docs/specs/13-payments-bookings.md "Venue
-- dashboard", decided 13 November, Dimitris; for Panos to confirm): the
-- player handed the venue the whole debt, so it's recorded once as a
-- debt_cash_received ledger row (venue_cents = the debt), beside the
-- venue_payable for Futty's part. Like cash_received, it never went through
-- Stripe, so the balance check (and P4d's payouts) leave it out by name. A
-- debt paid by card in the app is a Stripe capture, not cash.
begin;

do $$
declare
  v_owner uuid := tests.create_user('debt-cash-owner@futty.test');
  v_player uuid := tests.create_user('debt-cash-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_settled uuid;
  v_paid uuid;
  v_pitch_only uuid;
  v_row public.money_ledger;
  v_balance record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_player, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 2,
                                          p_label => 'debt-cash');
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_player, 'venue', v_venue, v_booking.id, 680, 600, 80, 'unpaid_share') returning id into v_settled;
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_player, 'venue', v_venue, v_booking.id, 680, 600, 80, 'unpaid_share') returning id into v_paid;
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_player, 'venue', v_venue, v_booking.id, 600, 600, 0, 'cash_unpaid') returning id into v_pitch_only;

  -- €6.80 settled at the counter: +6.80 cash received, -0.80 owed to Futty.
  perform tests.act_as(v_owner);
  perform public.settle_debt(v_settled);
  assert tests.error_of(format('select public.settle_debt(%L)', v_settled)) = 'debt_settled', 'settled once';
  perform tests.act_as_postgres();

  assert (select count(*) from public.money_ledger where debt_id = v_settled and kind = 'debt_cash_received') = 1,
    'one cash row per debt';
  select * into v_row from public.money_ledger where debt_id = v_settled and kind = 'debt_cash_received';
  assert v_row.amount_cents = 680 and v_row.venue_cents = 680 and v_row.futty_cents = 0 and v_row.stripe_fee_cents = 0
         and v_row.credit_cents = 0 and v_row.stripe_id is null and v_row.stripe_intent_id is null
         and v_row.share_id is null and v_row.booking_id = v_booking.id
         and v_row.ref = 'debt-cash-' || v_settled and v_row.reason = 'debt_settled_at_venue',
    format('the whole debt to the venue, got %s', to_jsonb(v_row));
  assert (select venue_cents = -80 and futty_cents = 80
          from public.money_ledger where kind = 'venue_payable' and ref = 'venue-payable-debt-' || v_settled),
    'Futty''s part owed by the venue';

  -- A pitch-only debt: the cash row, no payable.
  perform tests.act_as(v_owner);
  perform public.settle_debt(v_pitch_only);
  perform tests.act_as_postgres();
  assert (select venue_cents from public.money_ledger where debt_id = v_pitch_only and kind = 'debt_cash_received') = 600,
    'pitch-only debt: 600 cash';
  assert not exists (select 1 from public.money_ledger where kind = 'venue_payable'
                     and ref = 'venue-payable-debt-' || v_pitch_only), 'no Futty part, no payable';

  -- Paid by card in the app: a capture, no cash row.
  perform public.debt_paid(v_paid, 'pi_debt_cash_card', 680, tests.stripe_fee(680));
  assert (select settled_by from public.venue_debts where id = v_paid) = 'payment', 'paid by card';
  assert not exists (select 1 from public.money_ledger where debt_id = v_paid and kind = 'debt_cash_received'),
    'paid by card is not cash';

  -- The books still balance: the cash never went through Stripe.
  select * into v_balance from public.money_balance(v_booking.id);
  assert v_balance.balanced, format('balanced, got %s', to_jsonb(v_balance));

  -- The row can't be faked with another split.
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, debt_id, kind, amount_cents, ref, reason,
                                     venue_cents) values (%L, %L, 'debt_cash_received', 680, 'x', 'x', 600) $q$,
                               v_booking.id, v_paid)) like '%money_ledger_split_check%', 'venue_cents = amount';
end $$;

rollback;
