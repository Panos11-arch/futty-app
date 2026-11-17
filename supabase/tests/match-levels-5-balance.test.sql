-- A5a (docs/specs/match-record.md decision 1f): balance teams. The booker
-- splits a pickup's players (holding a spot or checked in, not left, not
-- guests) into two sides whose average levels are closest; sizes differ by
-- one at most; the booker stays on side a; a player with no level counts as
-- 3.0. Exact for 16 players or fewer, greedy above. Same lock as
-- set_match_player_side (sides_locked once a result is submitted).
begin;

create function tests.lv5_game(p_label text, p_others integer)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_b public.venue_bookings;
begin
  v_b := tests.booking_with_players(tests.create_user(format('%s-booker@futty.test', p_label)), tests.create_venue(),
                                    'each_pays_own_spot', p_others, tests.next_weekday(3), '12:00', '13:00', p_label);
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_b.id returning * into v_b;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_b.id);
  perform tests.act_as_postgres();
  return v_b;
end;
$$;

create function tests.side_of(p_match uuid, p_profile uuid)
returns text
language sql
as $$
  select side from public.match_players where match_id = p_match and profile_id = p_profile;
$$;

do $$
declare
  v_b public.venue_bookings := tests.lv5_game('lv5', 6);
  v_m uuid := (tests.match_of(v_b.id)).id;
  p uuid[];
  v_levels numeric[] := array[1.0, 2.0, 2.5, 4.0, 5.5];
  v_left uuid;
  v_guest uuid;
  v_result jsonb;
begin
  -- Booker 6.0; players 1.0, 2.0, 2.5, 4.0, 5.5; total 21. The only even
  -- split: booker + 2.0 + 2.5 = 10.5 v 1.0 + 4.0 + 5.5 = 10.5.
  perform tests.set_level(v_b.created_by, 6.0);
  for i in 1..5 loop
    p := p || (tests.player(v_b.id, i)).profile_id;
    perform tests.set_level(p[i], v_levels[i]);
  end loop;
  -- The sixth player left (stays on b), and a guest stays where they are.
  v_left := (tests.player(v_b.id, 6)).profile_id;
  update public.match_players set side = 'b' where match_id = v_m and profile_id = v_left;
  update public.match_players set left_at = now() where match_id = v_m and profile_id = v_left;
  v_guest := tests.guest_player(v_m, 'b', 'Guest');
  update public.match_players set side = 'b' where match_id = v_m and profile_id = v_b.created_by;

  assert tests.error_as(p[1], format('select public.balance_match_teams(%L)', v_m)) = 'not_booker', 'a player';
  perform tests.act_as(v_b.created_by);
  v_result := public.balance_match_teams(v_m);
  perform tests.act_as_postgres();

  assert tests.side_of(v_m, v_b.created_by) = 'a', 'the booker on a';
  assert tests.side_of(v_m, p[2]) = 'a' and tests.side_of(v_m, p[3]) = 'a', '2.0 and 2.5 with the booker';
  assert tests.side_of(v_m, p[1]) = 'b' and tests.side_of(v_m, p[4]) = 'b' and tests.side_of(v_m, p[5]) = 'b', '1.0, 4.0, 5.5';
  assert (v_result -> 'sideA' ->> 'average')::numeric = 3.5 and (v_result -> 'sideB' ->> 'average')::numeric = 3.5,
    format('3.5 each: %s', v_result);
  assert jsonb_array_length(v_result -> 'sideA' -> 'players') = 3, 'three each';
  assert (select side from public.match_players where id = v_guest) = 'b', 'the guest is left alone';
  assert tests.side_of(v_m, v_left) = 'b', 'a player who left is left alone';

  -- Locked once a result is submitted.
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by)
  values (v_m, 'a', 2, 1, v_b.created_by);
  assert tests.error_as(v_b.created_by, format('select public.balance_match_teams(%L)', v_m)) = 'sides_locked', 'locked';
  assert tests.error_as(v_b.created_by, format('select public.balance_match_teams(%L)', gen_random_uuid())) = 'match_not_found',
    'no such match';
  -- Pickups only.
  delete from public.match_result_submissions where match_id = v_m;
  update public.matches set kind = 'named' where id = v_m;
  assert tests.error_as(v_b.created_by, format('select public.balance_match_teams(%L)', v_m)) = 'not_pickup', 'named';
end $$;

-- An odd number, nobody with a level (3.0 each, nothing written), and a
-- checked-in player without a share.
do $$
declare
  v_b public.venue_bookings := tests.lv5_game('lv5b', 2);
  v_m uuid := (tests.match_of(v_b.id)).id;
  v_walk_in uuid := tests.create_user('lv5b-walkin@futty.test');
  v_result jsonb;
begin
  insert into public.match_players (match_id, profile_id) values (v_m, v_walk_in);
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (v_m, v_walk_in, 'qr', v_walk_in);
  perform tests.act_as(v_b.created_by);
  v_result := public.balance_match_teams(v_m);
  perform tests.act_as_postgres();
  assert (select count(*) from public.match_players where match_id = v_m and side = 'a') = 2
     and (select count(*) from public.match_players where match_id = v_m and side = 'b') = 2, format('2 v 2: %s', v_result);
  assert tests.side_of(v_m, v_walk_in) is not null, 'checked in: placed';
  assert not exists (select 1 from public.player_levels pl join public.match_players mp on mp.profile_id = pl.profile_id
                     where mp.match_id = v_m), 'no level rows written';

  -- 5 players: 3 v 2.
  insert into public.match_players (match_id, profile_id) values (v_m, tests.create_user('lv5b-fifth@futty.test'));
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by)
  select v_m, profile_id, 'qr', profile_id from public.match_players where match_id = v_m and side is null;
  perform tests.act_as(v_b.created_by);
  v_result := public.balance_match_teams(v_m);
  perform tests.act_as_postgres();
  assert (select count(*) from public.match_players where match_id = v_m and side is not null) = 5, 'all placed';
  assert abs((select count(*) from public.match_players where match_id = v_m and side = 'a')
           - (select count(*) from public.match_players where match_id = v_m and side = 'b')) = 1, 'sizes differ by one';
end $$;

-- More than 16 players: the greedy split.
do $$
declare
  v_b public.venue_bookings := tests.lv5_game('lv5c', 0);
  v_m uuid := (tests.match_of(v_b.id)).id;
  v_p uuid;
  v_result jsonb;
begin
  perform tests.set_level(v_b.created_by, 1.0);
  for i in 1..17 loop
    v_p := tests.create_user(format('lv5c-%s@futty.test', i));
    perform tests.set_level(v_p, 1.0 + i * 0.3);
    insert into public.match_players (match_id, profile_id) values (v_m, v_p);
    insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (v_m, v_p, 'qr', v_p);
  end loop;
  perform tests.act_as(v_b.created_by);
  v_result := public.balance_match_teams(v_m);
  perform tests.act_as_postgres();
  assert tests.side_of(v_m, v_b.created_by) = 'a', 'booker on a';
  assert (select count(*) from public.match_players where match_id = v_m and side = 'a') = 9
     and (select count(*) from public.match_players where match_id = v_m and side = 'b') = 9, '9 v 9';
  assert abs((v_result -> 'sideA' ->> 'average')::numeric - (v_result -> 'sideB' ->> 'average')::numeric) < 0.1,
    format('close: %s', v_result);
end $$;

rollback;
