-- The venue cancels a booking (docs/specs/13-payments-bookings.md,
-- "Cancellations and refunds", and the 10 November decision): every player
-- gets their whole share back, card refund or credit, their choice; Stripe's
-- real fee on every payment that was taken is owed by the venue
-- (venue_payables), whether the player takes a refund or credit, so Futty
-- earns nothing on that booking. Only the venue's own staff can do it.
begin;

do $$
declare
  v_owner uuid := tests.create_user('venue-cancel-owner@futty.test');
  v_other_owner uuid := tests.create_user('venue-cancel-other@futty.test');
  v_booker uuid := tests.create_user('venue-cancel-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_refund public.booking_payment_shares;
  v_credit public.booking_payment_shares;
  v_held public.booking_payment_shares;
  v_quote jsonb;
  v_done jsonb;
  v_line public.booking_cancellation_lines;
  v_result jsonb;
begin
  update public.profiles set role = 'venue_owner' where id in (v_owner, v_other_owner);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                          p_label => 'venue-cancel');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_vc_0', interval '2 hours');
  v_refund := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_vc_1', interval '2 hours');
  v_credit := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_vc_2', interval '2 hours');
  v_held := tests.pay_ago((tests.player(v_booking.id, 3)).id, 'pi_vc_3', interval '5 minutes');

  perform tests.act_as(v_other_owner);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'venue') $q$, v_booking.id)) = 'not_your_venue',
    'another venue''s staff can''t';
  perform tests.act_as(v_booker);
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'venue') $q$, v_booking.id)) = 'not_your_venue',
    'the booker can''t cancel as the venue';
  perform tests.act_as(v_owner);
  v_quote := public.cancellation_quote(v_booking.id, 'venue');
  perform tests.act_as_postgres();

  assert tests.quote_line(v_quote, (tests.player(v_booking.id, 0)).id) @> jsonb_build_object(
    'window', 'venue', 'action', 'refund_choice', 'refund_cents', 680, 'kept_cents', 0), 'the booker gets 680 back too';
  assert tests.quote_line(v_quote, v_held.id) @> jsonb_build_object('action', 'release', 'refund_cents', 680),
    'a hold is released';
  assert v_quote -> 'booker_fee' = 'null'::jsonb, 'nobody pays extra';

  perform tests.act_as_service_role();
  v_done := public.cancel_booking_internal(v_booking.id, 'venue', v_owner, v_quote ->> 'quote');
  perform tests.act_as_postgres();
  assert (select status from public.venue_bookings where id = v_booking.id) = 'cancelled', 'cancelled';
  assert (select count(*) from public.notifications where type = 'booking_cancelled'
          and data ->> 'bookingId' = v_booking.id::text) = 4, 'all four players are told, the booker too';

  -- Player 1 takes the card refund (cancel-booking refunds 680 at Stripe).
  v_line := tests.line(v_done, v_refund.id);
  perform tests.act_as_service_role();
  v_result := public.choose_cancellation_refund(v_line.id, v_refund.profile_id, 'card');
  assert v_result ->> 'result' = 'refund', format('a card refund to send, got %s', v_result);
  perform public.record_intent_refund('pi_vc_1', 're_vc_1', 680, 'venue_cancelled');
  perform public.cancellation_line_refunded(v_line.id, 'refunded');
  perform public.cancellation_line_refunded(v_line.id, 'refunded');
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_refund.profile_id)).status = 'refunded', 'refunded';
  assert (select array_agg(amount_cents) from public.venue_payables where share_id = v_refund.id) = array[35],
    'the venue owes Stripe''s 35, once';
  assert (select futty from tests.share_books(v_refund.id)) = 0, 'Futty earns nothing on it';

  -- Player 2 takes credit: 680 credit, and the venue still owes the 35.
  v_line := tests.line(v_done, v_credit.id);
  perform tests.act_as_service_role();
  v_result := public.choose_cancellation_refund(v_line.id, v_credit.profile_id, 'credit');
  perform tests.act_as_postgres();
  assert v_result ->> 'result' = 'credited', format('credited, got %s', v_result);
  assert (select (amount_cents, source) from public.venue_credits where profile_id = v_credit.profile_id)
         = (680, 'venue_cancelled'::text), 'the whole 680 as credit';
  assert (select array_agg(amount_cents) from public.venue_payables where share_id = v_credit.id) = array[35],
    'the venue owes Stripe''s 35 on a credit too';
  assert (select (futty, credit) from tests.share_books(v_credit.id)) = (0, 680), 'Futty earns nothing; 680 credit';
  assert (tests.share_of(v_booking.id, v_credit.profile_id)).status = 'credited', 'credited';

  -- The held share: released, nothing owed (Stripe took nothing).
  assert (tests.share_of(v_booking.id, v_held.profile_id)).status = 'cancelled', 'released';
  assert not exists (select 1 from public.venue_payables where share_id = v_held.id), 'nothing owed on a hold';

  -- Venue owners see what they owe; players don't.
  perform tests.act_as(v_owner);
  assert (select count(*) from public.venue_payables) = 2, 'the owner sees what the venue owes';
  perform tests.act_as(v_booker);
  assert (select count(*) from public.venue_payables) = 0, 'a player sees none';
  perform tests.act_as_postgres();
end $$;

-- Less than 6 hours before kickoff the venue can still cancel, and every
-- player still gets their share back.
do $$
declare
  v_owner uuid := tests.create_user('venue-late-owner@futty.test');
  v_booker uuid := tests.create_user('venue-late-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'venue-late');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_vl_0', interval '2 hours');
  perform tests.set_kickoff(v_booking.id, now() + interval '2 hours');
  assert tests.quote_line(tests.plan(v_booking.id, 'venue', v_owner), v_share.id) @> jsonb_build_object(
    'action', 'refund_choice', 'refund_cents', 680), 'full share back, even under 6 hours';
end $$;

rollback;
