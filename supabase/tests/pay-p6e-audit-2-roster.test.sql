-- P6e audit fix 2: the roster's can_unmark_arrived follows the same rule as
-- venue_unmark_arrived since 20261117192228_match_ratings_unmark: false once
-- the player has voted for man of the match (or, before S13B removed the
-- 1-10 ratings, rated a player) in the match.
begin;

do $$
declare
  v_owner uuid := tests.create_user('audit-ro-owner@futty.test');
  v_b public.venue_bookings;
  v_m uuid;
  v_p uuid;
  v_q uuid;
  v_r uuid;
  v_roster jsonb;
  v_row jsonb;
begin
  v_b := tests.booking_with_players(tests.create_user('audit-ro-booker@futty.test'), tests.create_venue(p_owner => v_owner),
                                    'each_pays_own_spot', 3, tests.next_weekday(3), '12:00', '13:00', 'audit-ro');
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_b.id;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_b.id);
  perform tests.act_as_postgres();
  v_m := (tests.match_of(v_b.id)).id;
  v_p := (tests.player(v_b.id, 1)).profile_id;
  v_q := (tests.player(v_b.id, 2)).profile_id;
  v_r := (tests.player(v_b.id, 3)).profile_id;
  update public.match_players set side = 'a' where match_id = v_m;
  update public.matches set kickoff_at = now() - interval '3 hours', ends_at = now() - interval '2 hours',
                            result_deadline_at = now() + interval '22 hours', status = 'confirmed',
                            side_a_score = 2, side_b_score = 2, confirmed_via = 'agreed', confirmed_at = now() - interval '1 hour'
  where id = v_m;
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (v_m, v_q, 'qr', v_q);
  assert tests.error_as(v_owner, format('select public.venue_mark_arrived(%L, %L)', v_m, v_p)) is null, 'p ticked';
  assert tests.error_as(v_owner, format('select public.venue_mark_arrived(%L, %L)', v_m, v_r)) is null, 'r ticked';

  -- Before anyone votes, a venue tick can be undone.
  perform tests.act_as(v_owner);
  v_roster := public.venue_booking_roster(v_b.id);
  perform tests.act_as_postgres();
  select e into v_row from jsonb_array_elements(v_roster -> 'players') e where e ->> 'profile_id' = v_p::text;
  assert (v_row ->> 'can_unmark_arrived')::boolean, format('p can be undone before voting, got %s', v_row);

  -- p votes for q; r is only voted for (by q).
  assert tests.error_as(v_p, format('select public.cast_motm_vote(%L, %L)', v_m, tests.player_id(v_m, v_q))) is null, 'p votes';
  assert tests.error_as(v_q, format('select public.cast_motm_vote(%L, %L)', v_m, tests.player_id(v_m, v_r))) is null, 'r is voted for';

  perform tests.act_as(v_owner);
  v_roster := public.venue_booking_roster(v_b.id);
  perform tests.act_as_postgres();
  select e into v_row from jsonb_array_elements(v_roster -> 'players') e where e ->> 'profile_id' = v_p::text;
  assert not (v_row ->> 'can_unmark_arrived')::boolean, format('p voted: no undo, got %s', v_row);
  assert tests.error_as(v_owner, format('select public.venue_unmark_arrived(%L, %L)', v_m, v_p)) = 'check_in_used',
    'and the server refuses it, as the roster says';
  select e into v_row from jsonb_array_elements(v_roster -> 'players') e where e ->> 'profile_id' = v_r::text;
  assert (v_row ->> 'can_unmark_arrived')::boolean, format('r was only voted for: can be undone, got %s', v_row);
  select e into v_row from jsonb_array_elements(v_roster -> 'players') e where e ->> 'profile_id' = v_q::text;
  assert not (v_row ->> 'can_unmark_arrived')::boolean, format('q checked in by QR, not a venue tick, got %s', v_row);
end $$;

rollback;
