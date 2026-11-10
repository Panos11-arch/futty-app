-- A cash player who cancels (docs/specs/13-payments-bookings.md, "Cash at the
-- venue", confirmed): the normal timings, but only the 80-cent fee they paid
-- by card is at stake: released in the first hour, kept after.
begin;

do $$
declare
  v_booker uuid := tests.create_user('cash-cancel-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_free public.booking_payment_shares;
  v_kept public.booking_payment_shares;
  v_quote jsonb;
  v_books record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'cash-cancel');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_cash_booker');
  v_free := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_cash_free', interval '5 minutes', 'cash');
  v_kept := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_cash_kept', interval '2 hours', 'cash');
  assert v_free.amount_cents = 80 and v_free.cash_cents = 600, 'a cash player pays only the fee by card';

  -- First hour: the 80 hold is released.
  v_quote := tests.plan(v_booking.id, 'my_spot', v_free.profile_id);
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object(
    'window', 'free', 'action', 'release', 'value_cents', 80, 'refund_cents', 80, 'kept_cents', 0),
    format('the fee hold is released, got %s', v_quote);
  perform tests.cancel(v_booking.id, 'my_spot', v_free.profile_id);
  assert (tests.share_of(v_booking.id, v_free.profile_id)).status = 'cancelled', 'released';

  -- After the first hour: the 80 is kept, no credit (the pitch part was never paid).
  v_quote := tests.plan(v_booking.id, 'my_spot', v_kept.profile_id);
  assert (v_quote -> 'lines' -> 0) @> jsonb_build_object(
    'window', 'middle', 'action', 'keep', 'value_cents', 80, 'kept_cents', 80, 'credit_cents', 0),
    format('the fee is kept, got %s', v_quote);
  perform tests.cancel(v_booking.id, 'my_spot', v_kept.profile_id);
  assert (tests.share_of(v_booking.id, v_kept.profile_id)).status = 'forfeited', 'kept';
  assert not exists (select 1 from public.venue_credits where profile_id = v_kept.profile_id), 'no credit';
  select * into v_books from tests.share_books(v_kept.id);
  assert (v_books.venue, v_books.futty + v_books.stripe) = (0, 80), format('Futty keeps the 80; got %s', row_to_json(v_books));
end $$;

rollback;
