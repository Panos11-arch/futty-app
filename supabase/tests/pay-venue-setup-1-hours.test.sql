-- Venue setup: opening hours (docs/specs/13-payments-bookings.md "Venue
-- setup", decided 17 November, Dimitris; for Panos to confirm). Staff set the
-- whole week; a weekday with no hours is closed. Games already booked stay on
-- when the hours shrink, and each player still in them is told once that the
-- venue has closed new bookings, as for a block.
begin;

do $$
declare
  v_owner uuid := tests.create_user('hours-owner@futty.test');
  v_other_owner uuid := tests.create_user('hours-other-owner@futty.test');
  v_booker uuid := tests.create_user('hours-booker@futty.test');
  v_newcomer uuid := tests.create_user('hours-newcomer@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_wed date := tests.next_weekday(3);
  v_thu date := tests.next_weekday(4);
  v_sun date := tests.next_weekday(7);
  v_booking public.venue_bookings;
  v_stayed uuid;
  v_left uuid;
  v_week jsonb;
  v_late public.venue_bookings;
  v_setup jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);

  -- A game on Wednesday 20:00, with the booker, a player still in, and a
  -- player who has left.
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, v_wed, '20:00', '21:00', 'hours');
  v_stayed := (tests.player(v_booking.id, 1)).profile_id;
  v_left := (tests.player(v_booking.id, 2)).profile_id;
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_hours_0', interval '2 hours');
  update public.booking_payment_shares set status = 'cancelled'
  where booking_id = v_booking.id and profile_id = v_left;

  -- The owner shortens Wednesday to 08:00-18:00, keeps the other days until
  -- midnight (24:00) and closes on Sundays (no row).
  v_week := '[
    {"weekday": 1, "opens": "08:00", "closes": "24:00"},
    {"weekday": 2, "opens": "08:00", "closes": "24:00"},
    {"weekday": 3, "opens": "08:00", "closes": "18:00"},
    {"weekday": 4, "opens": "08:00", "closes": "24:00"},
    {"weekday": 5, "opens": "08:00", "closes": "24:00"},
    {"weekday": 6, "opens": "09:00", "closes": "22:00"}
  ]';
  perform tests.act_as(v_owner);
  perform public.set_venue_hours(v_venue, v_week);
  v_setup := public.venue_setup(v_venue);
  perform tests.act_as_postgres();

  assert (select count(*) from public.opening_hours where venue_id = v_venue) = 6, 'six days open';
  assert (select closes from public.opening_hours where venue_id = v_venue and weekday = 3) = '18:00', 'Wednesday shortened';
  assert (select closes from public.opening_hours where venue_id = v_venue and weekday = 1) = '24:00', 'midnight kept';
  assert jsonb_array_length(v_setup -> 'hours') = 6, 'venue_setup shows the week';

  -- The game booked before stays on, at its price.
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert v_booking.status = 'confirmed', 'the existing game stays on';
  assert v_booking.amount_cents = 6000, 'its price is unchanged';

  -- Its players still in are told once; the player who left isn't.
  assert (select count(*) from public.notifications
          where profile_id = v_booker and type = 'venue_closed_new_bookings'
            and data ->> 'bookingId' = v_booking.id::text) = 1, 'the booker is told';
  assert (select count(*) from public.notifications
          where profile_id = v_stayed and type = 'venue_closed_new_bookings'
            and data ->> 'bookingId' = v_booking.id::text) = 1, 'a player still in is told';
  assert not exists (select 1 from public.notifications
                     where profile_id = v_left and type = 'venue_closed_new_bookings'), 'a player who left isn''t told';

  -- Saving the same hours again tells nobody twice.
  perform tests.act_as(v_owner);
  perform public.set_venue_hours(v_venue, v_week);
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications
          where profile_id = v_booker and type = 'venue_closed_new_bookings') = 1, 'told only once';

  -- New bookings follow the new hours.
  assert tests.error_as(v_newcomer, format(
    $q$select public.book_slot(%L, %L, '18:00', '19:00', 1, '5-a-side', 5, 'each_pays_own_spot')$q$, v_venue, v_wed))
    = 'outside_opening_hours', 'Wednesday evening is closed to new bookings';
  assert tests.error_as(v_newcomer, format(
    $q$select public.book_slot(%L, %L, '10:00', '11:00', 1, '5-a-side', 5, 'each_pays_own_spot')$q$, v_venue, v_sun))
    = 'outside_opening_hours', 'no hours on Sunday: closed';
  perform tests.act_as(v_newcomer);
  v_late := public.book_slot(v_venue, v_thu, '23:00', '24:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert v_late.id is not null, 'a game ending at midnight can be booked';

  -- Bad weeks are refused and change nothing.
  assert tests.error_as(v_owner, format($q$select public.set_venue_hours(%L, %L)$q$, v_venue,
    '[{"weekday": 1, "opens": "08:00", "closes": "22:00"}, {"weekday": 1, "opens": "09:00", "closes": "22:00"}]'))
    = 'invalid_hours', 'a weekday twice';
  assert tests.error_as(v_owner, format($q$select public.set_venue_hours(%L, %L)$q$, v_venue,
    '[{"weekday": 2, "opens": "22:00", "closes": "08:00"}]')) = 'invalid_hours', 'closes before it opens';
  assert tests.error_as(v_owner, format($q$select public.set_venue_hours(%L, %L)$q$, v_venue,
    '[{"weekday": 2, "opens": "08:00", "closes": "08:00"}]')) = 'invalid_hours', 'closes when it opens';
  assert tests.error_as(v_owner, format($q$select public.set_venue_hours(%L, %L)$q$, v_venue,
    '[{"weekday": 8, "opens": "08:00", "closes": "22:00"}]')) = 'invalid_hours', 'no weekday 8';
  assert tests.error_as(v_owner, format($q$select public.set_venue_hours(%L, %L)$q$, v_venue,
    '[{"weekday": 2, "opens": "soon", "closes": "22:00"}]')) = 'invalid_hours', 'not a time';
  assert tests.error_as(v_owner, format($q$select public.set_venue_hours(%L, %L)$q$, v_venue,
    '[{"weekday": 2, "opens": "24:00", "closes": "24:00"}]')) = 'invalid_hours', 'opening at midnight';
  assert tests.error_as(v_owner, format($q$select public.set_venue_hours(%L, %L)$q$, v_venue,
    '{"weekday": 2}')) = 'invalid_hours', 'not a list';
  assert (select count(*) from public.opening_hours where venue_id = v_venue) = 6, 'refusals change nothing';

  -- An empty week closes every day.
  perform tests.act_as(v_owner);
  perform public.set_venue_hours(v_venue, '[]');
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.opening_hours where venue_id = v_venue), 'closed every day';

  -- Only the venue's own staff.
  assert tests.error_as(v_other_owner, format($q$select public.set_venue_hours(%L, '[]')$q$, v_venue))
    = 'not_venue_staff', 'another venue''s staff';
  assert tests.error_as(v_booker, format($q$select public.set_venue_hours(%L, '[]')$q$, v_venue))
    = 'not_venue_staff', 'a player';
  assert (select count(*) from public.opening_hours where venue_id = v_other_venue) = 7, 'the other venue is untouched';
end;
$$;

rollback;
