-- Venue notifications: only that venue's staff are told, and the app can't
-- run the job, read what it sent or build another venue's summary.
begin;

-- 1. Staff of venue B never hear about venue A, and A's summary holds only A.
do $$
declare
  v_owner_a uuid := tests.create_user('vsec-a@futty.test');
  v_owner_b uuid := tests.create_user('vsec-b@futty.test');
  v_booker uuid := tests.create_user('vsec-booker@futty.test');
  v_booker_b uuid := tests.create_user('vsec-booker-b@futty.test');
  v_a uuid := tests.create_venue(p_owner => v_owner_a, p_pitches => 1, p_open => '07:00', p_close => '24:00');
  v_b uuid := tests.create_venue(p_owner => v_owner_b, p_pitches => 1, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 1;
  v_ga public.venue_bookings;
  v_gb public.venue_bookings;
  v_at timestamptz := (tests.cyprus_today() + time '20:00') at time zone 'Asia/Nicosia';
  v_summary jsonb;
begin
  perform tests.set_price(v_a, '5-a-side', 6000);
  perform tests.set_price(v_b, '5-a-side', 6000);
  v_ga := tests.booking_with_players(v_booker, v_a, 'each_pays_own_spot', 0, v_day, '19:00', '20:00', 'vsec-a');
  v_gb := tests.booking_with_players(v_booker_b, v_b, 'each_pays_own_spot', 0, v_day, '19:00', '20:00', 'vsec-b');
  perform tests.pay_ago((tests.player(v_ga.id, 0)).id, 'pi_vsec_a');
  perform tests.pay_ago((tests.player(v_gb.id, 0)).id, 'pi_vsec_b');

  perform public.venue_notifications_tick(v_at);

  assert not exists (select 1 from public.notifications
                     where profile_id = v_owner_b and data ->> 'bookingId' = v_ga.id::text),
    'B''s owner is never told about A''s booking';
  assert not exists (select 1 from public.notifications
                     where profile_id = v_owner_a and data ->> 'bookingId' = v_gb.id::text),
    'A''s owner is never told about B''s booking';
  select data into v_summary from public.notifications where profile_id = v_owner_a and type = 'venue_daily_summary';
  assert v_summary ->> 'venueId' = v_a::text, 'A''s summary is about A';
  assert position(v_ga.id::text in v_summary::text) > 0, 'A''s summary lists A''s game';
  assert position(v_gb.id::text in v_summary::text) = 0, 'A''s summary never lists B''s game';
  assert not exists (select 1 from public.notifications
                     where profile_id in (v_booker, v_booker_b)
                       and type in ('venue_new_booking', 'venue_booking_cancelled', 'venue_short_game',
                                    'venue_daily_summary')),
    'players get no staff notices';

  -- A venue with no owner has no staff: nothing is sent for it.
  update public.venues set owner_profile_id = null where id = v_b;
  assert not exists (select 1 from public.venue_staff_profiles(v_b)), 'no owner, no staff';
end $$;

-- 2. The app can't run the job, its helpers or read its tables.
do $$
declare
  v_owner uuid := tests.create_user('vsec-app@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_call text;
  v_error text;
begin
  foreach v_call in array array[
    'select public.venue_notifications_tick(''2026-07-15 17:00:00+00'')',
    format('select public.venue_daily_summary_content(%L, ''2026-07-16'')', v_venue),
    format('select public.venue_staff_profiles(%L)', v_venue),
    format('select public.venue_staff_notify_once(%L, %L, ''venue_daily_summary'', ''x'', ''{}'')', v_venue, v_owner),
    'select * from public.venue_staff_notification_log',
    'select * from public.venue_staff_notify_since'
  ] loop
    perform tests.act_as(v_owner);
    v_error := tests.error_of(v_call);
    perform tests.act_as_postgres();
    assert v_error like 'permission denied%', format('%s as the venue''s owner: got %s', v_call, v_error);
    perform tests.act_as_anon();
    v_error := tests.error_of(v_call);
    perform tests.act_as_postgres();
    assert v_error like 'permission denied%', format('%s as anon: got %s', v_call, v_error);
  end loop;

  perform tests.act_as_service_role();
  perform public.venue_notifications_tick('2026-07-15 17:00:00+00');
  perform tests.act_as_postgres();
end $$;

rollback;
