-- A11 streaks (match-record decision 1i): cancelled games.
--   * a player cancelling their own spot breaks their streak;
--   * the booker cancelling the whole booking breaks the booker's streak;
--     for the other players that week is an ordinary missed week;
--   * a venue cancellation is forgiven: the week is skipped, neither played
--     nor missed; so is a Gipedo Pano game cancelled for want of an
--     opponent;
--   * a counted match in the same week beats a cancellation.
-- The cancellations go through the real cancellation code on a booking a
-- few days ahead, then the booking is moved to a week in January 2026
-- (Cyprus UTC+2; Mondays 5, 12, 19 and 26 January, 2 and 9 February).
begin;

create function tests.s_play(p_profile uuid, p_kickoff timestamptz)
returns void language plpgsql as $$
declare
  v_match uuid := tests.form_match(p_kickoff, 'confirmed', 1, 0);
begin
  perform tests.form_player(v_match, p_profile, 'a', true, true);
end;
$$;

-- Played the weeks of 5 and 12 January: a streak of 2.
create function tests.s_two_weeks(p_profile uuid)
returns void language sql as $$
  select tests.s_play(p_profile, '2026-01-06 18:00+00');
  select tests.s_play(p_profile, '2026-01-13 18:00+00');
$$;

create function tests.s_streak(p_profile uuid, p_now timestamptz)
returns text language plpgsql as $$
declare
  v text;
begin
  perform tests.act_as_service_role();
  select format('%s/%s', current_weeks, best_weeks) into v from public.player_streak(p_profile, p_now);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- A confirmed booking at a venue of its own owned by p_owner, with p_others
-- players joined (unpaid) and the booker paid.
create function tests.s_booking(p_booker uuid, p_others integer, p_owner uuid default null)
returns public.venue_bookings language plpgsql as $$
declare
  v_venue uuid := tests.create_venue(p_owner => p_owner, p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(p_booker, v_venue, 'each_pays_own_spot', p_others, tests.cyprus_today() + 3,
                                          p_label => 's2');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_s2_' || left(v_booking.id::text, 8));
  return v_booking;
end;
$$;

-- Moves a booking to a day in a test week (its week is its booking_day's).
create function tests.s_move(p_booking uuid, p_day date)
returns void language sql security definer set search_path = '' as $$
  update public.venue_bookings set booking_day = p_day where id = p_booking;
$$;

-- A player cancels their own spot: the week of 19 January breaks the
-- streak. As an ordinary missed week it would have stayed at 2.
do $$
declare
  v_booker uuid := tests.create_user('s2-spot-booker@futty.test');
  v_booking public.venue_bookings := tests.s_booking(v_booker, 1);
  v_player uuid := (tests.player(v_booking.id, 1)).profile_id;
begin
  perform tests.s_two_weeks(v_player);
  perform tests.cancel(v_booking.id, 'my_spot', v_player);
  perform tests.s_move(v_booking.id, '2026-01-21');
  assert tests.s_streak(v_player, '2026-01-21 10:00+00') = '2/2', 'the week in progress is not judged yet';
  assert tests.s_streak(v_player, '2026-01-27 10:00+00') = '0/2', 'my own cancellation breaks it';
  assert tests.s_streak(v_booker, '2026-01-27 10:00+00') = '0/0', 'nothing for the booker, who played nothing';
end $$;

-- The booker cancels the whole booking in the week of 19 January.
do $$
declare
  v_booker uuid := tests.create_user('s2-team-booker@futty.test');
  v_booking public.venue_bookings := tests.s_booking(v_booker, 2);
  v_player uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_played uuid := (tests.player(v_booking.id, 2)).profile_id;
begin
  perform tests.s_two_weeks(v_booker);
  perform tests.s_two_weeks(v_player);
  perform tests.s_two_weeks(v_played);
  perform tests.s_play(v_played, '2026-01-22 18:00+00');
  perform tests.cancel(v_booking.id, 'whole_team', v_booker);
  perform tests.s_move(v_booking.id, '2026-01-21');

  assert tests.s_streak(v_booker, '2026-01-27 10:00+00') = '0/2', 'the booker''s streak is broken';
  assert tests.s_streak(v_player, '2026-01-27 10:00+00') = '2/2', 'another player: an ordinary missed week';
  assert tests.s_streak(v_player, '2026-02-02 10:00+00') = '0/2',
    'it used their one allowed miss: missing 26 January too ends it';
  assert tests.s_streak(v_played, '2026-01-27 10:00+00') = '3/3', 'a player who played another game that week';
end $$;

-- A counted match in the same week beats the player's own cancellation.
do $$
declare
  v_booker uuid := tests.create_user('s2-mixed-booker@futty.test');
  v_booking public.venue_bookings := tests.s_booking(v_booker, 1);
  v_player uuid := (tests.player(v_booking.id, 1)).profile_id;
begin
  perform tests.s_two_weeks(v_player);
  perform tests.cancel(v_booking.id, 'my_spot', v_player);
  perform tests.s_move(v_booking.id, '2026-01-20');
  perform tests.s_play(v_player, '2026-01-23 18:00+00');
  assert tests.s_streak(v_player, '2026-01-27 10:00+00') = '3/3', 'the played game wins';
end $$;

-- The venue cancels: every player's week is forgiven, skipped as if it
-- weren't there.
do $$
declare
  v_owner uuid := tests.create_user('s2-venue-owner@futty.test');
  v_booker uuid := tests.create_user('s2-venue-booker@futty.test');
  v_booking public.venue_bookings;
  v_player uuid;
  v_skip uuid := tests.create_user('s2-venue-skip@futty.test');
  v_booking2 public.venue_bookings;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;
  v_booking := tests.s_booking(v_booker, 1, v_owner);
  v_player := (tests.player(v_booking.id, 1)).profile_id;
  perform tests.s_two_weeks(v_booker);
  perform tests.s_two_weeks(v_player);
  perform tests.cancel(v_booking.id, 'venue', v_owner);
  perform tests.s_move(v_booking.id, '2026-01-21');

  -- 19 January forgiven, 26 January missed: still one miss.
  assert tests.s_streak(v_player, '2026-02-02 10:00+00') = '2/2', 'forgiven for a player';
  assert tests.s_streak(v_booker, '2026-02-02 10:00+00') = '2/2', 'forgiven for the booker';
  -- Forgiving 19 January doesn't protect later weeks: 26 January and
  -- 2 February both missed ends it.
  assert tests.s_streak(v_player, '2026-02-09 10:00+00') = '0/2', 'two real misses still end it';

  -- Missed 19 January, forgiven 26 January, missed 2 February: two misses
  -- in a row, because the forgiven week is skipped.
  v_booking2 := tests.s_booking(v_skip, 0, v_owner);
  perform tests.s_two_weeks(v_skip);
  perform tests.cancel(v_booking2.id, 'venue', v_owner);
  perform tests.s_move(v_booking2.id, '2026-01-28');
  assert tests.s_streak(v_skip, '2026-02-02 10:00+00') = '2/2', 'missed one, forgiven one';
  assert tests.s_streak(v_skip, '2026-02-09 10:00+00') = '0/2', 'missed, forgiven, missed ends it';
end $$;

-- A Gipedo Pano game cancelled for want of an opponent is forgiven too,
-- whether the booker chose to cancel or it was cancelled automatically.
do $$
declare
  v_booker uuid := tests.create_user('s2-gipedo-booker@futty.test');
  v_booking public.venue_bookings := tests.s_booking(v_booker, 1);
  v_player uuid := (tests.player(v_booking.id, 1)).profile_id;
  v_booker2 uuid := tests.create_user('s2-gipedo-booker2@futty.test');
  v_booking2 public.venue_bookings := tests.s_booking(v_booker2, 0);
begin
  perform tests.s_two_weeks(v_booker);
  perform tests.s_two_weeks(v_player);
  perform tests.s_two_weeks(v_booker2);
  perform tests.act_as_service_role();
  update public.venue_bookings set gipedo_choice = 'auto_cancel' where id = v_booking.id;
  perform public.gipedo_cancel_booking(v_booking.id, 'Nobody took it on.');
  update public.venue_bookings set gipedo_choice = 'cancel' where id = v_booking2.id;
  perform public.gipedo_cancel_booking(v_booking2.id, 'Nobody took it on.');
  perform tests.act_as_postgres();
  perform tests.s_move(v_booking.id, '2026-01-21');
  perform tests.s_move(v_booking2.id, '2026-01-21');

  assert tests.s_streak(v_player, '2026-02-02 10:00+00') = '2/2', 'auto-cancelled: forgiven for a player';
  assert tests.s_streak(v_booker, '2026-02-02 10:00+00') = '2/2', 'auto-cancelled: forgiven for the booker';
  assert tests.s_streak(v_booker2, '2026-02-02 10:00+00') = '2/2', 'the booker chose to cancel: forgiven';
end $$;

rollback;
