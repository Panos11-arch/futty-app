-- P5: booking_detail, and a booking completing in each mode
-- (docs/specs/15-design.md section 5, "Booking detail"; spec 13, decided 12
-- November: everyone in a booking sees the roster's names and paid state,
-- only the booker sees everyone's amounts). Only players in the booking may
-- read it.
begin;

-- The mode the booker chose reaches book_slot, and the booking completes
-- once the booker's payment is held, in each of the three modes.
do $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 3);
  v_day date := tests.cyprus_today() + 3;
  r record;
  v_booker uuid;
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  for r in select * from (values ('pay_all', 6550, '12:00'::time), ('each_pays_responsible', 680, '14:00'::time),
                                 ('each_pays_own_spot', 680, '16:00'::time)) as m (mode, pays, start_at)
  loop
    v_booker := tests.create_user(format('detail-mode-%s@futty.test', r.mode));
    perform tests.act_as(v_booker);
    assert tests.error_of(format($q$ select public.book_slot(%L, %L, %L, %L, 1, '5-a-side', 5) $q$,
                                 v_venue, v_day, r.start_at, r.start_at + interval '1 hour')) = 'mode_required',
      'no mode, no booking';
    v_booking := public.book_slot(v_venue, v_day, r.start_at, (r.start_at + interval '1 hour')::time, 1, '5-a-side', 5, r.mode);
    perform tests.act_as_postgres();
    assert v_booking.payment_mode = r.mode and v_booking.status = 'pending_payment',
      format('%s: stored, waiting for payment', r.mode);
    v_share := tests.share_of(v_booking.id, v_booker);
    assert v_share.amount_cents = r.pays, format('%s: the booker pays %s, got %s', r.mode, r.pays, v_share.amount_cents);
    perform tests.hold_share(v_share.id, 'pi_detail_' || r.mode);
    assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed',
      format('%s: confirmed once the booker''s payment is held', r.mode);
  end loop;
end $$;

-- The roster, amounts and cutoffs.
do $$
declare
  v_booker uuid := tests.create_user('detail-booker@futty.test');
  v_cash uuid := tests.create_user('detail-cash@futty.test');
  v_unpaid uuid := tests.create_user('detail-unpaid@futty.test');
  v_stranger uuid := tests.create_user('detail-stranger@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  d jsonb;
  v_row jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.profiles set full_name = 'Booker Name' where id = v_booker;
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_detail_booker');
  perform tests.join_booking(v_booking.id, v_cash);
  perform tests.hold_share((tests.share_of(v_booking.id, v_cash)).id, 'pi_detail_cash', p_method => 'cash');
  perform tests.join_booking(v_booking.id, v_unpaid);
  -- Distinct join times (one transaction gives them all the same now()), so
  -- the roster's order is the join order.
  update public.booking_payment_shares set created_at = created_at + interval '1 second'
  where booking_id = v_booking.id and profile_id = v_cash;
  update public.booking_payment_shares set created_at = created_at + interval '2 seconds'
  where booking_id = v_booking.id and profile_id = v_unpaid;

  -- The booker sees everyone, with amounts.
  perform tests.act_as(v_booker);
  d := public.booking_detail(v_booking.id);
  assert (d ->> 'is_booker')::boolean, 'the booker';
  assert jsonb_array_length(d -> 'roster') = 3, 'three players';
  assert (select array_agg(e ->> 'state' order by o) from jsonb_array_elements(d -> 'roster') with ordinality t (e, o))
         = array['in_app', 'cash', 'unpaid'], format('paid states, got %s', d -> 'roster');
  assert d -> 'roster' -> 0 ->> 'name' = 'Booker Name', 'names from profiles';
  assert (d -> 'roster' -> 1 ->> 'amount_cents')::int = 80 and (d -> 'roster' -> 1 ->> 'cash_cents')::int = 600,
    'the booker sees the cash player''s 80 by card and 600 in cash';
  assert (d -> 'roster' -> 2 ->> 'amount_cents')::int = 680, 'and the unpaid player''s 680';
  assert d -> 'next_cutoff' ->> 'kind' = 'free_hour_ends', format('the free hour ends first, got %s', d -> 'next_cutoff');
  assert (d -> 'next_cutoff' ->> 'at')::timestamptz = (tests.share_of(v_booking.id, v_booker)).capture_due_at,
    'when the booker''s payment is taken';
  assert d -> 'can_cancel' = jsonb_build_object('my_spot', true, 'whole_team', true), 'the booker can cancel either';
  assert d -> 'booking' ->> 'payment_mode' = 'each_pays_own_spot', 'the mode';
  assert (d -> 'booking' ->> 'kickoff_at')::timestamptz = tests.kickoff_of(v_booking.id), 'kickoff in Cyprus time';

  -- Another player sees names and states, but only their own amount.
  perform tests.act_as(v_unpaid);
  d := public.booking_detail(v_booking.id);
  assert not (d ->> 'is_booker')::boolean, 'not the booker';
  assert (select array_agg(e ->> 'state' order by o) from jsonb_array_elements(d -> 'roster') with ordinality t (e, o))
         = array['in_app', 'cash', 'unpaid'], 'the same paid states';
  assert d -> 'roster' -> 0 -> 'amount_cents' = 'null'::jsonb and d -> 'roster' -> 1 -> 'amount_cents' = 'null'::jsonb,
    'other players'' amounts are hidden';
  assert (d -> 'roster' -> 2 ->> 'amount_cents')::int = 680 and (d -> 'roster' -> 2 ->> 'is_me')::boolean, 'their own is shown';
  assert (d -> 'me' ->> 'amount_cents')::int = 680 and d -> 'me' ->> 'status' = 'pending', 'their share';
  assert d -> 'next_cutoff' ->> 'kind' = 'refunds_stop'
         and (d -> 'next_cutoff' ->> 'at')::timestamptz = tests.kickoff_of(v_booking.id) - interval '6 hours',
    'not paid: the next cutoff is 6 hours before kickoff';
  assert d -> 'can_cancel' = jsonb_build_object('my_spot', true, 'whole_team', false), 'a player cancels their own spot only';

  -- Someone not in the booking can't read it.
  perform tests.act_as(v_stranger);
  assert tests.error_of(format($q$ select public.booking_detail(%L) $q$, v_booking.id)) = 'booking_not_found',
    'a stranger is refused';
  assert tests.error_of(format($q$ select public.booking_detail(%L) $q$, gen_random_uuid())) = 'booking_not_found',
    'an unknown booking is refused the same way';

  -- The cash player is ticked by the venue: cash_paid.
  perform tests.act_as_postgres();
  update public.booking_payment_shares set cash_received_at = now() where booking_id = v_booking.id and profile_id = v_cash;
  perform tests.act_as(v_cash);
  d := public.booking_detail(v_booking.id);
  assert d -> 'roster' -> 1 ->> 'state' = 'cash_paid', 'ticked cash shows as paid in cash';

  -- A player who cancelled still reads it, but is no longer on the roster.
  perform tests.act_as_postgres();
  update public.booking_payment_shares set status = 'cancelled' where booking_id = v_booking.id and profile_id = v_unpaid;
  perform tests.act_as(v_unpaid);
  d := public.booking_detail(v_booking.id);
  assert jsonb_array_length(d -> 'roster') = 2, 'cancelled spots leave the roster';
  assert d -> 'can_cancel' = jsonb_build_object('my_spot', false, 'whole_team', false), 'nothing left to cancel';

  perform tests.act_as_anon();
  assert tests.error_of(format($q$ select public.booking_detail(%L) $q$, v_booking.id)) like 'permission denied%',
    'anon cannot call booking_detail';
  perform tests.act_as_postgres();
end $$;

-- Pay for everyone: the others' spots are covered; the booker can only cancel the whole booking.
do $$
declare
  v_booker uuid := tests.create_user('detail-all-booker@futty.test');
  v_player uuid := tests.create_user('detail-all-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  d jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_detail_all');
  perform tests.join_booking(v_booking.id, v_player);
  perform tests.act_as(v_booker);
  d := public.booking_detail(v_booking.id);
  assert d -> 'roster' -> 1 ->> 'state' = 'covered', format('the booker paid for this spot, got %s', d -> 'roster');
  assert d -> 'can_cancel' = jsonb_build_object('my_spot', false, 'whole_team', true),
    'a booker who paid for everyone can only cancel the whole booking';
  perform tests.act_as_postgres();
end $$;

-- After refunds stop there is no cutoff left; once started nothing can be cancelled.
do $$
declare
  v_booker uuid := tests.create_user('detail-late@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_booking public.venue_bookings;
  d jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, now() + interval '3 hours');
  perform tests.act_as(v_booker);
  d := public.booking_detail(v_booking.id);
  assert d -> 'next_cutoff' = 'null'::jsonb, 'less than 6 hours before kickoff: no cutoff left';
  assert (d -> 'can_cancel' ->> 'whole_team')::boolean, 'still cancellable before kickoff';
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, now() - interval '5 minutes');
  perform tests.act_as(v_booker);
  d := public.booking_detail(v_booking.id);
  assert d -> 'can_cancel' = jsonb_build_object('my_spot', false, 'whole_team', false), 'nothing once the game started';
  perform tests.act_as_postgres();
end $$;

rollback;
