-- P3: real pitches. book_slot assigns a free pitch automatically and two
-- active bookings can never hold the same pitch at overlapping times.
begin;

do $$
declare
  v_a uuid := tests.create_user('overlap-a@futty.test');
  v_b uuid := tests.create_user('overlap-b@futty.test');
  v_c uuid := tests.create_user('overlap-c@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_day date := tests.cyprus_today() + 1;
  v_first public.venue_bookings;
  v_second public.venue_bookings;
  v_third public.venue_bookings;
  v_first_pitch uuid;
  v_second_pitch uuid;
  v_error text;
  v_count integer;
begin
  perform tests.act_as(v_a);
  v_first := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5);

  -- The second overlapping game goes on the other pitch...
  perform tests.act_as(v_b);
  v_second := public.book_slot(v_venue, v_day, '12:30', '13:30', 1, '5-a-side', 5);

  perform tests.act_as_postgres();
  select pitch_id into v_first_pitch from public.booking_pitches where booking_id = v_first.id;
  select pitch_id into v_second_pitch from public.booking_pitches where booking_id = v_second.id;
  assert v_first_pitch is not null and v_second_pitch is not null, 'each booking should hold a pitch';
  assert v_first_pitch <> v_second_pitch, 'overlapping games must be on different pitches';
  assert v_first.pitches = 1, format('a 5-a-side holds 1 pitch, got %s', v_first.pitches);

  -- ...and a third overlapping game is refused: both pitches are taken.
  perform tests.act_as(v_c);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:30'', ''13:00'', 1, ''5-a-side'', 5)', v_venue, v_day));
  assert v_error = 'slot_full', format('a third overlapping game: got %s', coalesce(v_error, 'success'));

  -- Back-to-back is not an overlap.
  v_third := public.book_slot(v_venue, v_day, '13:00', '14:00', 1, '5-a-side', 5);
  perform tests.act_as_postgres();
  select count(*) into v_count from public.booking_pitches where booking_id = v_third.id and pitch_id = v_first_pitch;
  assert v_count = 1, 'a game starting when the first ends should take the first pitch (first free in order)';

  -- Even writing straight to the table can't double-book a pitch.
  v_error := tests.error_of(format(
    'insert into public.booking_pitches (booking_id, pitch_id, slot) values (%L, %L, tsrange(%L::timestamp, %L::timestamp))',
    v_third.id, v_second_pitch, v_day + time '12:45', v_day + time '13:15'));
  assert v_error like '%booking_pitches_no_overlap%', format('direct double-booking: got %s', coalesce(v_error, 'success'));

  -- Cancelling frees the pitch.
  update public.venue_bookings set status = 'cancelled' where id = v_second.id;
  select count(*) into v_count from public.booking_pitches where booking_id = v_second.id;
  assert v_count = 0, 'a cancelled booking should release its pitch';
  perform tests.act_as(v_c);
  perform public.book_slot(v_venue, v_day, '12:30', '13:00', 1, '5-a-side', 5);

  -- A pitch closed for maintenance is never assigned.
  perform tests.act_as_postgres();
  update public.pitches set is_open = false where id = v_second_pitch;
  perform tests.act_as(v_a);
  v_first := public.book_slot(v_venue, v_day, '16:00', '17:00', 1, '5-a-side', 5);
  perform tests.act_as(v_b);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''16:00'', ''17:00'', 1, ''5-a-side'', 5)', v_venue, v_day));
  assert v_error = 'slot_full', format('only the closed pitch is left: got %s', coalesce(v_error, 'success'));
end $$;

select 'venue model 1 (no overlapping bookings) passed' as result;

rollback;
