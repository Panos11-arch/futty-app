-- P3: combined pitches. "Pitch 1 + Pitch 2 = 7-a-side" holds both pitches,
-- so neither can be booked on its own at the same time, and the other way
-- round. A real pitch of the right size is used before a combination.
begin;

do $$
declare
  v_a uuid := tests.create_user('combined-a@futty.test');
  v_b uuid := tests.create_user('combined-b@futty.test');
  -- Hours only; the pitches are added below.
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_day date := tests.cyprus_today() + 1;
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
  v_seven uuid;
  v_booking public.venue_bookings;
  v_held uuid[];
  v_error text;
begin
  v_p1 := tests.create_pitch(v_venue, 'Pitch 1', p_sort => 1);
  v_p2 := tests.create_pitch(v_venue, 'Pitch 2', p_sort => 2);
  v_p3 := tests.create_pitch(v_venue, 'Pitch 3', p_sort => 3);
  insert into public.pitch_combinations (venue_id, format, pitch_ids) values (v_venue, '7-a-side', array[v_p1, v_p2]);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_venue, '7-a-side', 11000);

  -- A 7-a-side holds both pitches of the combination.
  perform tests.act_as(v_a);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 2, '7-a-side', 5);
  assert v_booking.pitches = 2, format('a combined 7-a-side holds 2 pitches, got %s', v_booking.pitches);
  assert v_booking.capacity = 14, format('a 7-a-side is for 14 players, got %s', v_booking.capacity);
  assert v_booking.amount_cents = 11000, format('the 7-a-side price, not 2 x 5-a-side: got %s', v_booking.amount_cents);
  perform tests.act_as_postgres();
  select array_agg(pitch_id order by pitch_id) into v_held from public.booking_pitches where booking_id = v_booking.id;
  assert v_held = (select array_agg(x order by x) from unnest(array[v_p1, v_p2]) as x),
    format('the 7-a-side should hold pitches 1 and 2, got %s', v_held);

  -- Pitch 3 is still free for a 5-a-side at the same time...
  perform tests.act_as(v_b);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '5-a-side', 5);
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_booking.id) = v_p3,
    'the only free pitch during the 7-a-side is pitch 3';

  -- ...and then the venue is full.
  perform tests.act_as(v_b);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''18:30'', ''19:30'', 1, ''5-a-side'', 5)', v_venue, v_day));
  assert v_error = 'slot_full', format('a 5-a-side during the 7-a-side: got %s', coalesce(v_error, 'success'));

  -- The other way round: a 5-a-side on pitch 1 breaks the combination.
  perform tests.act_as(v_a);
  v_booking := public.book_slot(v_venue, v_day, '20:00', '21:00', 1, '5-a-side', 5);
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_booking.id) = v_p1,
    'the first free pitch in order is pitch 1';
  perform tests.act_as(v_b);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''20:30'', ''21:30'', 2, ''7-a-side'', 5)', v_venue, v_day));
  assert v_error = 'slot_full', format('a 7-a-side while pitch 1 is taken: got %s', coalesce(v_error, 'success'));

  -- A format the venue has no pitch or combination for is refused.
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''10:00'', ''11:00'', 3, ''9-a-side'', 5)', v_venue, v_day));
  assert v_error = 'invalid_format', format('9-a-side at a venue without one: got %s', coalesce(v_error, 'success'));

  -- With a real 7-a-side pitch, it's used before tying up two 5-a-side pitches.
  perform tests.act_as_postgres();
  v_seven := tests.create_pitch(v_venue, 'Big pitch', '7-a-side', p_sort => 4);
  perform tests.act_as(v_a);
  v_booking := public.book_slot(v_venue, v_day, '10:00', '11:00', 1, '7-a-side', 5);
  perform tests.act_as_postgres();
  select array_agg(pitch_id) into v_held from public.booking_pitches where booking_id = v_booking.id;
  assert v_held = array[v_seven], format('a real 7-a-side pitch should be used first, got %s', v_held);
  assert v_booking.pitches = 1, 'a game on one real pitch holds 1 pitch';
end $$;

select 'venue model 2 (combined pitches) passed' as result;

rollback;
