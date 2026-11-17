-- Venue notifications: the daily summary goes out at 20:00 Cyprus time
-- (Asia/Nicosia), summer and winter and on the nights the clocks change,
-- once per staff member per day however often the job runs. The job runs
-- every 5 minutes in UTC; it decides by Cyprus wall-clock time. Every time
-- and date in the text is Cyprus time, never UTC.
begin;

-- How many summaries for p_day the owner got.
create or replace function tests.summaries(p_owner uuid, p_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.notifications
  where profile_id = p_owner and type = 'venue_daily_summary' and data ->> 'day' = p_day::text;
$$;

-- A venue whose owner has something (a block) on p_day.
create or replace function tests.venue_blocked_on(p_email text, p_day date, out owner uuid, out venue uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  owner := tests.create_user(p_email);
  venue := tests.create_venue(p_owner => owner, p_pitches => 1);
  insert into public.venue_blocks (venue_id, block_day, reason) values (venue, p_day, 'Works');
end;
$$;

-- 1. Summer (EEST, UTC+3): 20:00 in Cyprus is 17:00 UTC.
do $$
declare
  v record := tests.venue_blocked_on('vt-summer@futty.test', '2026-07-16');
begin
  perform public.venue_notifications_tick('2026-07-15 16:55:00+00');
  assert tests.summaries(v.owner, '2026-07-16') = 0, 'summer: 19:55 in Cyprus is too early';
  perform public.venue_notifications_tick('2026-07-15 17:00:00+00');
  assert tests.summaries(v.owner, '2026-07-16') = 1, 'summer: sent at 20:00 Cyprus (17:00 UTC)';
  perform public.venue_notifications_tick('2026-07-15 17:05:00+00');
  perform public.venue_notifications_tick('2026-07-15 17:05:00+00');
  assert tests.summaries(v.owner, '2026-07-16') = 1, 'running again sends nothing more';
end $$;

-- 2. Winter (EET, UTC+2): 20:00 in Cyprus is 18:00 UTC.
do $$
declare
  v record := tests.venue_blocked_on('vt-winter@futty.test', '2027-01-14');
begin
  perform public.venue_notifications_tick('2027-01-13 17:00:00+00');
  perform public.venue_notifications_tick('2027-01-13 17:55:00+00');
  assert tests.summaries(v.owner, '2027-01-14') = 0, 'winter: 19:55 in Cyprus is too early';
  perform public.venue_notifications_tick('2027-01-13 18:00:00+00');
  perform public.venue_notifications_tick('2027-01-13 18:05:00+00');
  assert tests.summaries(v.owner, '2027-01-14') = 1, 'winter: sent once at 20:00 Cyprus (18:00 UTC)';
end $$;

-- 3. The clocks go back (Sunday 25 October 2026, 04:00 EEST -> 03:00 EET):
-- that evening 20:00 is 18:00 UTC.
do $$
declare
  v record := tests.venue_blocked_on('vt-back@futty.test', '2026-10-26');
begin
  perform public.venue_notifications_tick('2026-10-25 17:00:00+00');
  assert tests.summaries(v.owner, '2026-10-26') = 0, 'clocks back: 19:00 in Cyprus is too early';
  perform public.venue_notifications_tick('2026-10-25 18:00:00+00');
  assert tests.summaries(v.owner, '2026-10-26') = 1, 'clocks back: sent at 20:00 Cyprus';
end $$;

-- 4. The clocks go forward (Sunday 28 March 2027, 03:00 EET -> 04:00 EEST):
-- that evening 20:00 is 17:00 UTC.
do $$
declare
  v record := tests.venue_blocked_on('vt-forward@futty.test', '2027-03-29');
begin
  perform public.venue_notifications_tick('2027-03-28 16:55:00+00');
  assert tests.summaries(v.owner, '2027-03-29') = 0, 'clocks forward: 19:55 in Cyprus is too early';
  perform public.venue_notifications_tick('2027-03-28 17:00:00+00');
  assert tests.summaries(v.owner, '2027-03-29') = 1, 'clocks forward: sent at 20:00 Cyprus';
end $$;

-- 5. A missed run catches up that evening, but never after midnight: by
-- then "tomorrow" is today.
do $$
declare
  v_late record := tests.venue_blocked_on('vt-late@futty.test', '2026-07-17');
  v_missed record := tests.venue_blocked_on('vt-missed@futty.test', '2026-07-18');
begin
  -- 23:55 on 16 July in Cyprus: still that evening.
  perform public.venue_notifications_tick('2026-07-16 20:55:00+00');
  assert tests.summaries(v_late.owner, '2026-07-17') = 1, 'a late run that evening still sends';
  -- 00:01 on 18 July in Cyprus: the summary for the 18th was due on the 17th.
  perform public.venue_notifications_tick('2026-07-17 21:01:00+00');
  assert tests.summaries(v_missed.owner, '2026-07-18') = 0, 'after midnight it is never sent';
end $$;

-- 6. Times are Cyprus time, never UTC: a 19:00 game in winter (17:00 UTC)
-- reads 19:00 in the new booking notice and in the summary.
do $$
declare
  v_owner uuid := tests.create_user('vt-tz-owner@futty.test');
  v_booker uuid := tests.create_user('vt-tz-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1, p_open => '07:00', p_close => '24:00');
  v_booking uuid;
  v_new text;
  v_summary public.notifications;
begin
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format,
                                     booking_type, created_by, amount_cents, status, payment_mode)
  values (v_venue, '2027-01-14', '19:00', '20:00', 1, 10, '5-a-side', 'user_booking', v_booker, 6000,
          'confirmed', 'pay_all')
  returning id into v_booking;
  assert (select (booking_day + start_time) at time zone 'Asia/Nicosia' from public.venue_bookings
          where id = v_booking) = '2027-01-14 17:00:00+00', 'the game kicks off at 17:00 UTC';

  perform public.venue_notifications_tick('2027-01-13 18:00:00+00');

  select body into v_new from public.notifications where profile_id = v_owner and type = 'venue_new_booking';
  assert v_new like 'Thursday 14 January at 19:00%', format('new booking in Cyprus time, got %s', v_new);
  assert position('17:00' in v_new) = 0, 'never UTC';

  select * into v_summary from public.notifications where profile_id = v_owner and type = 'venue_daily_summary';
  assert v_summary.body like 'Thursday 14 January: 1 game%', format('summary day, got %s', v_summary.body);
  assert (select g ->> 'start' from jsonb_array_elements(v_summary.data -> 'pitches') p,
                                    jsonb_array_elements(p -> 'games') g limit 1) = '19:00',
    format('summary game at 19:00, got %s', v_summary.data);
  assert position('17:00' in v_summary.data::text) = 0, 'no UTC time in the summary';
end $$;

rollback;
