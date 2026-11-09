-- A block stops new bookings only: players can still join a game that was
-- booked before the block, through an invite or a "need players" post. The
-- join screen shows the venue's notice that it has closed new bookings
-- (squad_post_block_notice). Decided 9 November,
-- docs/specs/13-payments-bookings.md, "Blocking pitches".
begin;

do $$
declare
  v_owner uuid := tests.create_user('joinblock-owner@futty.test');
  v_booker uuid := tests.create_user('joinblock-booker@futty.test', '{"username":"joinblockbooker"}');
  v_invited uuid := tests.create_user('joinblock-invited@futty.test', '{"username":"joinblockinvited"}');
  v_joiner uuid := tests.create_user('joinblock-joiner@futty.test', '{"username":"joinblockjoiner"}');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_venue_name text;
  v_day date := tests.cyprus_today() + 1;
  v_p1 uuid;
  v_p2 uuid;
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_invite public.invites;
  v_share integer;
  v_count integer;
  v_notice record;
  v_error text;
begin
  select name into v_venue_name from public.venues where id = v_venue;
  select id into v_p1 from public.pitches where venue_id = v_venue and name = 'Pitch 1';
  select id into v_p2 from public.pitches where venue_id = v_venue and name = 'Pitch 2';

  -- The game is booked (pitch 1, 18:00) and posted for players, then invites go out.
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_day, '18:00', '19:00', 1, '5-a-side', 5);
  v_post := public.create_squad_post(
    v_venue, (v_day + time '18:00') at time zone 'Asia/Nicosia', '5-a-side', 'players',
    p_players_needed => 3, p_venue_booking_id => v_booking.id);
  perform public.add_booking_player(v_booking.id, 'joinblockinvited');

  -- No block yet: no notice.
  perform tests.act_as(v_joiner);
  select count(*) into v_count from public.squad_post_block_notice(v_post.id);
  assert v_count = 0, format('no block, no notice: got %s rows', v_count);

  -- A block on the other pitch doesn't cover this game.
  perform tests.act_as(v_owner);
  insert into public.venue_blocks (venue_id, pitch_id, block_day, starts_at, ends_at, reason, created_by)
  values (v_venue, v_p2, v_day, '17:00', '21:00', 'Private reason', v_owner);
  perform tests.act_as(v_joiner);
  select count(*) into v_count from public.squad_post_block_notice(v_post.id);
  assert v_count = 0, format('a block on another pitch: got %s rows', v_count);

  -- Now the venue blocks the game's own pitch.
  perform tests.act_as(v_owner);
  insert into public.venue_blocks (venue_id, pitch_id, block_day, starts_at, ends_at, reason, created_by)
  values (v_venue, v_p1, v_day, '17:00', '21:00', 'Private reason', v_owner);

  -- The join screen gets the venue's notice: only the venue name, never who
  -- blocked it or why.
  perform tests.act_as(v_joiner);
  select * into v_notice from public.squad_post_block_notice(v_post.id);
  assert v_notice.venue_name = v_venue_name, format('notice venue: got %s', v_notice.venue_name);
  assert (select count(*) from public.squad_post_block_notice(v_post.id)) = 1, 'one notice, however many blocks';
  assert to_jsonb(v_notice) - 'venue_name' = '{}'::jsonb, format('the notice says nothing else: %s', to_jsonb(v_notice));

  -- A new booking in the block is still refused...
  perform tests.act_as(v_joiner);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''19:00'', ''20:00'', 1, ''5-a-side'', 5)', v_venue, v_day));
  assert v_error = 'slot_blocked', format('a new booking in the block: got %s', coalesce(v_error, 'success'));

  -- ...but the game booked before it can be joined from the post (EUR 60 / 10 + 80 = 680)...
  perform public.join_squad_post(v_post.id);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and profile_id = v_joiner;
  assert v_share = 680, format('joining from the post: share should be 680, got %s', v_share);

  -- ...and through an invite.
  perform tests.act_as(v_invited);
  select * into v_invite from public.invites where booking_id = v_booking.id and invited_profile_id = v_invited and status = 'pending';
  perform public.accept_invite(v_invite.id);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and profile_id = v_invited;
  assert v_share = 680, format('joining by invite: share should be 680, got %s', v_share);

  -- A venue-wide block shows the notice too.
  perform tests.act_as_postgres();
  delete from public.venue_blocks where venue_id = v_venue;
  insert into public.venue_blocks (venue_id, block_day) values (v_venue, v_day);
  perform tests.act_as(v_joiner);
  assert (select count(*) from public.squad_post_block_notice(v_post.id)) = 1, 'a whole-day venue block shows the notice';

  -- Signed-out users can't ask.
  perform tests.act_as_anon();
  v_error := tests.error_of(format('select * from public.squad_post_block_notice(%L::uuid)', v_post.id));
  assert v_error like '%permission denied%', format('anon: got %s', coalesce(v_error, 'success'));
end $$;

select 'venue model 11 (joining a game booked before a block) passed' as result;

rollback;
