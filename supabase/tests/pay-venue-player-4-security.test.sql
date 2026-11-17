-- Venue-offered players: security (CLAUDE.md working rule 4).
--   booking_venue_players has RLS and no direct access for the app; every
--   function is security definer with search_path = ''; the app calls only
--   offer, withdraw, answer and remove; the read helper is service_role only;
--   anon can call nothing.
begin;

do $$
declare
  v_fn text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.booking_venue_players'::regclass), 'RLS is on';
  assert not has_table_privilege('authenticated', 'public.booking_venue_players', 'select'), 'authenticated can''t read';
  assert not has_table_privilege('authenticated', 'public.booking_venue_players', 'insert'), 'authenticated can''t insert';
  assert not has_table_privilege('authenticated', 'public.booking_venue_players', 'update'), 'authenticated can''t update';
  assert not has_table_privilege('anon', 'public.booking_venue_players', 'select'), 'anon can''t read';

  foreach v_fn in array array[
    'public.offer_venue_player(uuid, text)', 'public.withdraw_venue_player(uuid)',
    'public.answer_venue_player(uuid, boolean)', 'public.remove_venue_player(uuid)',
    'public.booking_venue_players_json(uuid, uuid, boolean)', 'public.booking_spots_taken(uuid)',
    'public.venue_player_when(public.venue_bookings)'
  ] loop
    assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = v_fn::regprocedure),
      format('%s is security definer with search_path = ''''', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('anon can''t run %s', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.offer_venue_player(uuid, text)', 'public.withdraw_venue_player(uuid)',
    'public.answer_venue_player(uuid, boolean)', 'public.remove_venue_player(uuid)'
  ] loop
    assert has_function_privilege('authenticated', v_fn, 'execute'), format('the app calls %s', v_fn);
  end loop;

  foreach v_fn in array array['public.booking_venue_players_json(uuid, uuid, boolean)', 'public.booking_spots_taken(uuid)',
                              'public.venue_player_when(public.venue_bookings)'] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute'), format('%s is internal', v_fn);
    assert has_function_privilege('service_role', v_fn, 'execute'), format('service_role runs %s', v_fn);
  end loop;
end $$;

-- Acting as anon, as the app would without signing in.
do $$
declare
  v_owner uuid := tests.create_user('vp-sec-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booker uuid := tests.create_user('vp-sec-booker@futty.test');
  v_b public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 5, tests.cyprus_today() + 3,
                                    '19:00', '20:00', 'vp-sec');
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.offer_venue_player(%L, %L)', v_b.id, 'Andreas')) like 'permission denied%',
    'anon can''t offer';
  assert tests.error_of(format('select public.answer_venue_player(%L, true)', gen_random_uuid())) like 'permission denied%',
    'anon can''t answer';
  perform tests.act_as_postgres();

  -- Signed in, the table itself is still closed.
  perform tests.act_as(v_owner);
  assert tests.error_of('select * from public.booking_venue_players') like 'permission denied%',
    'staff read it only through the roster';
  assert tests.error_of(format('insert into public.booking_venue_players (booking_id, venue_id, name, offered_by) values (%L, %L, %L, %L)',
                               v_b.id, v_venue, 'Andreas', v_owner)) like 'permission denied%',
    'staff write it only through offer_venue_player';
  assert tests.error_of(format('select public.booking_venue_players_json(%L, %L, true)', v_b.id, v_owner))
         like 'permission denied%', 'the read helper is internal';
  perform tests.act_as_postgres();

  -- Unknown offers are not found, for staff and bookers alike.
  assert tests.error_as(v_owner, format('select public.withdraw_venue_player(%L)', gen_random_uuid())) = 'offer_not_found',
    'withdraw an unknown offer';
  assert tests.error_as(v_booker, format('select public.remove_venue_player(%L)', gen_random_uuid())) = 'offer_not_found',
    'remove an unknown offer';
end $$;

rollback;
