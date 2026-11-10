-- A player cancels their own spot (docs/specs/13-payments-bookings.md,
-- "Cancellations and refunds"), one block per row of the table, on a €60
-- 5 v 5 where each pays 680:
--   within 1 hour of paying (booked more than 6 hours ahead): the hold is
--     cancelled, nothing charged;
--   from 1 hour after paying until 6 hours before kickoff: 100 kept, 580
--     becomes credit at that venue;
--   less than 6 hours before kickoff: nothing back;
--   paid less than 6 hours before kickoff, at any time: nothing back.
-- Cancelling releases the spot and tells the other players; a late-cancelled
-- spot that is filled leaves the venue with both payments.
begin;

-- Within the free hour: the hold is cancelled.
do $$
declare
  v_booker uuid := tests.create_user('spot-free-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_quote jsonb;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'spot-free');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_free_booker');
  v_share := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_free_p1', interval '10 minutes');
  assert v_share.status = 'authorized', 'held, not yet taken';

  perform tests.act_as(v_share.profile_id);
  v_quote := public.cancellation_quote(v_booking.id, 'my_spot');
  perform tests.act_as_postgres();
  assert jsonb_array_length(v_quote -> 'lines') = 1, 'my spot only';
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object(
    'share_id', v_share.id, 'window', 'free', 'action', 'release', 'value_cents', 680, 'refund_cents', 680,
    'kept_cents', 0, 'credit_cents', 0, 'stripe_intent_id', 'pi_free_p1'), format('free hour, got %s', v_quote);
  assert v_quote -> 'booker_fee' = 'null'::jsonb, 'no extra charge';
  assert not (v_quote ->> 'cancels_booking')::boolean, 'the booking stays on';

  perform tests.act_as_service_role();
  v_done := public.cancel_booking_internal(v_booking.id, 'my_spot', v_share.profile_id, v_quote ->> 'quote');
  perform tests.act_as_postgres();
  assert v_done -> 'lines' = v_quote -> 'lines', 'cancelling does exactly what the quote said';
  assert (tests.share_of(v_booking.id, v_share.profile_id)).status = 'cancelled', 'the spot is released';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the booking is still on';
  v_line := tests.line(v_done, v_share.id);
  assert v_line.work = 'pending' and v_line.stripe_intent_id = 'pi_free_p1', 'the hold is to be cancelled at Stripe';
  assert not exists (select 1 from public.venue_credits where profile_id = v_share.profile_id), 'no credit';

  -- The other players are told, the canceller isn't.
  assert (select count(*) from public.notifications where type = 'booking_spot_released'
          and profile_id in (v_booker, (tests.player(v_booking.id, 2)).profile_id)) = 2, 'the others are told';
  assert not exists (select 1 from public.notifications where type = 'booking_spot_released'
                     and profile_id = v_share.profile_id), 'not the player who cancelled';

  -- Cancelling the same spot again.
  perform tests.act_as(v_share.profile_id);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'my_spot') $q$, v_booking.id)) = 'not_in_booking',
    'nothing left to cancel';
  perform tests.act_as_postgres();
end $$;

-- From 1 hour after paying until 6 hours before kickoff: 580 credit.
do $$
declare
  v_booker uuid := tests.create_user('spot-middle-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_quote jsonb;
  v_done jsonb;
  v_credit public.venue_credits;
  v_books record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'spot-middle');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_mid_booker');
  v_share := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_mid_p1', interval '2 hours');
  assert v_share.status = 'paid', 'taken after its free hour';

  v_quote := tests.plan(v_booking.id, 'my_spot', v_share.profile_id);
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object(
    'window', 'middle', 'action', 'keep_and_credit', 'value_cents', 680, 'kept_cents', 100, 'credit_cents', 580,
    'refund_cents', 0, 'needs_capture', false), format('middle window, got %s', v_quote);

  v_done := tests.cancel(v_booking.id, 'my_spot', v_share.profile_id);
  assert (tests.share_of(v_booking.id, v_share.profile_id)).status = 'credited', 'the spot is released as credit';
  select * into v_credit from public.venue_credits where profile_id = v_share.profile_id;
  assert v_credit.venue_id = v_venue and v_credit.amount_cents = 580 and v_credit.remaining_cents = 580,
    format('580 credit at that venue, got %s', row_to_json(v_credit));
  assert v_credit.source = 'player_cancelled' and v_credit.source_booking_id = v_booking.id
         and v_credit.source_share_id = v_share.id, 'its source is recorded';
  assert v_credit.expires_at = v_credit.issued_at + interval '12 months', 'expires 12 months after it was issued';
  assert (tests.line(v_done, v_share.id)).work = 'none', 'nothing to do at Stripe';

  -- Futty keeps 100 minus Stripe's 35 = 65; the venue holds the 580.
  select * into v_books from tests.share_books(v_share.id);
  assert (v_books.venue, v_books.futty, v_books.stripe, v_books.credit) = (0, 65, 35, 580),
    format('venue 0, Futty 65, Stripe 35, credit 580; got %s', row_to_json(v_books));
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Less than 6 hours before kickoff: nothing back.
do $$
declare
  v_booker uuid := tests.create_user('spot-late-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_quote jsonb;
  v_books record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'spot-late');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_late_booker');
  v_share := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_late_p1', interval '2 hours');
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours 59 minutes');

  v_quote := tests.plan(v_booking.id, 'my_spot', v_share.profile_id);
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object(
    'window', 'late', 'action', 'keep', 'value_cents', 680, 'kept_cents', 680, 'credit_cents', 0, 'refund_cents', 0),
    format('late, got %s', v_quote);

  perform tests.cancel(v_booking.id, 'my_spot', v_share.profile_id);
  assert (tests.share_of(v_booking.id, v_share.profile_id)).status = 'forfeited', 'the spot is released, the money kept';
  assert not exists (select 1 from public.venue_credits where profile_id = v_share.profile_id), 'no credit';
  select * into v_books from tests.share_books(v_share.id);
  assert (v_books.venue, v_books.futty, v_books.stripe, v_books.refunded) = (600, 45, 35, 0),
    format('the venue keeps 600, Futty 45; got %s', row_to_json(v_books));

  -- Exactly 6 hours before is no longer "until 6 hours before".
  perform tests.set_kickoff(v_booking.id, now() + interval '6 hours');
end $$;

-- Paid less than 6 hours before kickoff: nothing back, even a minute later.
do $$
declare
  v_booker uuid := tests.create_user('spot-nonref-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_slot record := tests.slot_starting_in(interval '5 hours');
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_quote jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 12000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, v_slot.day, v_slot.start_time,
                                          v_slot.end_time, 'spot-nonref');
  v_share := tests.player(v_booking.id, 1);
  perform tests.pay_share(v_share.id, 'pi_nonref_p1', 'card', true);
  perform public.share_payment_captured(v_share.id, 'pi_nonref_p1', 680, 'pm_nonref', 80, 35, now() - interval '1 minute');
  assert (tests.share_of(v_booking.id, v_share.profile_id)).status = 'paid', 'taken at once';

  v_quote := tests.plan(v_booking.id, 'my_spot', v_share.profile_id);
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object('window', 'late', 'action', 'keep', 'kept_cents', 680),
    format('non-refundable from the start, got %s', v_quote);

  -- Even with kickoff moved more than 6 hours away: no free hour.
  perform tests.set_kickoff(v_booking.id, now() + interval '2 days');
  v_quote := tests.plan(v_booking.id, 'my_spot', v_share.profile_id);
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object('window', 'late', 'action', 'keep', 'kept_cents', 680),
    format('a share paid under 6 hours never gets a free hour, got %s', v_quote);
end $$;

-- A held share whose free hour is over but whose capture hasn't happened
-- yet (capture failing): taken first, credit only once it's taken.
do $$
declare
  v_booker uuid := tests.create_user('spot-overdue-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'spot-overdue');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_over_booker');
  v_share := tests.player(v_booking.id, 1);
  perform tests.hold_share(v_share.id, 'pi_over_p1');
  update public.booking_payment_shares
  set held_at = now() - interval '2 hours', capture_due_at = now() - interval '1 hour'
  where id = v_share.id;

  v_done := tests.cancel(v_booking.id, 'my_spot', v_share.profile_id);
  v_line := tests.line(v_done, v_share.id);
  assert v_line.action = 'keep_and_credit' and v_line.needs_capture and v_line.work = 'pending',
    format('to be taken first, got %s', row_to_json(v_line));
  assert not exists (select 1 from public.venue_credits where profile_id = v_share.profile_id),
    'no credit for money not yet taken';
  perform tests.act_as_service_role();
  assert not exists (select 1 from public.shares_due_for_capture() where share_id = v_share.id),
    'the capture job leaves it to the cancellation';
  perform tests.act_as_postgres();

  -- Stripe takes it (cancel-booking's capture): then the credit is issued, once.
  perform tests.act_as_service_role();
  perform public.cancellation_line_captured(v_line.id, 680, 35);
  perform public.cancellation_line_captured(v_line.id, 680, 35);
  perform tests.act_as_postgres();
  assert (select amount_cents from public.venue_credits where profile_id = v_share.profile_id) = 580, '580 credit, once';
  assert (tests.line(v_done, v_share.id)).work = 'done', 'done';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- A late-cancelled spot that is filled: the venue keeps both payments.
do $$
declare
  v_booker uuid := tests.create_user('spot-filled-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_late public.booking_payment_shares;
  v_new uuid := tests.create_user('spot-filled-new@futty.test');
  v_new_share public.booking_payment_shares;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'spot-filled');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_filled_' || i, interval '2 hours');
  end loop;
  v_new_share := tests.join_booking(v_booking.id, v_new);
  assert v_new_share.id is null, 'full: no spot for an 11th player';

  perform tests.set_kickoff(v_booking.id, now() + interval '3 hours');
  v_late := tests.player(v_booking.id, 4);
  perform tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);

  v_new_share := tests.join_booking(v_booking.id, v_new);
  assert v_new_share.status = 'pending' and v_new_share.amount_cents = 680, 'the released spot can be filled';
  perform tests.pay_share(v_new_share.id, 'pi_filled_new', 'card', true);
  perform public.share_payment_captured(v_new_share.id, 'pi_filled_new', 680, 'pm_new', 80, 35, now());
  assert (select sum(venue_cents) from public.money_ledger where booking_id = v_booking.id) = 11 * 600,
    'the venue keeps the late canceller''s 600 and the new player''s 600';
  assert not exists (select 1 from public.money_ledger where share_id = v_late.id and kind = 'refund'),
    'the late canceller gets nothing back';
end $$;

-- Refusals.
do $$
declare
  v_booker uuid := tests.create_user('spot-refusals-booker@futty.test');
  v_stranger uuid := tests.create_user('spot-refusals-stranger@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_pay_all public.venue_bookings;
  v_share public.booking_payment_shares;
  v_quote text;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'spot-refusals');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_ref_booker');
  v_share := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_ref_p1', interval '2 hours');

  perform tests.act_as(v_stranger);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'my_spot') $q$, v_booking.id)) = 'not_in_booking',
    'not their booking';
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'whole_team') $q$, v_booking.id)) = 'not_your_booking',
    'only the booker cancels the whole team';
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'everything') $q$, v_booking.id)) = 'invalid_scope',
    'unknown scope';
  perform tests.act_as_anon();
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'my_spot') $q$, v_booking.id)) is not null,
    'signed out: refused';
  perform tests.act_as_postgres();

  -- The quote the player confirmed must still be what happens.
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.cancel_booking_internal(%L, 'my_spot', %L, null) $q$,
                               v_booking.id, v_share.profile_id)) = 'quote_required', 'a quote must be confirmed';
  assert tests.error_of(format($q$ select public.cancel_booking_internal(%L, 'my_spot', %L, 'stale') $q$,
                               v_booking.id, v_share.profile_id)) = 'quote_changed', 'a stale quote is refused';
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_share.profile_id)).status = 'paid', 'nothing changed';

  -- Once the game has started, nothing can be cancelled.
  v_quote := tests.plan(v_booking.id, 'my_spot', v_share.profile_id) ->> 'quote';
  perform tests.set_kickoff(v_booking.id, now() - interval '1 minute');
  assert tests.error_of(format($q$ select tests.plan(%L, 'my_spot', %L) $q$, v_booking.id, v_share.profile_id))
         = 'booking_started', 'too late: the game has started';

  -- The booker who paid for everyone cancels the whole booking, not a spot.
  perform tests.act_as(v_booker);
  v_pay_all := public.book_slot(v_venue, tests.cyprus_today() + 4, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'my_spot') $q$, v_pay_all.id)) = 'use_whole_team',
    'pay for everyone: my_spot is refused';
  perform tests.act_as_postgres();
end $$;

rollback;
