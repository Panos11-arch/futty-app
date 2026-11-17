-- A5a (docs/specs/match-record.md decision 1f, section 4.1): competitive or
-- casual. matches.competitive is null by default and is_competitive =
-- coalesce(competitive, kind = 'named'): named games count, pickups don't,
-- and a pickup that becomes a named game (1b.1) counts unless a captain
-- chose. Any captain (the booker on side a, a team captain) changes it while
-- the match is scheduled and before kickoff.
begin;

create function tests.set_comp(p_user uuid, p_match uuid, p_value boolean)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.set_match_competitive(%L, %s)', p_match, coalesce(p_value::text, 'null')));
$$;

do $$
declare
  v_b public.venue_bookings;
  v_m uuid;
  v_player uuid;
  v_home uuid := tests.create_team('LV4 Home');
  v_away uuid := tests.create_team('LV4 Away');
  v_cap_b uuid := tests.create_user('lv4-cap-b@futty.test');
  v_member_b uuid := tests.create_user('lv4-member-b@futty.test');
  v_named uuid;
  v_pickup uuid;
begin
  -- A pickup from a booking: casual by default; the booker changes it.
  v_b := tests.booking_with_players(tests.create_user('lv4-booker@futty.test'), tests.create_venue(), 'each_pays_own_spot', 2,
                                    tests.next_weekday(3), '12:00', '13:00', 'lv4');
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_b.id;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_b.id);
  perform tests.act_as_postgres();
  v_m := (tests.match_of(v_b.id)).id;
  v_player := (tests.player(v_b.id, 1)).profile_id;
  assert (tests.match_of(v_b.id)).competitive is null and not (tests.match_of(v_b.id)).is_competitive, 'pickup: casual';

  assert tests.set_comp(v_player, v_m, true) = 'not_captain', 'a player isn''t a captain';
  assert tests.set_comp(tests.create_user('lv4-stranger@futty.test'), v_m, true) = 'not_captain', 'stranger';
  assert tests.set_comp(v_b.created_by, v_m, true) is null, 'the booker';
  assert (tests.match_of(v_b.id)).is_competitive, 'now competitive';
  assert tests.set_comp(v_b.created_by, v_m, null) is null, 'back to the default';
  assert not (tests.match_of(v_b.id)).is_competitive, 'casual again';
  assert tests.error_as(v_b.created_by, format('select public.set_match_competitive(%L, true)', gen_random_uuid()))
         = 'match_not_found', 'no such match';

  -- Locked from kickoff, and once the match isn't scheduled.
  update public.matches set kickoff_at = now() where id = v_m;
  assert tests.set_comp(v_b.created_by, v_m, true) = 'competitive_locked', 'at kickoff';
  update public.matches set kickoff_at = now() + interval '1 hour', status = 'void' where id = v_m;
  assert tests.set_comp(v_b.created_by, v_m, true) = 'competitive_locked', 'void';

  -- A named game: competitive by default; either side's captain changes it.
  perform tests.join_team(v_away, v_cap_b, 'captain');
  perform tests.join_team(v_away, v_member_b, 'player');
  v_named := tests.form_match(now() + interval '3 hours', 'scheduled', null, null, v_home, v_away);
  perform tests.form_player(v_named, v_cap_b, 'b', true, false);
  perform tests.form_player(v_named, v_member_b, 'b', true, false);
  assert (select is_competitive from public.matches where id = v_named), 'named: competitive';
  assert tests.set_comp(v_member_b, v_named, false) = 'not_captain', 'a team member isn''t a captain';
  assert tests.set_comp(v_cap_b, v_named, false) is null, 'side b''s captain';
  assert not (select is_competitive from public.matches where id = v_named), 'casual';

  -- A pickup that becomes a named game counts, unless a captain chose.
  v_pickup := tests.form_match(now() + interval '3 hours', 'scheduled');
  assert not (select is_competitive from public.matches where id = v_pickup), 'pickup';
  update public.matches set kind = 'named' where id = v_pickup;
  assert (select is_competitive from public.matches where id = v_pickup), 'became named: competitive';
  update public.matches set kind = 'pickup', competitive = false where id = v_pickup;
  update public.matches set kind = 'named' where id = v_pickup;
  assert not (select is_competitive from public.matches where id = v_pickup), 'a captain chose casual: kept';

  -- Nobody writes the flag directly.
  assert tests.error_as(v_b.created_by, format('update public.matches set competitive = true where id = %L', v_m))
         like 'permission denied%', 'direct update';
end $$;

rollback;
