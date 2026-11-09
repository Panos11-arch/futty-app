-- P3 follow-up.
-- 1. booking_slot_range is an internal helper: only the security definer
--    functions call it, so the app (anon, authenticated) can't (CLAUDE.md
--    rule 4).
-- 2. A block stops new bookings only, and the players of every game it
--    covers are told. That holds when staff widen a block later (longer
--    hours, one pitch -> the whole venue), not only when it's created.
--    Nobody is told twice about the same block.
begin;

do $$
begin
  assert not has_function_privilege('authenticated', 'public.booking_slot_range(date, time, time)', 'execute'),
    'authenticated must not call booking_slot_range';
  assert not has_function_privilege('anon', 'public.booking_slot_range(date, time, time)', 'execute'),
    'anon must not call booking_slot_range';
  assert has_function_privilege('service_role', 'public.booking_slot_range(date, time, time)', 'execute'),
    'service_role keeps booking_slot_range';
end $$;

do $$
declare
  v_owner uuid := tests.create_user('widen-owner@futty.test');
  v_early uuid := tests.create_user('widen-early@futty.test');
  v_late uuid := tests.create_user('widen-late@futty.test');
  v_other uuid := tests.create_user('widen-other@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 1;
  v_p1 uuid;
  v_p2 uuid;
  v_early_booking public.venue_bookings;
  v_late_booking public.venue_bookings;
  v_other_booking public.venue_bookings;
  v_block uuid;
  v_count integer;
begin
  select id into v_p1 from public.pitches where venue_id = v_venue and name = 'Pitch 1';
  select id into v_p2 from public.pitches where venue_id = v_venue and name = 'Pitch 2';

  -- Two games on pitch 1 (18:00 and 20:00), one on pitch 2 (18:00).
  perform tests.act_as(v_early);
  v_early_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '5-a-side', 5);
  perform tests.act_as(v_late);
  v_late_booking := public.book_slot(v_venue, v_day, '20:00', '21:00', 1, '5-a-side', 5);
  perform tests.act_as(v_other);
  v_other_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '5-a-side', 5);
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_early_booking.id) = v_p1, 'early game on pitch 1';
  assert (select pitch_id from public.booking_pitches where booking_id = v_late_booking.id) = v_p1, 'late game on pitch 1';
  assert (select pitch_id from public.booking_pitches where booking_id = v_other_booking.id) = v_p2, 'other game on pitch 2';

  -- The owner blocks pitch 1, 17:00-19:00: only the early game is told.
  perform tests.act_as(v_owner);
  insert into public.venue_blocks (venue_id, pitch_id, block_day, starts_at, ends_at, created_by)
  values (v_venue, v_p1, v_day, '17:00', '19:00', v_owner)
  returning id into v_block;

  perform tests.act_as_postgres();
  select count(*) into v_count from public.notifications where type = 'venue_closed_new_bookings' and profile_id = v_early;
  assert v_count = 1, format('the early game is told once, got %s', v_count);
  select count(*) into v_count from public.notifications
  where type = 'venue_closed_new_bookings' and profile_id in (v_late, v_other);
  assert v_count = 0, format('games outside the block are not told yet, got %s', v_count);

  -- The owner widens it to 17:00-22:00: the late game is now covered and told.
  perform tests.act_as(v_owner);
  update public.venue_blocks set ends_at = '22:00' where id = v_block;

  perform tests.act_as_postgres();
  select count(*) into v_count from public.notifications
  where type = 'venue_closed_new_bookings' and profile_id = v_late and data ->> 'bookingId' = v_late_booking.id::text;
  assert v_count = 1, format('widening the block tells the late game, got %s', v_count);
  select count(*) into v_count from public.notifications where type = 'venue_closed_new_bookings' and profile_id = v_early;
  assert v_count = 1, format('the early game is not told twice, got %s', v_count);
  select count(*) into v_count from public.notifications where type = 'venue_closed_new_bookings' and profile_id = v_other;
  assert v_count = 0, format('pitch 2 is not blocked, got %s', v_count);

  -- From one pitch to the whole venue: the game on pitch 2 is told.
  perform tests.act_as(v_owner);
  update public.venue_blocks set pitch_id = null where id = v_block;

  perform tests.act_as_postgres();
  select count(*) into v_count from public.notifications where type = 'venue_closed_new_bookings' and profile_id = v_other;
  assert v_count = 1, format('a venue-wide block tells the pitch 2 game, got %s', v_count);

  -- Editing only the reason tells nobody again.
  perform tests.act_as(v_owner);
  update public.venue_blocks set reason = 'Floodlights' where id = v_block;

  perform tests.act_as_postgres();
  select count(*) into v_count from public.notifications where type = 'venue_closed_new_bookings';
  assert v_count = 3, format('one notice per player per block, got %s', v_count);

  -- Every game is still on.
  select count(*) into v_count from public.venue_bookings
  where id in (v_early_booking.id, v_late_booking.id, v_other_booking.id) and status = 'cancelled';
  assert v_count = 0, 'a block never cancels a booking';
end $$;

select 'venue model 9 (follow-up: helper grant, widened blocks) passed' as result;

rollback;
