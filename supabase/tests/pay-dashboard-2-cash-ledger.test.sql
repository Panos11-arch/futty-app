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

-- Ticked cash handed back (decided 13 November): a ticked share later
-- cancelled, refunded or forfeited, or the venue cancelling the booking,
-- writes one reversing cash_received row.
do $$
declare
  v_owner uuid := tests.create_user('cash-back-owner@futty.test');
  v_booker uuid := tests.create_user('cash-back-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_early public.booking_payment_shares;
  v_late public.booking_payment_shares;
  v_stays public.booking_payment_shares;
  v_unticked public.booking_payment_shares;
  v_share public.booking_payment_shares;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 4, tests.cyprus_today() + 3,
                                          p_label => 'cash-back');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_cback_0', interval '2 hours');
  v_early := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_cback_1', interval '5 minutes', 'cash');
  v_late := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_cback_2', interval '2 hours', 'cash');
  v_stays := tests.pay_ago((tests.player(v_booking.id, 3)).id, 'pi_cback_3', interval '2 hours', 'cash');
  v_unticked := tests.pay_ago((tests.player(v_booking.id, 4)).id, 'pi_cback_4', interval '2 hours', 'cash');
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_early.id);
  perform public.mark_cash_received(v_late.id);
  perform public.mark_cash_received(v_stays.id);
  perform tests.act_as_postgres();

  -- Players cancel: in the free hour (cancelled) and later (forfeited).
  v_result := tests.cancel(v_booking.id, 'my_spot', v_early.profile_id);
  v_result := tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  assert (select status from public.booking_payment_shares where id = v_early.id) = 'cancelled', 'early: cancelled';
  assert (select status from public.booking_payment_shares where id = v_late.id) = 'forfeited', 'late: forfeited';
  assert not exists (select 1 from public.money_ledger where ref = 'cash_reversal:' || v_stays.id), 'still playing';

  -- The venue cancels the booking (its shares change too: still one row).
  v_result := tests.cancel(v_booking.id, 'venue', v_owner);

  foreach v_share in array array[v_early, v_late, v_stays] loop
    assert (select count(*) from public.money_ledger where ref = 'cash_reversal:' || v_share.id) = 1,
      format('one reversal for %s', v_share.id);
    assert (select kind = 'cash_received' and amount_cents = 600 and venue_cents = -600 and share_id = v_share.id
                   and booking_id = v_booking.id and reason = 'cash_returned' and stripe_id is null
            from public.money_ledger where ref = 'cash_reversal:' || v_share.id), 'the cash back off the venue';
    assert (select sum(venue_cents) from public.money_ledger where share_id = v_share.id and kind = 'cash_received') = 0,
      'nets to nothing';
  end loop;
  assert not exists (select 1 from public.money_ledger where share_id = v_unticked.id and kind = 'cash_received'),
    'never ticked: nothing to hand back';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books still balance';
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
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, share_id, kind, amount_cents, ref, reason, venue_cents)
                                   values (%L, gen_random_uuid(), 'cash_received', 600, 'x2b', 'r', -600) $q$, v_booking)) is null,
    'cash handed back';
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, share_id, kind, amount_cents, ref, reason, venue_cents)
                                   values (%L, gen_random_uuid(), 'cash_received', 600, 'x2c', 'r', -500) $q$, v_booking))
         like '%money_ledger_split_check%', 'the whole amount back';
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
