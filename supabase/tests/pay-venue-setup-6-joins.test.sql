-- Venue setup: joining a game booked before a setup change
-- (docs/specs/13-payments-bookings.md "Venue setup", decided 17 November,
-- Dimitris; for Panos to confirm). The venue lowers its price and closes the
-- game's day; players still join through an invite, a "need players" post
-- and a Gipedo Pano opposition offer, at the price the game was booked at.
begin;

-- 1. Invite and "need players" post: booked at €60, repriced to €50, the
-- day closed. Each joiner pays 6000 / 10 = 600 + 80 = 680, not 580.
do $$
declare
  v_owner uuid := tests.create_user('setupjoin-owner@futty.test');
  v_booker uuid := tests.create_user('setupjoin-booker@futty.test', '{"username":"setupjoinbooker"}');
  v_invited uuid := tests.create_user('setupjoin-invited@futty.test', '{"username":"setupjoininvited"}');
  v_joiner uuid := tests.create_user('setupjoin-joiner@futty.test', '{"username":"setupjoinjoiner"}');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 2;
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_invite public.invites;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_post := public.create_squad_post(
    v_venue, (v_day + time '18:00') at time zone 'Asia/Nicosia', '5-a-side', 'players',
    p_players_needed => 3, p_venue_booking_id => v_booking.id);
  perform public.add_booking_player(v_booking.id, 'setupjoininvited');

  -- The owner drops the price to €50 and closes the game's day.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000, null, null, null, null, null, null);
  perform public.add_venue_closure(v_venue, v_day, v_day, 'Works');
  perform tests.act_as_postgres();

  -- From the post.
  perform tests.act_as(v_joiner);
  perform public.join_squad_post(v_post.id);
  perform tests.act_as_postgres();
  perform tests.assert_share(v_booking.id, v_joiner, 600, 680, 'joining from the post on a closed day, at the old price');

  -- By invite.
  perform tests.act_as(v_invited);
  select * into v_invite from public.invites
  where booking_id = v_booking.id and invited_profile_id = v_invited and status = 'pending';
  perform public.accept_invite(v_invite.id);
  perform tests.act_as_postgres();
  perform tests.assert_share(v_booking.id, v_invited, 600, 680, 'joining by invite on a closed day, at the old price');

  assert (select amount_cents from public.venue_bookings where id = v_booking.id) = 6000, 'the booking keeps €60';
end $$;

-- 2. Gipedo Pano: the opposing captain offers after the price drops to €50
-- and the day closes, and gets the same 6550 hold (6000 pitch + 550 fee) the
-- game was booked at, not 5550.
create function tests.sj_team(p_captain uuid, p_name text)
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

do $$
declare
  v_owner uuid := tests.create_user('setupjoin-gp-owner@futty.test');
  v_home uuid := tests.create_user('setupjoin-gp-home@futty.test');
  v_away uuid := tests.create_user('setupjoin-gp-away@futty.test');
  v_home_team uuid := tests.sj_team(v_home, 'Setup Home FC');
  v_away_team uuid := tests.sj_team(v_away, 'Setup Away FC');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 2;
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_home);
  v_booking := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', v_home_team);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_home)).id, 'pi_sj_' || left(v_booking.id::text, 8));
  select * into v_post from public.squad_posts where venue_booking_id = v_booking.id and type = 'opposition';

  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000, null, null, null, null, null, null);
  perform public.add_venue_closure(v_venue, v_day, v_day, 'Works');

  perform tests.act_as(v_away);
  perform public.offer_opposition(v_post.id, v_away_team);
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_away);
  assert v_share.status = 'pending' and v_share.gipedo_side = 'b', 'the offer is taken on a closed day';
  assert v_share.amount_cents = 6550 and v_share.pitch_cents = 6000 and v_share.fee_cents = 550,
    format('the opponent''s hold is at the old price: %s', to_jsonb(v_share));
end $$;

select 'venue setup 6 (joining after a setup change) passed' as result;

rollback;
