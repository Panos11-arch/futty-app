-- P2 rule 6: joining a team or a booking is an invite the invited user
-- accepts, never a direct insert.
begin;

do $$
declare
  v_captain uuid := tests.create_user('invite-captain@futty.test', '{"username":"invitecaptain"}');
  v_player uuid := tests.create_user('invite-player@futty.test', '{"username":"inviteplayer"}');
  v_stranger uuid := tests.create_user('invite-stranger@futty.test', '{"username":"invitestranger"}');
  v_venue uuid := tests.create_venue(p_price => 60);
  v_team public.teams;
  v_booking public.venue_bookings;
  v_invite public.invites;
  v_error text;
  v_share integer;
begin
  perform tests.act_as(v_captain);
  v_team := public.create_team('Invite FC', 'Nicosia', 2, 0);

  -- A captain can no longer insert team members directly.
  v_error := tests.error_of(format(
    'insert into public.team_members (team_id, profile_id, role) values (%L, %L, ''player'')', v_team.id, v_player));
  assert v_error is not null, 'a direct team_members insert should be refused';

  -- Only a captain invites.
  perform tests.act_as(v_stranger);
  v_error := tests.error_of(format('select public.invite_team_member(%L::uuid, %L::uuid, ''player'')', v_team.id, v_player));
  assert v_error = 'not_captain', format('non-captain invite: got %s', coalesce(v_error, 'success'));

  perform tests.act_as(v_captain);
  v_invite := public.invite_team_member(v_team.id, v_player, 'player');
  assert v_invite.status = 'pending', 'a new invite should be pending';
  assert not exists (select 1 from public.team_members where team_id = v_team.id and profile_id = v_player),
    'an invite must not add the player by itself';

  -- The invited player is told, and only they can answer.
  perform tests.act_as(v_player);
  assert exists (
    select 1 from public.notifications
    where profile_id = v_player and type = 'team_invite' and data ->> 'inviteId' = v_invite.id::text
  ), 'the invited player should get a team_invite notification';

  perform tests.act_as(v_stranger);
  v_error := tests.error_of(format('select public.accept_invite(%L::uuid)', v_invite.id));
  assert v_error = 'not_your_invite', format('someone else accepting: got %s', coalesce(v_error, 'success'));

  perform tests.act_as(v_player);
  perform public.accept_invite(v_invite.id);
  assert exists (select 1 from public.team_members where team_id = v_team.id and profile_id = v_player and role = 'player'),
    'accepting should add the player';
  v_error := tests.error_of(format('select public.accept_invite(%L::uuid)', v_invite.id));
  assert v_error = 'invite_not_pending', format('accepting twice: got %s', coalesce(v_error, 'success'));

  -- The roster (2 incl. the captain) is now full.
  perform tests.act_as(v_captain);
  v_error := tests.error_of(format('select public.invite_team_member(%L::uuid, %L::uuid, ''player'')', v_team.id, v_stranger));
  assert v_error = 'team_full', format('inviting into a full team: got %s', coalesce(v_error, 'success'));

  -- Bookings: add_booking_player sends an invite; the share appears on accept.
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 1, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');

  perform tests.act_as(v_stranger);
  v_error := tests.error_of(format('select public.add_booking_player(%L::uuid, ''inviteplayer'')', v_booking.id));
  assert v_error = 'not_your_booking', format('non-booker adding a player: got %s', coalesce(v_error, 'success'));

  perform tests.act_as(v_captain);
  perform public.add_booking_player(v_booking.id, 'inviteplayer');
  perform tests.act_as(v_player);
  select * into v_invite from public.invites where booking_id = v_booking.id and invited_profile_id = v_player;
  assert v_invite.status = 'pending', 'add_booking_player should create a pending invite';
  assert not exists (select 1 from public.booking_payment_shares where booking_id = v_booking.id and profile_id = v_player),
    'no share before the player accepts';

  -- Declining leaves them out.
  perform public.decline_invite(v_invite.id);
  assert not exists (select 1 from public.booking_payment_shares where booking_id = v_booking.id and profile_id = v_player),
    'declining must not add a share';

  -- A fresh invite, accepted, adds their share: EUR 60 / 10 + 80 = 680.
  perform tests.act_as(v_captain);
  perform public.add_booking_player(v_booking.id, 'inviteplayer');
  perform tests.act_as(v_player);
  select * into v_invite from public.invites where booking_id = v_booking.id and invited_profile_id = v_player and status = 'pending';
  perform public.accept_invite(v_invite.id);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and profile_id = v_player;
  assert v_share = 680, format('accepted player''s share should be 680 cents, got %s', v_share);
  perform tests.assert_share(v_booking.id, v_player, 600, 680, 'accepted invite: 6000 / 10 = 600, + 80');

  -- A booking invite at a venue that has gone offline can't be accepted.
  perform tests.act_as(v_captain);
  perform public.add_booking_player(v_booking.id, 'invitestranger');
  perform tests.act_as_postgres();
  update public.venues set is_live = false where id = v_venue;
  perform tests.act_as(v_stranger);
  select * into v_invite from public.invites where booking_id = v_booking.id and invited_profile_id = v_stranger;
  v_error := tests.error_of(format('select public.accept_invite(%L::uuid)', v_invite.id));
  assert v_error = 'venue_not_live', format('accepting at a non-live venue: got %s', coalesce(v_error, 'success'));
end $$;

select 'pay-guards rule 6 (invites) passed' as result;

rollback;
