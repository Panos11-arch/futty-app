-- Venue setup: closures (docs/specs/13-payments-bookings.md "Venue setup",
-- decided 17 November, Dimitris; for Panos to confirm). A closure stops new
-- bookings on its days; games already booked stay on and each player still
-- in them is told once. Removing a closure only reopens new bookings, as
-- removing a block does.
begin;

do $$
declare
  v_owner uuid := tests.create_user('closure-owner@futty.test');
  v_other_owner uuid := tests.create_user('closure-other-owner@futty.test');
  v_booker uuid := tests.create_user('closure-booker@futty.test');
  v_newcomer uuid := tests.create_user('closure-newcomer@futty.test');
  v_outside_booker uuid := tests.create_user('closure-outside@futty.test');
  v_ended uuid;
  v_far uuid;
  v_setup jsonb;
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_today date := tests.cyprus_today();
  v_day date := tests.cyprus_today() + 3;
  v_booking public.venue_bookings;
  v_player uuid;
  v_closure uuid;
  v_second uuid;
  v_running uuid;
  v_new public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);

  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, v_day, '12:00', '13:00', 'closure');
  v_player := (tests.player(v_booking.id, 1)).profile_id;
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_closure_0', interval '2 hours');
  -- A game the day after the closure.
  perform tests.booking_with_players(v_outside_booker, v_venue, 'each_pays_own_spot', 0, v_day + 2, '12:00', '13:00', 'closure-out');

  -- The owner closes the venue for two days, starting the day of the game.
  perform tests.act_as(v_owner);
  v_closure := public.add_venue_closure(v_venue, v_day, v_day + 1, 'Holiday');
  perform tests.act_as_postgres();
  assert v_closure is not null, 'closure added';

  -- No new bookings on those days.
  assert tests.error_as(v_newcomer, format(
    $q$select public.book_slot(%L, %L, '18:00', '19:00', 1, '5-a-side', 5, 'each_pays_own_spot')$q$, v_venue, v_day + 1))
    = 'venue_closed', 'closed to new bookings';
  assert (select count(*) from public.venue_free_slots(v_venue, v_day + 1, '5-a-side')) = 0, 'no free slots shown';

  -- The game already booked stays on, and its players are told once.
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert v_booking.status = 'confirmed', 'the existing game stays on';
  assert (select count(*) from public.notifications
          where profile_id = v_booker and type = 'venue_closed_new_bookings'
            and data ->> 'bookingId' = v_booking.id::text) = 1, 'the booker is told';
  assert (select count(*) from public.notifications
          where profile_id = v_player and type = 'venue_closed_new_bookings'
            and data ->> 'bookingId' = v_booking.id::text) = 1, 'the player is told';

  assert (select data ->> 'closureId' from public.notifications
          where profile_id = v_player and type = 'venue_closed_new_bookings') = v_closure::text, 'keyed on the closure';
  -- A game outside the closure isn't told.
  assert not exists (select 1 from public.notifications
                     where profile_id = v_outside_booker and type = 'venue_closed_new_bookings'),
    'a game outside the closure isn''t told';

  -- Players are told once per closure, as for a block (decided 17
  -- November): the owner removes the closure, then later adds a new one
  -- over the same game, and its players are told again.
  perform tests.act_as(v_owner);
  perform public.remove_venue_closure(v_closure);
  v_second := public.add_venue_closure(v_venue, v_day, v_day, null);
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications
          where profile_id = v_player and type = 'venue_closed_new_bookings') = 2, 'a new closure tells the player again';
  assert (select count(*) from public.notifications
          where profile_id = v_booker and type = 'venue_closed_new_bookings') = 2, 'and the booker';
  assert (select count(*) from public.notifications
          where profile_id = v_player and type = 'venue_closed_new_bookings'
            and data ->> 'closureId' = v_second::text) = 1, 'once for the new closure';

  -- Removing the closure reopens the days to new bookings only.
  perform tests.act_as(v_owner);
  perform public.remove_venue_closure(v_second);
  perform tests.act_as_postgres();
  perform tests.act_as(v_newcomer);
  v_new := public.book_slot(v_venue, v_day + 1, '18:00', '19:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert v_new.id is not null, 'reopened to new bookings';
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert v_booking.status = 'confirmed', 'the existing game is untouched';

  -- A closure already running (started yesterday) can be added; one that
  -- ended before today, or ends before it starts, can't.
  perform tests.act_as(v_owner);
  v_running := public.add_venue_closure(v_venue, v_today - 1, v_today + 1, 'Works');
  perform tests.act_as_postgres();
  assert v_running is not null, 'a closure that started yesterday';
  assert tests.error_as(v_owner, format($q$select public.add_venue_closure(%L, %L, %L, null)$q$,
    v_venue, v_today - 3, v_today - 1)) = 'day_in_past', 'a closure in the past';
  assert tests.error_as(v_owner, format($q$select public.add_venue_closure(%L, %L, %L, null)$q$,
    v_venue, v_day + 1, v_day)) = 'invalid_range', 'ends before it starts';
  assert tests.error_as(v_owner, format($q$select public.add_venue_closure(%L, null, %L, null)$q$,
    v_venue, v_day)) = 'invalid_range', 'no start day';

  -- venue_setup lists every closure that hasn't ended yet, however far
  -- ahead, and none that ended before today (Cyprus).
  insert into public.venue_closures (venue_id, starts_on, ends_on, reason)
  values (v_venue, v_today - 5, v_today - 1, 'Ended yesterday') returning id into v_ended;
  perform tests.act_as(v_owner);
  v_far := public.add_venue_closure(v_venue, v_today + 200, v_today + 210, 'Next summer');
  v_setup := public.venue_setup(v_venue);
  perform tests.act_as_postgres();
  assert exists (select 1 from jsonb_array_elements(v_setup -> 'closures') c where (c ->> 'id')::uuid = v_running),
    'a running closure is listed';
  assert exists (select 1 from jsonb_array_elements(v_setup -> 'closures') c where (c ->> 'id')::uuid = v_far),
    'a closure far ahead is listed';
  assert not exists (select 1 from jsonb_array_elements(v_setup -> 'closures') c where (c ->> 'id')::uuid = v_ended),
    'a closure that ended yesterday isn''t';

  -- Only the venue's own staff, and only real closures.
  assert tests.error_as(v_other_owner, format($q$select public.add_venue_closure(%L, %L, %L, null)$q$,
    v_venue, v_day, v_day)) = 'not_venue_staff', 'another venue''s staff can''t add one';
  -- Another venue's staff learn nothing: the same answer as for no closure.
  assert tests.error_as(v_other_owner, format($q$select public.remove_venue_closure(%L)$q$, v_running))
    = 'closure_not_found', 'another venue''s staff can''t remove one';
  assert tests.error_as(v_booker, format($q$select public.remove_venue_closure(%L)$q$, v_running))
    = 'not_venue_staff', 'a player can''t remove one';
  assert tests.error_as(v_owner, format($q$select public.remove_venue_closure(%L)$q$, gen_random_uuid()))
    = 'closure_not_found', 'no such closure';
  assert exists (select 1 from public.venue_closures where id = v_running), 'still there';
  assert not exists (select 1 from public.venue_closures where venue_id = v_other_venue), 'nothing at the other venue';
end;
$$;

rollback;
