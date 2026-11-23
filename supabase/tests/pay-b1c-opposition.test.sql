-- B1c (Booking v2, spec 13 "Invites, after payment"): on a half pitch, side
-- A's captain invites the opposition (friends or teams), the first captain to
-- accept becomes side B's captain (decided on the server), chooses how side B
-- pays and pays or holds his part within 15 minutes, or his acceptance lapses
-- and the invite reopens (decided 23 November). Each captain is the booker of
-- his own half, so side B's captain has his own guarantee and invites his own
-- players. Amounts are B0's worked examples on a €40.00 5-a-side pitch.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.b1c_setup(p_mode text default 'pay_all', out venue uuid, out booking uuid, out booker uuid,
                                 out friend uuid, out other uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
begin
  booker := tests.create_user('b1c-booker-' || gen_random_uuid() || '@futty.test');
  friend := tests.create_user('b1c-friend-' || gen_random_uuid() || '@futty.test');
  other := tests.create_user('b1c-other-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => 'half');
  perform tests.act_as_postgres();
  booking := v.id;
  -- Side A's captain pays (or holds, with a saved card): the booking is confirmed.
  perform tests.hold_share((select id from public.booking_payment_shares where booking_id = booking and profile_id = booker),
                           'pi_b1c_a_' || gen_random_uuid());
end;
$$;

create function tests.b1c_invite(p_booking uuid, p_as uuid, p_profiles uuid[], p_teams uuid[] default '{}')
returns integer
language plpgsql
as $$
declare
  v integer;
begin
  perform tests.act_as(p_as);
  v := public.invite_opposition(p_booking, p_profiles, p_teams);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.b1c_invite_id(p_booking uuid, p_profile uuid default null, p_team uuid default null)
returns uuid
language sql
as $$
  select id from public.booking_opposition_invites
  where booking_id = p_booking
    and (p_profile is null or invited_profile_id = p_profile)
    and (p_team is null or invited_team_id = p_team);
$$;

create function tests.b1c_accept(p_invite uuid, p_as uuid, p_mode text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_as);
  v := public.accept_opposition(p_invite, p_mode);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.b1c_side(p_booking uuid, p_side text)
returns public.booking_sides
language sql
as $$ select * from public.booking_sides where booking_id = p_booking and side = p_side $$;

create function tests.b1c_username(p_profile uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.profiles set username = coalesce(username, 'b1c' || replace(left(p_profile::text, 13), '-', ''))
  where id = p_profile returning username;
$$;

-- 1. Only side A's captain invites, and only on a half pitch that's confirmed.
do $$
declare
  s record := tests.b1c_setup();
  v_whole public.venue_bookings;
begin
  assert tests.error_of(format('select tests.b1c_invite(%L, %L, array[%L]::uuid[])', s.booking, s.friend, s.other))
         = 'not_your_booking', 'a stranger can''t invite';
  perform tests.act_as(s.booker);
  v_whole := public.book_slot(s.venue, tests.cyprus_today() + 4, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all', p_kind => 'whole');
  perform tests.act_as_postgres();
  assert tests.error_of(format('select tests.b1c_invite(%L, %L, array[%L]::uuid[])', v_whole.id, s.booker, s.friend))
         = 'not_half_pitch', 'a whole pitch has no opposition';

  assert tests.b1c_invite(s.booking, s.booker, array[s.friend, s.friend, s.booker]) = 1,
    'one invite: duplicates and the booker himself are skipped';
  assert tests.b1c_invite(s.booking, s.booker, array[s.friend]) = 0, 'inviting again adds nothing';
  assert tests.notified(s.friend, 'opposition_invite') = 1, 'the friend is told';
end $$;

-- 2. What the invited captain sees before accepting: side B's half and its
--    prices (examples 4 and 5): pay for everyone €22.75, pay for myself
--    €4.80 each with a €20.00 guarantee.
do $$
declare
  s record := tests.b1c_setup();
  r record;
begin
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend]);
  perform tests.act_as(s.friend);
  select * into r from public.my_opposition_invites() where booking_id = s.booking;
  perform tests.act_as_postgres();
  assert r.invite_id is not null, 'the friend sees the invite';
  assert (r.side_pitch_cents, r.side_players, r.pay_all_cents, r.each_pays_cents, r.guarantee_cents)
         = (2000, 5, 2275, 480, 2000),
    format('side B prices: %s', row(r.side_pitch_cents, r.side_players, r.pay_all_cents, r.each_pays_cents, r.guarantee_cents));
  assert not r.found, 'no opposition yet';
  assert r.pitch_label = 'Pitch 1', 'the pitch name';
end $$;

-- 3. Accepting: only an invited friend, or an invited team's captain; never
--    someone already in the booking; only the ways to pay side B can use.
do $$
declare
  s record := tests.b1c_setup();
  v_team uuid := tests.create_team('B1c Rovers ' || gen_random_uuid());
  v_member uuid := tests.create_user('b1c-member-' || gen_random_uuid() || '@futty.test');
  v_invite uuid;
  v_team_invite uuid;
begin
  perform tests.join_team(v_team, s.other, 'captain');
  perform tests.join_team(v_team, v_member, 'player');
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend], array[v_team]);
  v_invite := tests.b1c_invite_id(s.booking, s.friend);
  v_team_invite := tests.b1c_invite_id(s.booking, p_team => v_team);
  assert tests.notified(s.other, 'opposition_invite') = 1, 'the team''s captain is told';

  assert tests.error_of(format('select tests.b1c_accept(%L, %L, ''pay_all'')', v_invite, s.other)) = 'not_invited',
    'someone else''s invite';
  assert tests.error_of(format('select tests.b1c_accept(%L, %L, ''pay_all'')', v_team_invite, v_member)) = 'not_captain',
    'a team member who isn''t its captain';
  assert tests.error_of(format('select tests.b1c_accept(%L, %L, ''cash'')', v_invite, s.friend)) = 'cash_whole_pitch_only',
    'cash is whole pitch only';
  assert tests.error_of(format('select tests.b1c_accept(%L, %L, ''each_pays_own_spot'')', v_invite, s.friend))
         = 'just_my_spot_removed', '"Just my spot" is removed';
  assert tests.error_of(format('select tests.b1c_accept(%L, %L, ''gipedo_pano'')', v_invite, s.friend))
         = 'losers_pay_not_available', 'Losers pay comes in B1d';

  -- Already in the booking (a side A player).
  perform public.add_booking_side_share_internal(s.booking, s.friend, 'a');
  assert tests.error_of(format('select tests.b1c_accept(%L, %L, ''pay_all'')', v_invite, s.friend)) = 'already_in_booking',
    'a side A player can''t be side B''s captain';
end $$;

-- 4. Side B pays for everyone: its captain pays €22.75 (example 4). The first
--    to accept wins; everyone else sees "Opposition found".
do $$
declare
  s record := tests.b1c_setup();
  v jsonb;
  v_side public.booking_sides;
  v_share public.booking_payment_shares;
  r record;
begin
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend, s.other]);
  v := tests.b1c_accept(tests.b1c_invite_id(s.booking, s.friend), s.friend, 'pay_all');
  v_side := tests.b1c_side(s.booking, 'b');
  assert (v_side.captain_id, v_side.payment_mode, v_side.pitch_cents, v_side.players) = (s.friend, 'pay_all', 2000, 5),
    format('side B: %s', row(v_side.captain_id, v_side.payment_mode, v_side.pitch_cents, v_side.players));
  assert v_side.accepted_at is not null and v_side.paid_at is null, 'accepted, not paid yet';
  select * into v_share from public.booking_payment_shares where id = (v ->> 'share_id')::uuid;
  assert (v_share.side, v_share.is_booker, v_share.status, v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents)
         = ('b', false, 'pending', 2275, 2000, 275),
    format('side B captain''s share: %s', row(v_share.side, v_share.is_booker, v_share.status, v_share.amount_cents));
  assert (v ->> 'amount_cents')::integer = 2275, 'the amount to pay';
  assert tests.notified(s.booker, 'opposition_found') = 1, 'side A''s captain is told';

  assert tests.error_of(format('select tests.b1c_accept(%L, %L, ''pay_all'')', tests.b1c_invite_id(s.booking, s.other), s.other))
         = 'opposition_found', 'the second captain is too late';
  perform tests.act_as(s.other);
  select * into r from public.my_opposition_invites() where booking_id = s.booking;
  perform tests.act_as_postgres();
  assert r.found, 'and sees "Opposition found"';

  -- He pays: side B is paid.
  perform tests.hold_share(v_share.id, 'pi_b1c_b_' || gen_random_uuid());
  assert (tests.b1c_side(s.booking, 'b')).paid_at is not null, 'side B paid';
  assert (select status from public.booking_payment_shares where id = v_share.id) in ('authorized', 'paid'), 'his share is held';
end $$;

-- 5. Side A pays for everyone, side B pays for myself (example 5): each side
--    B player €4.80; side B's captain is the booker of his half, with his own
--    €20.00 guarantee. With side A paying for myself too, both captains have one.
do $$
declare
  s record := tests.b1c_setup('each_pays_responsible');
  v jsonb;
  v_player uuid := tests.create_user('b1c-bplayer-' || gen_random_uuid() || '@futty.test');
  v_share public.booking_payment_shares;
begin
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend]);
  v := tests.b1c_accept(tests.b1c_invite_id(s.booking, s.friend), s.friend, 'each_pays_responsible');
  assert (v ->> 'amount_cents')::integer = 480, 'his own share €4.80';
  assert (select array_agg(amount_cents order by profile_id = s.booker desc) from public.booking_guarantees
          where booking_id = s.booking) = array[2000, 2000], 'two guarantees, €20.00 each (each side''s half)';
  assert (select status from public.booking_guarantees where booking_id = s.booking and profile_id = s.friend) = 'awaiting_card',
    'side B''s guarantee waits for his card';

  -- He invites his own players only once side B is paid.
  perform tests.act_as(s.friend);
  assert tests.error_of(format('select public.add_booking_player(%L, %L)', s.booking,
                               tests.b1c_username(v_player))) = 'side_not_paid',
    'not before he has paid';
  perform tests.act_as_postgres();
  perform tests.hold_share((v ->> 'share_id')::uuid, 'pi_b1c_b_' || gen_random_uuid());
  assert (select status from public.booking_guarantees where booking_id = s.booking and profile_id = s.friend) = 'scheduled',
    'his card is saved for his guarantee';
  perform tests.act_as(s.friend);
  perform public.add_booking_player(s.booking, tests.b1c_username(v_player));
  perform tests.act_as(v_player);
  perform public.accept_invite((select id from public.invites where booking_id = s.booking and invited_profile_id = v_player));
  perform tests.act_as_postgres();
  select * into v_share from public.booking_payment_shares where booking_id = s.booking and profile_id = v_player;
  assert (v_share.side, v_share.amount_cents, v_share.status) = ('b', 480, 'pending'),
    format('his player joins side B at €4.80: %s', row(v_share.side, v_share.amount_cents, v_share.status));

  -- His guarantee is his to update, not side A's captain's.
  perform tests.act_as_service_role();
  assert (public.guarantee_for_card_update(s.booking, s.friend) ->> 'guarantee_id')::uuid
         = (select id from public.booking_guarantees where booking_id = s.booking and profile_id = s.friend),
    'side B''s captain updates his own guarantee';
  assert (public.guarantee_for_card_update(s.booking, s.booker) ->> 'guarantee_id')::uuid
         = (select id from public.booking_guarantees where booking_id = s.booking and profile_id = s.booker),
    'side A''s captain his';
  perform tests.act_as_postgres();
end $$;

-- 6. Side B pays for everyone: a player he invites joins covered (nothing to pay).
do $$
declare
  s record := tests.b1c_setup();
  v jsonb;
  v_player uuid := tests.create_user('b1c-covered-' || gen_random_uuid() || '@futty.test');
begin
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend]);
  v := tests.b1c_accept(tests.b1c_invite_id(s.booking, s.friend), s.friend, 'pay_all');
  perform tests.hold_share((v ->> 'share_id')::uuid, 'pi_b1c_b_' || gen_random_uuid());
  perform tests.act_as(s.friend);
  perform public.add_booking_player(s.booking, tests.b1c_username(v_player));
  perform tests.act_as(v_player);
  perform public.accept_invite((select id from public.invites where booking_id = s.booking and invited_profile_id = v_player));
  perform tests.act_as_postgres();
  assert (select (side, status) from public.booking_payment_shares where booking_id = s.booking and profile_id = v_player)
         = ('b'::text, 'covered'::text), 'covered on side B';
end $$;

-- 7. Not paid within 15 minutes: his acceptance lapses, his share and
--    guarantee are cancelled, and the invite reopens for the others.
do $$
declare
  s record := tests.b1c_setup();
  v jsonb;
begin
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend, s.other]);
  v := tests.b1c_accept(tests.b1c_invite_id(s.booking, s.friend), s.friend, 'each_pays_responsible');
  update public.booking_sides set accepted_at = now() - interval '14 minutes' where booking_id = s.booking and side = 'b';
  assert public.booking_side_b_lapse_due() = 0, 'not before 15 minutes';
  update public.booking_sides set accepted_at = now() - interval '16 minutes' where booking_id = s.booking and side = 'b';
  assert public.booking_side_b_lapse_due() = 1, 'lapses after 15 minutes';
  assert (tests.b1c_side(s.booking, 'b')).booking_id is null, 'side B is free again';
  assert (select status from public.booking_payment_shares where id = (v ->> 'share_id')::uuid) = 'cancelled', 'share cancelled';
  assert (select status from public.booking_guarantees where booking_id = s.booking and profile_id = s.friend) = 'cancelled',
    'guarantee cancelled';
  assert tests.notified(s.booker, 'opposition_lapsed') = 1, 'side A''s captain is told';
  assert public.booking_side_b_lapse_due() = 0, 'once';
  perform tests.b1c_accept(tests.b1c_invite_id(s.booking, s.other), s.other, 'pay_all');
  assert (tests.b1c_side(s.booking, 'b')).captain_id = s.other, 'another captain can accept';
end $$;

-- 8. A paid side B never lapses.
do $$
declare
  s record := tests.b1c_setup();
  v jsonb;
begin
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend]);
  v := tests.b1c_accept(tests.b1c_invite_id(s.booking, s.friend), s.friend, 'pay_all');
  perform tests.hold_share((v ->> 'share_id')::uuid, 'pi_b1c_b_' || gen_random_uuid());
  update public.booking_sides set accepted_at = now() - interval '1 hour' where booking_id = s.booking and side = 'b';
  assert public.booking_side_b_lapse_due() = 0, 'paid: stays';
end $$;

-- 9. No side B by 24 hours before kickoff: invites can't be accepted any
--    more (the booker's 24-hour choice takes over, B1c part 2).
do $$
declare
  s record := tests.b1c_setup();
begin
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend]);
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  assert tests.error_of(format('select tests.b1c_accept(%L, %L, ''pay_all'')', tests.b1c_invite_id(s.booking, s.friend), s.friend))
         = 'opposition_closed', 'closed 24 hours before kickoff';
  assert tests.error_of(format('select tests.b1c_invite(%L, %L, array[%L]::uuid[])', s.booking, s.booker, s.other))
         = 'opposition_closed', 'and no new invites';
end $$;

-- 10. Who reads the invites, and who can call what.
do $$
declare
  s record := tests.b1c_setup();
  v_stranger uuid := tests.create_user('b1c-stranger-' || gen_random_uuid() || '@futty.test');
begin
  perform tests.b1c_invite(s.booking, s.booker, array[s.friend]);
  perform tests.act_as(s.friend);
  assert (select count(*) from public.booking_opposition_invites where booking_id = s.booking) = 1, 'the invitee reads it';
  perform tests.act_as(s.booker);
  assert (select count(*) from public.booking_opposition_invites where booking_id = s.booking) = 1, 'side A''s captain reads it';
  perform tests.act_as(v_stranger);
  assert (select count(*) from public.booking_opposition_invites where booking_id = s.booking) = 0, 'a stranger doesn''t';
  assert tests.error_of(format('insert into public.booking_opposition_invites (booking_id, invited_profile_id, invited_by) '
                               'values (%L, %L, %L)', s.booking, v_stranger, v_stranger)) like '%permission denied%',
    'nobody writes it directly';
  assert tests.error_of('select public.booking_side_b_lapse_due()') like '%permission denied%', 'the job is the server''s';
  perform tests.act_as_postgres();
end $$;

rollback;
