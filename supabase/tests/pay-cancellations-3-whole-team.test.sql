-- The booker cancels the whole team in an each-pays booking
-- (docs/specs/13-payments-bookings.md, "Cancellations and refunds",
-- confirmed, and the 10 November decisions):
--   every other player whose payment was taken gets their full share back,
--   card refund or credit, their choice, within 48 hours (no choice = card
--   refund); a payment only held is released;
--   the booker pays 100 for every other player whose payment was already
--   taken, as one extra charge, when the team is cancelled more than 6 hours
--   before kickoff (inside the booker's own free hour too); held payments
--   don't count;
--   the booker's own share follows the player table;
--   less than 6 hours before kickoff: nobody gets money back, no extra
--   charge, and the slot is released for others to book.
begin;

-- 9 other players paid and taken: 900 extra; the booker's own 680 -> 580 credit.
do $$
declare
  v_booker uuid := tests.create_user('team-nine-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_quote jsonb;
  v_done jsonb;
  v_fee public.booking_cancellation_fees;
  v_line public.booking_cancellation_lines;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'team-nine');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_nine_' || i, interval '2 hours');
  end loop;

  perform tests.act_as(v_booker);
  v_quote := public.cancellation_quote(v_booking.id, 'whole_team');
  perform tests.act_as_postgres();
  assert v_quote -> 'booker_fee' @> jsonb_build_object('players', 9, 'amount_cents', 900, 'profile_id', v_booker),
    format('9 x 100 = 900, got %s', v_quote -> 'booker_fee');
  assert tests.quote_line(v_quote, (tests.player(v_booking.id, 0)).id) @> jsonb_build_object(
    'is_booker', true, 'window', 'middle', 'action', 'keep_and_credit', 'kept_cents', 100, 'credit_cents', 580),
    'the booker''s own share follows the table';
  for i in 1 .. 9 loop
    assert tests.quote_line(v_quote, (tests.player(v_booking.id, i)).id) @> jsonb_build_object(
      'action', 'refund_choice', 'value_cents', 680, 'refund_cents', 680, 'kept_cents', 0),
      format('player %s gets 680 back', i);
  end loop;
  assert (v_quote ->> 'cancels_booking')::boolean, 'the booking is cancelled';

  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);
  assert v_done -> 'lines' = v_quote -> 'lines' and v_done -> 'booker_fee' = v_quote -> 'booker_fee', 'as quoted';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'cancelled', 'cancelled, pitch released';

  select * into v_fee from public.booking_cancellation_fees where id = (v_done ->> 'fee_id')::uuid;
  assert v_fee.amount_cents = 900 and v_fee.players = 9 and v_fee.profile_id = v_booker and v_fee.status = 'pending',
    format('one extra charge of 900, got %s', row_to_json(v_fee));
  assert v_fee.stripe_payment_method_id = 'pm_pi_nine_0', 'on the booker''s saved card';
  assert v_fee.stop_at = tests.kickoff_of(v_booking.id), 'retries stop at the original kickoff';

  for i in 1 .. 9 loop
    v_line := tests.line(v_done, (tests.player(v_booking.id, i)).id);
    assert v_line.action = 'refund_choice' and v_line.choice is null and v_line.work = 'pending'
           and v_line.choose_by = now() + interval '48 hours' and v_line.next_attempt_at = v_line.choose_by,
      format('48 hours to choose, then a card refund; got %s', row_to_json(v_line));
    assert (tests.player(v_booking.id, i)).status = 'refund_due', 'waiting for the player''s choice';
  end loop;
  assert (select amount_cents from public.venue_credits where profile_id = v_booker) = 580, 'the booker''s 580 credit';

  -- Every other player is told what they get back and how to choose.
  assert (select count(*) from public.notifications n where n.type = 'booking_cancelled'
          and n.profile_id <> v_booker and n.data ->> 'bookingId' = v_booking.id::text) = 9, 'the 9 are told';

  -- Cancelling twice.
  perform tests.act_as(v_booker);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'whole_team') $q$, v_booking.id))
         = 'already_cancelled', 'already cancelled';
  perform tests.act_as_postgres();
end $$;

-- 10 players: 6 taken, 3 still held -> the booker pays 6 x 100 = 600; the
-- 3 holds are released at no charge.
do $$
declare
  v_booker uuid := tests.create_user('team-six-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_quote jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'team-six');
  for i in 0 .. 6 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_six_' || i, interval '2 hours');
  end loop;
  for i in 7 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_six_' || i, interval '10 minutes');
  end loop;

  v_quote := tests.plan(v_booking.id, 'whole_team', v_booker);
  assert v_quote -> 'booker_fee' @> jsonb_build_object('players', 6, 'amount_cents', 600),
    format('6 x 100 = 600, got %s', v_quote -> 'booker_fee');
  for i in 7 .. 9 loop
    assert tests.quote_line(v_quote, (tests.player(v_booking.id, i)).id) @> jsonb_build_object(
      'action', 'release', 'refund_cents', 680, 'stripe_intent_id', 'pi_six_' || i), format('player %s: hold released', i);
  end loop;
end $$;

-- Inside the booker's own free hour: other players' taken payments still
-- count, held ones don't. 4 taken, 5 held -> 400; the booker's hold released.
do $$
declare
  v_booker uuid := tests.create_user('team-free-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_quote jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'team-free');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_tfree_0', interval '5 minutes');
  for i in 1 .. 4 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_tfree_' || i, interval '2 hours');
  end loop;
  for i in 5 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_tfree_' || i, interval '5 minutes');
  end loop;

  v_quote := tests.plan(v_booking.id, 'whole_team', v_booker);
  assert tests.quote_line(v_quote, (tests.player(v_booking.id, 0)).id) @> jsonb_build_object(
    'window', 'free', 'action', 'release', 'refund_cents', 680), 'the booker''s own hold is released';
  assert v_quote -> 'booker_fee' @> jsonb_build_object('players', 4, 'amount_cents', 400),
    format('4 taken x 100 = 400, got %s', v_quote -> 'booker_fee');
end $$;

-- Responsible mode: the booker's guarantee hold is released too.
do $$
declare
  v_booker uuid := tests.create_user('team-guarantee-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_guarantee public.booking_guarantees;
  v_quote jsonb;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 1, tests.cyprus_today() + 2,
                                          p_label => 'team-guarantee');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_tg_0', interval '2 hours');
  select * into v_guarantee from public.booking_guarantees where booking_id = v_booking.id;
  perform public.guarantee_hold_placed(v_guarantee.id, 'pi_tg_guarantee', 6000);

  v_quote := tests.plan(v_booking.id, 'whole_team', v_booker);
  assert exists (select 1 from jsonb_array_elements(v_quote -> 'lines') l
                 where l ->> 'guarantee_id' = v_guarantee.id::text and l ->> 'action' = 'release'
                   and l ->> 'stripe_intent_id' = 'pi_tg_guarantee'), format('the guarantee is released, got %s', v_quote);
  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);
  assert (select status from public.booking_guarantees where id = v_guarantee.id) = 'cancelled', 'no longer held for';
  select * into v_line from public.booking_cancellation_lines
  where cancellation_id = (v_done ->> 'cancellation_id')::uuid and guarantee_id = v_guarantee.id;
  assert v_line.work = 'pending', 'the hold is to be cancelled at Stripe';
  assert v_done -> 'booker_fee' = 'null'::jsonb, 'nobody else paid: no extra charge';
end $$;

-- Less than 6 hours before kickoff: nobody gets money back, no extra
-- charge, and the slot can be booked again.
do $$
declare
  v_booker uuid := tests.create_user('team-late-booker@futty.test');
  v_next uuid := tests.create_user('team-late-next@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_slot record := tests.slot_starting_in(interval '5 hours');
  v_booking public.venue_bookings;
  v_again public.venue_bookings;
  v_quote jsonb;
  v_share public.booking_payment_shares;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 12000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, v_slot.day, v_slot.start_time,
                                          v_slot.end_time, 'team-late');
  for i in 0 .. 3 loop
    v_share := tests.player(v_booking.id, i);
    perform tests.pay_share(v_share.id, 'pi_tlate_' || i, 'card', true);
    perform public.share_payment_captured(v_share.id, 'pi_tlate_' || i, 680, 'pm_tlate_' || i, 80, 35, now());
  end loop;

  v_quote := tests.plan(v_booking.id, 'whole_team', v_booker);
  assert v_quote -> 'booker_fee' = 'null'::jsonb, format('no extra charge under 6 hours, got %s', v_quote -> 'booker_fee');
  assert not exists (select 1 from jsonb_array_elements(v_quote -> 'lines') l
                     where l ->> 'action' <> 'keep' or (l ->> 'refund_cents')::integer <> 0 or (l ->> 'credit_cents')::integer <> 0),
    format('nobody gets anything back, got %s', v_quote);
  perform tests.cancel(v_booking.id, 'whole_team', v_booker);
  assert not exists (select 1 from public.booking_payment_shares where booking_id = v_booking.id and status <> 'forfeited'),
    'every payment is kept';
  assert not exists (select 1 from public.booking_cancellation_fees where booking_id = v_booking.id), 'no fee row';

  perform tests.act_as(v_next);
  v_again := public.book_slot(v_venue, v_slot.day, v_slot.start_time, v_slot.end_time, 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  assert v_again.id is not null, 'the slot is released for others to book';
end $$;

-- Responsible-mode refusals: only the booker cancels the whole team.
do $$
declare
  v_booker uuid := tests.create_user('team-refusal-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'team-refusal');
  perform tests.act_as((tests.player(v_booking.id, 1)).profile_id);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'whole_team') $q$, v_booking.id))
         = 'not_your_booking', 'a player can''t cancel the whole team';
  perform tests.act_as_postgres();
end $$;

rollback;
