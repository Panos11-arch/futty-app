-- P3: a blocked slot can't be booked. Blocks cover one pitch or the whole
-- venue, for a whole day or a time range on a day.
begin;

do $$
declare
  v_owner uuid := tests.create_user('blocked-owner@futty.test');
  v_player uuid := tests.create_user('blocked-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 1;
  v_next date := tests.cyprus_today() + 2;
  v_p1 uuid;
  v_p2 uuid;
  v_booking public.venue_bookings;
  v_error text;
begin
  select id into v_p1 from public.pitches where venue_id = v_venue and name = 'Pitch 1';
  select id into v_p2 from public.pitches where venue_id = v_venue and name = 'Pitch 2';

  -- Pitch 1 blocked 12:00-14:00: a 5-a-side then goes on pitch 2...
  insert into public.venue_blocks (venue_id, pitch_id, block_day, starts_at, ends_at)
  values (v_venue, v_p1, v_day, '12:00', '14:00');
  perform tests.act_as(v_player);
  v_booking := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert (select pitch_id from public.booking_pitches where booking_id = v_booking.id) = v_p2,
    'with pitch 1 blocked, the game goes on pitch 2';

  -- ...a 7-a-side needs pitch 1 too, so it's refused as blocked...
  perform tests.act_as(v_player);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''13:00'', ''14:00'', 2, ''7-a-side'', 5, ''each_pays_own_spot'')', v_venue, v_day));
  assert v_error = 'slot_blocked', format('7-a-side over a blocked pitch: got %s', coalesce(v_error, 'success'));

  -- ...and with pitch 2 taken, the only pitch left is blocked.
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:30'', ''13:30'', 1, ''5-a-side'', 5, ''each_pays_own_spot'')', v_venue, v_day));
  assert v_error = 'slot_blocked', format('only a blocked pitch left: got %s', coalesce(v_error, 'success'));

  -- Touching the block's edge is fine: 14:00 is free on both pitches.
  perform public.book_slot(v_venue, v_day, '14:00', '15:00', 2, '7-a-side', 5, 'each_pays_own_spot');

  -- The whole venue 18:00-20:00: refused, even overlapping by half an hour.
  perform tests.act_as_postgres();
  insert into public.venue_blocks (venue_id, block_day, starts_at, ends_at) values (v_venue, v_day, '18:00', '20:00');
  perform tests.act_as(v_player);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''19:30'', ''20:30'', 1, ''5-a-side'', 5, ''each_pays_own_spot'')', v_venue, v_day));
  assert v_error = 'slot_blocked', format('a venue-wide block: got %s', coalesce(v_error, 'success'));

  -- The whole venue for a whole day.
  perform tests.act_as_postgres();
  insert into public.venue_blocks (venue_id, block_day) values (v_venue, v_next);
  perform tests.act_as(v_player);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''09:00'', ''10:00'', 1, ''5-a-side'', 5, ''each_pays_own_spot'')', v_venue, v_next));
  assert v_error = 'slot_blocked', format('a whole-day block: got %s', coalesce(v_error, 'success'));

  -- A block on another day changes nothing.
  perform public.book_slot(v_venue, tests.cyprus_today() + 3, '09:00', '10:00', 1, '5-a-side', 5, 'each_pays_own_spot');
end $$;

select 'venue model 4 (a blocked slot can''t be booked) passed' as result;

rollback;
