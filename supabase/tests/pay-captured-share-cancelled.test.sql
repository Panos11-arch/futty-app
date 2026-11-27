-- Money taken late on a cancelled share of a LIVE booking (Booking v2, spec
-- 13 "When money is held and taken"; migration pay_captured_share_cancelled).
-- A share paid less than 6 hours before kickoff is taken at once. If that
-- share was cancelled first (a side B lapse, a player's own spot, a refund)
-- while the booking is still on, the late payment_intent.succeeded must give
-- back only its own money ('share_cancelled'). 'booking_cancelled' makes
-- stripe-webhook refund and release everything on the booking, so it stays
-- for a booking that really is cancelled. The same as share_payment_held
-- since 20261113130016.
begin;

-- A each-pays booking 5 hours away (every share is taken at once): the
-- booker and player 2 have paid; player 1 started paying.
create function tests.csc_game(p_label text, out booking uuid, out booker uuid,
                               out p1 public.booking_payment_shares, out p2 public.booking_payment_shares)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_slot record := tests.slot_starting_in(interval '5 hours');
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  booker := tests.create_user(format('csc-%s-booker@futty.test', p_label));
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(booker, v_venue, 'each_pays_own_spot', 2, v_slot.day, v_slot.start_time,
                                          v_slot.end_time, 'csc-' || p_label);
  booking := v_booking.id;

  v_share := tests.share_of(booking, booker);
  perform tests.pay_share(v_share.id, 'pi_csc_' || p_label || '_b', 'card', true);
  select * into v_share from public.booking_payment_shares where id = v_share.id;
  perform public.share_payment_captured(v_share.id, 'pi_csc_' || p_label || '_b', v_share.amount_cents, 'pm_b',
                                        v_share.fee_cents, 30, now());

  p2 := tests.player(booking, 2);
  perform tests.pay_share(p2.id, 'pi_csc_' || p_label || '_p2', 'card', true);
  select * into p2 from public.booking_payment_shares where id = p2.id;
  perform public.share_payment_captured(p2.id, 'pi_csc_' || p_label || '_p2', p2.amount_cents, 'pm_p2',
                                        p2.fee_cents, 30, now());

  p1 := tests.player(booking, 1);
  perform tests.pay_share(p1.id, 'pi_csc_' || p_label || '_p1', 'card', true);
  select * into p1 from public.booking_payment_shares where id = p1.id;
  select * into p2 from public.booking_payment_shares where id = p2.id;
end;
$$;

-- 1. The share was cancelled (side B lapse, own spot) before its immediate
-- charge arrived: only this payment goes back.
do $$
declare
  g record;
  v_result jsonb;
begin
  select * into g from tests.csc_game('lapse');
  assert (g.p2).status = 'paid', format('player 2 paid; got %s', (g.p2).status);
  update public.booking_payment_shares set status = 'cancelled' where id = (g.p1).id;

  perform tests.act_as_service_role();
  v_result := public.share_payment_captured((g.p1).id, (g.p1).stripe_payment_intent_id, (g.p1).amount_cents,
                                            'pm_p1', (g.p1).fee_cents, 30, now());
  perform tests.act_as_postgres();

  assert v_result ->> 'result' = 'refund' and v_result ->> 'reason' = 'share_cancelled'
         and v_result ->> 'booking_id' = g.booking::text and v_result ->> 'share_id' = (g.p1).id::text,
    format('refunded as a cancelled share, never as a cancelled booking (which refunds everyone); got %s', v_result);
  assert (select status from public.venue_bookings where id = g.booking) <> 'cancelled', 'the game is still on';
  assert (tests.share_of(g.booking, g.booker)).status = 'paid', 'the booker''s payment is untouched';
  assert (select status from public.booking_payment_shares where id = (g.p2).id) = 'paid',
    'player 2''s payment is untouched';
  assert exists (select 1 from public.money_ledger where stripe_id = (g.p1).stripe_payment_intent_id),
    'the late payment is in the ledger';
end $$;

-- 2. The same for a share that was already refunded on a live booking.
do $$
declare
  g record;
  v_result jsonb;
begin
  select * into g from tests.csc_game('refunded');
  update public.booking_payment_shares set status = 'refunded' where id = (g.p1).id;

  v_result := public.share_payment_captured((g.p1).id, (g.p1).stripe_payment_intent_id, (g.p1).amount_cents,
                                            'pm_p1', (g.p1).fee_cents, 30, now());

  assert v_result ->> 'result' = 'refund' and v_result ->> 'reason' = 'share_cancelled',
    format('a refunded share on a live booking gives back only itself; got %s', v_result);
end $$;

-- 3. A booking that really is cancelled keeps 'booking_cancelled', so the
-- webhook still releases the rest of it.
do $$
declare
  g record;
  v_result jsonb;
begin
  select * into g from tests.csc_game('booking');
  update public.venue_bookings set status = 'cancelled' where id = g.booking;
  update public.booking_payment_shares set status = 'cancelled' where id = (g.p1).id;

  v_result := public.share_payment_captured((g.p1).id, (g.p1).stripe_payment_intent_id, (g.p1).amount_cents,
                                            'pm_p1', (g.p1).fee_cents, 30, now());

  assert v_result ->> 'result' = 'refund' and v_result ->> 'reason' = 'booking_cancelled',
    format('a cancelled booking still releases everything; got %s', v_result);
end $$;

-- 4. A normal immediate charge on a live booking is unchanged: captured.
do $$
declare
  g record;
  v_result jsonb;
begin
  select * into g from tests.csc_game('normal');

  v_result := public.share_payment_captured((g.p1).id, (g.p1).stripe_payment_intent_id, (g.p1).amount_cents,
                                            'pm_p1', (g.p1).fee_cents, 30, now());

  assert v_result ->> 'result' = 'captured', format('taken as before; got %s', v_result);
  assert (select status from public.booking_payment_shares where id = (g.p1).id) = 'paid', 'player 1 paid';
end $$;

-- 5. Only the server (service_role) can call either function.
do $$
begin
  assert not has_function_privilege('authenticated',
    'public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz)', 'execute'),
    'players can''t call share_payment_captured';
  assert not has_function_privilege('anon',
    'public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz)', 'execute'),
    'nobody signed out can';
  assert not has_function_privilege('authenticated',
    'public.share_payment_captured_modes(uuid, text, integer, text, integer, integer, timestamptz)', 'execute'),
    'nor the function it wraps';
  assert has_function_privilege('service_role',
    'public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz)', 'execute'),
    'stripe-webhook can';
end $$;

rollback;
