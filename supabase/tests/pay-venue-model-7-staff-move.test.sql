-- P3: the venue's staff can move a booking to other pitches later. Only
-- their own venue's bookings, only onto pitches that host the format, and
-- never onto a pitch that's taken. Opening hours are per weekday.
begin;

do $$
declare
  v_owner uuid := tests.create_user('move-owner@futty.test');
  v_player uuid := tests.create_user('move-player@futty.test');
  v_other_owner uuid := tests.create_user('move-other-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 1;
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
  v_foreign uuid;
  v_booking public.venue_bookings;
  v_second public.venue_bookings;
  v_held uuid[];
  v_error text;
begin
  select id into v_p1 from public.pitches where venue_id = v_venue and name = 'Pitch 1';
  select id into v_p2 from public.pitches where venue_id = v_venue and name = 'Pitch 2';
  select id into v_p3 from public.pitches where venue_id = v_venue and name = 'Pitch 3';
  select id into v_foreign from public.pitches where venue_id = v_other_venue;

  perform tests.act_as(v_player);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '5-a-side', 5);
  v_second := public.book_slot(v_venue, v_day, '18:30', '19:30', 1, '5-a-side', 5);

  -- The player can't move it; neither can another venue's owner.
  v_error := tests.error_of(format('select public.move_booking_pitches(%L, array[%L]::uuid[])', v_booking.id, v_p3));
  assert v_error = 'not_your_venue', format('a player moving a booking: got %s', coalesce(v_error, 'success'));
  perform tests.act_as(v_other_owner);
  v_error := tests.error_of(format('select public.move_booking_pitches(%L, array[%L]::uuid[])', v_booking.id, v_p3));
  assert v_error = 'not_your_venue', format('another owner moving a booking: got %s', coalesce(v_error, 'success'));

  perform tests.act_as(v_owner);
  -- Not onto the pitch the other game holds...
  v_error := tests.error_of(format('select public.move_booking_pitches(%L, array[%L]::uuid[])', v_booking.id, v_p2));
  assert v_error = 'slot_full', format('moving onto a taken pitch: got %s', coalesce(v_error, 'success'));
  -- ...not onto another venue's pitch...
  v_error := tests.error_of(format('select public.move_booking_pitches(%L, array[%L]::uuid[])', v_booking.id, v_foreign));
  assert v_error = 'invalid_pitches', format('moving to another venue''s pitch: got %s', coalesce(v_error, 'success'));
  -- ...not onto two pitches that don't make a combination for its format...
  v_error := tests.error_of(format('select public.move_booking_pitches(%L, array[%L, %L]::uuid[])', v_booking.id, v_p1, v_p3));
  assert v_error = 'invalid_pitches', format('5-a-side on two pitches: got %s', coalesce(v_error, 'success'));

  -- ...but onto the free pitch 3, yes.
  perform public.move_booking_pitches(v_booking.id, array[v_p3]);
  perform tests.act_as_postgres();
  select array_agg(pitch_id) into v_held from public.booking_pitches where booking_id = v_booking.id;
  assert v_held = array[v_p3], format('the booking should now be on pitch 3, got %s', v_held);

  -- Pitch 1 is free again at 18:00 (for someone else: the player already
  -- has a game at 18:00 here).
  perform tests.act_as(v_other_owner);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '18:30', 1, '5-a-side', 5);
end $$;

-- Opening hours per weekday: no row for a weekday = closed that day.
do $$
declare
  v_player uuid := tests.create_user('hours-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '23:00');
  v_day date := tests.cyprus_today() + 1;
  v_error text;
begin
  perform tests.act_as_postgres();
  delete from public.opening_hours where venue_id = v_venue and weekday = extract(isodow from v_day);
  update public.opening_hours set opens = '17:00', closes = '22:00'
  where venue_id = v_venue and weekday = extract(isodow from v_day + 1);

  perform tests.act_as(v_player);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:00'', ''13:00'', 1, ''5-a-side'', 5)', v_venue, v_day));
  assert v_error = 'outside_opening_hours', format('a day the venue is closed: got %s', coalesce(v_error, 'success'));
  assert not exists (select 1 from public.venue_free_slots(v_venue, v_day, '5-a-side')), 'no free slots on a closed weekday';

  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:00'', ''13:00'', 1, ''5-a-side'', 5)', v_venue, v_day + 1));
  assert v_error = 'outside_opening_hours', format('before that day''s opening: got %s', coalesce(v_error, 'success'));
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''21:30'', ''22:30'', 1, ''5-a-side'', 5)', v_venue, v_day + 1));
  assert v_error = 'outside_opening_hours', format('after that day''s closing: got %s', coalesce(v_error, 'success'));
  perform public.book_slot(v_venue, v_day + 1, '17:00', '18:00', 1, '5-a-side', 5);

  assert (select min(start_time) from public.venue_free_slots(v_venue, v_day + 1, '5-a-side')) = '18:00',
    'free slots start at that day''s opening (17:00 is now booked)';
  assert (select max(end_time) from public.venue_free_slots(v_venue, v_day + 1, '5-a-side')) = '22:00',
    'free slots end at that day''s closing';
end $$;

select 'venue model 7 (staff move, weekday hours) passed' as result;

rollback;
