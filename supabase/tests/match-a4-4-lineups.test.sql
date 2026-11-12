-- A4a (docs/specs/match-record.md section 4.9, decisions 1e): lineups.
-- set_match_lineup: that side's captain (the booker for both sides of a
-- pickup), before kickoff only; the formation is a preset for the match's
-- players_per_side; every position is a key of that formation and holds a
-- player on that side, once. Empty positions are allowed. A change of
-- players_per_side (5 v 5 to 6 v 6, P12) clears the match's lineups.
begin;

-- Every preset has players_per_side - 1 outfield players, and its
-- positions are gk plus one key per outfield player.
do $$
declare
  v_row record;
begin
  for v_row in select * from public.match_formation_presets loop
    assert (select sum(x::int) from unnest(string_to_array(v_row.formation, '-')) x) = v_row.players_per_side - 1,
      format('%s for %s', v_row.formation, v_row.players_per_side);
    assert cardinality(public.match_formation_positions(v_row.formation)) = v_row.players_per_side,
      format('positions of %s', v_row.formation);
  end loop;
  assert (select array_agg(distinct players_per_side order by players_per_side) from public.match_formation_presets)
         = array[5, 6, 7, 9, 11], 'every format';
  assert public.match_formation_positions('1-2-1') = array['gk', 'd1', 'm1', 'm2', 'f1'], '1-2-1 keys';
  assert public.match_formation_positions('2-2') = array['gk', 'd1', 'd2', 'f1', 'f2'], '2-2 keys';
  assert public.match_formation_positions('4-2-3-1')
         = array['gk', 'd1', 'd2', 'd3', 'd4', 'm1', 'm2', 'm3', 'm4', 'm5', 'f1'], '4-2-3-1 keys';
end $$;

do $$
declare
  v_home uuid := tests.create_team('A4L Home');
  v_away uuid := tests.create_team('A4L Away');
  cap_a uuid := tests.create_user('a4l-cap-a@futty.test');
  cap_b uuid := tests.create_user('a4l-cap-b@futty.test');
  sami uuid := tests.create_user('a4l-sami@futty.test');
  keeper uuid := tests.create_user('a4l-keeper@futty.test');
  away_player uuid := tests.create_user('a4l-away@futty.test');
  stranger uuid := tests.create_user('a4l-stranger@futty.test');
  m uuid := tests.form_match(now() + interval '1 day', 'scheduled', null, null, v_home, v_away);
  m_started uuid := tests.form_match(now() - interval '1 minute', 'scheduled', null, null, v_home, v_away);
  v_m uuid;
  v_pos jsonb;
begin
  perform tests.join_team(v_home, cap_a, 'captain');
  perform tests.join_team(v_away, cap_b, 'captain');
  foreach v_m in array array[m, m_started] loop
    perform tests.form_player(v_m, cap_a, 'a', true, false);
    perform tests.form_player(v_m, sami, 'a', true, false);
    perform tests.form_player(v_m, keeper, 'a', true, false);
    perform tests.form_player(v_m, cap_b, 'b', true, false);
    perform tests.form_player(v_m, away_player, 'b', true, false);
  end loop;

  -- A partial 1-2-1 (empty positions are "Need players").
  v_pos := jsonb_build_object('gk', tests.player_id(m, keeper), 'm1', tests.player_id(m, sami), 'f1', tests.player_id(m, cap_a));
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '1-2-1', v_pos)) is null, 'lineup';
  assert (select formation from public.match_lineups where match_id = m and side = 'a') = '1-2-1', 'saved';
  assert (select position from public.match_players where id = tests.player_id(m, keeper)) = 'gk', 'keeper position';
  assert (select position from public.match_players where id = tests.player_id(m, sami)) = 'm1', 'sami position';

  -- Changed: Sami moves to defence, the captain drops out of the lineup.
  v_pos := jsonb_build_object('gk', tests.player_id(m, keeper), 'd1', tests.player_id(m, sami), 'f1', null);
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2', v_pos)) is null, 'changed';
  assert (select position from public.match_players where id = tests.player_id(m, sami)) = 'd1', 'sami moved';
  assert (select position from public.match_players where id = tests.player_id(m, cap_a)) is null, 'captain cleared';
  assert (select positions from public.match_lineups where match_id = m and side = 'a')
         = jsonb_build_object('gk', tests.player_id(m, keeper), 'd1', tests.player_id(m, sami)), 'nulls dropped';

  -- A player from the other side.
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2',
           jsonb_build_object('gk', tests.player_id(m, away_player)))) = 'not_in_match', 'other side';
  -- An unknown formation, or one for another format (2-3-1 is 7 a side).
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '3-3-3', '{}')) = 'unknown_formation',
    'unknown';
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-3-1', '{}')) = 'unknown_formation',
    'wrong size';
  -- A key the formation doesn't have, a value that isn't a player id, the
  -- same player twice.
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2',
           jsonb_build_object('m1', tests.player_id(m, sami)))) = 'invalid_position', 'no m1 in 2-2';
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2',
           jsonb_build_object('gk', 'nobody'))) = 'invalid_position', 'not an id';
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2', '[]')) = 'invalid_position',
    'not an object';
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2',
           jsonb_build_object('d1', tests.player_id(m, sami), 'd2', tests.player_id(m, sami)))) = 'duplicate_player', 'twice';
  -- Who may set it.
  assert tests.error_as(sami, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2', '{}')) = 'not_captain', 'player';
  assert tests.error_as(stranger, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2', '{}')) = 'not_in_match',
    'stranger';
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'b', '2-2', '{}')) = 'not_captain',
    'other side';
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, null, '2-2', '{}')) = 'invalid_side',
    'no side';
  assert tests.error_as(cap_b, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'b', '3-1-1', '{}')) = 'unknown_formation',
    '6 a side preset on 5 a side';
  assert tests.error_as(cap_b, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'b', '2-1-1',
           jsonb_build_object('gk', tests.player_id(m, cap_b)))) is null, 'away lineup';
  -- After kickoff it's locked.
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m_started, 'a', '2-2', '{}')) = 'lineup_locked',
    'after kickoff';
  -- Refused calls changed nothing.
  assert (select formation from public.match_lineups where match_id = m and side = 'a') = '2-2', 'unchanged';

  -- 5 v 5 becomes 6 v 6 (P12): the lineups no longer fit, so they go.
  update public.matches set players_per_side = 6 where id = m;
  assert not exists (select 1 from public.match_lineups where match_id = m), 'lineups cleared';
  assert not exists (select 1 from public.match_players where match_id = m and position is not null), 'positions cleared';
  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '3-1-1', '{}')) is null, '6 a side preset';
  -- The same number again changes nothing.
  update public.matches set players_per_side = 6 where id = m;
  assert exists (select 1 from public.match_lineups where match_id = m), 'kept';

  -- Nobody writes match_lineups directly.
  assert tests.error_as(cap_a, format('update public.match_lineups set formation = %L where match_id = %L', '2-2', m))
         like 'permission denied%', 'direct update';
end $$;

-- Pickup: the booker sets Bibs and Non-bibs; a Non-bibs player can't.
do $$
declare
  booker uuid := tests.create_user('a4l2-booker@futty.test');
  nonbib uuid := tests.create_user('a4l2-nonbib@futty.test');
  unsided uuid := tests.create_user('a4l2-unsided@futty.test');
  m uuid := tests.form_match(now() + interval '1 day', 'scheduled');
begin
  update public.match_sides set captain_profile_id = booker where match_id = m and side = 'a';
  perform tests.form_player(m, booker, 'a', true, false);
  perform tests.form_player(m, nonbib, 'b', true, false);
  perform tests.form_player(m, unsided, null, true, false);
  assert tests.error_as(booker, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'b', '2-2',
           jsonb_build_object('gk', tests.player_id(m, nonbib)))) is null, 'booker sets non-bibs';
  assert tests.error_as(booker, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2',
           jsonb_build_object('gk', tests.player_id(m, unsided)))) = 'not_in_match', 'no side picked';
  assert tests.error_as(nonbib, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'b', '2-2', '{}')) = 'not_captain',
    'non-bibs player';
end $$;

-- Through contract 1: a booking's capacity changes before kickoff and the
-- re-sync changes players_per_side, which clears the lineup.
do $$
declare
  v_booker uuid := tests.create_user('a4l3-booker@futty.test');
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings;
  v_match uuid;
begin
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.next_weekday(3),
                                          '12:00', '13:00', 'a4l3');
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, now() + interval '2 days');
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  perform tests.act_as_service_role();
  v_match := public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  assert (select players_per_side from public.matches where id = v_match) = 5, 'five a side';
  assert tests.error_as(v_booker, format('select public.set_match_lineup(%L, %L, %L, %L)', v_match, 'a', '2-2',
           jsonb_build_object('gk', tests.player_id(v_match, v_booker)))) is null, 'booker lineup';

  update public.venue_bookings set capacity = 12 where id = v_booking.id;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  assert (select players_per_side from public.matches where id = v_match) = 6, 'six a side';
  assert not exists (select 1 from public.match_lineups where match_id = v_match), 'lineup cleared by the re-sync';
  assert (select position from public.match_players where id = tests.player_id(v_match, v_booker)) is null, 'position cleared';
end $$;

rollback;
