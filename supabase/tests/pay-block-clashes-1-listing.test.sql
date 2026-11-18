-- Clashes when blocking (docs/specs/13-payments-bookings.md "Blocking
-- pitches", decided 18 November): venue_block_clashes lists every app, walk-in
-- and phone booking a block would clash with on that pitch, a booking on a
-- combination containing the pitch included, and nothing else (not owner
-- blocks, cancelled games or games that only touch the block). Each app
-- booking carries its venue cancel quote and the free pitches of the same
-- size it can move to; the list carries Stripe's fees in total and one quote.
begin;

-- Pitches A, B, C (5-a-side) and D (7-a-side, also hosts 5-a-side); A+B and
-- B+C combine for 7-a-side.
create function tests.bc_venue(p_owner uuid, out venue uuid, out a uuid, out b uuid, out c uuid, out d uuid)
language plpgsql
as $$
begin
  venue := tests.create_venue(p_owner => p_owner, p_pitches => 0);
  a := tests.create_pitch(venue, 'Pitch A', '5-a-side', null, 1);
  b := tests.create_pitch(venue, 'Pitch B', '5-a-side', null, 2);
  c := tests.create_pitch(venue, 'Pitch C', '5-a-side', null, 3);
  d := tests.create_pitch(venue, 'Pitch D', '7-a-side', array['7-a-side', '5-a-side'], 4);
  insert into public.pitch_combinations (venue_id, format, pitch_ids)
  values (venue, '7-a-side', array[a, b]), (venue, '7-a-side', array[b, c]);
  perform tests.set_price(venue, '5-a-side', 6000);
  perform tests.set_price(venue, '7-a-side', 8000);
end;
$$;

create function tests.bc_item(p_list jsonb, p_booking uuid)
returns jsonb language sql immutable as $$
  select c from jsonb_array_elements(p_list -> 'clashes') c where (c ->> 'id')::uuid = p_booking
$$;

do $$
declare
  v_owner uuid := tests.create_user('bc1-owner@futty.test');
  v_booker uuid := tests.create_user('bc1-booker@futty.test');
  v_v record;
  v_day date := tests.cyprus_today() + 2;
  v_app5 public.venue_bookings;
  v_touch public.venue_bookings;
  v_gone public.venue_bookings;
  v_app7 public.venue_bookings;
  v_maria uuid;
  v_on_d uuid;
  v_list jsonb;
  v_item jsonb;
  v_quote text;
begin
  v_v := tests.bc_venue(v_owner);

  -- 18:00 on A: booker and two players, one of whom has paid (taken).
  v_app5 := tests.booking_with_players(v_booker, v_v.venue, 'each_pays_own_spot', 2, v_day, '18:00', '19:00', 'bc1');
  perform tests.pay_ago((tests.player(v_app5.id, 1)).id, 'pi_bc1_1', interval '2 hours');
  -- 18:00 on B: a paid phone booking.
  perform tests.act_as(v_owner);
  v_maria := public.add_counter_booking(v_v.venue, v_day, '18:00', '19:00', '5-a-side', 'phone', 'Maria',
                                        '99 000 001', v_v.b, 4500, 'cash');
  -- 20:00 on D: a walk-in, so the 7-a-side game goes on A+B.
  v_on_d := public.add_counter_booking(v_v.venue, v_day, '20:00', '21:00', '7-a-side', 'walk_in', 'Nikos',
                                       null, v_v.d);
  v_app7 := public.book_slot(v_v.venue, v_day, '20:00', '21:00', 1, '7-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert (select array_agg(pitch_id order by pitch_id) from public.booking_pitches where booking_id = v_app7.id)
         = (select array_agg(x order by x) from unnest(array[v_v.a, v_v.b]) x), 'the 7-a-side game is on A+B';
  -- 19:00 on A: touches 18:00-19:00 without overlapping.
  v_touch := tests.booking_with_players(tests.create_user('bc1-touch@futty.test'), v_v.venue, 'each_pays_own_spot', 0,
                                        v_day, '19:00', '20:00', 'bc1t');
  -- 18:00 on C, cancelled.
  v_gone := tests.booking_with_players(tests.create_user('bc1-gone@futty.test'), v_v.venue, 'each_pays_own_spot', 0,
                                       v_day, '18:00', '19:00', 'bc1g');
  update public.venue_bookings set status = 'cancelled' where id = v_gone.id;
  -- 21:00: an owner block (a training slot).
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format,
                                     booking_type, created_by, amount_cents, note)
  values (v_v.venue, v_day, '21:00', '22:00', 1, 0, '5-a-side', 'owner_block', v_owner, 0, 'Academy');

  perform tests.act_as(v_owner);

  -- One pitch, one hour: only the game on it.
  v_list := public.venue_block_clashes(v_v.venue, v_v.a, v_day, '18:00', '19:00');
  assert jsonb_array_length(v_list -> 'clashes') = 1, format('only the 18:00 game on A, got %s', v_list);
  v_item := tests.bc_item(v_list, v_app5.id);
  assert v_item ->> 'kind' = 'app' and v_item ->> 'booker_name' is not null
         and (v_item ->> 'joined')::integer = 3 and (v_item ->> 'unpaid')::integer = 2
         and (v_item ->> 'capacity')::integer = 10 and v_item ->> 'payment_mode' = 'each_pays_own_spot'
         and v_item -> 'pitch_names' = '["Pitch A"]'::jsonb and not (v_item ->> 'started')::boolean,
    format('the app game, its booker and players, got %s', v_item);
  v_quote := public.cancellation_quote(v_app5.id, 'venue') ->> 'quote';
  assert v_item ->> 'quote' = v_quote, 'its quote is the venue cancel''s own';
  assert (v_item ->> 'venue_stripe_fee_cents')::integer = tests.stripe_fee(680)
         and (v_list ->> 'venue_stripe_fee_cents')::integer = tests.stripe_fee(680),
    format('Stripe''s fee on the one payment taken (35), got %s', v_list -> 'venue_stripe_fee_cents');
  -- Moves: C is free (the game there was cancelled); B is taken; D is a
  -- 7-a-side pitch, a different size.
  assert v_item -> 'moves' = jsonb_build_array(jsonb_build_object('pitch_ids', jsonb_build_array(v_v.c),
                                                                  'pitch_names', '["Pitch C"]'::jsonb)),
    format('only C, got %s', v_item -> 'moves');
  assert v_list ->> 'quote' = public.venue_block_clashes(v_v.venue, v_v.a, v_day, '18:00', '19:00') ->> 'quote',
    'the same list gives the same quote';

  -- B from 18:00 to 21:00: the phone booking, and the 7-a-side game through
  -- its combination.
  v_list := public.venue_block_clashes(v_v.venue, v_v.b, v_day, '18:00', '21:00');
  assert jsonb_array_length(v_list -> 'clashes') = 2, format('phone booking and combination, got %s', v_list);
  v_item := tests.bc_item(v_list, v_maria);
  assert v_item ->> 'kind' = 'counter' and v_item ->> 'source' = 'phone' and v_item ->> 'contact_name' = 'Maria'
         and v_item ->> 'phone' = '+35799000001' and (v_item ->> 'paid')::boolean
         and (v_item ->> 'refund_cents')::integer = 4500,
    format('the contact to call and what they paid, got %s', v_item);
  v_item := tests.bc_item(v_list, v_app7.id);
  assert v_item -> 'pitch_names' = '["Pitch A", "Pitch B"]'::jsonb, format('the combination, got %s', v_item);
  assert v_item -> 'moves' = '[]'::jsonb, 'B+C holds B, and D is taken: nowhere to go';

  -- A from 20:00: the 7-a-side game can go to B+C (B is its own).
  v_item := tests.bc_item(public.venue_block_clashes(v_v.venue, v_v.a, v_day, '20:00', '21:00'), v_app7.id);
  assert v_item -> 'moves' = jsonb_build_array(jsonb_build_object('pitch_ids', jsonb_build_array(v_v.b, v_v.c),
                                                                  'pitch_names', '["Pitch B", "Pitch C"]'::jsonb)),
    format('B+C, got %s', v_item -> 'moves');

  -- The whole venue, all day: every game and walk-in, never the owner block
  -- or the cancelled game, and nowhere to move.
  v_list := public.venue_block_clashes(v_v.venue, null, v_day, null, null);
  assert (select array_agg((c ->> 'id')::uuid order by c ->> 'id') from jsonb_array_elements(v_list -> 'clashes') c)
         = (select array_agg(x order by x::text) from unnest(array[v_app5.id, v_maria, v_on_d, v_app7.id, v_touch.id]) x),
    format('five clashes, got %s', v_list -> 'clashes');
  assert not exists (select 1 from jsonb_array_elements(v_list -> 'clashes') c
                     where c ->> 'kind' = 'app' and c -> 'moves' <> '[]'::jsonb), 'a whole-venue block leaves nowhere';

  -- Nothing on another day.
  assert public.venue_block_clashes(v_v.venue, null, v_day + 1, null, null) -> 'clashes' = '[]'::jsonb, 'empty day';

  -- What changes the quote: a player paying.
  v_quote := public.venue_block_clashes(v_v.venue, v_v.a, v_day, '18:00', '19:00') ->> 'quote';
  perform tests.act_as_postgres();
  perform tests.pay_ago((tests.player(v_app5.id, 2)).id, 'pi_bc1_2', interval '2 hours');
  perform tests.act_as(v_owner);
  assert public.venue_block_clashes(v_v.venue, v_v.a, v_day, '18:00', '19:00') ->> 'quote' <> v_quote,
    'a new payment changes the quote';

  -- Bad input.
  assert tests.error_of(format($q$ select public.venue_block_clashes(%L, %L, %L, '18:00', null) $q$,
                               v_v.venue, v_v.a, v_day)) = 'invalid_block_time', 'a start needs an end';
  assert tests.error_of(format($q$ select public.venue_block_clashes(%L, %L, %L, '19:00', '18:00') $q$,
                               v_v.venue, v_v.a, v_day)) = 'invalid_block_time', 'the end comes after the start';
  perform tests.act_as_postgres();
end $$;

select 'pay block clashes 1 (listing) passed' as result;

rollback;
