-- Venue setup: who is told that the venue has closed new bookings
-- (docs/specs/13-payments-bookings.md "Venue setup", decided 17 November,
-- Dimitris; for Panos to confirm). Every player still in a game that hasn't
-- ended, once per closure, hours change or pitch closure, as a block tells
-- them once per block. A free game's booker is told; walk-ins, owner blocks,
-- ended games and games the change doesn't cover aren't.
begin;

-- 1. A closure: who is told.
do $$
declare
  v_owner uuid := tests.create_user('notice-owner@futty.test');
  v_paid_booker uuid := tests.create_user('notice-paid@futty.test');
  v_free_booker uuid := tests.create_user('notice-free@futty.test');
  v_done_booker uuid := tests.create_user('notice-done@futty.test');
  v_later_booker uuid := tests.create_user('notice-later@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3, p_open => '00:00', p_close => '24:00');
  v_today date := tests.cyprus_today();
  v_paid public.venue_bookings;
  v_done public.venue_bookings;
  v_free uuid;
  v_closure uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  -- A paid game inside the closure, and one after it.
  v_paid := tests.booking_with_players(v_paid_booker, v_venue, 'each_pays_own_spot', 0, v_today + 2, '12:00', '13:00', 'nt-p');
  perform tests.booking_with_players(v_later_booker, v_venue, 'each_pays_own_spot', 0, v_today + 5, '12:00', '13:00', 'nt-l');
  -- A free game (no price, so no shares): its booker is still in it.
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format,
                                     booking_type, created_by, amount_cents, status)
  values (v_venue, v_today + 2, '14:00', '15:00', 1, 10, '5-a-side', 'user_booking', v_free_booker, 0, 'confirmed')
  returning id into v_free;
  -- A game today that ended 10 minutes ago.
  v_done := tests.booking_with_players(v_done_booker, v_venue, 'each_pays_own_spot', 0, v_today + 3, '12:00', '13:00', 'nt-d');
  perform tests.set_kickoff(v_done.id, now() - interval '40 minutes');
  select * into v_done from public.venue_bookings where id = v_done.id;
  -- A walk-in, added by the owner.
  perform tests.act_as(v_owner);
  perform public.add_counter_booking(v_venue, v_today + 2, '16:00', '17:00', '5-a-side', 'walk_in', 'Walter', null);

  -- The owner closes today to three days ahead.
  v_closure := public.add_venue_closure(v_venue, v_today, v_today + 3, 'Works');
  perform tests.act_as_postgres();

  assert (select count(*) from public.notifications
          where profile_id = v_paid_booker and type = 'venue_closed_new_bookings'
            and data ->> 'bookingId' = v_paid.id::text and data ->> 'closureId' = v_closure::text) = 1,
    'a player still in a game the closure covers is told once';
  assert (select count(*) from public.notifications
          where profile_id = v_free_booker and type = 'venue_closed_new_bookings'
            and data ->> 'bookingId' = v_free::text) = 1, 'a free game''s booker is told';
  assert not exists (select 1 from public.notifications
                     where profile_id = v_owner and type = 'venue_closed_new_bookings'), 'a walk-in tells nobody';
  assert not exists (select 1 from public.notifications
                     where profile_id = v_later_booker and type = 'venue_closed_new_bookings'),
    'a game after the closure isn''t told';
  -- Just after midnight the ended game is yesterday's, outside the closure anyway.
  if v_done.booking_day = v_today then
    assert not exists (select 1 from public.notifications
                       where profile_id = v_done_booker and type = 'venue_closed_new_bookings'),
      'a game that already ended today isn''t told';
  end if;
end $$;

-- 2. Closing a pitch tells the players still in the games on it that haven't
-- ended, once each time it's closed.
do $$
declare
  v_owner uuid := tests.create_user('notice-pitch-owner@futty.test');
  v_on_one uuid := tests.create_user('notice-pitch-one@futty.test');
  v_on_two uuid := tests.create_user('notice-pitch-two@futty.test');
  v_left uuid;
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 2;
  v_p1 uuid;
  v_one public.venue_bookings;
  v_two public.venue_bookings;
  v_stayed uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  select id into v_p1 from public.pitches where venue_id = v_venue and name = 'Pitch 1';
  -- Two games at the same time: the first on pitch 1, the second on pitch 2.
  v_one := tests.booking_with_players(v_on_one, v_venue, 'each_pays_own_spot', 2, v_day, '18:00', '19:00', 'np-1');
  v_two := tests.booking_with_players(v_on_two, v_venue, 'each_pays_own_spot', 0, v_day, '18:00', '19:00', 'np-2');
  assert (select pitch_id from public.booking_pitches where booking_id = v_one.id) = v_p1, 'the first game is on pitch 1';
  assert (select pitch_id from public.booking_pitches where booking_id = v_two.id) <> v_p1, 'the second isn''t';
  v_stayed := (tests.player(v_one.id, 1)).profile_id;
  v_left := (tests.player(v_one.id, 2)).profile_id;
  update public.booking_payment_shares set status = 'cancelled' where booking_id = v_one.id and profile_id = v_left;
  -- A walk-in on pitch 1, later that day.
  perform tests.act_as(v_owner);
  perform public.add_counter_booking(v_venue, v_day, '20:00', '21:00', '5-a-side', 'walk_in', 'Walter', null, v_p1);

  perform public.set_pitch_open(v_p1, false);
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications
          where profile_id = v_on_one and type = 'venue_closed_new_bookings'
            and data ->> 'bookingId' = v_one.id::text and data ->> 'pitchId' = v_p1::text) = 1,
    'the booker of the game on pitch 1 is told';
  assert (select count(*) from public.notifications
          where profile_id = v_stayed and type = 'venue_closed_new_bookings') = 1, 'a player still in is told';
  assert not exists (select 1 from public.notifications
                     where profile_id = v_left and type = 'venue_closed_new_bookings'), 'a player who left isn''t';
  assert not exists (select 1 from public.notifications
                     where profile_id = v_on_two and type = 'venue_closed_new_bookings'), 'a game on pitch 2 isn''t';
  assert not exists (select 1 from public.notifications
                     where profile_id = v_owner and type = 'venue_closed_new_bookings'), 'a walk-in tells nobody';
  assert (select status from public.venue_bookings where id = v_one.id) <> 'cancelled', 'the game stays on';

  -- Closing it again while it's closed tells nobody.
  perform tests.act_as(v_owner);
  perform public.set_pitch_open(v_p1, false);
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications
          where profile_id = v_on_one and type = 'venue_closed_new_bookings') = 1, 'still closed: told once';

  -- Reopening tells nobody; closing it again is a new closure, told again.
  perform tests.act_as(v_owner);
  perform public.set_pitch_open(v_p1, true);
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications
          where profile_id = v_on_one and type = 'venue_closed_new_bookings') = 1, 'reopening tells nobody';
  perform tests.act_as(v_owner);
  perform public.set_pitch_open(v_p1, false);
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications
          where profile_id = v_on_one and type = 'venue_closed_new_bookings') = 2, 'a new pitch closure tells again';
  assert (select count(*) from public.notifications
          where profile_id = v_on_two and type = 'venue_closed_new_bookings') = 0, 'pitch 2 still not';
end $$;

select 'venue setup 7 (who is told) passed' as result;

rollback;
