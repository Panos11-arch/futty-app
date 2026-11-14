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

-- Ticked cash handed back (decided 13 November, corrected the same day;
-- for Panos to confirm): ticked cash follows the cancellation rules exactly
-- as if the player had paid it by card. It goes back (one reversing
-- cash_received row) only when a card player would get money back: a
-- cancel in the free hour, a whole-team cancel more than 6 hours before
-- kickoff, or the venue cancelling. In the middle window the venue keeps
-- the €1 (card and cash together) and the rest becomes credit at the venue,
-- like a card player's; a late cancel keeps it all. Cash never reaches
-- Stripe: refunds stay the card part.
do $$
declare
  v_owner uuid := tests.create_user('cash-back-owner@futty.test');
  v_booker uuid := tests.create_user('cash-back-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_free public.booking_payment_shares;
  v_middle public.booking_payment_shares;
  v_stays public.booking_payment_shares;
  v_unticked public.booking_payment_shares;
  v_result jsonb;
  v_line public.booking_cancellation_lines;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 4, tests.cyprus_today() + 3,
                                          p_label => 'cash-back');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_cback_0', interval '2 hours');
  v_free := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_cback_1', interval '5 minutes', 'cash');
  v_middle := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_cback_2', interval '2 hours', 'cash');
  v_stays := tests.pay_ago((tests.player(v_booking.id, 3)).id, 'pi_cback_3', interval '2 hours', 'cash');
  v_unticked := tests.pay_ago((tests.player(v_booking.id, 4)).id, 'pi_cback_4', interval '2 hours', 'cash');
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_free.id);
  perform public.mark_cash_received(v_middle.id);
  perform public.mark_cash_received(v_stays.id);
  perform tests.act_as_postgres();

  -- The quote shows the cash next to the card amounts.
  assert tests.quote_line(tests.plan(v_booking.id, 'my_spot', v_free.profile_id), v_free.id)
         @> '{"window": "free", "cash_cents": 600, "cash_back_cents": 600, "cash_credit_cents": 0, "refund_cents": 80}',
    format('free-hour quote, got %s', tests.quote_line(tests.plan(v_booking.id, 'my_spot', v_free.profile_id), v_free.id));

  -- In the free hour: a card player gets everything back, so the cash goes back.
  v_result := tests.cancel(v_booking.id, 'my_spot', v_free.profile_id);
  v_line := tests.line(v_result, v_free.id);
  assert v_line.cash_cents = 600 and v_line.cash_back_cents = 600 and v_line.cash_credit_cents = 0
         and v_line.refund_cents = 80, format('free hour: the card part released, the cash back, got %s', to_jsonb(v_line));
  assert (select status from public.booking_payment_shares where id = v_free.id) = 'cancelled', 'free: cancelled';
  assert (select count(*) from public.money_ledger where ref = 'cash_reversal:' || v_free.id) = 1, 'free: cash back';
  assert (select amount_cents = 600 and venue_cents = -600 and share_id = v_free.id and booking_id = v_booking.id
                 and kind = 'cash_received' and reason = 'cash_returned' and stripe_id is null
          from public.money_ledger where ref = 'cash_reversal:' || v_free.id), 'the cash back off the venue';
  assert not exists (select 1 from public.venue_credits where source_share_id = v_free.id), 'free: no credit';

  -- In the middle window: a card player who paid 680 has 100 kept and gets
  -- 580 as credit. The cash player paid 80 by card and 600 cash: the same
  -- 100 is kept (all 80 of the card part, 20 of the cash), the other 580 of
  -- cash becomes credit at the venue, and the cash stays there.
  v_result := tests.cancel(v_booking.id, 'my_spot', v_middle.profile_id);
  v_line := tests.line(v_result, v_middle.id);
  assert v_line."window" = 'middle' and v_line.action = 'keep_and_credit' and v_line.kept_cents = 80
         and v_line.credit_cents = 0 and v_line.refund_cents = 0
         and v_line.cash_cents = 600 and v_line.cash_back_cents = 0 and v_line.cash_credit_cents = 580,
    format('middle: like a card player, got %s', to_jsonb(v_line));
  assert (select status from public.booking_payment_shares where id = v_middle.id) = 'credited', 'middle: credited';
  assert not exists (select 1 from public.money_ledger where ref = 'cash_reversal:' || v_middle.id), 'middle: cash kept';
  assert (select count(*) = 1 and sum(amount_cents) = 580 and min(source) = 'player_cancelled'
                 and min(venue_id::text) = v_venue::text
          from public.venue_credits where source_share_id = v_middle.id), 'middle: 580 credit at the venue';
  assert (select credit_cents = 580 and venue_cents = 0
          from public.money_ledger where share_id = v_middle.id and kind = 'credit_issued'), 'the credit in the ledger';

  -- The venue cancels: a paid share still in the game is refund_due and its
  -- cash goes back; the credited share already has its credit (as a card
  -- player's would), so nothing more.
  v_result := tests.cancel(v_booking.id, 'venue', v_owner);
  v_line := tests.line(v_result, v_stays.id);
  assert v_line.action = 'refund_choice' and v_line.refund_cents = 80 and v_line.cash_back_cents = 600,
    format('venue: card part to choose, cash back, got %s', to_jsonb(v_line));
  assert (select status from public.booking_payment_shares where id = v_stays.id) = 'refund_due', 'refund_due';
  assert (select count(*) from public.money_ledger where ref = 'cash_reversal:' || v_stays.id) = 1, 'venue: cash back';
  assert (tests.line(v_result, v_middle.id)).id is null, 'the credited share isn''t in the venue''s cancellation';
  assert not exists (select 1 from public.money_ledger where ref = 'cash_reversal:' || v_middle.id), 'credited: kept';
  assert (select sum(venue_cents) from public.money_ledger where share_id = v_middle.id and kind = 'cash_received') = 600,
    'the venue still holds the credited cash';
  assert not exists (select 1 from public.money_ledger where share_id = v_unticked.id and kind = 'cash_received'),
    'never ticked: nothing to hand back';
  assert (select count(*) from public.money_ledger where ref like 'cash_reversal:%' and booking_id = v_booking.id) = 2,
    'one reversal each, no more';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books still balance';
end $$;

-- A late cancel (inside 6 hours) keeps the cash, exactly like a card
-- player's money; if the venue then cancels the game, it goes back (Q1).
do $$
declare
  v_owner uuid := tests.create_user('cash-late-owner@futty.test');
  v_booker uuid := tests.create_user('cash-late-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_late public.booking_payment_shares;
  v_result jsonb;
  v_line public.booking_cancellation_lines;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'cash-late');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_clate_0', interval '2 hours');
  v_late := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_clate_1', interval '2 hours', 'cash');
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_late.id);
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, now() + interval '3 hours');

  v_result := tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  v_line := tests.line(v_result, v_late.id);
  assert v_line."window" = 'late' and v_line.action = 'keep' and v_line.cash_cents = 600
         and v_line.cash_back_cents = 0 and v_line.cash_credit_cents = 0,
    format('late: everything kept, got %s', to_jsonb(v_line));
  assert (select status from public.booking_payment_shares where id = v_late.id) = 'forfeited', 'late: forfeited';
  assert not exists (select 1 from public.money_ledger where ref = 'cash_reversal:' || v_late.id),
    'forfeited: the venue keeps the cash';
  assert not exists (select 1 from public.venue_credits where source_share_id = v_late.id), 'and no credit';

  v_result := tests.cancel(v_booking.id, 'venue', v_owner);
  assert (tests.line(v_result, v_late.id)).cash_back_cents = 600, 'the venue cancels: Q1 gives it back';
  assert (select count(*) from public.money_ledger where ref = 'cash_reversal:' || v_late.id) = 1, 'once';
end $$;

-- The booker cancels the whole team: more than 6 hours before kickoff every
-- other player gets their money back, so their cash goes back; inside 6
-- hours nothing comes back, so the venue keeps it.
do $$
declare
  v_owner uuid := tests.create_user('cash-team-owner@futty.test');
  v_booker uuid := tests.create_user('cash-team-booker@futty.test');
  v_booker_late uuid := tests.create_user('cash-team-booker-late@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_booking public.venue_bookings;
  v_late_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
  v_late_cash public.booking_payment_shares;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          '12:00', '13:00', 'cash-team');
  v_late_booking := tests.booking_with_players(v_booker_late, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                               '15:00', '16:00', 'cash-team-late');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_cteam_0', interval '2 hours');
  v_cash := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_cteam_1', interval '2 hours', 'cash');
  perform tests.pay_ago((tests.player(v_late_booking.id, 0)).id, 'pi_cteaml_0', interval '2 hours');
  v_late_cash := tests.pay_ago((tests.player(v_late_booking.id, 1)).id, 'pi_cteaml_1', interval '2 hours', 'cash');
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_cash.id);
  perform public.mark_cash_received(v_late_cash.id);
  perform tests.act_as_postgres();

  v_result := tests.cancel(v_booking.id, 'whole_team', v_booker);
  assert (tests.line(v_result, v_cash.id)).cash_back_cents = 600, 'whole team in time: cash back';
  assert (select count(*) from public.money_ledger where ref = 'cash_reversal:' || v_cash.id) = 1, 'reversed once';

  perform tests.set_kickoff(v_late_booking.id, now() + interval '3 hours');
  v_result := tests.cancel(v_late_booking.id, 'whole_team', v_booker_late);
  assert (tests.line(v_result, v_late_cash.id)).action = 'keep'
         and (tests.line(v_result, v_late_cash.id)).cash_back_cents = 0, 'whole team late: kept';
  assert not exists (select 1 from public.money_ledger where ref = 'cash_reversal:' || v_late_cash.id),
    'the venue keeps the cash';
  assert (select balanced from public.money_balance(v_booking.id))
         and (select balanced from public.money_balance(v_late_booking.id)), 'the books still balance';
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
