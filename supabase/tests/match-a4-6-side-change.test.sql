-- A4a follow-up (docs/specs/match-record.md decisions 1e.4 and 1e.7): a
-- lineup position belongs to a side. When a player changes side
-- (choose_match_side, set_match_player_side) or leaves the match, their
-- match_players.position is cleared and they're taken out of the lineup;
-- the rest of the lineup stays. When a pickup becomes a named game
-- (decision 1b.1) the sides are rebuilt, so every lineup and position of
-- the match is cleared.
begin;

do $$
declare
  v_booker uuid := tests.create_user('a4s-booker@futty.test');
  v_booking public.venue_bookings;
  v_match uuid;
  p1 uuid;
  p2 uuid;
  p3 uuid;
begin
  v_booking := tests.booking_with_players(v_booker, tests.create_venue(), 'each_pays_own_spot', 3, tests.next_weekday(3),
                                          '12:00', '13:00', 'a4s');
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, now() + interval '2 days');
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  perform tests.act_as_service_role();
  v_match := public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  p1 := (tests.player(v_booking.id, 1)).profile_id;
  p2 := (tests.player(v_booking.id, 2)).profile_id;
  p3 := (tests.player(v_booking.id, 3)).profile_id;

  -- The booker puts p1 on Bibs, p2 and p3 on Non-bibs, and sets both lineups.
  assert tests.error_as(v_booker, format('select public.set_match_player_side(%L, %L, %L)', v_match, tests.player_id(v_match, p1), 'a')) is null, 'p1 a';
  assert tests.error_as(v_booker, format('select public.set_match_player_side(%L, %L, %L)', v_match, tests.player_id(v_match, p2), 'b')) is null, 'p2 b';
  assert tests.error_as(v_booker, format('select public.set_match_player_side(%L, %L, %L)', v_match, tests.player_id(v_match, p3), 'b')) is null, 'p3 b';
  assert tests.error_as(v_booker, format('select public.set_match_lineup(%L, %L, %L, %L)', v_match, 'a', '2-2',
           jsonb_build_object('gk', tests.player_id(v_match, p1), 'f1', tests.player_id(v_match, v_booker)))) is null, 'bibs lineup';
  assert tests.error_as(v_booker, format('select public.set_match_lineup(%L, %L, %L, %L)', v_match, 'b', '2-2',
           jsonb_build_object('gk', tests.player_id(v_match, p2), 'f1', tests.player_id(v_match, p3)))) is null, 'non-bibs lineup';

  -- p1 picks Non-bibs: no longer Bibs' keeper, and the booker stays at f1.
  assert tests.error_as(p1, format('select public.choose_match_side(%L, %L)', v_match, 'b')) is null, 'p1 moves';
  assert (select position from public.match_players where id = tests.player_id(v_match, p1)) is null, 'p1 position cleared';
  assert (select positions from public.match_lineups where match_id = v_match and side = 'a')
         = jsonb_build_object('f1', tests.player_id(v_match, v_booker)), 'p1 out of the bibs lineup';
  assert (select position from public.match_players where id = tests.player_id(v_match, v_booker)) = 'f1', 'booker kept';
  assert (select positions from public.match_lineups where match_id = v_match and side = 'b')
         = jsonb_build_object('gk', tests.player_id(v_match, p2), 'f1', tests.player_id(v_match, p3)), 'non-bibs untouched';

  -- The booker moves p2 to Bibs.
  assert tests.error_as(v_booker, format('select public.set_match_player_side(%L, %L, %L)', v_match, tests.player_id(v_match, p2), 'a')) is null, 'p2 moves';
  assert (select position from public.match_players where id = tests.player_id(v_match, p2)) is null, 'p2 position cleared';
  assert (select positions from public.match_lineups where match_id = v_match and side = 'b')
         = jsonb_build_object('f1', tests.player_id(v_match, p3)), 'p2 out of the non-bibs lineup';

  -- Setting the side a player already has changes nothing.
  assert tests.error_as(v_booker, format('select public.set_match_lineup(%L, %L, %L, %L)', v_match, 'a', '2-2',
           jsonb_build_object('gk', tests.player_id(v_match, p2), 'f1', tests.player_id(v_match, v_booker)))) is null, 'p2 in goal';
  assert tests.error_as(v_booker, format('select public.set_match_player_side(%L, %L, %L)', v_match, tests.player_id(v_match, p2), 'a')) is null, 'same side';
  assert (select position from public.match_players where id = tests.player_id(v_match, p2)) = 'gk', 'p2 still in goal';
  assert (select positions -> 'gk' from public.match_lineups where match_id = v_match and side = 'a')
         = to_jsonb(tests.player_id(v_match, p2)::text), 'still in the lineup';

  -- p3's spot is cancelled: the re-sync marks them as left, and they leave the lineup.
  update public.booking_payment_shares set status = 'cancelled' where id = (tests.player(v_booking.id, 3)).id;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  assert (select left_at from public.match_players where id = tests.player_id(v_match, p3)) is not null, 'p3 left';
  assert (select position from public.match_players where id = tests.player_id(v_match, p3)) is null, 'p3 position cleared';
  assert (select positions from public.match_lineups where match_id = v_match and side = 'b') = '{}', 'p3 out of the lineup';
  assert (select position from public.match_players where id = tests.player_id(v_match, p2)) = 'gk', 'others kept by the re-sync';
end $$;

-- A pickup becomes a named game (decision 1b.1): the sides are rebuilt, so
-- every lineup and position goes.
do $$
declare
  v_booker uuid := tests.create_user('a4s2-booker@futty.test');
  v_booking public.venue_bookings;
  v_match uuid;
  v_home uuid := tests.create_team('A4S Home');
  v_away uuid := tests.create_team('A4S Away');
  v_post uuid;
begin
  v_booking := tests.booking_with_players(v_booker, tests.create_venue(), 'each_pays_own_spot', 1, tests.next_weekday(3),
                                          '12:00', '13:00', 'a4s2');
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, now() + interval '2 days');
  update public.venue_bookings set status = 'confirmed', team_id = v_home where id = v_booking.id;
  perform tests.join_team(v_home, v_booker);
  perform tests.join_team(v_away, tests.create_user('a4s2-away-captain@futty.test'), 'captain');
  perform tests.act_as_service_role();
  v_match := public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  assert (select kind from public.matches where id = v_match) = 'pickup', 'pickup first';
  assert tests.error_as(v_booker, format('select public.set_match_lineup(%L, %L, %L, %L)', v_match, 'a', '2-2',
           jsonb_build_object('f1', tests.player_id(v_match, v_booker)))) is null, 'pickup lineup';

  insert into public.squad_posts (type, team_id, venue_id, venue_booking_id, posted_by, matched_team_id)
  values ('opposition', v_home, v_booking.venue_id, v_booking.id, v_booker, v_away) returning id into v_post;
  insert into public.friendly_matches (squad_post_id, home_team_id, away_team_id) values (v_post, v_home, v_away);
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  assert (select kind from public.matches where id = v_match) = 'named', 'named now';
  assert not exists (select 1 from public.match_lineups where match_id = v_match), 'lineups cleared';
  assert not exists (select 1 from public.match_players where match_id = v_match and position is not null), 'positions cleared';
end $$;

rollback;
