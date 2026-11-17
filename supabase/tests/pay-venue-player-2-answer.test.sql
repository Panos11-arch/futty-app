-- The booker answers a venue's offer; staff withdraw, the booker removes
-- (docs/specs/13-payments-bookings.md "Venue-offered players", decided
-- 17 November, Dimitris; for Panos to confirm).
--   Accepting adds him to the match as a guest (match_players.guest_name)
--   and he takes a spot: app joins stop at capacity minus accepted venue
--   players. Accepting and joining both lock the booking row before counting,
--   so only one of them gets the last spot.
--   A booking with no match keeps him in booking_venue_players only.
--   An unanswered offer lapses at kickoff.
begin;

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

-- Staff offer p_name; returns the offer id.
create or replace function tests.vp_offer(p_owner uuid, p_booking uuid, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_offer jsonb;
begin
  perform tests.act_as(p_owner);
  v_offer := public.offer_venue_player(p_booking, p_name);
  perform tests.act_as_postgres();
  return (v_offer ->> 'id')::uuid;
end;
$$;

create or replace function tests.vp_row(p_offer uuid)
returns public.booking_venue_players
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.booking_venue_players where id = p_offer;
$$;

-- The venue player's row in the booking's match.
create or replace function tests.vp_match_row(p_booking uuid, p_name text)
returns public.match_players
language sql
stable
security definer
set search_path = ''
as $$
  select mp.* from public.match_players mp join public.matches m on m.id = mp.match_id
  where m.booking_id = p_booking and mp.guest_name = p_name;
$$;

-- p_user's venue_players list in booking_detail.
create or replace function tests.vp_detail(p_user uuid, p_booking uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  v := public.booking_detail(p_booking) -> 'venue_players';
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- The staff roster's venue_players list and can_offer_player.
create or replace function tests.vp_roster(p_owner uuid, p_booking uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_owner);
  v := public.venue_booking_roster(p_booking);
  perform tests.act_as_postgres();
  return jsonb_build_object('venue_players', v -> 'venue_players', 'can_offer_player', v -> 'can_offer_player');
end;
$$;

-- 1. The booker accepts: a guest in the match, staff told once, by name.
do $$
declare
  v_owner uuid := tests.create_user('vp-accept-owner@futty.test');
  v_b public.venue_bookings;
  v_offer uuid;
  v_result jsonb;
  v_mp public.match_players;
  v_n public.notifications;
begin
  v_b := tests.vp_game(v_owner, 'vp-accept', 7);
  assert (tests.match_of(v_b.id)).id is not null, 'the booking has a match';
  v_offer := tests.vp_offer(v_owner, v_b.id, 'Andreas');

  assert tests.error_as(v_owner, format('select public.answer_venue_player(%L, true)', v_offer)) = 'offer_not_found',
    'staff can''t answer for the booker';
  assert tests.error_as((tests.player(v_b.id, 1)).profile_id, format('select public.answer_venue_player(%L, true)', v_offer))
         = 'offer_not_found', 'another player can''t answer';

  perform tests.act_as(v_b.created_by);
  v_result := public.answer_venue_player(v_offer, true);
  perform tests.act_as_postgres();
  assert v_result ->> 'state' = 'accepted', format('accepted, got %s', v_result);

  v_mp := tests.vp_match_row(v_b.id, 'Andreas');
  assert v_mp.id is not null and v_mp.profile_id is null and v_mp.share_id is null and v_mp.left_at is null,
    format('a guest in the match, got %s', row_to_json(v_mp));
  assert (tests.vp_row(v_offer)).match_player_id = v_mp.id and (tests.vp_row(v_offer)).answered_at is not null,
    'linked to his match row';
  assert (select count(*) from public.booking_payment_shares where booking_id = v_b.id) = 8, 'no share for him';

  assert tests.notified(v_owner, 'venue_player_accepted') = 1, 'the owner is told once';
  v_n := tests.last_notification(v_owner, 'venue_player_accepted');
  assert v_n.title = 'Player accepted', format('title, got %s', v_n.title);
  assert v_n.body = format('%s accepted Andreas for %s at 19:00. Andreas plays free; the team''s amounts don''t change.',
                           public.profile_display_name(v_b.created_by), to_char(v_b.booking_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', v_n.body);
  assert v_n.data @> jsonb_build_object('bookingId', v_b.id, 'offerId', v_offer, 'venueId', v_b.venue_id),
    format('data, got %s', v_n.data);

  assert tests.error_as(v_b.created_by, format('select public.answer_venue_player(%L, false)', v_offer))
         = 'offer_not_open', 'answered once';

  -- Everyone in the booking sees him; the staff roster lists him.
  assert tests.vp_detail((tests.player(v_b.id, 2)).profile_id, v_b.id)
         = jsonb_build_array(jsonb_build_object('name', 'Andreas', 'state', 'accepted')),
    format('a player sees his name only, got %s', tests.vp_detail((tests.player(v_b.id, 2)).profile_id, v_b.id));
  assert tests.vp_detail(v_b.created_by, v_b.id) -> 0 @> jsonb_build_object(
           'id', v_offer, 'name', 'Andreas', 'state', 'accepted', 'can_answer', false, 'can_remove', true),
    format('the booker can remove him, got %s', tests.vp_detail(v_b.created_by, v_b.id));
  assert tests.vp_roster(v_owner, v_b.id) -> 'venue_players' -> 0 @> jsonb_build_object(
           'id', v_offer, 'name', 'Andreas', 'state', 'accepted', 'can_withdraw', true),
    format('the roster, got %s', tests.vp_roster(v_owner, v_b.id));

  -- The booker removes him: he leaves the match, staff are told.
  perform tests.act_as(v_b.created_by);
  assert public.remove_venue_player(v_offer) ->> 'state' = 'removed', 'removed';
  perform tests.act_as_postgres();
  assert (tests.vp_match_row(v_b.id, 'Andreas')).left_at is not null, 'he left the match';
  assert (tests.vp_row(v_offer)).ended_at is not null, 'ended';
  assert tests.notified(v_owner, 'venue_player_removed') = 1, 'staff told';
  assert (tests.last_notification(v_owner, 'venue_player_removed')).body
         = format('%s removed Andreas from %s at 19:00.', public.profile_display_name(v_b.created_by),
                  to_char(v_b.booking_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', (tests.last_notification(v_owner, 'venue_player_removed')).body);
  assert tests.error_as(v_b.created_by, format('select public.remove_venue_player(%L)', v_offer)) = 'offer_not_open',
    'removed once';
  assert tests.vp_detail((tests.player(v_b.id, 2)).profile_id, v_b.id) = '[]'::jsonb, 'players no longer see him';
end $$;

-- 2. The booker declines; staff are told.
do $$
declare
  v_owner uuid := tests.create_user('vp-decline-owner@futty.test');
  v_b public.venue_bookings;
  v_offer uuid;
begin
  v_b := tests.vp_game(v_owner, 'vp-decline', 7);
  v_offer := tests.vp_offer(v_owner, v_b.id, 'Bambos');
  assert tests.vp_detail(v_b.created_by, v_b.id) -> 0 @> jsonb_build_object(
           'id', v_offer, 'name', 'Bambos', 'state', 'offered', 'can_answer', true, 'can_remove', false),
    format('the booker sees the open offer, got %s', tests.vp_detail(v_b.created_by, v_b.id));
  assert tests.vp_detail((tests.player(v_b.id, 1)).profile_id, v_b.id) = '[]'::jsonb,
    'other players don''t see an open offer';

  perform tests.act_as(v_b.created_by);
  assert public.answer_venue_player(v_offer, false) ->> 'state' = 'declined', 'declined';
  perform tests.act_as_postgres();
  assert tests.vp_match_row(v_b.id, 'Bambos') is null or (tests.vp_match_row(v_b.id, 'Bambos')).id is null,
    'not in the match';
  assert tests.notified(v_owner, 'venue_player_declined') = 1, 'staff told once';
  assert (tests.last_notification(v_owner, 'venue_player_declined')).body
         = format('%s declined Bambos for %s at 19:00.', public.profile_display_name(v_b.created_by),
                  to_char(v_b.booking_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', (tests.last_notification(v_owner, 'venue_player_declined')).body);
  assert tests.error_as(v_b.created_by, format('select public.answer_venue_player(%L, true)', v_offer))
         = 'offer_not_open', 'answered once';
  -- A declined offer frees its spot for another offer.
  assert tests.vp_roster(v_owner, v_b.id) ->> 'can_offer_player' = 'true', 'staff can offer again';
end $$;

-- 3. Staff withdraw an accepted player: he leaves the match, the booker is told.
do $$
declare
  v_owner uuid := tests.create_user('vp-withdraw-owner@futty.test');
  v_other_owner uuid := tests.create_user('vp-withdraw-other@futty.test');
  v_b public.venue_bookings;
  v_offer uuid;
  v_open uuid;
begin
  perform tests.create_venue(p_owner => v_other_owner);
  v_b := tests.vp_game(v_owner, 'vp-withdraw', 6);
  v_offer := tests.vp_offer(v_owner, v_b.id, 'Christos');
  perform tests.act_as(v_b.created_by);
  perform public.answer_venue_player(v_offer, true);
  perform tests.act_as_postgres();

  assert tests.error_as(v_other_owner, format('select public.withdraw_venue_player(%L)', v_offer)) = 'not_venue_staff',
    'another venue''s owner';
  assert tests.error_as(v_b.created_by, format('select public.withdraw_venue_player(%L)', v_offer)) = 'not_venue_staff',
    'the booker removes, staff withdraw';

  perform tests.act_as(v_owner);
  assert public.withdraw_venue_player(v_offer) ->> 'state' = 'withdrawn', 'withdrawn';
  perform tests.act_as_postgres();
  assert (tests.vp_match_row(v_b.id, 'Christos')).left_at is not null, 'he left the match';
  assert tests.notified(v_b.created_by, 'venue_player_withdrawn') = 1, 'the booker is told';
  assert (tests.last_notification(v_b.created_by, 'venue_player_withdrawn')).body
         = format('%s withdrew Christos from %s at 19:00.', (select name from public.venues where id = v_b.venue_id),
                  to_char(v_b.booking_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', (tests.last_notification(v_b.created_by, 'venue_player_withdrawn')).body);
  assert tests.error_as(v_owner, format('select public.withdraw_venue_player(%L)', v_offer)) = 'offer_not_open',
    'withdrawn once';

  -- An open offer can be withdrawn too.
  v_open := tests.vp_offer(v_owner, v_b.id, 'Dimos');
  perform tests.act_as(v_owner);
  assert public.withdraw_venue_player(v_open) ->> 'state' = 'withdrawn', 'an open offer withdrawn';
  perform tests.act_as_postgres();
  assert tests.error_as(v_b.created_by, format('select public.answer_venue_player(%L, true)', v_open))
         = 'offer_not_open', 'a withdrawn offer can''t be accepted';
end $$;

-- 4. At kickoff an open offer lapses; nothing can change after kickoff.
do $$
declare
  v_owner uuid := tests.create_user('vp-lapse-owner@futty.test');
  v_b public.venue_bookings;
  v_open uuid;
  v_taken uuid;
begin
  v_b := tests.vp_game(v_owner, 'vp-lapse', 6);
  v_open := tests.vp_offer(v_owner, v_b.id, 'Elias');
  v_taken := tests.vp_offer(v_owner, v_b.id, 'Fotis');
  perform tests.act_as(v_b.created_by);
  perform public.answer_venue_player(v_taken, true);
  perform tests.act_as_postgres();

  perform tests.set_kickoff(v_b.id, now());
  assert tests.error_as(v_b.created_by, format('select public.answer_venue_player(%L, true)', v_open)) = 'offer_closed',
    'too late to answer';
  assert tests.error_as(v_b.created_by, format('select public.remove_venue_player(%L)', v_taken)) = 'booking_started',
    'too late to remove';
  assert tests.error_as(v_owner, format('select public.withdraw_venue_player(%L)', v_taken)) = 'booking_started',
    'too late to withdraw';
  assert tests.error_as(v_owner, format('select public.withdraw_venue_player(%L)', v_open)) = 'offer_closed',
    'a lapsed offer can''t be withdrawn';

  assert (select jsonb_agg(e ->> 'state' order by e ->> 'name') from jsonb_array_elements(
            tests.vp_roster(v_owner, v_b.id) -> 'venue_players') e) = '["lapsed", "accepted"]'::jsonb,
    format('read back as lapsed, got %s', tests.vp_roster(v_owner, v_b.id));
  assert (tests.vp_row(v_open)).status = 'offered', 'no job: lapsed is worked out when read';
  assert tests.vp_roster(v_owner, v_b.id) ->> 'can_offer_player' = 'false', 'no offers after kickoff';
end $$;

-- 5. A cancelled booking: every offer action is refused.
do $$
declare
  v_owner uuid := tests.create_user('vp-cancel-owner@futty.test');
  v_b public.venue_bookings;
  v_open uuid;
begin
  v_b := tests.vp_game(v_owner, 'vp-cancel', 6);
  v_open := tests.vp_offer(v_owner, v_b.id, 'Giorgos');
  update public.venue_bookings set status = 'cancelled' where id = v_b.id;
  assert tests.error_as(v_b.created_by, format('select public.answer_venue_player(%L, true)', v_open))
         = 'booking_cancelled', 'answer';
  assert tests.error_as(v_owner, format('select public.withdraw_venue_player(%L)', v_open)) = 'booking_cancelled',
    'withdraw';
end $$;

-- 6. He takes a spot: app joins stop at capacity minus accepted venue players.
do $$
declare
  v_owner uuid := tests.create_user('vp-spot-owner@futty.test');
  v_b public.venue_bookings;
  v_offer uuid;
  v_late uuid := tests.create_user('vp-spot-late@futty.test');
begin
  v_b := tests.vp_game(v_owner, 'vp-spot', 8);  -- 9 of 10
  v_offer := tests.vp_offer(v_owner, v_b.id, 'Haris');
  -- An open offer doesn't stop a join; it only stops another offer.
  perform tests.act_as(v_b.created_by);
  perform public.answer_venue_player(v_offer, true);
  perform tests.act_as_postgres();

  assert (tests.join_booking(v_b.id, v_late)).id is null, 'the 10th spot is his: no share for a late joiner';

  perform tests.act_as(v_b.created_by);
  perform public.remove_venue_player(v_offer);
  perform tests.act_as_postgres();
  assert (tests.join_booking(v_b.id, v_late)).id is not null, 'removed: the spot is free again';
end $$;

-- 7. The last spot: an accept and a join are both checked against it, under
-- the same lock on the booking row, and exactly one gets it, in either order.
do $$
declare
  v_owner uuid := tests.create_user('vp-race-owner@futty.test');
  v_join_first public.venue_bookings;
  v_accept_first public.venue_bookings;
  v_offer uuid;
  v_joiner uuid;
  v_got_share boolean;
  v_accept_error text;
begin
  -- Join first: the join gets it, the accept is refused.
  v_join_first := tests.vp_game(v_owner, 'vp-race-a', 8);  -- 9 of 10
  v_offer := tests.vp_offer(v_owner, v_join_first.id, 'Ioannis');
  v_joiner := tests.create_user('vp-race-a-joiner@futty.test');
  v_got_share := (tests.join_booking(v_join_first.id, v_joiner)).id is not null;
  v_accept_error := tests.error_as(v_join_first.created_by, format('select public.answer_venue_player(%L, true)', v_offer));
  assert v_got_share and v_accept_error = 'no_empty_spot',
    format('join first: the join gets it (%s), the accept is refused (%s)', v_got_share, v_accept_error);
  assert (tests.vp_row(v_offer)).status = 'offered', 'the offer is untouched';

  -- Accept first: the accept gets it, the join adds nobody.
  v_accept_first := tests.vp_game(v_owner, 'vp-race-b', 8);
  v_offer := tests.vp_offer(v_owner, v_accept_first.id, 'Kostas');
  v_accept_error := tests.error_as(v_accept_first.created_by, format('select public.answer_venue_player(%L, true)', v_offer));
  v_joiner := tests.create_user('vp-race-b-joiner@futty.test');
  v_got_share := (tests.join_booking(v_accept_first.id, v_joiner)).id is not null;
  assert v_accept_error is null and not v_got_share,
    format('accept first: the accept gets it (%s), the join adds nobody (%s)', v_accept_error, v_got_share);
  assert (select count(*) from public.booking_payment_shares where booking_id = v_accept_first.id) = 9, 'still 9 shares';

  -- Both take the same row lock (select ... for update on venue_bookings)
  -- before counting, so two sessions can't both see the spot free.
  assert pg_get_functiondef('public.answer_venue_player(uuid, boolean)'::regprocedure)
         ~ 'from public\.venue_bookings[^;]*where id = [a-z_.]+ for update',
    'answer_venue_player locks the booking row';
  assert pg_get_functiondef('public.add_booking_share_internal(uuid, uuid)'::regprocedure)
         ~ 'from public\.venue_bookings where id = p_booking_id for update',
    'add_booking_share_internal locks the booking row';
end $$;

-- 8. A booking with no match: he's kept in booking_venue_players only and
-- shown from there; a match made later doesn't add him.
do $$
declare
  v_owner uuid := tests.create_user('vp-nomatch-owner@futty.test');
  v_b public.venue_bookings;
  v_offer uuid;
begin
  v_b := tests.vp_game(v_owner, 'vp-nomatch', 7);
  delete from public.matches where booking_id = v_b.id;
  v_offer := tests.vp_offer(v_owner, v_b.id, 'Loizos');
  perform tests.act_as(v_b.created_by);
  assert public.answer_venue_player(v_offer, true) ->> 'state' = 'accepted', 'accepted without a match';
  perform tests.act_as_postgres();

  assert (tests.vp_row(v_offer)).match_player_id is null, 'no match row to link';
  assert tests.vp_detail((tests.player(v_b.id, 1)).profile_id, v_b.id)
         = jsonb_build_array(jsonb_build_object('name', 'Loizos', 'state', 'accepted')),
    'players see him from booking_venue_players';
  assert tests.vp_roster(v_owner, v_b.id) -> 'venue_players' -> 0 @> jsonb_build_object('name', 'Loizos', 'state', 'accepted'),
    'staff see him';
  assert tests.notified(v_owner, 'venue_player_accepted') = 1, 'staff told';

  -- The match sync makes the match later; it isn't copied in.
  perform public.sync_booking_match(v_b.id);
  assert (tests.match_of(v_b.id)).id is not null, 'the match exists now';
  assert (tests.vp_match_row(v_b.id, 'Loizos')).id is null, 'he isn''t added to it';

  -- Removing him still works.
  perform tests.act_as(v_b.created_by);
  assert public.remove_venue_player(v_offer) ->> 'state' = 'removed', 'removed without a match row';
  perform tests.act_as_postgres();
end $$;

rollback;
