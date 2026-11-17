-- Venue staff offer a player to a short team (docs/specs/13-payments-bookings.md
-- "Booking modes": "accept a player the venue offers from its dashboard";
-- "Venue-offered players", decided 17 November, Dimitris; for Panos to confirm).
--   Staff offer a name to a confirmed app booking in an each-pays mode with
--   an empty spot, until kickoff (Cyprus time). Spots taken = players still
--   holding a spot + accepted venue players + open offers.
--   The booker is told once, with the player's name.
begin;

-- A confirmed €60 5 v 5 at a venue owned by p_owner: the booker and
-- p_others players, the booker's share paid.
create or replace function tests.vp_game(p_owner uuid, p_label text, p_others integer,
                                         p_mode text default 'each_pays_own_spot')
returns public.venue_bookings
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_owner => p_owner, p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(tests.create_user(p_label || '-booker@futty.test'), v_venue, p_mode,
                                          p_others, tests.cyprus_today() + 3, '19:00', '20:00', p_label);
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_' || p_label || '_0');
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  return v_booking;
end;
$$;

-- 1. Staff offer a player to a short game; the booker is told once, by name.
do $$
declare
  v_owner uuid := tests.create_user('vp-offer-owner@futty.test');
  v_b public.venue_bookings;
  v_offer jsonb;
  v_row record;
  v_n public.notifications;
begin
  v_b := tests.vp_game(v_owner, 'vp-offer', 7);
  assert v_b.status = 'confirmed', 'the booking is confirmed';

  perform tests.act_as(v_owner);
  v_offer := public.offer_venue_player(v_b.id, '  Andreas  ');
  perform tests.act_as_postgres();

  assert v_offer ->> 'name' = 'Andreas' and v_offer ->> 'state' = 'offered' and v_offer ? 'id',
    format('the offer, trimmed, got %s', v_offer);
  select * into v_row from public.booking_venue_players where id = (v_offer ->> 'id')::uuid;
  assert v_row.booking_id = v_b.id and v_row.venue_id = v_b.venue_id and v_row.status = 'offered'
         and v_row.offered_by = v_owner and v_row.match_player_id is null,
    format('stored, got %s', row_to_json(v_row));

  assert tests.notified(v_b.created_by, 'venue_player_offered') = 1, 'the booker is told once';
  v_n := tests.last_notification(v_b.created_by, 'venue_player_offered');
  assert v_n.title = (select name from public.venues where id = v_b.venue_id) || ' offered a player',
    format('title, got %s', v_n.title);
  assert v_n.body = format('Andreas for %s at 19:00. Andreas plays free; the team''s amounts don''t change.',
                           to_char(v_b.booking_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', v_n.body);
  assert v_n.data @> jsonb_build_object('bookingId', v_b.id, 'offerId', v_offer ->> 'id', 'name', 'Andreas',
                                        'venueId', v_b.venue_id, 'actions', jsonb_build_array('accept', 'decline')),
    format('data, got %s', v_n.data);
  assert (select count(*) from public.notifications where type = 'venue_player_offered') = 1,
    'nobody else is told (the venue player has no account)';

  -- No share, no money for him.
  assert (select count(*) from public.booking_payment_shares where booking_id = v_b.id) = 8, 'still 8 shares';
end $$;

-- 2. Only while there's an empty spot: open offers take one too.
do $$
declare
  v_owner uuid := tests.create_user('vp-full-owner@futty.test');
  v_full public.venue_bookings;
  v_nine public.venue_bookings;
begin
  v_full := tests.vp_game(v_owner, 'vp-full', 9);
  v_nine := tests.vp_game(v_owner, 'vp-nine', 8);

  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_full.id, 'Andreas'))
         = 'no_empty_spot', 'a full game';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_nine.id, 'Andreas')) is null,
    'the last spot';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_nine.id, 'Bambos'))
         = 'no_empty_spot', 'an open offer holds the last spot';
end $$;

-- 3. Only a confirmed app booking in an each-pays mode, before kickoff.
do $$
declare
  v_owner uuid := tests.create_user('vp-which-owner@futty.test');
  v_all public.venue_bookings;
  v_responsible public.venue_bookings;
  v_cancelled public.venue_bookings;
  v_started public.venue_bookings;
  v_at public.venue_bookings;
  v_unpaid public.venue_bookings;
  v_walk_in uuid;
begin
  v_all := tests.vp_game(v_owner, 'vp-all', 5, 'pay_all');
  v_responsible := tests.vp_game(v_owner, 'vp-resp', 5, 'each_pays_responsible');
  v_cancelled := tests.vp_game(v_owner, 'vp-cancelled', 5);
  v_started := tests.vp_game(v_owner, 'vp-started', 5);
  v_at := tests.vp_game(v_owner, 'vp-at', 5);

  update public.venue_bookings set status = 'cancelled' where id = v_cancelled.id;
  perform tests.set_kickoff(v_started.id, now() - interval '1 minute');
  perform tests.set_kickoff(v_at.id, now());

  perform tests.act_as(v_owner);
  v_walk_in := public.add_counter_booking(v_all.venue_id, tests.cyprus_today() + 4, '10:00', '11:00', '5-a-side',
                                          'walk_in', 'Walter', null);
  perform tests.act_as_postgres();

  -- A booking still waiting for the booker's payment.
  perform tests.act_as(tests.create_user('vp-unpaid-booker@futty.test'));
  v_unpaid := public.book_slot(v_all.venue_id, tests.cyprus_today() + 5, '12:00', '13:00', 1, '5-a-side', 5,
                               'each_pays_own_spot');
  perform tests.act_as_postgres();

  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_responsible.id, 'Andreas'))
         is null, 'responsible mode is an each-pays mode';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_all.id, 'Andreas'))
         = 'not_each_pays', 'not when the booker paid for everyone';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_walk_in, 'Andreas'))
         = 'counter_booking', 'not a walk-in';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_cancelled.id, 'Andreas'))
         = 'booking_cancelled', 'not a cancelled booking';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_unpaid.id, 'Andreas'))
         = 'booking_not_confirmed', 'not before the booker has paid';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_started.id, 'Andreas'))
         = 'booking_started', 'not after kickoff';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_at.id, 'Andreas'))
         = 'booking_started', 'not at kickoff';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', gen_random_uuid(), 'Andreas'))
         = 'booking_not_found', 'an unknown booking';
end $$;

-- 4. A name is required, at most 40 characters.
do $$
declare
  v_owner uuid := tests.create_user('vp-name-owner@futty.test');
  v_b public.venue_bookings;
begin
  v_b := tests.vp_game(v_owner, 'vp-name', 5);
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_b.id, '   ')) = 'name_required',
    'blank';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, null)', v_b.id)) = 'name_required',
    'null';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_b.id, repeat('a', 41)))
         = 'name_too_long', '41 characters';
  assert tests.error_as(v_owner, format('select public.offer_venue_player(%L, %L)', v_b.id, repeat('a', 40))) is null,
    '40 characters';
end $$;

-- 5. Only that venue's staff can offer.
do $$
declare
  v_owner uuid := tests.create_user('vp-staff-owner@futty.test');
  v_other_owner uuid := tests.create_user('vp-staff-other@futty.test');
  v_b public.venue_bookings;
begin
  perform tests.create_venue(p_owner => v_other_owner);
  v_b := tests.vp_game(v_owner, 'vp-staff', 5);
  assert tests.error_as(v_other_owner, format('select public.offer_venue_player(%L, %L)', v_b.id, 'Andreas'))
         = 'not_venue_staff', 'another venue''s owner';
  assert tests.error_as(v_b.created_by, format('select public.offer_venue_player(%L, %L)', v_b.id, 'Andreas'))
         = 'not_venue_staff', 'the booker';
  assert tests.error_as((tests.player(v_b.id, 1)).profile_id,
                        format('select public.offer_venue_player(%L, %L)', v_b.id, 'Andreas'))
         = 'not_venue_staff', 'a player';
  assert not exists (select 1 from public.booking_venue_players where booking_id = v_b.id), 'nothing offered';
end $$;

rollback;
