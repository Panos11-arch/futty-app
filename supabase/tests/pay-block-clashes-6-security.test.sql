-- Who may list clashes, move a booking or save a block (decided 18
-- November): the venue's own staff only, never with another venue's pitch or
-- booking. The internal helpers are the service role's only.
begin;

do $$
declare
  v_owner uuid := tests.create_user('bc6-owner@futty.test');
  v_other_owner uuid := tests.create_user('bc6-other@futty.test');
  v_player uuid := tests.create_user('bc6-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 2;
  v_game public.venue_bookings;
  v_pitch uuid;
  v_other_pitch uuid;
  v_free_pitch uuid;
  v_list jsonb;
  v_fn text;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_game := tests.booking_with_players(v_player, v_venue, 'each_pays_own_spot', 0, v_day, '18:00', '19:00', 'bc6');
  select pitch_id into v_pitch from public.booking_pitches where booking_id = v_game.id;
  select id into v_free_pitch from public.pitches where venue_id = v_venue and id <> v_pitch and size = '5-a-side' limit 1;
  select id into v_other_pitch from public.pitches where venue_id = v_other_venue limit 1;

  perform tests.act_as(v_owner);
  v_list := public.venue_block_clashes(v_venue, v_pitch, v_day, '18:00', '19:00');
  assert tests.error_of(format($q$ select public.venue_block_clashes(%L, %L, %L, null, null) $q$,
                               v_venue, v_other_pitch, v_day)) = 'invalid_pitches', 'another venue''s pitch';
  assert tests.error_of(format($q$ select public.venue_add_block(%L, %L, %L, null, null, null, 'q') $q$,
                               v_venue, v_other_pitch, v_day)) = 'invalid_pitches', 'another venue''s pitch';
  assert tests.error_of(format($q$ select public.venue_block_clashes(%L, null, %L, null, null) $q$,
                               v_other_venue, v_day)) = 'not_venue_staff', 'another venue';

  foreach v_fn in array array['other', 'player'] loop
    perform tests.act_as(case v_fn when 'other' then v_other_owner else v_player end);
    assert tests.error_of(format($q$ select public.venue_block_clashes(%L, %L, %L, '18:00', '19:00') $q$,
                                 v_venue, v_pitch, v_day)) = 'not_venue_staff', v_fn || ': no list';
    assert tests.error_of(format($q$ select public.venue_add_block(%L, %L, %L, '18:00', '19:00', null, %L) $q$,
                                 v_venue, v_pitch, v_day, v_list ->> 'quote')) = 'not_venue_staff', v_fn || ': no block';
    assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$,
                                 v_game.id, v_free_pitch)) = 'not_venue_staff', v_fn || ': no move';
  end loop;

  perform tests.act_as_anon();
  assert tests.error_of(format($q$ select public.venue_block_clashes(%L, null, %L, null, null) $q$, v_venue, v_day))
         like 'permission denied%', 'signed out: no list';
  assert tests.error_of(format($q$ select public.venue_add_block(%L, null, %L, null, null, null, 'q') $q$, v_venue, v_day))
         like 'permission denied%', 'signed out: no block';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_free_pitch))
         like 'permission denied%', 'signed out: no move';
  perform tests.act_as_postgres();

  assert (select status from public.venue_bookings where id = v_game.id) <> 'cancelled', 'nothing changed';
  assert not exists (select 1 from public.venue_blocks where venue_id = v_venue), 'no block';
  assert (select pitch_id from public.booking_pitches where booking_id = v_game.id) = v_pitch, 'not moved';

  -- Internal helpers: service role only.
  foreach v_fn in array array[
    'public.block_clash_booking_ids(uuid, uuid, date, time, time)',
    'public.booking_move_refusal(public.venue_bookings, uuid[])',
    'public.block_clashes_internal(uuid, uuid, date, time, time)',
    'public.cancel_counter_booking_internal(uuid)'] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute')
           and not has_function_privilege('anon', v_fn, 'execute')
           and has_function_privilege('service_role', v_fn, 'execute'), v_fn || ' is internal';
  end loop;
  foreach v_fn in array array[
    'public.venue_block_clashes(uuid, uuid, date, time, time)',
    'public.venue_move_booking(uuid, uuid[])',
    'public.venue_add_block(uuid, uuid, date, time, time, text, text)'] loop
    assert has_function_privilege('authenticated', v_fn, 'execute')
           and not has_function_privilege('anon', v_fn, 'execute'), v_fn || ' is for signed-in staff';
    assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = v_fn::regprocedure),
      v_fn || ' is security definer with an empty search_path';
  end loop;
end $$;

select 'pay block clashes 6 (security) passed' as result;

rollback;
