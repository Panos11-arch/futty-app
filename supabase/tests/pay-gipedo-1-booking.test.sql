-- P8: Gipedo Pano booked at checkout (docs/specs/13-payments-bookings.md,
-- "Gipedo Pano", decisions of 12 and 13 November). Worked examples with
-- their exact amounts:
--   each captain's hold on a EUR 60 5 v 5: 6000 + 10 x 55 = 6550
--   a Premium captain's own spot is fee-free: 6495
--   6 v 6 on a 5-a-side pitch: 6000 + 12 x 55 = 6660
-- Plus: captains only, for their team; kickoff 24 to 120 hours away; card
-- only; the hold is never taken at +60 minutes; the booking is left out of
-- collection; checkout shows it; the old Gipedo Pano never touches it.
begin;

-- A team captained by p_captain.
create function tests.gp_team(p_captain uuid, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_team uuid := tests.create_team(p_name);
begin
  perform tests.join_team(v_team, p_captain, 'captain');
  return v_team;
end;
$$;

-- p_captain books Gipedo Pano for p_team.
create function tests.gp_book(p_captain uuid, p_team uuid, p_venue uuid, p_day date,
                              p_start time default '12:00', p_end time default '13:00')
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
begin
  perform tests.act_as(p_captain);
  v_booking := public.book_slot(p_venue, p_day, p_start, p_end, 1, '5-a-side', 5, 'gipedo_pano', p_team);
  perform tests.act_as_postgres();
  return v_booking;
end;
$$;

-- 1. The window: 24 to 120 hours (5 days) ahead, both ends included.
do $$
declare
  v_now timestamptz := now();
begin
  assert public.gipedo_window_error(v_now + interval '120 hours', v_now) is null, '120 hours ahead is allowed';
  assert public.gipedo_window_error(v_now + interval '120 hours 1 minute', v_now) = 'gipedo_too_far_ahead',
    'more than 120 hours is too far';
  assert public.gipedo_window_error(v_now + interval '24 hours', v_now) is null, '24 hours ahead is allowed';
  assert public.gipedo_window_error(v_now + interval '23 hours 59 minutes', v_now) = 'gipedo_too_soon',
    'less than 24 hours is too soon';
end $$;

-- 2. Booking it: the captain's hold, the team, the amounts.
do $$
declare
  v_captain uuid := tests.create_user('gp1-captain@futty.test');
  v_premium uuid := tests.create_user('gp1-premium@futty.test');
  v_team uuid := tests.gp_team(v_captain, 'Lions');
  v_premium_team uuid := tests.gp_team(v_premium, 'Tigers');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_six uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_six, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_six;
  perform tests.make_premium(v_premium);

  v_booking := tests.gp_book(v_captain, v_team, v_venue, tests.cyprus_today() + 2);
  assert v_booking.payment_mode = 'gipedo_pano', 'the mode is stored';
  assert v_booking.team_id = v_team, 'the booking is for the captain''s team';
  assert v_booking.status = 'pending_payment', 'waiting for the hold';
  assert v_booking.service_fee_cents_per_player = 55, '55 per player';
  v_share := tests.share_of(v_booking.id, v_captain);
  assert v_share.amount_cents = 6550 and v_share.pitch_cents = 6000 and v_share.fee_cents = 550,
    format('the hold is 6000 + 550 = 6550, got %s', v_share.amount_cents);
  assert v_share.gipedo_side = 'a' and v_share.is_booker, 'the booking team''s hold';
  assert not exists (select 1 from public.booking_guarantees where booking_id = v_booking.id), 'no guarantee';

  v_booking := tests.gp_book(v_premium, v_premium_team, v_venue, tests.cyprus_today() + 2, '14:00', '15:00');
  assert (tests.share_of(v_booking.id, v_premium)).amount_cents = 6495, 'a Premium captain''s hold is 6495';

  perform tests.act_as(v_captain);
  v_booking := public.book_slot(v_six, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 6, 'gipedo_pano', v_team);
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_captain)).amount_cents = 6660, '6 v 6: 6000 + 12 x 55 = 6660';
end $$;

-- 3. Refusals: a team, its captain, the window.
do $$
declare
  v_captain uuid := tests.create_user('gp1-refuse-captain@futty.test');
  v_player uuid := tests.create_user('gp1-refuse-player@futty.test');
  v_team uuid := tests.gp_team(v_captain, 'Bears');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 2;
  v_soon record := tests.slot_starting_in('20 hours');
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.join_team(v_team, v_player);

  assert tests.error_as(v_captain, format($q$ select public.book_slot(%L, %L, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano') $q$,
    v_venue, v_day)) = 'team_required', 'a team is required';
  assert tests.error_as(v_player, format($q$ select public.book_slot(%L, %L, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', %L) $q$,
    v_venue, v_day, v_team)) = 'not_captain', 'only the team''s captain';
  assert tests.error_as(v_captain, format($q$ select public.book_slot(%L, %L, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', %L) $q$,
    v_venue, tests.cyprus_today() + 7, v_team)) = 'gipedo_too_far_ahead', 'a week ahead is refused';
  assert tests.error_as(v_captain, format($q$ select public.book_slot(%L, %L, %L, %L, 1, '5-a-side', 5, 'gipedo_pano', %L) $q$,
    v_venue, v_soon.day, v_soon.start_time, v_soon.end_time, v_team)) = 'gipedo_too_soon', 'less than 24 hours is refused';
  assert tests.error_as(v_captain, format($q$ select public.book_slot(%L, %L, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo') $q$,
    v_venue, v_day)) = 'invalid_payment_mode', 'an unknown mode is refused';
  assert not exists (select 1 from public.venue_bookings where venue_id = v_venue), 'nothing was booked';
end $$;

-- 4. Paying the hold: card only, always held, never taken at +60 minutes;
-- the hold confirms the booking and opens its opposition post.
do $$
declare
  v_captain uuid := tests.create_user('gp1-pay-captain@futty.test');
  v_team uuid := tests.gp_team(v_captain, 'Wolves');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_plan jsonb;
  v_post public.squad_posts;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.gp_book(v_captain, v_team, v_venue, tests.cyprus_today() + 2);
  v_share := tests.share_of(v_booking.id, v_captain);

  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'cash', false) $q$, v_share.id, v_captain))
    = 'cash_not_allowed', 'no cash';
  insert into public.venue_credits (profile_id, venue_id, amount_cents, remaining_cents, source, source_booking_id, expires_at)
  values (v_captain, v_venue, 2000, 2000, 'player_cancelled', v_booking.id, now() + interval '1 year');
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false, true) $q$, v_share.id, v_captain))
    = 'credit_not_allowed', 'no venue credit';

  v_plan := public.plan_share_payment(v_share.id, v_captain, 'card', false);
  assert (v_plan ->> 'amount_cents')::int = 6550, 'the card is held for 6550';
  assert v_plan ->> 'capture_method' = 'manual', 'held, not taken';

  perform tests.hold_share(v_share.id, 'pi_gp1_hold');
  v_share := tests.share_of(v_booking.id, v_captain);
  assert v_share.status = 'authorized', 'held';
  assert v_share.capture_due_at is null, 'never due for the +60-minute capture';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the hold confirms the booking';

  update public.booking_payment_shares set held_at = now() - interval '2 hours' where id = v_share.id;
  assert not exists (select 1 from public.shares_due_for_capture() d where d.share_id = v_share.id),
    'not taken an hour later';

  select * into v_post from public.squad_posts where venue_booking_id = v_booking.id;
  assert v_post.type = 'opposition' and v_post.status = 'open' and v_post.team_id = v_team
         and v_post.payment_mode = 'gipedo_pano', 'its "Need opposition" post is open';
  perform public.gipedo_open_post(v_booking.id);
  assert (select count(*) from public.squad_posts where venue_booking_id = v_booking.id) = 1, 'one post only';
end $$;

-- 5. Others who join play covered; collection never runs on it.
do $$
declare
  v_captain uuid := tests.create_user('gp1-join-captain@futty.test');
  v_team uuid := tests.gp_team(v_captain, 'Hawks');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_player uuid := tests.create_user('gp1-join-player@futty.test');
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.gp_book(v_captain, v_team, v_venue, tests.cyprus_today() + 2);
  perform tests.hold_share((tests.share_of(v_booking.id, v_captain)).id, 'pi_gp1_join');
  assert (tests.join_booking(v_booking.id, v_player)).status = 'covered', 'a player who joins plays covered';
  assert (tests.share_of(v_booking.id, v_player)).amount_cents = 0, 'and pays nothing';

  perform tests.end_match(v_booking.id, '3 hours');
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert not public.collection_is_due(v_booking), 'collection never runs on a Gipedo Pano booking';
  assert not exists (select 1 from public.collections_due() c where c.booking_id = v_booking.id), 'not in collections_due';
end $$;

-- 6. Checkout shows it, from the server.
do $$
declare
  v_captain uuid := tests.create_user('gp1-quote-captain@futty.test');
  v_player uuid := tests.create_user('gp1-quote-player@futty.test');
  v_premium uuid := tests.create_user('gp1-quote-premium@futty.test');
  v_team uuid := tests.gp_team(v_captain, 'Eagles');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  q jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.gp_team(v_premium, 'Falcons');
  perform tests.make_premium(v_premium);

  perform tests.act_as(v_captain);
  q := public.booking_quote(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', '5-a-side', 5);
  assert (q -> 'gipedo_pano' ->> 'hold_cents')::int = 6550, format('the hold is 6550, got %s', q -> 'gipedo_pano');
  assert (q -> 'gipedo_pano' ->> 'available')::boolean, 'available to a captain';
  assert q -> 'gipedo_pano' -> 'unavailable_reason' = 'null'::jsonb, 'no reason';
  assert q -> 'captain_teams' = jsonb_build_array(jsonb_build_object('id', v_team, 'name', 'Eagles')), 'their teams';
  assert (q -> 'pay_all' ->> 'card_cents')::int = 6550, 'the other modes are unchanged';

  q := public.booking_quote(v_venue, tests.cyprus_today() + 7, '12:00', '13:00', '5-a-side', 5);
  assert not (q -> 'gipedo_pano' ->> 'available')::boolean
         and q -> 'gipedo_pano' ->> 'unavailable_reason' = 'gipedo_too_far_ahead', 'a week ahead: too far';

  perform tests.act_as(v_player);
  q := public.booking_quote(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', '5-a-side', 5);
  assert q -> 'gipedo_pano' ->> 'unavailable_reason' = 'not_captain', 'not for a player who captains no team';
  assert q -> 'captain_teams' = '[]'::jsonb, 'no teams';

  perform tests.act_as(v_premium);
  q := public.booking_quote(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', '5-a-side', 5);
  assert (q -> 'gipedo_pano' ->> 'hold_cents')::int = 6495, 'a Premium captain''s hold is 6495';
  perform tests.act_as_postgres();
end $$;

-- 7. A captain cancels by pulling out, not with "my spot" or "whole team";
-- the old Gipedo Pano never touches a booking with a payment mode.
do $$
declare
  v_captain uuid := tests.create_user('gp1-cancel-captain@futty.test');
  v_team uuid := tests.gp_team(v_captain, 'Sharks');
  v_away uuid := tests.create_team('Visitors');
  v_owner uuid := tests.create_user('gp1-cancel-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_friendly uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.gp_book(v_captain, v_team, v_venue, tests.cyprus_today() + 2);
  perform tests.hold_share((tests.share_of(v_booking.id, v_captain)).id, 'pi_gp1_cancel');

  assert tests.error_of(format($q$ select public.cancellation_plan(%L, 'whole_team', %L, now()) $q$, v_booking.id, v_captain))
    = 'use_gipedo_pull_out', 'whole team: pull out instead';
  assert tests.error_of(format($q$ select public.cancellation_plan(%L, 'my_spot', %L, now()) $q$, v_booking.id, v_captain))
    = 'use_gipedo_pull_out', 'my spot: pull out instead';
  assert public.cancellation_plan(v_booking.id, 'venue', v_owner, now()) is not null, 'the venue can still cancel';

  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id, status, score_attempts)
  values ((select id from public.squad_posts where venue_booking_id = v_booking.id), v_team, v_away, 'pending_score', 0)
  returning id into v_friendly;
  perform public.record_gipedo_pano_settlement(v_friendly, 'home_wins');
  assert (select payment_settlement from public.friendly_matches where id = v_friendly) is null,
    'the old settlement ignores it';
  update public.friendly_matches set payment_settlement = 'home_wins' where id = v_friendly;
  assert not exists (select 1 from public.gipedo_pano_pending_settlement_shares() p where p.match_id = v_friendly),
    'and the old job never settles it';
end $$;

-- 8. Security.
do $$
declare
  v_player uuid := tests.create_user('gp1-security@futty.test');
  v_fn text;
begin
  foreach v_fn in array array['public.gipedo_window_error(timestamptz, timestamptz)',
                              'public.money_gipedo_half(integer, integer, boolean)',
                              'public.is_team_captain(uuid, uuid)', 'public.gipedo_open_post(uuid)',
                              'public.cancellation_plan_modes(uuid, text, uuid, timestamptz)',
                              'public.booking_quote_modes(uuid, date, time, time, text, integer)'] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute'), format('%s is internal', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('%s is internal (anon)', v_fn);
  end loop;
  assert has_function_privilege('authenticated',
    'public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid)', 'execute'), 'players book';
  assert not has_function_privilege('anon',
    'public.book_slot(uuid, date, time, time, integer, text, integer, text, uuid)', 'execute'), 'anon can''t book';
end $$;

select 'pay gipedo 1 (booking) passed' as result;

rollback;
