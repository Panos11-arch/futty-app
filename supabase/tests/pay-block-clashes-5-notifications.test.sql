-- Who is told what (decided 18 November): players of a moved game get
-- booking_pitch_moved once per move ("moved to <pitch>"), players of a
-- cancelled game get the venue cancellation's booking_cancelled, and neither
-- also gets the old venue_closed_new_bookings.
begin;

create function tests.bc_count(p_profile uuid, p_type text)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.notifications where profile_id = p_profile and type = p_type
$$;

do $$
declare
  v_owner uuid := tests.create_user('bc5-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 0);
  v_a uuid := tests.create_pitch(v_venue, 'Pitch A', '5-a-side', null, 1);
  v_c uuid := tests.create_pitch(v_venue, 'Pitch C', '5-a-side', null, 2);
  v_day date := tests.cyprus_today() + 2;
  v_moved public.venue_bookings;
  v_cancelled public.venue_bookings;
  v_list jsonb;
  v_n public.notifications;
  v_profile uuid;
begin
  update public.venues set name = 'Nuevo Campo' where id = v_venue;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_moved := tests.booking_with_players(tests.create_user('bc5-m@futty.test'), v_venue, 'each_pays_own_spot', 2,
                                        v_day, '18:00', '19:00', 'bc5m');
  v_cancelled := tests.booking_with_players(tests.create_user('bc5-c@futty.test'), v_venue, 'each_pays_own_spot', 1,
                                            v_day, '19:00', '20:00', 'bc5c');
  perform tests.pay_ago((tests.player(v_cancelled.id, 1)).id, 'pi_bc5_1', interval '2 hours');

  assert (select always_sent from public.notification_types where type = 'booking_pitch_moved'),
    'always sent: players can''t turn it off';

  perform tests.act_as(v_owner);
  perform public.venue_move_booking(v_moved.id, array[v_c]);
  v_list := public.venue_block_clashes(v_venue, v_a, v_day, '18:00', '20:00');
  assert jsonb_array_length(v_list -> 'clashes') = 1, 'only the 19:00 game still clashes';
  perform public.venue_add_block(v_venue, v_a, v_day, '18:00', '20:00', null, v_list ->> 'quote');
  perform tests.act_as_postgres();

  -- The moved game: booker and two players, once each, with the words.
  for v_profile in select profile_id from public.booking_payment_shares where booking_id = v_moved.id loop
    assert tests.bc_count(v_profile, 'booking_pitch_moved') = 1, 'told once it moved';
    assert tests.bc_count(v_profile, 'booking_cancelled') = 0, 'not cancelled';
    assert tests.bc_count(v_profile, 'venue_closed_new_bookings') = 0, 'not the old message';
  end loop;
  select * into v_n from public.notifications where profile_id = v_moved.created_by and type = 'booking_pitch_moved';
  assert v_n.title = 'Your game moved to Pitch C', format('title, got %s', v_n.title);
  assert v_n.body = format('Your game at Nuevo Campo on %s at 18:00 is now on Pitch C. Everything else stays the same.',
                           to_char(v_day, 'FMDay DD Mon')), format('body, got %s', v_n.body);
  assert (v_n.data ->> 'bookingId')::uuid = v_moved.id, 'it opens the booking';

  -- The cancelled game: the venue cancellation's notice, once, and nothing else.
  for v_profile in select profile_id from public.booking_payment_shares where booking_id = v_cancelled.id loop
    assert tests.bc_count(v_profile, 'booking_cancelled') = 1, 'told once it was cancelled';
    assert tests.bc_count(v_profile, 'venue_closed_new_bookings') = 0, 'not the old message';
    assert tests.bc_count(v_profile, 'booking_pitch_moved') = 0, 'not moved';
  end loop;
  select * into v_n from public.notifications
  where profile_id = (tests.player(v_cancelled.id, 1)).profile_id and type = 'booking_cancelled';
  assert v_n.body like 'Nuevo Campo cancelled your game at Nuevo Campo on %. You get €6.80 back.%',
    format('the venue cancel''s words, got %s', v_n.body);

  -- Staff aren't told about their own cancel or move.
  assert tests.bc_count(v_owner, 'booking_pitch_moved') = 0 and tests.bc_count(v_owner, 'booking_cancelled') = 0,
    'staff aren''t told';
end $$;

-- A block saved the old way (until the app ships the clash sheet) still
-- tells the players of a game it covers, but not of one that has started.
do $$
declare
  v_owner uuid := tests.create_user('bc5o-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2, p_open => '00:00', p_close => '23:59');
  v_on public.venue_bookings;
  v_started public.venue_bookings;
  v_day date;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_started := tests.booking_with_players(tests.create_user('bc5o-s@futty.test'), v_venue, 'each_pays_own_spot', 0,
                                          tests.cyprus_today() + 1, '12:00', '13:00', 'bc5os');
  perform tests.set_kickoff(v_started.id, now() - interval '10 minutes');
  select booking_day into v_day from public.venue_bookings where id = v_started.id;
  v_on := tests.booking_with_players(tests.create_user('bc5o-o@futty.test'), v_venue, 'each_pays_own_spot', 0,
                                     v_day + 1, '12:00', '13:00', 'bc5oo');
  insert into public.venue_blocks (venue_id, block_day, created_by) values (v_venue, v_day, v_owner);
  insert into public.venue_blocks (venue_id, block_day, created_by) values (v_venue, v_day + 1, v_owner);
  assert tests.bc_count(v_started.created_by, 'venue_closed_new_bookings') = 0, 'a started game isn''t told';
  assert tests.bc_count(v_on.created_by, 'venue_closed_new_bookings') = 1, 'a game still to come is';
end $$;

select 'pay block clashes 5 (notifications) passed' as result;

rollback;
