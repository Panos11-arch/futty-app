-- P11 Weather (docs/specs/13-payments-bookings.md "Weather, condition
-- warnings and blocking pitches"): the database side.
--
--   * venues have coordinates for the forecast (both or neither, in range);
--   * the forecast cache is for the Edge Function (service_role) only;
--   * app_rules holds the nudge lead (12 hours), read when used;
--   * venue_weather_slots lists a venue's booked app games starting at least
--     that long from now and not yet flagged, for that venue's staff only.
begin;

-- Coordinates and the cache.
do $$
declare
  v_venue uuid := tests.create_venue();
  v_user uuid := tests.create_user('weather-reader@futty.test');
begin
  update public.venues set latitude = 35.1856, longitude = 33.3823 where id = v_venue;

  assert tests.error_of(format('update public.venues set latitude = 91 where id = %L', v_venue)) is not null,
    'latitude out of range is refused';
  assert tests.error_of(format('update public.venues set longitude = null where id = %L', v_venue)) is not null,
    'coordinates come both or neither';

  assert (select weather_nudge_hours from public.app_rules) = 12, 'spec 13: the nudge lead is 12 hours';

  perform tests.act_as(v_user);
  assert tests.error_of('select * from public.weather_cache') like '%permission denied%',
    'a signed-in user can''t read the forecast cache';
  assert tests.error_of($q$insert into public.weather_cache (cache_key, fetched_at, body) values ('x', now(), '{}')$q$)
         like '%permission denied%', 'nor write it';
  perform tests.act_as_anon();
  assert tests.error_of('select * from public.weather_cache') like '%permission denied%', 'nor can anyone signed out';
  perform tests.act_as_service_role();
  insert into public.weather_cache (cache_key, fetched_at, body) values ('venue:test', now(), '{"hours": []}');
  assert (select count(*) from public.weather_cache where cache_key = 'venue:test') = 1, 'the Edge Function can';
  perform tests.act_as_postgres();
end $$;

-- The slots the dashboard nudge checks.
do $$
declare
  v_owner uuid := tests.create_user('weather-owner@futty.test');
  v_other_owner uuid := tests.create_user('weather-other-owner@futty.test');
  v_booker uuid := tests.create_user('weather-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  v_far public.venue_bookings;
  v_soon public.venue_bookings;
  v_13h public.venue_bookings;
  v_cancelled public.venue_bookings;
  v_flagged public.venue_bookings;
  v_cleared public.venue_bookings;
  v_elsewhere public.venue_bookings;
  v_slots jsonb;
  v_ids uuid[];
  v_flag uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_other_venue, '5-a-side', 6000);
  v_far := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, v_day, '18:00', '19:00', 'w-far');
  v_soon := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, v_day, '10:00', '11:00', 'w-soon');
  v_13h := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, v_day, '11:00', '12:00', 'w-13h');
  v_cancelled := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, v_day, '14:00', '15:00', 'w-cancel');
  v_flagged := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, v_day + 1, '20:00', '21:00', 'w-flag');
  v_cleared := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, v_day + 1, '16:00', '17:00', 'w-clear');
  v_elsewhere := tests.booking_with_players(v_booker, v_other_venue, 'pay_all', 0, v_day, '18:00', '19:00', 'w-else');

  -- Kickoff 11 hours away: too late for the nudge. 13 hours: still in time.
  perform tests.set_kickoff(v_soon.id, now() + interval '11 hours');
  perform tests.set_kickoff(v_13h.id, now() + interval '13 hours');
  update public.venue_bookings set status = 'cancelled' where id = v_cancelled.id;

  perform tests.act_as(v_owner);
  -- A walk-in has no app players to warn.
  perform public.add_counter_booking(v_venue, v_day, '16:00', '17:00', '5-a-side', 'walk_in', 'A', null);
  -- Already flagged: the venue has acted, no nudge.
  perform public.flag_conditions(v_venue, v_day + 1, '19:30', '20:30', null, 'Storm');
  -- A flag cleared since doesn't count.
  v_flag := public.flag_conditions(v_venue, v_day + 1, '16:00', '17:00', null, null);
  perform public.clear_conditions(v_flag);

  v_slots := public.venue_weather_slots(v_venue);
  perform tests.act_as_postgres();

  select array_agg((s ->> 'booking_id')::uuid) into v_ids from jsonb_array_elements(v_slots) s;
  assert v_far.id = any (v_ids), 'a game 3 days away is checked';
  assert v_13h.id = any (v_ids), 'a game 13 hours away is checked';
  assert v_cleared.id = any (v_ids), 'a cleared flag doesn''t hide the game';
  assert not v_soon.id = any (v_ids), 'a game under 12 hours away isn''t';
  assert not v_cancelled.id = any (v_ids), 'a cancelled game isn''t';
  assert not v_flagged.id = any (v_ids), 'a game already flagged isn''t';
  assert not v_elsewhere.id = any (v_ids), 'another venue''s game isn''t';
  assert cardinality(v_ids) = 3, format('only those three: got %s', v_slots);

  select s into v_slots from jsonb_array_elements(v_slots) s where (s ->> 'booking_id')::uuid = v_far.id;
  assert v_slots ->> 'day' = v_day::text, 'with its Cyprus day';
  assert v_slots ->> 'start' = '18:00' and v_slots ->> 'end' = '19:00', format('and times: %s', v_slots);
  assert jsonb_array_length(v_slots -> 'pitch_ids') = 1, 'and its pitch';

  -- The lead is read from app_rules when used.
  update public.app_rules set weather_nudge_hours = 14;
  perform tests.act_as(v_owner);
  select array_agg((s ->> 'booking_id')::uuid) into v_ids from jsonb_array_elements(public.venue_weather_slots(v_venue)) s;
  perform tests.act_as_postgres();
  assert not v_13h.id = any (v_ids), 'with a 14-hour lead the 13-hour game drops out';
  assert v_far.id = any (v_ids), 'the far game stays';

  -- Only that venue's staff.
  perform tests.act_as(v_other_owner);
  assert tests.error_of(format('select public.venue_weather_slots(%L)', v_venue)) = 'not_venue_staff',
    'another venue''s staff can''t read it';
  perform tests.act_as(v_booker);
  assert tests.error_of(format('select public.venue_weather_slots(%L)', v_venue)) = 'not_venue_staff',
    'a player can''t';
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.venue_weather_slots(%L)', v_venue)) like '%permission denied%',
    'nobody signed out can';
  perform tests.act_as_postgres();
end $$;

rollback;
