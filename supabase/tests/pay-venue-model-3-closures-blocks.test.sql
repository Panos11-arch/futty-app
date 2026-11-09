-- P3: closures and venue blocks hide slots from availability but never
-- cancel bookings already made. A block tells the players of the games it
-- covers that the venue has closed new bookings (venue_closed_new_bookings).
begin;

do $$
declare
  v_owner uuid := tests.create_user('blocks-owner@futty.test');
  v_booker uuid := tests.create_user('blocks-booker@futty.test');
  v_friend uuid := tests.create_user('blocks-friend@futty.test');
  v_other uuid := tests.create_user('blocks-other@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 1;
  v_later date := tests.cyprus_today() + 2;
  v_booking public.venue_bookings;
  v_untouched public.venue_bookings;
  v_count integer;
  v_status text;
  v_error text;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;

  -- A game at 18:00 with two players holding a share, and one at 10:00.
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as(v_other);
  v_untouched := public.book_slot(v_venue, v_day, '10:00', '11:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (v_booking.id, v_friend, 680, false, 'pending');

  -- 18:00-19:00 and 19:00-20:00 are both free before the block.
  perform tests.act_as(v_other);
  select count(*) into v_count from public.venue_free_slots(v_venue, v_day, '5-a-side') where start_time = '19:00';
  assert v_count = 1, '19:00 should be free before the block';

  -- The owner blocks the venue 17:00-21:00.
  perform tests.act_as(v_owner);
  insert into public.venue_blocks (venue_id, block_day, starts_at, ends_at, reason, created_by)
  values (v_venue, v_day, '17:00', '21:00', 'Pitch maintenance', v_owner);

  -- The game already booked stays on, still holding its pitch...
  perform tests.act_as_postgres();
  select status into v_status from public.venue_bookings where id = v_booking.id;
  assert v_status <> 'cancelled', 'a block must not cancel an existing booking';
  select count(*) into v_count from public.booking_pitches where booking_id = v_booking.id;
  assert v_count = 1, 'the blocked game keeps its pitch';

  -- ...its two players are told, once each...
  select count(*) into v_count from public.notifications
  where type = 'venue_closed_new_bookings' and profile_id in (v_booker, v_friend)
    and data ->> 'bookingId' = v_booking.id::text;
  assert v_count = 2, format('the booker and the other player should be notified once each, got %s', v_count);
  -- ...and nobody outside the blocked hours is.
  select count(*) into v_count from public.notifications where type = 'venue_closed_new_bookings' and profile_id = v_other;
  assert v_count = 0, 'a game outside the block should not be notified';

  -- Availability hides the blocked hours but still offers the rest of the day.
  perform tests.act_as(v_other);
  select count(*) into v_count from public.venue_free_slots(v_venue, v_day, '5-a-side')
  where start_time < '21:00' and end_time > '17:00';
  assert v_count = 0, format('no free slot may overlap the block, got %s', v_count);
  select count(*) into v_count from public.venue_free_slots(v_venue, v_day, '5-a-side') where start_time = '21:00';
  assert v_count = 1, '21:00 (after the block) should still be free';
  select count(*) into v_count from public.venue_free_slots(v_venue, v_day, '5-a-side') where start_time = '10:00';
  assert v_count = 0, '10:00 is booked, so not free';
  -- Older app builds read venue_day_availability: the blocked hours show as taken.
  select count(*) into v_count from public.venue_day_availability(v_venue, v_day)
  where start_time = '17:00' and end_time = '21:00' and pitches = 1;
  assert v_count = 1, 'venue_day_availability should show the block as taken';

  -- A player can't read who blocked it or why.
  select count(*) into v_count from public.venue_blocks where venue_id = v_venue;
  assert v_count = 0, 'players should not read venue blocks directly';

  -- A holiday closure: the whole day disappears, the game that day stays.
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_later, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  insert into public.venue_closures (venue_id, starts_on, ends_on, reason) values (v_venue, v_later, v_later, 'Holiday');
  select status into v_status from public.venue_bookings where id = v_booking.id;
  assert v_status <> 'cancelled', 'a closure must not cancel an existing booking';
  perform tests.act_as(v_other);
  select count(*) into v_count from public.venue_free_slots(v_venue, v_later, '5-a-side');
  assert v_count = 0, format('a closed day has no free slots, got %s', v_count);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''15:00'', ''16:00'', 1, ''5-a-side'', 5, ''each_pays_own_spot'')', v_venue, v_later));
  assert v_error = 'venue_closed', format('booking on a closed day: got %s', coalesce(v_error, 'success'));

  -- Only the venue's own staff may block it.
  v_error := tests.error_of(format(
    'insert into public.venue_blocks (venue_id, block_day, created_by) values (%L, %L, %L)', v_venue, v_day, v_other));
  assert v_error is not null, 'a player must not block a venue';
end $$;

select 'venue model 3 (closures and blocks keep existing bookings) passed' as result;

rollback;
