-- P2 rule 4: book_slot and every join function refuse a venue that isn't live.
begin;

do $$
declare
  v_poster uuid := tests.create_user('live-poster@futty.test');
  v_joiner uuid := tests.create_user('live-joiner@futty.test');
  v_owner uuid := tests.create_user('live-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_day date := tests.cyprus_today() + 1;
  v_team uuid;
  v_booking public.venue_bookings;
  v_players_post uuid;
  v_opposition_post uuid;
  v_error text;
begin
  update public.profiles set role = 'venue_owner' where id = v_owner;

  -- Set everything up while the venue is still live.
  perform tests.act_as(v_poster);
  v_booking := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5);
  v_players_post := (public.create_squad_post(
    v_venue, ((v_day + time '12:00') at time zone 'Asia/Nicosia'), '5-a-side', 'players',
    p_players_needed => 3, p_venue_booking_id => v_booking.id)).id;

  perform tests.act_as(v_joiner);
  v_team := (public.create_team('Live test FC', 'Nicosia', 5, 0)).id;

  perform tests.act_as_postgres();
  insert into public.squad_posts (venue_id, scheduled_at, format, type, team_id, posted_by, status)
  values (v_venue, now() + interval '1 day', '5-a-side', 'opposition', null, v_poster, 'open')
  returning id into v_opposition_post;
  update public.venues set is_live = false where id = v_venue;

  -- Now nothing at that venue can be booked or joined.
  perform tests.act_as(v_poster);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''14:00'', ''15:00'', 1, ''5-a-side'', 5)', v_venue, v_day));
  assert v_error = 'venue_not_live', format('book_slot: got %s', coalesce(v_error, 'success'));

  v_error := tests.error_of(format(
    'select public.create_squad_post(%L::uuid, now() + interval ''1 day'', ''5-a-side'', ''players'', p_players_needed => 3)', v_venue));
  assert v_error = 'venue_not_live', format('create_squad_post: got %s', coalesce(v_error, 'success'));

  perform tests.act_as(v_joiner);
  v_error := tests.error_of(format('select public.join_squad_post(%L::uuid)', v_players_post));
  assert v_error = 'venue_not_live', format('join_squad_post: got %s', coalesce(v_error, 'success'));

  v_error := tests.error_of(format('select public.offer_opposition(%L::uuid, %L::uuid)', v_opposition_post, v_team));
  assert v_error = 'venue_not_live', format('offer_opposition: got %s', coalesce(v_error, 'success'));

  perform tests.act_as(v_owner);
  v_error := tests.error_of(format('select public.add_house_player(%L::uuid, ''House Player'')', v_players_post));
  assert v_error = 'venue_not_live', format('add_house_player: got %s', coalesce(v_error, 'success'));
end $$;

select 'pay-guards rule 4 (live venues) passed' as result;

rollback;
