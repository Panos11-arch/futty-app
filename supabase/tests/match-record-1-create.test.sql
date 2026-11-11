-- A2 (docs/specs/match-record.md section 6.1): create_match_for_booking,
-- contract 1. One match per booking, re-synced on every call; the roster
-- comes from the shares that hold a spot; after kickoff the roster stays;
-- a cancelled booking voids a match that hasn't ended; a booking back in
-- pending_payment (P4b's undo) leaves the match as it is (decision 1a.2);
-- kickoff and end use booking_kickoff_at (decision 1a.3).
begin;

-- Test-only helpers (this transaction only).
create function tests.mr_booking(p_others integer, p_kickoff timestamptz, p_label text default 'mr')
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booker uuid := tests.create_user(format('%s-booker-%s@futty.test', p_label, left(gen_random_uuid()::text, 8)));
  v_owner uuid := tests.create_user(format('%s-owner-%s@futty.test', p_label, left(gen_random_uuid()::text, 8)));
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_booking public.venue_bookings;
begin
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', p_others, tests.next_weekday(3),
                                          '12:00', '13:00', p_label);
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, p_kickoff);
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id returning * into v_booking;
  return v_booking;
end;
$$;

create function tests.mr_create(p_booking uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.act_as_service_role();
  v_id := public.create_match_for_booking(p_booking);
  perform tests.act_as_postgres();
  return v_id;
end;
$$;

create function tests.mr_create_error(p_booking uuid)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  perform tests.act_as_service_role();
  v_error := tests.error_of(format('select public.create_match_for_booking(%L)', p_booking));
  perform tests.act_as_postgres();
  return v_error;
end;
$$;

do $$
declare
  v_booking public.venue_bookings;
  v_match uuid;
  v_again uuid;
  v_row public.matches;
  v_kickoff timestamptz := date_trunc('minute', now()) + interval '2 days';
  v_count integer;
  v_left integer;
  v_p1 public.booking_payment_shares;
  v_p2 public.booking_payment_shares;
  v_p3 public.booking_payment_shares;
  v_newcomer uuid;
begin
  -- 1. Created once, with the booking's times from booking_kickoff_at.
  v_booking := tests.mr_booking(3, v_kickoff, 'mr1a');
  v_match := tests.mr_create(v_booking.id);
  assert v_match is not null, 'a match is created';
  select * into v_row from public.matches where id = v_match;
  assert v_row.booking_id = v_booking.id, 'linked to the booking';
  assert v_row.venue_id = v_booking.venue_id, 'venue copied';
  assert v_row.kind = 'pickup', 'no friendly: pickup';
  assert v_row.format = '5-a-side', 'format copied';
  assert v_row.players_per_side = 5, format('capacity 10 / 2 = 5, got %s', v_row.players_per_side);
  assert v_row.status = 'scheduled', 'starts scheduled';
  assert v_row.kickoff_at = public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time), 'kickoff from booking_kickoff_at';
  assert v_row.kickoff_at = v_kickoff, 'kickoff is the Cyprus wall-clock time of the booking';
  assert v_row.ends_at = public.booking_kickoff_at(v_booking.booking_day, v_booking.end_time), 'end from booking_kickoff_at';
  assert v_row.result_deadline_at = v_row.ends_at + interval '24 hours', 'result deadline = end + 24 hours';

  -- Sides: Bibs (the booker's, captained by the booker) and Non-bibs.
  assert (select label from public.match_sides where match_id = v_match and side = 'a') = 'Bibs', 'side a is Bibs';
  assert (select label from public.match_sides where match_id = v_match and side = 'b') = 'Non-bibs', 'side b is Non-bibs';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'a') = v_booking.created_by,
    'the booker captains side a';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'b') is null,
    'no captain on Non-bibs';

  -- Roster: every share holding a spot; the booker on side a, the others unsided.
  select count(*) into v_count from public.match_players where match_id = v_match and left_at is null;
  assert v_count = 4, format('4 players (booker + 3), got %s', v_count);
  assert (select side from public.match_players where match_id = v_match and profile_id = v_booking.created_by) = 'a',
    'the booker plays on Bibs';
  assert (select count(*) from public.match_players where match_id = v_match and side is null) = 3,
    'the others pick their side later';
  assert (select count(*) from public.match_players mp join public.booking_payment_shares s on s.id = mp.share_id
          where mp.match_id = v_match) = 4, 'every player keeps the share they came from';
  assert exists (select 1 from public.match_check_in_codes where match_id = v_match), 'a check-in code is made';

  -- 2. A second call returns the same id and re-syncs.
  v_p1 := tests.player(v_booking.id, 1);
  v_p2 := tests.player(v_booking.id, 2);
  v_p3 := tests.player(v_booking.id, 3);
  update public.booking_payment_shares set status = 'cancelled' where id = v_p2.id;
  v_newcomer := tests.create_user('mr1-newcomer@futty.test');
  perform public.add_booking_share_internal(v_booking.id, v_newcomer);
  perform tests.set_kickoff(v_booking.id, v_kickoff + interval '1 hour');
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  v_again := tests.mr_create(v_booking.id);
  assert v_again = v_match, 'same match id the second time';
  assert (select count(*) from public.matches where booking_id = v_booking.id) = 1, 'still one match';
  select * into v_row from public.matches where id = v_match;
  assert v_row.kickoff_at = v_kickoff + interval '1 hour', 'kickoff re-synced';
  assert v_row.result_deadline_at = v_row.ends_at + interval '24 hours', 'deadline re-synced';
  assert (select left_at from public.match_players where match_id = v_match and profile_id = v_p2.profile_id) is not null,
    'a cancelled share''s player gets left_at';
  assert exists (select 1 from public.match_players where match_id = v_match and profile_id = v_newcomer and left_at is null),
    'a new share''s player joins';

  -- Coming back clears left_at.
  update public.booking_payment_shares set status = 'pending' where id = v_p2.id;
  perform tests.mr_create(v_booking.id);
  assert (select left_at from public.match_players where match_id = v_match and profile_id = v_p2.profile_id) is null,
    'a player whose share holds a spot again is back in';

  -- Every holding status counts; refunded / credited / forfeited don't.
  update public.booking_payment_shares set status = 'covered' where id = v_p1.id;
  update public.booking_payment_shares set status = 'refunded' where id = v_p3.id;
  perform tests.mr_create(v_booking.id);
  assert (select left_at from public.match_players where match_id = v_match and profile_id = v_p1.profile_id) is null,
    'covered holds a spot';
  assert (select left_at from public.match_players where match_id = v_match and profile_id = v_p3.profile_id) is not null,
    'refunded doesn''t';
end $$;

-- 3. After kickoff the roster is no longer changed.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(2, date_trunc('minute', now()) + interval '2 days', 'mr1b');
  v_match uuid := tests.mr_create(v_booking.id);
  v_late uuid := tests.create_user('mr1-late@futty.test');
  v_p1 public.booking_payment_shares := tests.player(v_booking.id, 1);
  v_kickoff timestamptz;
begin
  -- The match kicked off ten minutes ago.
  update public.matches set kickoff_at = now() - interval '10 minutes', ends_at = now() + interval '20 minutes',
    result_deadline_at = now() + interval '20 minutes' + interval '24 hours' where id = v_match;
  select kickoff_at into v_kickoff from public.matches where id = v_match;
  perform public.add_booking_share_internal(v_booking.id, v_late);
  update public.booking_payment_shares set status = 'cancelled' where id = v_p1.id;
  assert tests.mr_create(v_booking.id) = v_match, 'same id after kickoff';
  assert not exists (select 1 from public.match_players where match_id = v_match and profile_id = v_late),
    'nobody joins after kickoff';
  assert (select left_at from public.match_players where match_id = v_match and profile_id = v_p1.profile_id) is null,
    'nobody leaves after kickoff';
  assert (select kickoff_at from public.matches where id = v_match) = v_kickoff, 'nothing is re-synced after kickoff';
end $$;

-- 4. A cancelled booking voids a match that hasn't ended, and it stays void.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, date_trunc('minute', now()) + interval '2 days', 'mr1c');
  v_match uuid := tests.mr_create(v_booking.id);
begin
  update public.venue_bookings set status = 'cancelled' where id = v_booking.id;
  assert tests.mr_create(v_booking.id) = v_match, 'same id';
  assert (select status from public.matches where id = v_match) = 'void', 'a cancelled booking voids the match';
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  perform tests.mr_create(v_booking.id);
  assert (select status from public.matches where id = v_match) = 'void', 'void is final';
end $$;

-- A match that has ended isn't voided by a late cancellation; nor is a forfeit.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, now() - interval '3 hours', 'mr1d');
  v_match uuid := tests.mr_create(v_booking.id);
  v_other public.venue_bookings := tests.mr_booking(1, date_trunc('minute', now()) + interval '2 days', 'mr1e');
  v_other_match uuid := tests.mr_create(v_other.id);
begin
  update public.venue_bookings set status = 'cancelled' where id = v_booking.id;
  perform tests.mr_create(v_booking.id);
  assert (select status from public.matches where id = v_match) = 'scheduled', 'an ended match isn''t voided';

  update public.matches set status = 'confirmed', forfeit_side = 'b', forfeit_reason = 'pulled_out',
    confirmed_via = 'forfeit', confirmed_at = now() where id = v_other_match;
  update public.venue_bookings set status = 'cancelled' where id = v_other.id;
  perform tests.mr_create(v_other.id);
  assert (select status from public.matches where id = v_other_match) = 'confirmed', 'a forfeit isn''t voided';
end $$;

-- 5. pending_payment: never confirmed → error; back to pending_payment
-- (P4b's undo) → the match as it is, no error; confirmed again → re-synced.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(2, date_trunc('minute', now()) + interval '2 days', 'mr1f');
  v_match uuid;
  v_before public.matches;
  v_after public.matches;
  v_players_before integer;
  v_new uuid := tests.create_user('mr1-new@futty.test');
  v_pending public.venue_bookings;
begin
  -- A booking still waiting for its first payment. (mr_booking's bookings
  -- are confirmed, so the payment code's trigger has already made their
  -- match: see pay_match_sync.)
  v_pending := tests.booking_with_players(tests.create_user('mr1-pending-booker@futty.test'), tests.create_venue(),
                                          'each_pays_own_spot', 0, tests.next_weekday(3), '12:00', '13:00', 'mr1-pending');
  assert tests.mr_create_error(v_pending.id) = 'booking_not_confirmed', 'never confirmed: booking_not_confirmed';
  assert not exists (select 1 from public.matches where booking_id = v_pending.id), 'no match made';

  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  v_match := tests.mr_create(v_booking.id);
  select * into v_before from public.matches where id = v_match;
  select count(*) into v_players_before from public.match_players where match_id = v_match and left_at is null;

  -- The booker's payment is undone: the booking is pending_payment again.
  update public.venue_bookings set status = 'pending_payment', payment_window_started_at = now() where id = v_booking.id;
  perform public.add_booking_share_internal(v_booking.id, v_new);
  perform tests.set_kickoff(v_booking.id, v_before.kickoff_at + interval '30 minutes');
  assert tests.mr_create_error(v_booking.id) is null, 'no error while pending_payment again';
  assert tests.mr_create(v_booking.id) = v_match, 'same id';
  select * into v_after from public.matches where id = v_match;
  assert v_after.status = 'scheduled' and v_after.kickoff_at = v_before.kickoff_at and v_after.updated_at = v_before.updated_at,
    'the match is left as it is';
  assert (select count(*) from public.match_players where match_id = v_match and left_at is null) = v_players_before,
    'the roster is left as it is';

  -- Confirmed again: re-synced.
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  perform tests.mr_create(v_booking.id);
  assert (select kickoff_at from public.matches where id = v_match) = v_before.kickoff_at + interval '30 minutes',
    're-synced once confirmed again';
  assert exists (select 1 from public.match_players where match_id = v_match and profile_id = v_new), 'new player synced';

  -- Or cancelled: voided.
  update public.venue_bookings set status = 'pending_payment' where id = v_booking.id;
  perform tests.mr_create(v_booking.id);
  update public.venue_bookings set status = 'cancelled' where id = v_booking.id;
  perform tests.mr_create(v_booking.id);
  assert (select status from public.matches where id = v_match) = 'void', 'cancelled after the undo: void';
end $$;

-- 6. Errors and grants.
do $$
declare
  v_owner uuid := tests.create_user('mr1-block-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_block uuid;
  v_booking public.venue_bookings := tests.mr_booking(1, date_trunc('minute', now()) + interval '2 days', 'mr1g');
  v_error text;
begin
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status,
                                     created_by, booking_type)
  values (v_venue, tests.next_weekday(4), '10:00', '11:00', 1, 10, '5-a-side', 'confirmed', v_owner, 'owner_block')
  returning id into v_block;
  assert tests.mr_create_error(v_block) = 'not_a_game', 'an owner block isn''t a game';
  assert tests.mr_create_error(gen_random_uuid()) = 'booking_not_found', 'unknown booking';

  perform tests.act_as(v_booking.created_by);
  v_error := tests.error_of(format('select public.create_match_for_booking(%L)', v_booking.id));
  perform tests.act_as_postgres();
  assert v_error like 'permission denied%', format('the app can''t call it, got %s', v_error);
end $$;

-- 7. Named game: a booking whose squad post led to a friendly match.
do $$
declare
  v_booker uuid := tests.create_user('mr1-named-booker@futty.test');
  v_home_captain uuid := tests.create_user('mr1-home-captain@futty.test');
  v_away_captain uuid := tests.create_user('mr1-away-captain@futty.test');
  v_away_player uuid := tests.create_user('mr1-away-player@futty.test');
  v_home uuid;
  v_away uuid;
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings;
  v_post uuid;
  v_friendly uuid;
  v_match uuid;
  v_row public.matches;
begin
  insert into public.teams (name) values ('Home FC') returning id into v_home;
  insert into public.teams (name) values ('Away FC') returning id into v_away;
  insert into public.team_members (team_id, profile_id, role) values
    (v_home, v_booker, 'player'), (v_home, v_home_captain, 'captain'),
    (v_away, v_away_captain, 'captain'), (v_away, v_away_player, 'player');

  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.next_weekday(5));
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed', team_id = v_home where id = v_booking.id;
  perform public.add_booking_share_internal(v_booking.id, v_away_player);

  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id)
  values ('opposition', v_home, v_venue, v_booking.id, v_booker, v_away) returning id into v_post;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id)
  values (v_post, v_home, v_away) returning id into v_friendly;

  v_match := tests.mr_create(v_booking.id);
  select * into v_row from public.matches where id = v_match;
  assert v_row.kind = 'named', 'a friendly makes a named game';
  assert v_row.friendly_match_id = v_friendly, 'linked to the friendly';
  assert v_row.league_fixture_id is null, 'no league fixture link yet';
  assert (select team_id from public.match_sides where match_id = v_match and side = 'a') = v_home, 'the booker''s team is side a';
  assert (select label from public.match_sides where match_id = v_match and side = 'a') = 'Home FC', 'labelled with the team name';
  assert (select team_id from public.match_sides where match_id = v_match and side = 'b') = v_away, 'the other team is side b';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'a') = v_booker,
    'the booker captains their own side';
  assert (select captain_profile_id from public.match_sides where match_id = v_match and side = 'b') = v_away_captain,
    'a team captain captains side b';
  assert (select side from public.match_players where match_id = v_match and profile_id = v_away_player) = 'b',
    'a member of side b''s team plays on side b';
  assert (select side from public.match_players where match_id = v_match and profile_id = v_booker) = 'a',
    'the booker plays on side a';
end $$;

select 'match record 1 (create_match_for_booking) passed' as result;

rollback;
