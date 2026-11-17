-- P6e no-shows: only that venue's staff mark, undo and read no-shows; the
-- helpers are internal; nobody writes match_attendance directly.
begin;

do $$
declare
  v_owner uuid := tests.create_user('ns8-owner@futty.test');
  v_other_owner uuid := tests.create_user('ns8-other-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner);
  v_booking public.venue_bookings;
  v_m uuid;
  v_p uuid;
  v_booker uuid;
  v_fn text;
begin
  v_booking := tests.booking_with_players(tests.create_user('ns8-booker@futty.test'), v_venue, 'each_pays_own_spot', 2,
                                          tests.next_weekday(3), '12:00', '13:00', 'ns8');
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  v_m := (tests.match_of(v_booking.id)).id;
  v_p := (tests.player(v_booking.id, 1)).profile_id;
  v_booker := v_booking.created_by;
  update public.matches set kickoff_at = now() - interval '1 hour', ends_at = now(),
                            result_deadline_at = now() + interval '24 hours'
  where id = v_m;

  foreach v_fn in array array['venue_mark_arrived', 'venue_unmark_arrived'] loop
    assert tests.error_as(v_other_owner, format('select public.%s(%L, %L)', v_fn, v_m, v_p)) = 'not_venue_staff',
      v_fn || ': another venue''s staff';
    assert tests.error_as(v_booker, format('select public.%s(%L, %L)', v_fn, v_m, v_p)) = 'not_venue_staff',
      v_fn || ': the booker, in the match';
    assert tests.error_as(v_p, format('select public.%s(%L, %L)', v_fn, v_m, v_p)) = 'not_venue_staff',
      v_fn || ': the player themselves';
    perform tests.act_as_anon();
    assert tests.error_of(format('select public.%s(%L, %L)', v_fn, v_m, v_p)) like 'permission denied%',
      v_fn || ': signed out';
    perform tests.act_as_postgres();
  end loop;

  assert tests.error_as(v_other_owner, format('select public.venue_booking_roster(%L)', v_booking.id)) = 'not_venue_staff',
    'roster: another venue';
  assert tests.error_as(v_other_owner, format('select public.venue_customer(%L, ''player'', %L)', v_venue, v_p))
         = 'not_venue_staff', 'customer: another venue';
  assert tests.error_as(v_other_owner, format('select public.venue_customer(%L, ''player'', %L)', v_other_venue, v_p))
         = 'customer_not_found', 'customer: not a customer of the other venue';

  -- Internal helpers: not callable from the app.
  foreach v_fn in array array[
    format('select public.match_attendance_state(%L, %L)', v_m, v_p),
    format('select public.match_spot_holder(%L, %L)', v_m, v_p),
    format('select public.venue_no_show_count(%L, %L)', v_venue, v_p)] loop
    assert tests.error_as(v_owner, v_fn) like 'permission denied%', 'internal: ' || v_fn;
  end loop;

  -- No direct writes to match_attendance, even for staff.
  assert tests.error_as(v_owner, format(
           'insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (%L, %L, ''venue'', %L)',
           v_m, v_p, v_owner)) like 'permission denied%', 'no direct insert';
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (v_m, v_p, 'venue', v_owner);
  assert tests.error_as(v_owner, format('delete from public.match_attendance where match_id = %L', v_m))
         like 'permission denied%', 'no direct delete';
  assert exists (select 1 from public.match_attendance where match_id = v_m and profile_id = v_p), 'still there';

  -- The method is checked.
  assert tests.error_of(format(
           'insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (%L, %L, ''staff'', %L)',
           v_m, v_booker, v_owner)) like '%match_attendance_method_check%', 'unknown method refused';
end $$;

rollback;
