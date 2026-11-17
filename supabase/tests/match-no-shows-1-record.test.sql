-- P6e no-shows (docs/specs/13-payments-bookings.md "No-shows"; match-record.md
-- section 4.4, question 9 closed 17 November by Anghelo):
--   a no-show is a player who held a spot in the booking (share pending,
--   authorized, paid or covered; match_players.left_at null) with no
--   match_attendance row. A side b squad member without a spot, a guest and
--   a venue-offered player (a guest) never count; a void match has none.
--   From 1 hour after the end (QR check-in closed) the player "didn't check
--   in" (missing); the record is final at result_deadline_at (no_show), when
--   captain_mark_attendance closes too.
--   Staff read it on the booking's roster (each player's state and their
--   no-show count at this venue) and on the customer page.
begin;

-- A confirmed each-pays booking at p_venue with p_others players and its match.
create function tests.ns_game(p_venue uuid, p_others integer, p_day date, p_label text)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
begin
  v_booking := tests.booking_with_players(tests.create_user(format('%s-booker@futty.test', p_label)), p_venue,
                                          'each_pays_own_spot', p_others, p_day, '12:00', '13:00', p_label);
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id returning * into v_booking;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  return v_booking;
end;
$$;

-- Moves a match (tests only): kickoff, end, and the deadline 24 hours after the end.
create function tests.ns_times(p_match uuid, p_kickoff timestamptz, p_ends timestamptz)
returns void
language sql
as $$
  update public.matches set kickoff_at = p_kickoff, ends_at = p_ends, result_deadline_at = p_ends + interval '24 hours'
  where id = p_match;
$$;

create function tests.ns_state(p_match uuid, p_profile uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select public.match_attendance_state(p_match, p_profile);
$$;

-- 1. Who counts: spot holders without a check-in, nobody else.
do $$
declare
  v_owner uuid := tests.create_user('ns1-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_b public.venue_bookings := tests.ns_game(v_venue, 5, tests.next_weekday(3), 'ns1');
  v_m uuid := (tests.match_of(v_b.id)).id;
  v_booker uuid := v_b.created_by;
  v_captained uuid := (tests.player(v_b.id, 1)).profile_id;
  v_paid uuid := (tests.player(v_b.id, 2)).profile_id;
  v_left uuid := (tests.player(v_b.id, 3)).profile_id;
  v_credited uuid := (tests.player(v_b.id, 4)).profile_id;
  v_cash uuid := (tests.player(v_b.id, 5)).profile_id;
  v_squad uuid := tests.create_user('ns1-squad@futty.test');
  v_stranger uuid := tests.create_user('ns1-stranger@futty.test');
  v_void public.venue_bookings := tests.ns_game(v_venue, 1, tests.next_weekday(4), 'ns1v');
  v_void_m uuid := (tests.match_of(v_void.id)).id;
begin
  perform tests.pay_ago((tests.player(v_b.id, 2)).id, 'pi_ns1_paid');
  -- Left before kickoff with credit (the re-sync sets left_at).
  update public.booking_payment_shares set status = 'credited' where id = (tests.player(v_b.id, 3)).id;
  update public.match_players set left_at = now() where match_id = v_m and profile_id = v_left;
  -- A share that stopped holding a spot, even if left_at wasn't set yet.
  update public.booking_payment_shares set status = 'forfeited' where id = (tests.player(v_b.id, 4)).id;
  -- A side b squad member without a spot, and a guest (as a venue-offered player is).
  insert into public.match_players (match_id, profile_id, side) values (v_m, v_squad, 'b');
  perform tests.guest_player(v_m, 'a', 'Andreas');

  insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
  values (v_m, v_booker, 'qr', v_booker), (v_m, v_captained, 'captain', v_booker);

  -- After the deadline (the end was 25 hours ago).
  perform tests.ns_times(v_m, now() - interval '26 hours', now() - interval '25 hours');
  assert tests.ns_state(v_m, v_booker) = 'checked_in', 'QR check-in';
  assert tests.ns_state(v_m, v_captained) = 'checked_in', 'ticked by the captain';
  assert tests.ns_state(v_m, v_paid) = 'no_show', 'a paid spot holder who didn''t check in';
  assert tests.ns_state(v_m, v_cash) = 'no_show', 'an unpaid (pending) spot holder still counts';
  assert tests.ns_state(v_m, v_left) is null, 'left before kickoff';
  assert tests.ns_state(v_m, v_credited) is null, 'a share that no longer holds a spot';
  assert tests.ns_state(v_m, v_squad) is null, 'a squad member without a spot never counts';
  assert tests.ns_state(v_m, v_stranger) is null, 'not in the match';

  -- A void match has no no-shows.
  perform tests.ns_times(v_void_m, now() - interval '26 hours', now() - interval '25 hours');
  update public.matches set status = 'void' where id = v_void_m;
  assert tests.ns_state(v_void_m, (tests.player(v_void.id, 1)).profile_id) is null, 'void match';
end $$;

-- 2. When: not yet, then missing from 1 hour after the end, final at the deadline.
do $$
declare
  v_owner uuid := tests.create_user('ns2-owner@futty.test');
  v_b public.venue_bookings := tests.ns_game(tests.create_venue(p_owner => v_owner), 2, tests.next_weekday(3), 'ns2');
  v_m uuid := (tests.match_of(v_b.id)).id;
  v_p uuid := (tests.player(v_b.id, 1)).profile_id;
begin
  perform tests.ns_times(v_m, now() + interval '30 minutes', now() + interval '90 minutes');
  assert tests.ns_state(v_m, v_p) = 'not_yet', 'before kickoff';
  perform tests.ns_times(v_m, now() - interval '2 hours', now() - interval '1 hour' + interval '1 second');
  assert tests.ns_state(v_m, v_p) = 'not_yet', 'QR check-in still open';
  perform tests.ns_times(v_m, now() - interval '2 hours', now() - interval '1 hour');
  assert tests.ns_state(v_m, v_p) = 'missing', 'QR closed exactly 1 hour after the end';
  -- The deadline is 1 second away: still missing (the captain can still tick).
  perform tests.ns_times(v_m, now() - interval '25 hours', now() - interval '24 hours' + interval '1 second');
  assert tests.ns_state(v_m, v_p) = 'missing', 'before the deadline';
  -- Exactly at the deadline counts as past it.
  perform tests.ns_times(v_m, now() - interval '25 hours', now() - interval '24 hours');
  assert tests.ns_state(v_m, v_p) = 'no_show', 'final at the deadline';
  -- A captain's tick before the deadline clears it.
  perform tests.ns_times(v_m, now() - interval '3 hours', now() - interval '2 hours');
  update public.match_players set side = 'a' where match_id = v_m and profile_id = v_p;
  perform tests.act_as(v_b.created_by);
  perform public.captain_mark_attendance(v_m, array[v_p]);
  perform tests.act_as_postgres();
  perform tests.ns_times(v_m, now() - interval '26 hours', now() - interval '25 hours');
  assert tests.ns_state(v_m, v_p) = 'checked_in', 'ticked in time';
end $$;

-- 3. What staff read: the roster and the customer page; counts per venue.
do $$
declare
  v_owner uuid := tests.create_user('ns3-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_other_venue uuid := tests.create_venue(p_owner => tests.create_user('ns3-other-owner@futty.test'));
  v_b1 public.venue_bookings := tests.ns_game(v_venue, 2, tests.next_weekday(3), 'ns3a');
  v_b2 public.venue_bookings := tests.ns_game(v_venue, 1, tests.next_weekday(4), 'ns3b');
  v_b3 public.venue_bookings := tests.ns_game(v_other_venue, 1, tests.next_weekday(5), 'ns3c');
  v_p uuid := (tests.player(v_b1.id, 1)).profile_id;
  v_in uuid := (tests.player(v_b1.id, 2)).profile_id;
  v_roster jsonb;
  v_row jsonb;
  v_customer jsonb;
begin
  -- v_p also plays in b2 (same venue) and b3 (another venue).
  perform public.add_booking_share_internal(v_b2.id, v_p);
  perform public.add_booking_share_internal(v_b3.id, v_p);
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_b2.id);
  perform public.create_match_for_booking(v_b3.id);
  perform tests.act_as_postgres();
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
  values ((tests.match_of(v_b1.id)).id, v_in, 'qr', v_in);

  perform tests.ns_times((tests.match_of(v_b1.id)).id, now() - interval '26 hours', now() - interval '25 hours');
  perform tests.ns_times((tests.match_of(v_b2.id)).id, now() - interval '50 hours', now() - interval '49 hours');
  perform tests.ns_times((tests.match_of(v_b3.id)).id, now() - interval '50 hours', now() - interval '49 hours');

  perform tests.act_as(v_owner);
  v_roster := public.venue_booking_roster(v_b1.id);
  v_customer := public.venue_customer(v_venue, 'player', v_p);
  perform tests.act_as_postgres();

  select e into v_row from jsonb_array_elements(v_roster -> 'players') e where e ->> 'profile_id' = v_p::text;
  assert v_row ->> 'attendance' = 'no_show' and not (v_row ->> 'checked_in')::boolean,
    format('a no-show on the roster, got %s', v_row);
  assert (v_row ->> 'no_show_count')::integer = 2, format('two at this venue, not the other one, got %s', v_row);
  assert v_row -> 'check_in_method' = 'null', 'no method';
  assert not (v_row ->> 'can_mark_arrived')::boolean and not (v_row ->> 'can_unmark_arrived')::boolean,
    'final: staff can''t change it';

  select e into v_row from jsonb_array_elements(v_roster -> 'players') e where e ->> 'profile_id' = v_in::text;
  assert v_row ->> 'attendance' = 'checked_in' and v_row ->> 'check_in_method' = 'qr'
         and (v_row ->> 'checked_in')::boolean and (v_row ->> 'no_show_count')::integer = 0,
    format('checked in by QR, got %s', v_row);

  assert (v_customer ->> 'no_show_count')::integer = 2, format('customer count, got %s', v_customer ->> 'no_show_count');
  assert (select count(*) from jsonb_array_elements(v_customer -> 'bookings') e where (e ->> 'no_show')::boolean) = 2,
    'both bookings marked no-show';
  assert (select bool_and(e ? 'no_show') from jsonb_array_elements(v_customer -> 'bookings') e), 'every booking says';

  -- Before the deadline the roster says "didn't check in" and staff can tick.
  perform tests.ns_times((tests.match_of(v_b1.id)).id, now() - interval '4 hours', now() - interval '3 hours');
  perform tests.act_as(v_owner);
  v_roster := public.venue_booking_roster(v_b1.id);
  perform tests.act_as_postgres();
  select e into v_row from jsonb_array_elements(v_roster -> 'players') e where e ->> 'profile_id' = v_p::text;
  assert v_row ->> 'attendance' = 'missing' and (v_row ->> 'can_mark_arrived')::boolean
         and (v_row ->> 'no_show_count')::integer = 1,
    format('missing, can be ticked, one final no-show so far, got %s', v_row);
end $$;

rollback;
