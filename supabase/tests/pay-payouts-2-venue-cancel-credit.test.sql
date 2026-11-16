-- P4d: what the venue owes comes off its next transfer, and credit money is
-- the venue's when it's issued (docs/specs/13-payments-bookings.md
-- "Payouts", "Credit sits with the venue", decided 10 November):
--   - the venue cancels and every player takes a card refund: the venue
--     owes Stripe's fee on each payment taken (venue_payables). Nothing is
--     pulled back: it comes off the venue's next transfer;
--   - credit issued at a venue is in that venue's next transfer; spending
--     it later adds nothing to a transfer (the share's card part only).
begin;

do $$
declare
  v_owner uuid := tests.create_user('payout-vc-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_cancelled public.venue_bookings;
  v_next public.venue_bookings;
  v_quote jsonb;
  v_done jsonb;
  v_share public.booking_payment_shares;
  v_line public.booking_cancellation_lines;
  v_fees integer;
  v_start jsonb;
  i integer;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);

  -- Three paid players; the venue cancels; each takes a card refund.
  v_cancelled := tests.booking_with_players(tests.create_user('payout-vc-booker@futty.test'), v_venue,
                                            'each_pays_own_spot', 2, tests.cyprus_today() + 3, '10:00', '11:00', 'payout-vc');
  for i in 0 .. 2 loop
    perform tests.pay_ago((tests.player(v_cancelled.id, i)).id, 'pi_pvc_' || i, interval '2 hours');
  end loop;
  perform tests.act_as(v_owner);
  v_quote := public.cancellation_quote(v_cancelled.id, 'venue');
  perform tests.act_as_service_role();
  v_done := public.cancel_booking_internal(v_cancelled.id, 'venue', v_owner, v_quote ->> 'quote');
  perform tests.act_as_postgres();
  assert tests.run_payouts() = 0, 'the players are still choosing: not final';

  for i in 0 .. 2 loop
    v_share := tests.player(v_cancelled.id, i);
    v_line := tests.line(v_done, v_share.id);
    perform tests.act_as_service_role();
    perform public.choose_cancellation_refund(v_line.id, v_share.profile_id, 'card');
    perform public.record_intent_refund('pi_pvc_' || i, 're_pvc_' || i, 680, 'venue_cancelled');
    perform public.cancellation_line_refunded(v_line.id, 'refunded');
    perform tests.act_as_postgres();
  end loop;
  select sum(amount_cents) into v_fees from public.venue_payables where booking_id = v_cancelled.id;
  assert v_fees = 3 * tests.stripe_fee(680), format('the venue owes Stripe''s fee on each of the 3, got %s', v_fees);
  assert tests.venue_earned(v_cancelled.id) = -v_fees, 'on the ledger: the venue owes the fees';

  assert tests.run_payouts() = 0, 'nothing to send: nothing is pulled back from the venue';
  assert not exists (select 1 from public.venue_payouts where venue_id = v_venue), 'no transfer';

  -- The venue's next booking, 10 at €60: 6000 less the fees.
  v_next := tests.booking_with_players(tests.create_user('payout-vc-next@futty.test'), v_venue,
                                       'each_pays_own_spot', 9, tests.cyprus_today() + 4, p_label => 'payout-vc-next');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_next.id, i)).id, 'pi_pvcn_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_next.id);
  v_start := public.start_collection(v_next.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'one transfer';
  assert tests.payout_amounts(v_venue) = array[6000 - v_fees],
    format('6000 less the recorded fees (%s), got %s', v_fees, tests.payout_amounts(v_venue));
  assert (select booking_id from public.venue_payouts where venue_id = v_venue) = v_next.id, 'for the next booking';
  assert (select count(*) from public.venue_payout_items i join public.venue_payouts p on p.id = i.payout_id
          where p.venue_id = v_venue and i.booking_id = v_cancelled.id) > 0, 'it covered the cancelled booking''s fees';
  assert not exists (select 1 from public.venue_payables where booking_id = v_cancelled.id and settled_at is null),
    'what the venue owed is settled';
  assert tests.transferred(v_cancelled.id) + tests.transferred(v_next.id)
         = tests.venue_earned(v_cancelled.id) + tests.venue_earned(v_next.id), 'the ledger, both bookings';
end $$;

-- Credit: a player cancels in the middle window and their money becomes
-- credit at the venue, which is in the venue's next transfer. They spend it
-- on the venue's next game: that game's transfer has only their card part.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_first public.venue_bookings;
  v_second public.venue_bookings;
  v_canceller public.booking_payment_shares;
  v_spender public.booking_payment_shares;
  v_credit integer;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  v_first := tests.booking_with_players(tests.create_user('payout-credit-booker@futty.test'), v_venue,
                                        'each_pays_own_spot', 9, tests.cyprus_today() + 3, '10:00', '11:00', 'payout-credit');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_first.id, i)).id, 'pi_pcr_' || i, interval '2 hours');
  end loop;
  v_canceller := tests.player(v_first.id, 9);
  perform tests.act_as_service_role();
  perform tests.cancel(v_first.id, 'my_spot', v_canceller.profile_id);
  perform tests.act_as_postgres();
  select remaining_cents into v_credit from public.venue_credits where profile_id = v_canceller.profile_id and venue_id = v_venue;
  assert v_credit > 0, 'credit at the venue';
  assert (select venue from tests.share_books(v_canceller.id)) >= v_credit,
    format('the credit money is the venue''s on the ledger: venue %s, credit %s',
           (select venue from tests.share_books(v_canceller.id)), v_credit);

  perform tests.end_match(v_first.id);
  v_start := public.start_collection(v_first.id);
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'the first game''s transfer';
  assert tests.transferred(v_first.id) = tests.venue_earned(v_first.id), 'the ledger, credit money included';
  assert (select coalesce(sum(i.venue_cents), 0) from public.venue_payout_items i
          join public.money_ledger l on l.id = i.ledger_id where l.share_id = v_canceller.id)
         = (select venue from tests.share_books(v_canceller.id)), 'the credited share''s money went in it';

  -- The same player spends the credit on the venue's next game.
  v_second := tests.booking_with_players(tests.create_user('payout-credit-next@futty.test'), v_venue,
                                         'each_pays_own_spot', 8, tests.cyprus_today() + 4, p_label => 'payout-credit-next');
  for i in 0 .. 8 loop
    perform tests.pay_ago((tests.player(v_second.id, i)).id, 'pi_pcrn_' || i, interval '2 hours');
  end loop;
  v_spender := tests.pay_ago((tests.join_booking(v_second.id, v_canceller.profile_id)).id, 'pi_pcrn_spend',
                             interval '2 hours', 'card', true);
  assert v_spender.credit_cents = v_credit and v_spender.status = 'paid',
    format('paid with all %s of the credit, got %s', v_credit, row_to_json(v_spender));
  assert (select coalesce(sum(venue_cents), 0) from public.money_ledger
          where kind in ('credit_spent', 'credit_issued', 'credit_returned', 'credit_expired')) = 0,
    'credit rows move no venue money';

  perform tests.end_match(v_second.id, interval '6 hours');
  v_start := public.start_collection(v_second.id);
  perform tests.charge_top_ups((v_start ->> 'collection_id')::uuid);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  assert tests.run_payouts() = 1, 'the second game''s transfer';
  assert tests.transferred(v_second.id) = tests.venue_earned(v_second.id), 'the ledger';
  assert (select coalesce(sum(i.venue_cents), 0) from public.venue_payout_items i
          join public.money_ledger l on l.id = i.ledger_id where l.share_id = v_spender.id)
         = (select coalesce(sum(venue_cents), 0) from public.money_ledger where share_id = v_spender.id and kind = 'capture'),
    'the spender''s share sends only its card part';
  assert tests.transferred(v_second.id) = 9 * 600
         + (select coalesce(sum(venue_cents), 0) from public.money_ledger where share_id = v_spender.id and kind = 'capture'),
    format('9 x 600 and the card part: %s', tests.transferred(v_second.id));
  assert (select coalesce(sum(venue_cents), 0) from public.money_ledger where share_id = v_spender.id and kind = 'capture')
         = 600 - v_credit,
    format('the card part is the pitch part less the credit spent (600 - %s), got %s', v_credit,
           (select coalesce(sum(venue_cents), 0) from public.money_ledger where share_id = v_spender.id and kind = 'capture'));
end $$;

rollback;
