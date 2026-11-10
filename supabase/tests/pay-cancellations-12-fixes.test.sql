-- P4b review fixes and the 10 November decisions Q1-Q3
-- (docs/specs/13-payments-bookings.md, "Cancellations and refunds", "Venue
-- credit"; migration pay_cancellations_fixes).
begin;

-- Q2: credit that paid for a share keeps its original expiry when it comes
-- back in the middle window; only the card-paid part becomes new 12-month
-- credit, less the €1 (which comes from the card part first).
-- Q3: the credit money stays with the venue, and the books balance.
do $$
declare
  v_booker uuid := tests.create_user('fix-q2-booker@futty.test');
  v_player uuid := tests.create_user('fix-q2-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_old uuid;
  v_old_expiry timestamptz;
  v_new public.venue_credits;
  v_books record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  -- 500 credit issued 10 months ago: it expires in 2 months.
  v_old := tests.give_credit(v_player, v_venue, 500, interval '10 months');
  select expires_at into v_old_expiry from public.venue_credits where id = v_old;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'fix-q2');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_q2_booker');
  v_share := tests.join_booking(v_booking.id, v_player);
  -- 500 credit + 180 by card (100 + 80), taken after its free hour.
  v_share := tests.pay_ago(v_share.id, 'pi_q2', interval '2 hours', 'card', true);
  assert (v_share.status, v_share.amount_cents, v_share.credit_cents) = ('paid', 180, 500), 'paid 180 + 500 credit';

  assert (tests.quote_line(tests.plan(v_booking.id, 'my_spot', v_player), v_share.id)) @> jsonb_build_object(
    'window', 'middle', 'value_cents', 680, 'kept_cents', 100, 'credit_cents', 580), '€1 kept, 580 back';
  perform tests.cancel(v_booking.id, 'my_spot', v_player);

  assert (select (remaining_cents, expires_at) from public.venue_credits where id = v_old) = (500, v_old_expiry),
    'the 500 credit is back with its original expiry';
  select * into v_new from public.venue_credits where profile_id = v_player and id <> v_old;
  assert (v_new.amount_cents, v_new.source) = (80, 'player_cancelled'::text),
    format('only the card part less the €1 is new credit (180 - 100 = 80), got %s', row_to_json(v_new));
  assert v_new.expires_at = v_new.issued_at + interval '12 months', 'the new credit expires in 12 months';

  -- Futty keeps 100 less Stripe's fee on the 180 (28) = 72. The venue holds
  -- the 80 new credit from this booking (and the 500 it already held).
  select * into v_books from tests.share_books(v_share.id);
  assert (v_books.venue, v_books.futty, v_books.stripe) = (80, 72, 28),
    format('venue 80, Futty 72, Stripe 28; got %s', row_to_json(v_books));
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Q2: a Premium share paid fully with credit (600): €1 kept from it, 500
-- back to where it came from, original expiry; no new credit.
do $$
declare
  v_booker uuid := tests.create_user('fix-q2p-booker@futty.test');
  v_player uuid := tests.create_user('fix-q2p-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_old uuid;
  v_old_expiry timestamptz;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_player);
  v_old := tests.give_credit(v_player, v_venue, 600, interval '3 months');
  select expires_at into v_old_expiry from public.venue_credits where id = v_old;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'fix-q2p');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_q2p_booker');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.act_as_service_role();
  perform public.attach_share_setup(v_share.id, v_player, 'card', 'seti_q2p', null, true);
  perform public.share_card_saved(v_share.id, 'seti_q2p', 'pm_q2p', now() - interval '2 hours');
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_player)).status = 'paid', 'paid with credit';

  perform tests.cancel(v_booking.id, 'my_spot', v_player);
  assert (select (remaining_cents, expires_at) from public.venue_credits where id = v_old) = (500, v_old_expiry),
    '500 back on the original credit, its expiry kept';
  assert (select count(*) from public.venue_credits where profile_id = v_player) = 1, 'no new credit';
  assert (select (venue, futty) from tests.share_books(v_share.id)) = (-100, 100),
    'Futty''s €1 comes out of the credit money the venue held';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Q1: the venue cancels after a player cancelled late (and forfeited their
-- share): they get it back too, refund or credit within 48 hours, and the
-- venue owes Stripe's fee. A middle-window canceller's €1 stays with Futty.
do $$
declare
  v_owner uuid := tests.create_user('fix-q1-owner@futty.test');
  v_booker uuid := tests.create_user('fix-q1-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_late public.booking_payment_shares;
  v_middle public.booking_payment_shares;
  v_quote jsonb;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'fix-q1');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_q1_0', interval '2 hours');
  v_middle := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_q1_mid', interval '2 hours');
  v_late := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_q1_late', interval '2 hours');

  perform tests.cancel(v_booking.id, 'my_spot', v_middle.profile_id);
  assert (tests.share_of(v_booking.id, v_middle.profile_id)).status = 'credited', 'middle window: credited';
  perform tests.set_kickoff(v_booking.id, now() + interval '3 hours');
  perform tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  assert (tests.share_of(v_booking.id, v_late.profile_id)).status = 'forfeited', 'late: forfeited';

  v_quote := tests.plan(v_booking.id, 'venue', v_owner);
  assert tests.quote_line(v_quote, v_late.id) @> jsonb_build_object(
    'window', 'venue', 'action', 'refund_choice', 'value_cents', 680, 'refund_cents', 680, 'kept_cents', 0),
    format('the late canceller gets 680 back, got %s', v_quote);
  assert tests.quote_line(v_quote, v_middle.id) is null, 'the middle-window canceller is not in it: the €1 stays with Futty';

  v_done := public.cancel_booking_internal(v_booking.id, 'venue', v_owner, v_quote ->> 'quote');
  assert (tests.share_of(v_booking.id, v_late.profile_id)).status = 'refund_due', 'their 48 hours start';
  assert exists (select 1 from public.notifications where profile_id = v_late.profile_id and type = 'booking_cancelled'),
    'they are told';
  v_line := tests.line(v_done, v_late.id);
  assert (public.choose_cancellation_refund(v_line.id, v_late.profile_id, 'credit')) ->> 'result' = 'credited', 'credit';
  assert (select (amount_cents, source) from public.venue_credits where profile_id = v_late.profile_id)
         = (680, 'venue_cancelled'::text), '680 credit';
  assert (select array_agg(amount_cents) from public.venue_payables where share_id = v_late.id) = array[35],
    'the venue owes Stripe''s 35';
  assert (select futty from tests.share_books(v_late.id)) = 0, 'Futty earns nothing on it';
  assert (select count(*) from public.venue_credits where profile_id = v_middle.profile_id) = 1,
    'the middle-window canceller keeps just their 580';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Q1: a cash player's middle-window 80 (the €1 rule) is not given back.
do $$
declare
  v_owner uuid := tests.create_user('fix-q1c-owner@futty.test');
  v_booker uuid := tests.create_user('fix-q1c-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'fix-q1c');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_q1c_0', interval '2 hours');
  v_cash := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_q1c_cash', interval '2 hours', 'cash');
  perform tests.cancel(v_booking.id, 'my_spot', v_cash.profile_id);
  assert (tests.share_of(v_booking.id, v_cash.profile_id)).status = 'forfeited', 'the 80 is kept';
  assert tests.quote_line(tests.plan(v_booking.id, 'venue', v_owner), v_cash.id) is null,
    'a middle-window keep is not given back when the venue cancels';
end $$;

-- Q1: a late canceller whose card was never taken (the hold was still
-- waiting to be taken when the venue cancelled). The waiting capture is
-- superseded and the hold is released instead; nothing is owed by the venue.
do $$
declare
  v_owner uuid := tests.create_user('fix-q1n-owner@futty.test');
  v_booker uuid := tests.create_user('fix-q1n-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_late public.booking_payment_shares;
  v_quote jsonb;
  v_done jsonb;
  v_kept public.booking_cancellation_lines;
  v_line public.booking_cancellation_lines;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'fix-q1n');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_q1n_0', interval '2 hours');
  v_late := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_q1n_late');
  assert v_late.status = 'authorized', 'held, not taken yet';
  perform tests.set_kickoff(v_booking.id, now() + interval '3 hours');
  v_done := tests.cancel(v_booking.id, 'my_spot', v_late.profile_id);
  v_kept := tests.line(v_done, v_late.id);
  assert (v_kept.action, v_kept.needs_capture, v_kept.work) = ('keep', true, 'pending'), 'late: to be taken';

  v_quote := tests.plan(v_booking.id, 'venue', v_owner);
  assert tests.quote_line(v_quote, v_late.id) @> jsonb_build_object(
    'window', 'venue', 'action', 'release', 'value_cents', 680, 'refund_cents', 680, 'kept_cents', 0,
    'stripe_intent_id', 'pi_q1n_late'), format('the hold is released, got %s', v_quote);
  v_done := public.cancel_booking_internal(v_booking.id, 'venue', v_owner, v_quote ->> 'quote');

  select * into v_kept from public.booking_cancellation_lines where id = v_kept.id;
  assert (v_kept.work, v_kept.outcome) = ('done', 'superseded'), 'the waiting capture is never done';
  v_line := tests.line(v_done, v_late.id);
  assert (v_line.action, v_line.work) = ('release', 'pending'), 'the hold is released at Stripe';
  assert exists (select 1 from public.cancellation_work(v_line.cancellation_id) where line_id = v_line.id and kind = 'release'),
    'cancel-booking releases it now';
  assert not exists (select 1 from public.cancellation_work(v_kept.cancellation_id) where line_id = v_kept.id),
    'and never takes it';
  assert (tests.share_of(v_booking.id, v_late.profile_id)).status = 'cancelled', 'the share is closed';
  assert not exists (select 1 from public.venue_payables where share_id = v_late.id), 'nothing taken: the venue owes nothing';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Q1: a late canceller who paid partly with credit (500 credit + 180 card,
-- taken). The venue cancels; they choose card: the 180 is refunded and the
-- 500 goes back to the credit it came from, keeping its expiry. The venue
-- owes Stripe's fee on the 180.
do $$
declare
  v_owner uuid := tests.create_user('fix-q1p-owner@futty.test');
  v_booker uuid := tests.create_user('fix-q1p-booker@futty.test');
  v_player uuid := tests.create_user('fix-q1p-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_old uuid;
  v_old_expiry timestamptz;
  v_quote jsonb;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_old := tests.give_credit(v_player, v_venue, 500, interval '10 months');
  select expires_at into v_old_expiry from public.venue_credits where id = v_old;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'fix-q1p');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_q1p_0', interval '2 hours');
  v_share := tests.join_booking(v_booking.id, v_player);
  v_share := tests.pay_ago(v_share.id, 'pi_q1p', interval '2 hours', 'card', true);
  assert (v_share.status, v_share.amount_cents, v_share.credit_cents) = ('paid', 180, 500), 'paid 180 + 500 credit';
  perform tests.set_kickoff(v_booking.id, now() + interval '3 hours');
  perform tests.cancel(v_booking.id, 'my_spot', v_player);
  assert (tests.share_of(v_booking.id, v_player)).status = 'forfeited', 'late: forfeited';
  assert (select remaining_cents from public.venue_credits where id = v_old) = 0, 'the credit is kept for now';

  v_quote := tests.plan(v_booking.id, 'venue', v_owner);
  assert tests.quote_line(v_quote, v_share.id) @> jsonb_build_object(
    'window', 'venue', 'action', 'refund_choice', 'paid_cents', 180, 'credit_used_cents', 500,
    'value_cents', 680, 'refund_cents', 680), format('all 680 comes back, got %s', v_quote);
  v_done := public.cancel_booking_internal(v_booking.id, 'venue', v_owner, v_quote ->> 'quote');
  v_line := tests.line(v_done, v_share.id);

  -- They choose card: the job claims it and refunds the 180 at Stripe.
  assert (public.choose_cancellation_refund(v_line.id, v_player, 'card')) ->> 'result' = 'refund', 'card';
  assert (select amount_cents from public.cancellation_line_work(v_line.id)) = 180, 'only the card part goes to Stripe';
  assert public.cancellation_claim_refund(v_line.id), 'claimed';
  perform public.record_intent_refund('pi_q1p', 're_q1p', 180, 'venue_refund_choice');
  assert public.cancellation_line_refunded(v_line.id, 'refunded'), 'refunded';

  assert (tests.share_of(v_booking.id, v_player)).status = 'refunded', 'refunded';
  assert (select (remaining_cents, expires_at) from public.venue_credits where id = v_old) = (500, v_old_expiry),
    'the 500 credit is back with its original expiry';
  assert (select count(*) from public.venue_credits where profile_id = v_player) = 1, 'no new credit';
  assert (select array_agg(amount_cents) from public.venue_payables where share_id = v_share.id)
         = array[tests.stripe_fee(180)], 'the venue owes Stripe''s fee on the 180';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Medium 4: a kept share whose held card part can never be taken. The €1
-- applies only to what was actually paid (here the 500 credit): 100 kept,
-- 400 back to the original credit; the line is finished.
do $$
declare
  v_booker uuid := tests.create_user('fix-m4-booker@futty.test');
  v_player uuid := tests.create_user('fix-m4-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_old uuid;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_old := tests.give_credit(v_player, v_venue, 500, interval '1 month');
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'fix-m4');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_m4_booker');
  v_share := tests.join_booking(v_booking.id, v_player);
  v_share := tests.pay_ago(v_share.id, 'pi_m4', interval '0', 'card', true);
  -- Held, its free hour over, not taken yet (the capture failed).
  update public.booking_payment_shares set held_at = now() - interval '2 hours', capture_due_at = now() - interval '1 hour'
  where id = v_share.id;

  v_done := tests.cancel(v_booking.id, 'my_spot', v_player);
  v_line := tests.line(v_done, v_share.id);
  assert (v_line.action, v_line.needs_capture, v_line.work) = ('keep_and_credit', true, 'pending'), 'to take first';
  assert (select remaining_cents from public.venue_credits where id = v_old) = 0, 'nothing back before the capture';

  -- Stripe says the hold is gone.
  assert public.cancellation_line_not_taken(v_line.id), 'settled';
  assert not public.cancellation_line_not_taken(v_line.id), 'once';
  select * into v_line from public.booking_cancellation_lines where id = v_line.id;
  assert (v_line.work, v_line.outcome, v_line.value_cents, v_line.kept_cents, v_line.credit_cents, v_line.paid_cents)
         = ('done', 'not_taken', 500, 100, 400, 0), format('100 of the 500 kept, 400 back; got %s', row_to_json(v_line));
  assert (select remaining_cents from public.venue_credits where id = v_old) = 400, '400 back on the original credit';
  assert (select count(*) from public.venue_credits where profile_id = v_player) = 1, 'no new credit: no card money';
  assert (select futty from tests.share_books(v_share.id)) = 100, 'Futty keeps the €1, from the credit money';
  assert not exists (select 1 from public.cancellation_work(null) where line_id = v_line.id), 'not retried';
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- Medium 4, late: nothing back even so; the card part is simply never taken.
do $$
declare
  v_booker uuid := tests.create_user('fix-m4l-booker@futty.test');
  v_player uuid := tests.create_user('fix-m4l-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_old uuid;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_old := tests.give_credit(v_player, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'fix-m4l');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_m4l_booker');
  v_share := tests.join_booking(v_booking.id, v_player);
  v_share := tests.pay_ago(v_share.id, 'pi_m4l', interval '0', 'card', true);
  update public.booking_payment_shares set held_at = now() - interval '2 hours', capture_due_at = now() - interval '1 hour'
  where id = v_share.id;
  perform tests.set_kickoff(v_booking.id, now() + interval '3 hours');
  v_done := tests.cancel(v_booking.id, 'my_spot', v_player);
  v_line := tests.line(v_done, v_share.id);
  assert (v_line.action, v_line.needs_capture) = ('keep', true), 'late, to take first';
  assert public.cancellation_line_not_taken(v_line.id), 'settled';
  select * into v_line from public.booking_cancellation_lines where id = v_line.id;
  assert (v_line.work, v_line.kept_cents, v_line.credit_cents) = ('done', 500, 0), 'the 500 credit is kept';
  assert (select remaining_cents from public.venue_credits where id = v_old) = 0, 'nothing back';
end $$;

-- Medium 3: the 48-hour refund is claimed in the database before Stripe.
do $$
declare
  v_booker uuid := tests.create_user('fix-m3-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_a public.booking_payment_shares;
  v_b public.booking_payment_shares;
  v_c public.booking_payment_shares;
  v_done jsonb;
  v_la uuid;
  v_lb uuid;
  v_lc uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                          p_label => 'fix-m3');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_m3_0', interval '2 hours');
  v_a := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_m3_a', interval '2 hours');
  v_b := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_m3_b', interval '2 hours');
  v_c := tests.pay_ago((tests.player(v_booking.id, 3)).id, 'pi_m3_c', interval '2 hours');
  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);
  v_la := (tests.line(v_done, v_a.id)).id;
  v_lb := (tests.line(v_done, v_b.id)).id;
  v_lc := (tests.line(v_done, v_c.id)).id;

  assert not public.cancellation_claim_refund(v_la), 'no claim inside the 48 hours without a card choice';

  -- A chooses credit, racing the automatic refund: the claim then says no.
  assert (public.choose_cancellation_refund(v_la, v_a.profile_id, 'credit')) ->> 'result' = 'credited', 'credit';
  update public.booking_cancellation_lines set choose_by = now() - interval '1 second' where id = v_la;
  assert not public.cancellation_claim_refund(v_la), 'credit chosen: no card refund';

  -- B chose nothing; the 48 hours are over. The job claims it first, so a
  -- late credit choice is refused.
  update public.booking_cancellation_lines set choose_by = now() - interval '1 second' where id = v_lb;
  assert public.cancellation_claim_refund(v_lb), 'claimed for the card refund';
  assert (select choice from public.booking_cancellation_lines where id = v_lb) = 'card', 'recorded as card';
  assert tests.error_of(format($q$ select public.choose_cancellation_refund(%L, %L, 'credit') $q$, v_lb, v_b.profile_id))
         = 'already_chosen', 'a credit choice after the claim is refused';
  assert not exists (select 1 from public.venue_credits where profile_id = v_b.profile_id), 'no credit for B';

  -- C chose card inside the 48 hours: claimable at once.
  perform public.choose_cancellation_refund(v_lc, v_c.profile_id, 'card');
  assert public.cancellation_claim_refund(v_lc), 'a card choice is claimable at once';
end $$;

-- Medium 2: the release job cancelled an intent the player had just
-- confirmed, and the hold webhook had already marked the share held and
-- spent its credit. The hold is undone and the credit comes back.
do $$
declare
  v_booker uuid := tests.create_user('fix-m2-booker@futty.test');
  v_player uuid := tests.create_user('fix-m2-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'fix-m2');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_m2_booker');
  v_share := tests.join_booking(v_booking.id, v_player);
  v_share := tests.pay_ago(v_share.id, 'pi_m2', interval '0', 'card', true);
  assert v_share.status = 'authorized' and public.venue_credit_available_cents(v_player, v_venue) = 0, 'held, credit spent';

  assert not public.release_share_credit_reservation(v_share.id, 'pi_m2'),
    'a held share''s credit is never released by the webhook path';
  assert public.release_share_credit_reservation(v_share.id, 'pi_m2', true), 'the job cancelled the hold: undone';
  v_share := tests.share_of(v_booking.id, v_player);
  assert (v_share.status, v_share.credit_cents, v_share.amount_cents, v_share.held_at is null) = ('pending', 0, 680, true),
    format('unpaid again, priced without credit; got %s', row_to_json(v_share));
  assert public.venue_credit_available_cents(v_player, v_venue) = 500, 'the 500 credit is back';
  assert exists (select 1 from public.money_ledger where share_id = v_share.id and kind = 'credit_returned'), 'recorded';
  assert exists (select 1 from public.money_ledger where stripe_id = 'pi_m2' and kind = 'cancel'), 'the hold release recorded';
  assert exists (select 1 from public.notifications where profile_id = v_player and type = 'match_payment_due'),
    'the player is asked to pay again';
  assert not public.release_share_credit_reservation(v_share.id, 'pi_m2', true), 'once';
end $$;

-- Medium 5: a share paid fully with credit is judged non-refundable when
-- its card is saved. Started 6h01 before kickoff (no notice needed then),
-- saved at 5h59 without it: refused, credit back. With the notice: paid.
do $$
declare
  v_booker uuid := tests.create_user('fix-m5-booker@futty.test');
  v_player uuid := tests.create_user('fix-m5-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 600);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'fix-m5');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_m5_booker');
  perform tests.set_kickoff(v_booking.id, date_trunc('minute', now()) + interval '6 hours 1 minute');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.act_as_service_role();
  perform public.attach_share_setup(v_share.id, v_player, 'card', 'seti_m5', null, true);
  v_result := public.share_card_saved(v_share.id, 'seti_m5', 'pm_m5', date_trunc('minute', now()) + interval '2 minutes');
  perform tests.act_as_postgres();
  assert v_result @> '{"result": "refused", "reason": "non_refundable_not_accepted"}', format('refused, got %s', v_result);
  v_share := tests.share_of(v_booking.id, v_player);
  assert (v_share.status, v_share.credit_cents) = ('pending', 0), 'still unpaid, no credit set aside';
  assert public.venue_credit_available_cents(v_player, v_venue) = 600, 'the credit is back';
  assert exists (select 1 from public.notifications where profile_id = v_player and type = 'match_payment_due'),
    'asked to pay again';

  -- Again with the notice accepted (a new SetupIntent): paid, and late.
  perform tests.act_as_service_role();
  perform public.attach_share_setup(v_share.id, v_player, 'card', 'seti_m5b', null, true, true);
  v_result := public.share_card_saved(v_share.id, 'seti_m5b', 'pm_m5', date_trunc('minute', now()) + interval '2 minutes');
  perform tests.act_as_postgres();
  assert v_result ->> 'result' = 'saved', format('saved, got %s', v_result);
  assert (tests.share_of(v_booking.id, v_player)).status = 'paid', 'paid with credit';
  assert (tests.quote_line(tests.plan(v_booking.id, 'my_spot', v_player), v_share.id)) ->> 'window' = 'late',
    'saved under 6 hours before kickoff: non-refundable';
end $$;

-- High 1 (database side): after the credit is released, the plan names the
-- cancelled SetupIntent (create-share-payment keys the next one on it), and
-- a fresh SetupIntent pays the share.
do $$
declare
  v_booker uuid := tests.create_user('fix-h1-booker@futty.test');
  v_player uuid := tests.create_user('fix-h1-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_plan jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 600);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'fix-h1');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_h1_booker');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.act_as_service_role();
  perform public.attach_share_setup(v_share.id, v_player, 'card', 'seti_h1_old', null, true);
  -- 15 minutes pass; the job cancels the SetupIntent and releases the credit.
  assert public.release_share_credit_reservation(v_share.id, 'seti_h1_old'), 'released';
  v_plan := public.plan_share_payment(v_share.id, v_player, 'card', false, true);
  assert v_plan @> '{"needs_saved_card": true, "credit_cents": 600, "stripe_setup_intent_id": "seti_h1_old"}',
    format('credit again, and the cancelled SetupIntent named; got %s', v_plan);
  perform public.attach_share_setup(v_share.id, v_player, 'card', 'seti_h1_new', null, true);
  assert (public.share_card_saved(v_share.id, 'seti_h1_old', 'pm_h1', now())) ->> 'result' = 'duplicate',
    'the old SetupIntent pays nothing';
  assert (public.share_card_saved(v_share.id, 'seti_h1_new', 'pm_h1', now())) ->> 'result' = 'saved', 'the new one pays it';
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_player)).status = 'paid', 'paid with credit';
  assert public.venue_credit_available_cents(v_player, v_venue) = 0, 'the 600 spent';
end $$;

-- Low: every player with a line in a cancellation can read it, not only the
-- one who cancelled; a stranger can't.
do $$
declare
  v_booker uuid := tests.create_user('fix-rls-booker@futty.test');
  v_stranger uuid := tests.create_user('fix-rls-stranger@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_player public.booking_payment_shares;
  v_done jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'fix-rls');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_rls_0', interval '2 hours');
  v_player := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_rls_1', interval '2 hours');
  v_done := tests.cancel(v_booking.id, 'whole_team', v_booker);

  perform tests.act_as(v_player.profile_id);
  assert (select count(*) from public.booking_cancellations where id = (v_done ->> 'cancellation_id')::uuid) = 1,
    'another player in the booking reads the cancellation';
  perform tests.act_as(v_stranger);
  assert (select count(*) from public.booking_cancellations where id = (v_done ->> 'cancellation_id')::uuid) = 0,
    'a stranger doesn''t';
  perform tests.act_as_postgres();
end $$;

rollback;
