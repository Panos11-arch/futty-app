-- Venue notifications: which events tell a venue's staff (docs/specs/05-product.md
-- section 12 item 11; docs/specs/13-payments-bookings.md "Venue notifications",
-- decided 17 November, Dimitris; for Panos to confirm).
--   venue_new_booking        an app booking is confirmed (never a walk-in, a
--                            phone booking or an owner block: staff added those);
--   venue_booking_cancelled  the booker cancels the whole booking (a player
--                            leaving or the venue's own cancel tells nobody);
--   venue_short_game         the 6-hour check finds the game short.
-- venue_notifications_tick sends each once per staff member, however often
-- it runs; nothing from before the feature existed is sent.
begin;

-- tests.venue_notices(owner, type, booking): how many the owner got.
create or replace function tests.venue_notices(p_profile uuid, p_type text, p_booking uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.notifications
  where profile_id = p_profile and type = p_type
    and (p_booking is null or data ->> 'bookingId' = p_booking::text);
$$;

-- 1. A new app booking tells its venue's staff once, when it's confirmed.
do $$
declare
  v_owner uuid := tests.create_user('vn-new-owner@futty.test');
  v_other_owner uuid := tests.create_user('vn-new-other@futty.test');
  v_booker uuid := tests.create_user('vn-new-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2, p_open => '07:00', p_close => '24:00');
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 1;
  v_b public.venue_bookings;
  v_n public.notifications;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, v_day, '19:00', '20:00', 'vn-new');

  -- Waiting for the booker's payment: not a booking yet.
  perform public.venue_notifications_tick(tests.kickoff_of(v_b.id) - interval '1 day');
  assert tests.venue_notices(v_owner, 'venue_new_booking') = 0, 'a booking waiting for payment tells nobody';

  perform tests.pay_ago((tests.player(v_b.id, 0)).id, 'pi_vn_new_0');
  assert (select status from public.venue_bookings where id = v_b.id) = 'confirmed', 'confirmed';
  perform public.venue_notifications_tick(tests.kickoff_of(v_b.id) - interval '1 day');
  perform public.venue_notifications_tick(tests.kickoff_of(v_b.id) - interval '1 day');

  assert tests.venue_notices(v_owner, 'venue_new_booking', v_b.id) = 1, 'the owner is told once';
  select * into v_n from public.notifications where profile_id = v_owner and type = 'venue_new_booking';
  assert v_n.title = 'New booking', format('title, got %s', v_n.title);
  assert v_n.body = format('%s at 19:00, %s: 5-a-side, booked by %s.',
                           to_char(v_day, 'FMDay FMDD FMMonth'),
                           (select string_agg(p.name, ' + ' order by p.sort_order, p.name)
                            from public.booking_pitches bp join public.pitches p on p.id = bp.pitch_id
                            where bp.booking_id = v_b.id),
                           public.profile_display_name(v_booker)),
    format('body, got %s', v_n.body);
  assert v_n.data ->> 'venueId' = v_venue::text, 'venueId in data';
  assert tests.venue_notices(v_other_owner, 'venue_new_booking') = 0, 'another venue''s owner hears nothing';
  assert tests.venue_notices(v_booker, 'venue_new_booking') = 0, 'the booker gets no venue notice';
  assert tests.venue_notices((tests.player(v_b.id, 1)).profile_id, 'venue_new_booking') = 0,
    'a player in the game gets no staff notice';
end $$;

-- 2. Walk-ins, phone bookings and owner blocks tell nobody: staff added them.
do $$
declare
  v_owner uuid := tests.create_user('vn-counter-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 2;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_owner);
  perform public.add_counter_booking(v_venue, v_day, '10:00', '11:00', '5-a-side', 'walk_in', 'Walter', null);
  perform public.add_counter_booking(v_venue, v_day, '11:00', '12:00', '5-a-side', 'phone', 'Phoebe', '99123456');
  perform tests.act_as_postgres();
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format,
                                     booking_type, created_by, amount_cents, status)
  values (v_venue, v_day, '12:00', '13:00', 1, 10, '5-a-side', 'owner_block', v_owner, 0, 'confirmed');

  perform public.venue_notifications_tick((v_day + time '09:00') at time zone 'Asia/Nicosia');
  assert tests.venue_notices(v_owner, 'venue_new_booking') = 0, 'walk-in, phone and owner block tell nobody';
end $$;

-- 3. Cancellations: the booker cancelling the whole booking tells staff once;
-- a player leaving, or the venue's own cancel, tells nobody.
do $$
declare
  v_owner uuid := tests.create_user('vn-cancel-owner@futty.test');
  v_booker uuid := tests.create_user('vn-cancel-booker@futty.test');
  v_booker2 uuid := tests.create_user('vn-cancel-booker2@futty.test');
  v_booker3 uuid := tests.create_user('vn-cancel-booker3@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 3;
  v_team public.venue_bookings;
  v_spot public.venue_bookings;
  v_by_venue public.venue_bookings;
  v_n public.notifications;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_team := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '18:00', '19:00', 'vn-c1');
  v_spot := tests.booking_with_players(v_booker2, v_venue, 'each_pays_own_spot', 1, v_day, '18:00', '19:00', 'vn-c2');
  v_by_venue := tests.booking_with_players(v_booker3, v_venue, 'each_pays_own_spot', 0, v_day, '18:00', '19:00', 'vn-c3');
  perform tests.pay_ago((tests.player(v_team.id, 0)).id, 'pi_vn_c1');
  perform tests.pay_ago((tests.player(v_spot.id, 0)).id, 'pi_vn_c2');
  perform tests.pay_ago((tests.player(v_spot.id, 1)).id, 'pi_vn_c2b');
  perform tests.pay_ago((tests.player(v_by_venue.id, 0)).id, 'pi_vn_c3');
  -- P6e audit: staff hear of a cancellation only for a booking they were
  -- told about, so the job runs once before the cancellations.
  perform public.venue_notifications_tick(tests.kickoff_of(v_team.id) - interval '1 day');

  perform tests.cancel(v_team.id, 'whole_team', v_booker);
  perform tests.cancel(v_spot.id, 'my_spot', (tests.player(v_spot.id, 1)).profile_id);
  perform tests.cancel(v_by_venue.id, 'venue', v_owner);

  perform public.venue_notifications_tick(tests.kickoff_of(v_team.id) - interval '1 day');
  perform public.venue_notifications_tick(tests.kickoff_of(v_team.id) - interval '1 day');

  assert tests.venue_notices(v_owner, 'venue_booking_cancelled', v_team.id) = 1, 'whole booking: told once';
  select * into v_n from public.notifications where profile_id = v_owner and type = 'venue_booking_cancelled';
  assert v_n.title = 'Booking cancelled', format('title, got %s', v_n.title);
  -- A cancelled booking no longer holds its pitches, so none are named.
  assert v_n.body = format('%s cancelled %s at 18:00 (5-a-side). The slot is free again.',
                           public.profile_display_name(v_booker), to_char(v_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', v_n.body);
  assert tests.venue_notices(v_owner, 'venue_booking_cancelled', v_spot.id) = 0, 'a player leaving tells nobody';
  assert tests.venue_notices(v_owner, 'venue_booking_cancelled', v_by_venue.id) = 0, 'the venue''s own cancel tells nobody';
end $$;

-- 4. A short game, found by the 6-hour check, tells staff once with the
-- server's counts; a full game tells nobody.
do $$
declare
  v_owner uuid := tests.create_user('vn-short-owner@futty.test');
  v_booker uuid := tests.create_user('vn-short-booker@futty.test');
  v_full_booker uuid := tests.create_user('vn-full-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2, p_open => '00:00', p_close => '24:00');
  v_short public.venue_bookings;
  v_full public.venue_bookings;
  v_n public.notifications;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_short := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 7, tests.cyprus_today() + 2,
                                        '12:00', '13:00', 'vn-short');
  v_full := tests.booking_with_players(v_full_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 2,
                                       '12:00', '13:00', 'vn-full');
  for i in 0 .. 7 loop
    perform tests.pay_ago((tests.player(v_short.id, i)).id, 'pi_vn_short_' || i);
  end loop;
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_full.id, i)).id, 'pi_vn_full_' || i);
  end loop;

  -- Nothing before the check has run.
  perform public.venue_notifications_tick(tests.kickoff_of(v_short.id) - interval '1 day');
  assert tests.venue_notices(v_owner, 'venue_short_game') = 0, 'not before the 6-hour check';

  perform tests.set_kickoff(v_short.id, now() + interval '5 hours');
  perform tests.set_kickoff(v_full.id, now() + interval '5 hours');
  perform public.send_short_game_warnings();
  perform public.venue_notifications_tick(tests.kickoff_of(v_short.id) - interval '5 hours');
  perform public.venue_notifications_tick(tests.kickoff_of(v_short.id) - interval '5 hours');

  assert tests.venue_notices(v_owner, 'venue_short_game', v_short.id) = 1, 'a short game: told once';
  select * into v_n from public.notifications where profile_id = v_owner and type = 'venue_short_game';
  assert v_n.title = 'Short game: 8 of 10', format('title, got %s', v_n.title);
  assert v_n.body like '%You can offer a player.', format('body, got %s', v_n.body);
  assert (v_n.data ->> 'joined')::integer = 8 and (v_n.data ->> 'players')::integer = 10,
    format('counts in data, got %s', v_n.data);
  assert tests.venue_notices(v_owner, 'venue_short_game', v_full.id) = 0, 'a full game tells nobody';
end $$;

-- 5. Nothing from before the feature existed is sent.
do $$
declare
  v_owner uuid := tests.create_user('vn-old-owner@futty.test');
  v_booker uuid := tests.create_user('vn-old-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1, p_open => '07:00', p_close => '24:00');
  v_b public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 2,
                                    '15:00', '16:00', 'vn-old');
  perform tests.pay_ago((tests.player(v_b.id, 0)).id, 'pi_vn_old');
  update public.venue_bookings
  set created_at = (select since from public.venue_staff_notify_since) - interval '1 minute'
  where id = v_b.id;
  perform public.venue_notifications_tick(tests.kickoff_of(v_b.id) - interval '1 day');
  assert tests.venue_notices(v_owner, 'venue_new_booking') = 0, 'a booking from before the feature tells nobody';
end $$;

-- 6. The kinds can be turned off (they aren't always sent): the bell row is
-- still written, but no push is queued, as for every type send_notification
-- handles.
do $$
declare
  v_owner uuid := tests.create_user('vn-off-owner@futty.test');
  v_booker uuid := tests.create_user('vn-off-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1, p_open => '07:00', p_close => '24:00');
  v_b public.venue_bookings;
begin
  assert (select bool_and(not always_sent) from public.notification_types
          where type in ('venue_new_booking', 'venue_booking_cancelled', 'venue_short_game', 'venue_daily_summary'))
         and (select count(*) from public.notification_types
              where type in ('venue_new_booking', 'venue_booking_cancelled', 'venue_short_game', 'venue_daily_summary')) = 4,
    'the four types exist and can be turned off';
  insert into public.push_tokens (profile_id, token, platform) values (v_owner, 'ExponentPushToken[vn-off]', 'ios');
  perform tests.act_as(v_owner);
  insert into public.notification_settings (profile_id, type, enabled) values (v_owner, 'venue_new_booking', false);
  perform tests.act_as_postgres();

  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 2,
                                    '16:00', '17:00', 'vn-off');
  perform tests.pay_ago((tests.player(v_b.id, 0)).id, 'pi_vn_off');
  perform public.venue_notifications_tick(tests.kickoff_of(v_b.id) - interval '1 day');

  assert tests.venue_notices(v_owner, 'venue_new_booking', v_b.id) = 1, 'the bell row is written';
  assert not exists (select 1 from public.notification_deliveries d
                     join public.notifications n on n.id = d.notification_id
                     where n.profile_id = v_owner and n.type = 'venue_new_booking'), 'no push when turned off';
end $$;

rollback;
