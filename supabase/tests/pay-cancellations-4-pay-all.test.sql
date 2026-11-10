-- The booker paid for everyone (docs/specs/13-payments-bookings.md,
-- "Cancellations and refunds", confirmed): in the middle window 100 per
-- player is kept and the rest becomes credit at that venue (6550 -> 5550 on
-- a €60 5 v 5). The free hour and the 6-hour line work as for any share.
-- The booker cancels the whole booking: there is no "my spot" to cancel.
begin;

-- Middle window: 1000 kept, 5550 credit.
do $$
declare
  v_booker uuid := tests.create_user('payall-middle-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_quote jsonb;
  v_books record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 3, tests.cyprus_today() + 3,
                                          p_label => 'payall-middle');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_pa_mid', interval '2 hours');
  assert v_share.amount_cents = 6550 and v_share.status = 'paid', 'one payment of 6550, taken';

  v_quote := tests.plan(v_booking.id, 'whole_team', v_booker);
  assert tests.quote_line(v_quote, v_share.id) @> jsonb_build_object(
    'window', 'middle', 'action', 'keep_and_credit', 'value_cents', 6550, 'kept_cents', 1000, 'credit_cents', 5550),
    format('100 per player kept, 5550 credit; got %s', v_quote);
  assert v_quote -> 'booker_fee' = 'null'::jsonb, 'no extra charge when the booker paid for everyone';
  assert (select count(*) from jsonb_array_elements(v_quote -> 'lines') l where l ->> 'action' = 'none') = 3,
    'the covered spots move no money';

  perform tests.cancel(v_booking.id, 'whole_team', v_booker);
  assert (select amount_cents from public.venue_credits where profile_id = v_booker and venue_id = v_venue) = 5550,
    '5550 credit at that venue';
  -- Futty keeps 1000 minus Stripe's 123.
  select * into v_books from tests.share_books(v_share.id);
  assert (v_books.venue, v_books.futty, v_books.stripe, v_books.credit) = (5550, 877, 123, 5550),
    format('the venue holds the 5550 credit, Futty 877, Stripe 123; got %s', row_to_json(v_books));
  assert (select balanced from public.money_balance(v_booking.id)), 'the books balance';
  assert not exists (select 1 from public.booking_payment_shares where booking_id = v_booking.id and status = 'covered'),
    'every covered spot is closed';
end $$;

-- A Premium booker paying for everyone (6495): 1000 kept, 5495 credit.
do $$
declare
  v_booker uuid := tests.create_user('payall-premium-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.make_premium(v_booker);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3,
                                          p_label => 'payall-premium');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_pa_prem', interval '2 hours');
  assert v_share.amount_cents = 6495, '6495';
  assert tests.quote_line(tests.plan(v_booking.id, 'whole_team', v_booker), v_share.id) @> jsonb_build_object(
    'action', 'keep_and_credit', 'kept_cents', 1000, 'credit_cents', 5495), '5495 credit';
end $$;

-- Free hour: the 6550 hold is released.
do $$
declare
  v_booker uuid := tests.create_user('payall-free-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3,
                                          p_label => 'payall-free');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_pa_free', interval '10 minutes');
  assert tests.quote_line(tests.plan(v_booking.id, 'whole_team', v_booker), v_share.id) @> jsonb_build_object(
    'window', 'free', 'action', 'release', 'refund_cents', 6550), 'released in full';
end $$;

-- Less than 6 hours before kickoff: nothing back.
do $$
declare
  v_booker uuid := tests.create_user('payall-late-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3,
                                          p_label => 'payall-late');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_pa_late', interval '2 hours');
  perform tests.set_kickoff(v_booking.id, now() + interval '4 hours');
  assert tests.quote_line(tests.plan(v_booking.id, 'whole_team', v_booker), v_share.id) @> jsonb_build_object(
    'window', 'late', 'action', 'keep', 'kept_cents', 6550, 'credit_cents', 0), 'nothing back';
end $$;

-- A player in a booking the booker paid for: cancelling frees the spot,
-- no money moves.
do $$
declare
  v_booker uuid := tests.create_user('payall-covered-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_player public.booking_payment_shares;
  v_quote jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 1, tests.cyprus_today() + 3,
                                          p_label => 'payall-covered');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_pa_cov', interval '2 hours');
  v_player := tests.player(v_booking.id, 1);
  v_quote := tests.plan(v_booking.id, 'my_spot', v_player.profile_id);
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object('action', 'none', 'value_cents', 0, 'refund_cents', 0),
    format('nothing to give back, got %s', v_quote);
  perform tests.cancel(v_booking.id, 'my_spot', v_player.profile_id);
  assert (tests.share_of(v_booking.id, v_player.profile_id)).status = 'cancelled', 'the spot is free';
end $$;

rollback;
