-- P3: existing venues and bookings move to the new model unchanged.
-- init_venue_model_from_legacy turns base_pitches / hours / price into
-- pitches, combinations, hours and price rules; assign_legacy_booking_pitches
-- gives every upcoming booking made before P3 its pitches, never cancelling one.
begin;

do $$
declare
  v_player uuid := tests.create_user('legacy-player@futty.test');
  v_venue uuid;
  v_day date := tests.cyprus_today() + 1;
  v_old_one uuid;
  v_old_both uuid;
  v_overbooked uuid;
  v_past uuid;
  v_count integer;
  v_unplaced integer;
  v_error text;
begin
  -- A venue as it was before P3: 3 pooled pitches, EUR 50 per pitch-hour, 09:00-23:59.
  insert into public.venues (name, base_pitches, open_time, close_time, price_per_pitch_hour)
  values ('Legacy venue', 3, '09:00', '23:59', 50) returning id into v_venue;
  perform public.init_venue_model_from_legacy(v_venue);

  select count(*) into v_count from public.pitches where venue_id = v_venue and size = '5-a-side' and is_open;
  assert v_count = 3, format('3 pooled pitches become 3 five-a-side pitches, got %s', v_count);
  select count(*) into v_count from public.pitch_combinations where venue_id = v_venue and format = '7-a-side';
  assert v_count = 2, format('neighbours combine for 7s (1+2, 2+3), got %s', v_count);
  select count(*) into v_count from public.pitch_combinations where venue_id = v_venue and format = '9-a-side';
  assert v_count = 1, format('1+2+3 make a 9-a-side, got %s', v_count);
  select count(*) into v_count from public.pitch_combinations where venue_id = v_venue and format = '11-a-side';
  assert v_count = 0, 'no 11-a-side from 3 pitches';
  select count(*) into v_count from public.opening_hours where venue_id = v_venue and opens = '09:00' and closes = '24:00';
  assert v_count = 7, format('the same hours every day, 23:59 meaning midnight; got %s days', v_count);
  assert (select peak_cents from public.price_rules where venue_id = v_venue and format = '5-a-side') = 5000, '5-a-side = 1 pitch-hour';
  assert (select weekend_cents from public.price_rules where venue_id = v_venue and format = '7-a-side') = 10000, '7-a-side = 2 pitch-hours';
  assert (select offpeak_cents from public.price_rules where venue_id = v_venue and format = '9-a-side') = 15000, '9-a-side = 3 pitch-hours';

  -- Running it again changes nothing.
  perform public.init_venue_model_from_legacy(v_venue);
  select count(*) into v_count from public.pitches where venue_id = v_venue;
  assert v_count = 3, 'init is a no-op for a venue that already has pitches';

  -- Bookings written before P3 (no pitches held), as the pooled model allowed:
  -- one pitch, then two pitches at an overlapping time, then one more that the
  -- pooled model would have refused but sneaked in anyway.
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by, created_at)
  values (v_venue, v_day, '18:00', '19:00', 1, 10, '5-a-side', 'confirmed', v_player, now() - interval '3 days')
  returning id into v_old_one;
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by, created_at)
  values (v_venue, v_day, '18:30', '19:30', 2, 14, '7-a-side', 'confirmed', null, now() - interval '2 days')
  returning id into v_old_both;
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by, created_at)
  values (v_venue, v_day, '18:30', '19:00', 1, 10, '5-a-side', 'confirmed', null, now() - interval '1 day')
  returning id into v_overbooked;
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by)
  values (v_venue, tests.cyprus_today() - 1, '18:00', '19:00', 1, 10, '5-a-side', 'confirmed', null)
  returning id into v_past;

  v_unplaced := public.assign_legacy_booking_pitches();

  select count(*) into v_count from public.booking_pitches where booking_id = v_old_one;
  assert v_count = 1, 'the first old booking gets 1 pitch';
  select count(*) into v_count from public.booking_pitches where booking_id = v_old_both;
  assert v_count = 2, 'the two-pitch old booking gets 2 pitches';
  select count(*) into v_count from public.booking_pitches where booking_id = v_overbooked;
  assert v_count = 0, 'an old booking with no pitch left gets none...';
  assert v_unplaced >= 1, 'and is reported';
  assert (select status from public.venue_bookings where id = v_overbooked) = 'confirmed', '...and is not cancelled';
  select count(*) into v_count from public.booking_pitches where booking_id = v_past;
  assert v_count = 0, 'games already played are left alone';

  -- The backfilled bookings now hold their pitches against new bookings.
  perform tests.act_as(v_player);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''18:30'', ''19:00'', 1, ''5-a-side'', 5)', v_venue, v_day));
  assert v_error = 'slot_full', format('booking over the backfilled games: got %s', coalesce(v_error, 'success'));
end $$;

select 'venue model 8 (legacy venues and bookings) passed' as result;

rollback;
