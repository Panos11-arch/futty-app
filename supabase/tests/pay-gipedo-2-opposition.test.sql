-- P8 (Gap A): offering to be the opposition creates the friendly match, so
-- the booking's match gets its second team and captain; on a Gipedo Pano
-- booking the offering captain also gets their hold (6550 on a EUR 60
-- 5 v 5, 6495 for a Premium captain), to place within 15 minutes. A
-- withdrawn or lapsed offer reopens the post; the post closes 24 hours
-- before kickoff.
begin;

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

-- A Gipedo Pano booking whose captain's hold is placed.
create function tests.gp_held(p_captain uuid, p_team uuid, p_venue uuid, p_day date default null)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
begin
  perform tests.act_as(p_captain);
  v_booking := public.book_slot(p_venue, coalesce(p_day, tests.cyprus_today() + 2), '12:00', '13:00', 1, '5-a-side', 5,
                                'gipedo_pano', p_team);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, p_captain)).id, 'pi_a_' || left(v_booking.id::text, 8));
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  return v_booking;
end;
$$;

create function tests.gp_post(p_booking uuid)
returns public.squad_posts
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.squad_posts where venue_booking_id = p_booking and type = 'opposition';
$$;

create function tests.gp_offer(p_captain uuid, p_booking uuid, p_team uuid)
returns void
language plpgsql
as $$
begin
  perform tests.act_as(p_captain);
  perform public.offer_opposition((tests.gp_post(p_booking)).id, p_team);
  perform tests.act_as_postgres();
end;
$$;

-- 1. An offer: the opponent's hold, the friendly, a named match.
do $$
declare
  v_home uuid := tests.create_user('gp2-home@futty.test');
  v_away uuid := tests.create_user('gp2-away@futty.test');
  v_home_team uuid := tests.gp_team(v_home, 'Home FC');
  v_away_team uuid := tests.gp_team(v_away, 'Away FC');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_plan jsonb;
  v_match public.matches;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.gp_held(v_home, v_home_team, v_venue);
  assert (tests.match_of(v_booking.id)).kind = 'pickup', 'a match waiting for an opponent';

  perform tests.gp_offer(v_away, v_booking.id, v_away_team);
  v_share := tests.share_of(v_booking.id, v_away);
  assert v_share.gipedo_side = 'b' and v_share.status = 'pending' and not v_share.is_booker, 'the opponent''s hold share';
  assert v_share.amount_cents = 6550 and v_share.pitch_cents = 6000 and v_share.fee_cents = 550, 'the same 6550 hold';
  assert (tests.gp_post(v_booking.id)).status = 'matched' and (tests.gp_post(v_booking.id)).matched_team_id = v_away_team,
    'the post is matched';
  assert exists (select 1 from public.friendly_matches fm
                 where fm.squad_post_id = (tests.gp_post(v_booking.id)).id and fm.home_team_id = v_home_team
                   and fm.away_team_id = v_away_team and fm.status = 'pending_score'), 'the friendly is created';

  v_match := tests.match_of(v_booking.id);
  assert v_match.kind = 'named' and v_match.friendly_match_id is not null, 'the match is named';
  assert (select team_id from public.match_sides where match_id = v_match.id and side = 'a') = v_home_team, 'side a is the booking team';
  assert (select team_id from public.match_sides where match_id = v_match.id and side = 'b') = v_away_team, 'side b the opponent';
  assert (select captain_profile_id from public.match_sides where match_id = v_match.id and side = 'b') = v_away,
    'with its captain';
  assert (tests.in_match(v_booking.id, v_away)).side = 'b', 'the opponent captain plays on side b';

  v_plan := public.plan_share_payment(v_share.id, v_away, 'card', false);
  assert (v_plan ->> 'amount_cents')::int = 6550 and v_plan ->> 'capture_method' = 'manual', 'held for 6550';
  perform tests.hold_share(v_share.id, 'pi_gp2_away');
  v_share := tests.share_of(v_booking.id, v_away);
  assert v_share.status = 'authorized' and v_share.capture_due_at is null, 'held, never taken at +60 minutes';

  assert tests.error_as(v_away, format('select public.cancel_opposition_offer(%L)', (tests.gp_post(v_booking.id)).id))
    = 'use_gipedo_pull_out', 'once held, the opponent pulls out instead';
  assert tests.error_as(v_home, format('select public.cancel_opposition_match(%L)', (tests.gp_post(v_booking.id)).id))
    = 'use_gipedo_pull_out', 'and so does the booking team';
end $$;

-- 2. A Premium opponent; refusals.
do $$
declare
  v_home uuid := tests.create_user('gp2-refuse-home@futty.test');
  v_away uuid := tests.create_user('gp2-refuse-away@futty.test');
  v_player uuid := tests.create_user('gp2-refuse-player@futty.test');
  v_home_team uuid := tests.gp_team(v_home, 'Refuse Home');
  v_away_team uuid := tests.gp_team(v_away, 'Refuse Away');
  v_player_team uuid := tests.gp_team(v_player, 'Refuse Player');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_booking public.venue_bookings;
  v_late public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_away);
  v_booking := tests.gp_held(v_home, v_home_team, v_venue);

  -- Someone already playing in the booking can't also be the opponent.
  perform tests.join_booking(v_booking.id, v_player);
  assert tests.error_as(v_player, format('select public.offer_opposition(%L, %L)', (tests.gp_post(v_booking.id)).id, v_player_team))
    = 'already_in_booking', 'a player in the booking can''t be the opponent';

  perform tests.gp_offer(v_away, v_booking.id, v_away_team);
  assert (tests.share_of(v_booking.id, v_away)).amount_cents = 6495, 'a Premium opponent''s hold is 6495';

  -- The post closes 24 hours before kickoff.
  v_late := tests.gp_held(v_home, v_home_team, v_venue, tests.cyprus_today() + 3);
  perform tests.set_kickoff(v_late.id, now() + interval '23 hours');
  assert tests.error_as(v_player, format('select public.offer_opposition(%L, %L)', (tests.gp_post(v_late.id)).id, v_player_team))
    = 'post_closed', 'no offers less than 24 hours before kickoff';
end $$;

-- 3. Withdrawn before the hold, and lapsed after 15 minutes.
do $$
declare
  v_home uuid := tests.create_user('gp2-lapse-home@futty.test');
  v_away uuid := tests.create_user('gp2-lapse-away@futty.test');
  v_other uuid := tests.create_user('gp2-lapse-other@futty.test');
  v_home_team uuid := tests.gp_team(v_home, 'Lapse Home');
  v_away_team uuid := tests.gp_team(v_away, 'Lapse Away');
  v_other_team uuid := tests.gp_team(v_other, 'Lapse Other');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.gp_held(v_home, v_home_team, v_venue);

  perform tests.gp_offer(v_away, v_booking.id, v_away_team);
  assert tests.error_as(v_home, format('select public.cancel_opposition_offer(%L)', (tests.gp_post(v_booking.id)).id))
    = 'not_captain', 'only the offering captain withdraws';
  perform tests.act_as(v_away);
  perform public.cancel_opposition_offer((tests.gp_post(v_booking.id)).id);
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_away)).status = 'cancelled', 'the hold share is cancelled';
  assert (tests.gp_post(v_booking.id)).status = 'open' and (tests.gp_post(v_booking.id)).matched_team_id is null, 'the post reopens';
  assert not exists (select 1 from public.friendly_matches where squad_post_id = (tests.gp_post(v_booking.id)).id
                     and status <> 'cancelled'), 'the friendly is cancelled';
  assert (tests.match_of(v_booking.id)).kind = 'pickup', 'the match waits for an opponent again';
  assert (select team_id from public.match_sides where match_id = (tests.match_of(v_booking.id)).id and side = 'b') is null,
    'side b is empty';
  assert tests.notified(v_home, 'gipedo_opponent_left') = 1, 'the booking captain is told';

  -- The same captain can offer again; then 15 minutes pass with no hold.
  perform tests.gp_offer(v_away, v_booking.id, v_away_team);
  v_share := tests.share_of(v_booking.id, v_away);
  assert v_share.status = 'pending' and v_share.amount_cents = 6550, 'offered again';
  update public.booking_payment_shares set created_at = now() - interval '16 minutes' where id = v_share.id;
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false) $q$, v_share.id, v_away))
    = 'payment_window_closed', 'too late to place the hold';
  assert public.gipedo_lapse_offers() = 1, 'the offer lapses';
  assert public.gipedo_lapse_offers() = 0, 'once';
  assert (tests.gp_post(v_booking.id)).status = 'open', 'the post is open again';
  assert tests.notified(v_home, 'gipedo_opponent_left') = 2, 'and the captain told again';

  -- Another team can now take it on.
  perform tests.gp_offer(v_other, v_booking.id, v_other_team);
  assert (select team_id from public.match_sides where match_id = (tests.match_of(v_booking.id)).id and side = 'b') = v_other_team,
    'a new opponent names the match again';
end $$;

-- 4. Gap A on an ordinary booking: the friendly is created and cancelled,
-- never deleted, and the match follows.
do $$
declare
  v_home uuid := tests.create_user('gp2-plain-home@futty.test');
  v_away uuid := tests.create_user('gp2-plain-away@futty.test');
  v_home_team uuid := tests.gp_team(v_home, 'Plain Home');
  v_away_team uuid := tests.gp_team(v_away, 'Plain Away');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_post public.squad_posts;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_home, v_venue, 'pay_all', 0, tests.cyprus_today() + 2);
  perform tests.hold_share((tests.share_of(v_booking.id, v_home)).id, 'pi_gp2_plain');
  perform tests.act_as(v_home);
  v_post := public.create_squad_post(v_venue, null, '5-a-side', 'opposition', null, v_home_team, null, v_booking.id);
  perform tests.act_as(v_away);
  perform public.offer_opposition(v_post.id, v_away_team);
  perform tests.act_as_postgres();

  assert exists (select 1 from public.friendly_matches where squad_post_id = v_post.id and away_team_id = v_away_team),
    'the friendly is created';
  assert (tests.match_of(v_booking.id)).kind = 'named', 'the match is named';
  assert (tests.share_of(v_booking.id, v_away)).id is null, 'no hold outside Gipedo Pano';

  perform tests.act_as(v_away);
  perform public.cancel_opposition_offer(v_post.id);
  perform tests.act_as_postgres();
  assert (select status from public.friendly_matches where squad_post_id = v_post.id) = 'cancelled', 'cancelled, not deleted';
  assert (tests.match_of(v_booking.id)).kind = 'pickup', 'the match is a pickup again';
end $$;

-- 5. Security.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.booking_match_drop_friendly(uuid)', 'public.gipedo_withdraw_offer(uuid, text)',
                              'public.gipedo_lapse_offers()'] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute'), format('%s is internal', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('%s is internal (anon)', v_fn);
  end loop;
  assert not has_function_privilege('anon', 'public.offer_opposition(uuid, uuid)', 'execute'), 'anon can''t offer';
end $$;

select 'pay gipedo 2 (opposition) passed' as result;

rollback;
