-- S13B, part 1: Booking v2 sides reach the match. A half pitch whose side B
-- has its own captain is a named game between two captains: side a = the
-- booking's own players with side A's captain, side b = side B's players with
-- side B's captain, labelled with team names when they booked as teams. A
-- whole pitch (or the same captain on both halves) stays a pickup, Bibs v
-- Non-bibs, one captain. €40.00 5-a-side pitch.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

-- A booking p_kind ('whole' or 'half') made 3 days ahead; the booker paid.
create function tests.s13b_setup(p_kind text default 'half', out venue uuid, out booking uuid, out booker uuid,
                                 out friend uuid, out other uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
begin
  booker := tests.create_user('s13b-booker-' || gen_random_uuid() || '@futty.test');
  friend := tests.create_user('s13b-friend-' || gen_random_uuid() || '@futty.test');
  other := tests.create_user('s13b-other-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all', p_kind => p_kind);
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.pay_ago((select id from public.booking_payment_shares where booking_id = booking and profile_id = booker),
                        's13b_a_' || gen_random_uuid(), interval '2 hours');
end;
$$;

-- Side B's captain p_captain accepts an invite (to him, or to p_team) and
-- pays; returns his share.
create function tests.s13b_side_b(p_booking uuid, p_booker uuid, p_captain uuid, p_team uuid default null)
returns uuid
language plpgsql
as $$
declare
  r jsonb;
  v_invite uuid;
begin
  perform tests.act_as(p_booker);
  if p_team is null then
    perform public.invite_opposition(p_booking, array[p_captain]);
  else
    perform public.invite_opposition(p_booking, '{}'::uuid[], array[p_team]);
  end if;
  perform tests.act_as_postgres();
  v_invite := (select id from public.booking_opposition_invites
               where booking_id = p_booking
                 and (invited_profile_id = p_captain or invited_team_id = p_team));
  perform tests.act_as(p_captain);
  r := public.accept_opposition(v_invite, 'pay_all');
  perform tests.act_as_postgres();
  perform tests.pay_ago((r ->> 'share_id')::uuid, 's13b_b_' || gen_random_uuid(), interval '1 hour');
  return (r ->> 'share_id')::uuid;
end;
$$;

-- A player side p_captain invites joins his side.
create function tests.s13b_join(p_booking uuid, p_captain uuid, p_player uuid)
returns void
language plpgsql
as $$
declare
  v_username text;
begin
  update public.profiles set username = coalesce(username, 's13b' || replace(left(p_player::text, 13), '-', ''))
  where id = p_player returning username into v_username;
  perform tests.act_as(p_captain);
  perform public.add_booking_player(p_booking, v_username);
  perform tests.act_as(p_player);
  perform public.accept_invite((select id from public.invites where booking_id = p_booking and invited_profile_id = p_player));
  perform tests.act_as_postgres();
end;
$$;

create function tests.s13b_side(p_booking uuid, p_side text)
returns public.match_sides
language sql
as $$
  select ms.* from public.match_sides ms join public.matches m on m.id = ms.match_id
  where m.booking_id = p_booking and ms.side = p_side;
$$;

-- 1. A whole pitch stays a pickup: Bibs v Non-bibs, the booker the only
--    captain, players choose their side.
do $$
declare
  s record := tests.s13b_setup('whole');
  v_player uuid := tests.create_user('s13b-p-' || gen_random_uuid() || '@futty.test');
begin
  perform tests.s13b_join(s.booking, s.booker, v_player);
  assert (tests.match_of(s.booking)).kind = 'pickup', 'a pickup';
  assert ((tests.s13b_side(s.booking, 'a')).label, (tests.s13b_side(s.booking, 'a')).captain_profile_id)
         = ('Bibs'::text, s.booker), 'Bibs, the booker captain';
  assert ((tests.s13b_side(s.booking, 'b')).label, (tests.s13b_side(s.booking, 'b')).captain_profile_id)
         is not distinct from ('Non-bibs'::text, null::uuid), 'Non-bibs, no captain';
  assert (tests.in_match(s.booking, s.booker)).side = 'a', 'the booker on Bibs';
  assert (tests.in_match(s.booking, v_player)).side is null, 'a player chooses his side';
end $$;

-- 2. A half pitch before side B: a pickup with one captain. Side B accepts
--    and pays: a named game, his captaincy and his side; his players join it.
do $$
declare
  s record := tests.s13b_setup();
  v_a_player uuid := tests.create_user('s13b-ap-' || gen_random_uuid() || '@futty.test');
  v_b_player uuid := tests.create_user('s13b-bp-' || gen_random_uuid() || '@futty.test');
begin
  assert (tests.match_of(s.booking)).kind = 'pickup', 'no opposition yet: a pickup';
  assert (tests.s13b_side(s.booking, 'b')).captain_profile_id is null, 'no side B captain yet';

  perform tests.s13b_side_b(s.booking, s.booker, s.friend);
  assert (tests.match_of(s.booking)).kind = 'named', 'two captains: a named game';
  assert ((tests.s13b_side(s.booking, 'a')).label, (tests.s13b_side(s.booking, 'a')).captain_profile_id)
         = ('Bibs'::text, s.booker), 'side a: Bibs, side A''s captain';
  assert ((tests.s13b_side(s.booking, 'b')).label, (tests.s13b_side(s.booking, 'b')).captain_profile_id)
         = ('Non-bibs'::text, s.friend), 'side b: Non-bibs, side B''s captain';
  assert (tests.in_match(s.booking, s.friend)).side = 'b', 'side B''s captain on side b';

  perform tests.s13b_join(s.booking, s.booker, v_a_player);
  perform tests.s13b_join(s.booking, s.friend, v_b_player);
  assert (tests.in_match(s.booking, v_a_player)).side = 'a', 'side A''s player on side a';
  assert (tests.in_match(s.booking, v_b_player)).side = 'b', 'side B''s player on side b';
  assert public.match_captain_side((tests.match_of(s.booking)).id, s.friend) = 'b', 'the server sees him as side b''s captain';
end $$;

-- 3. A team accepts the opposition invite (a matched opponent): its captain
--    and name on side b; the booker's side keeps "Bibs" with no team.
do $$
declare
  s record := tests.s13b_setup();
  v_name text := 'S13B Rovers ' || gen_random_uuid();
  v_team uuid := tests.create_team(v_name);
begin
  perform tests.join_team(v_team, s.other, 'captain');
  perform tests.s13b_side_b(s.booking, s.booker, s.other, v_team);
  assert ((tests.s13b_side(s.booking, 'b')).label, (tests.s13b_side(s.booking, 'b')).team_id,
          (tests.s13b_side(s.booking, 'b')).captain_profile_id) = (v_name, v_team, s.other),
    'side b: the team''s name, team and captain';
  assert (tests.s13b_side(s.booking, 'a')).label = 'Bibs', 'side a keeps its label';
  assert (tests.in_match(s.booking, s.other)).side = 'b', 'its captain on side b';
end $$;

-- 4. A side B player leaves: he has left the match; side B stays.
do $$
declare
  s record := tests.s13b_setup();
  v_b_player uuid := tests.create_user('s13b-bl-' || gen_random_uuid() || '@futty.test');
begin
  perform tests.s13b_side_b(s.booking, s.booker, s.friend);
  perform tests.s13b_join(s.booking, s.friend, v_b_player);
  assert (tests.in_match(s.booking, v_b_player)).left_at is null, 'in';
  perform tests.cancel(s.booking, 'my_spot', v_b_player);
  assert (tests.in_match(s.booking, v_b_player)).left_at is not null, 'left';
  assert (tests.s13b_side(s.booking, 'b')).captain_profile_id = s.friend, 'side B''s captain stays';
  assert (tests.match_of(s.booking)).kind = 'named', 'still two captains';
end $$;

-- 5. Side B cancels its side before kickoff: back to a pickup with one captain.
do $$
declare
  s record := tests.s13b_setup();
begin
  perform tests.s13b_side_b(s.booking, s.booker, s.friend);
  perform tests.cancel(s.booking, 'whole_team', s.friend);
  assert (tests.match_of(s.booking)).kind = 'pickup', 'a pickup again';
  assert ((tests.s13b_side(s.booking, 'b')).label, (tests.s13b_side(s.booking, 'b')).captain_profile_id)
         is not distinct from ('Non-bibs'::text, null::uuid), 'Non-bibs, no captain';
  assert (tests.in_match(s.booking, s.friend)).left_at is not null, 'side B''s captain has left';
end $$;

-- 6. The same captain on both halves ("Pay the whole pitch and play"): a pickup.
do $$
declare
  s record := tests.s13b_setup();
begin
  insert into public.booking_sides (booking_id, side, captain_id, payment_mode, pitch_cents, players, accepted_at, paid_at)
  values (s.booking, 'b', s.booker, 'pay_all', 2000, 5, now(), now());
  assert (tests.match_of(s.booking)).kind = 'pickup', 'one captain: a pickup';
  assert (tests.s13b_side(s.booking, 'b')).captain_profile_id is null, 'no second captain';
end $$;

-- 7. From kickoff nothing moves: side B leaving late doesn't change the match.
do $$
declare
  s record := tests.s13b_setup();
begin
  perform tests.s13b_side_b(s.booking, s.booker, s.friend);
  update public.matches set kickoff_at = now() - interval '1 minute' where booking_id = s.booking;
  update public.booking_sides set left_at = now() where booking_id = s.booking and side = 'b';
  assert (tests.match_of(s.booking)).kind = 'named', 'unchanged after kickoff';
  assert (tests.s13b_side(s.booking, 'b')).captain_profile_id = s.friend, 'side b''s captain kept';
end $$;

rollback;
