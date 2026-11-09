-- P3: a real 6-a-side pitch (English School Central Park) is its own pitch
-- size with its own price. allows_6v6_on_5s only ever puts 6 v 6 on a
-- 5-a-side pitch.
begin;

do $$
declare
  v_player uuid := tests.create_user('six-player@futty.test');
  -- A venue with one real 6-a-side pitch and one 5-a-side pitch, flag off.
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_six uuid;
  v_five uuid;
  v_booking public.venue_bookings;
  v_day date := tests.cyprus_today() + 1;
  v_share integer;
  v_error text;
begin
  v_six := tests.create_pitch(v_venue, 'Six', '6-a-side', p_sort => 1);
  v_five := tests.create_pitch(v_venue, 'Five', '5-a-side', p_sort => 2);
  perform tests.set_price(v_venue, '6-a-side', 7200, 7200, 7200);
  perform tests.set_price(v_venue, '5-a-side', 6000, 6000, 6000);

  -- 6-a-side books the real pitch at its own price: 12 players, 7200 / 12 = 600 + 80.
  perform tests.act_as(v_player);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '6-a-side', 5);
  assert v_booking.capacity = 12, format('a 6-a-side is for 12 players, got %s', v_booking.capacity);
  assert v_booking.amount_cents = 7200, format('the 6-a-side price: got %s', v_booking.amount_cents);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 680, format('7200 / 12 + 80 = 680, got %s', v_share);
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_booking.id) = v_six, 'on the 6-a-side pitch';

  -- With the 6-a-side pitch taken, 6-a-side is full: the 5-a-side pitch doesn't host it.
  perform tests.act_as(v_player);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''18:30'', ''19:30'', 1, ''6-a-side'', 5)', v_venue, v_day));
  assert v_error = 'slot_full', format('second 6-a-side: got %s', coalesce(v_error, 'success'));

  -- The real 6-a-side pitch doesn't need the 6 v 6 flag.
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''10:00'', ''11:00'', 1, ''5-a-side'', 6)', v_venue, v_day));
  assert v_error = 'six_a_side_not_allowed', format('6 v 6 on a 5 without the flag: got %s', coalesce(v_error, 'success'));

  -- With the flag on, 6 v 6 goes on a 5-a-side pitch at the 5-a-side price
  -- (EUR 60 / 12 = 500 + 80 = 580), never on the 6-a-side pitch, even
  -- where the 6-a-side pitch also hosts 5-a-side games.
  perform tests.act_as_postgres();
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  update public.pitches set formats = array['6-a-side', '5-a-side'] where id = v_six;
  perform tests.act_as(v_player);
  v_booking := public.book_slot(v_venue, v_day, '10:00', '11:00', 1, '5-a-side', 6);
  assert v_booking.capacity = 12, format('6 v 6 on a 5: 12 players, got %s', v_booking.capacity);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 580, format('6 v 6 on a 5: 580, got %s', v_share);
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_booking.id) = v_five, '6 v 6 goes on the 5-a-side pitch';

  -- Only the 6-a-side pitch is left at 10:00: 6 v 6 on 5s can't use it.
  perform tests.act_as(v_player);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''10:30'', ''11:30'', 1, ''5-a-side'', 6)', v_venue, v_day));
  assert v_error = 'slot_full', format('6 v 6 with only the 6-a-side pitch free: got %s', coalesce(v_error, 'success'));

  -- An ordinary 5-a-side may use the 6-a-side pitch, since it hosts 5-a-side.
  v_booking := public.book_slot(v_venue, v_day, '10:30', '11:30', 1, '5-a-side', 5);
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_booking.id) = v_six,
    'a 5-a-side can use a 6-a-side pitch that hosts 5-a-side';
end $$;

select 'venue model 6 (real 6-a-side pitch) passed' as result;

rollback;
