-- A2 (docs/specs/match-record.md section 4): every match table has RLS and
-- no app role writes one directly; players see a match only when they're
-- in it (or booked it, captain a side's team, or run the venue); the
-- check-in code and push deliveries are never readable by players; every
-- internal function is service_role only; every security definer function
-- pins search_path.
begin;

create function tests.mr_create(p_booking uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.act_as_service_role();
  v_id := public.create_match_for_booking(p_booking);
  perform tests.act_as_postgres();
  return v_id;
end;
$$;

do $$
declare
  v_owner uuid := tests.create_user('mr7-owner@futty.test');
  v_booker uuid := tests.create_user('mr7-booker@futty.test');
  v_outsider uuid := tests.create_user('mr7-outsider@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner);
  v_booking public.venue_bookings;
  v_match uuid;
  v_player uuid;
  v_table text;
  v_error text;
  v_role text;
begin
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.next_weekday(3));
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  v_match := tests.mr_create(v_booking.id);
  v_player := (tests.player(v_booking.id, 1)).profile_id;

  -- Who sees the match.
  perform tests.act_as(v_player);
  assert (select count(*) from public.matches where id = v_match) = 1, 'a player sees their match';
  assert (select count(*) from public.match_players where match_id = v_match) = 2, 'and its players';
  assert (select count(*) from public.match_sides where match_id = v_match) = 2, 'and its sides';
  perform tests.act_as(v_owner);
  assert (select count(*) from public.matches where id = v_match) = 1, 'the venue''s staff see it';
  perform tests.act_as(v_outsider);
  assert (select count(*) from public.matches where id = v_match) = 0, 'an outsider doesn''t';
  assert (select count(*) from public.match_players where match_id = v_match) = 0, 'nor its players';
  assert (select count(*) from public.match_attendance where match_id = v_match) = 0, 'nor attendance';
  assert (select count(*) from public.match_result_submissions where match_id = v_match) = 0, 'nor submissions';
  perform tests.act_as_postgres();

  -- No app role writes a match table, or reads the codes or deliveries.
  foreach v_role in array array['authenticated', 'anon'] loop
    if v_role = 'anon' then perform tests.act_as_anon(); else perform tests.act_as(v_booker); end if;
    foreach v_table in array array['matches', 'match_sides', 'match_players', 'match_attendance',
                                   'match_result_submissions', 'match_check_in_codes', 'notification_deliveries'] loop
      v_error := tests.error_of(format('delete from public.%I', v_table));
      assert v_error like 'permission denied%', format('%s can''t delete from %s, got %s', v_role, v_table, v_error);
      continue when v_table in ('matches', 'notification_deliveries');
      v_error := tests.error_of(format('update public.%I set match_id = match_id', v_table));
      assert v_error like 'permission denied%', format('%s can''t update %s, got %s', v_role, v_table, v_error);
    end loop;
    v_error := tests.error_of('update public.matches set status = status');
    assert v_error like 'permission denied%', format('%s can''t update matches, got %s', v_role, v_error);
    v_error := tests.error_of('update public.notification_deliveries set status = status');
    assert v_error like 'permission denied%', format('%s can''t update deliveries, got %s', v_role, v_error);
    v_error := tests.error_of(format('insert into public.matches (kind, format, players_per_side, kickoff_at, ends_at, result_deadline_at)
      values (%L, %L, 5, now(), now() + interval %L, now() + interval %L)', 'pickup', '5-a-side', '1 hour', '25 hours'));
    assert v_error like 'permission denied%', format('%s can''t insert a match, got %s', v_role, v_error);
    v_error := tests.error_of(format('insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (%L, %L, %L, %L)',
      v_match, v_booker, 'qr', v_booker));
    assert v_error like 'permission denied%', format('%s can''t check in directly, got %s', v_role, v_error);
    v_error := tests.error_of('select code from public.match_check_in_codes');
    assert v_error like 'permission denied%', format('%s can''t read check-in codes, got %s', v_role, v_error);
    v_error := tests.error_of('select count(*) from public.notification_deliveries');
    assert v_error like 'permission denied%', format('%s can''t read deliveries, got %s', v_role, v_error);
    perform tests.act_as_postgres();
  end loop;

  -- Internal functions: service_role only.
  perform tests.act_as(v_booker);
  foreach v_table in array array[
    format('select public.create_match_for_booking(%L)', v_booking.id),
    format('select public.record_match_forfeit(%L, %L, %L)', v_match, 'a', 'no_show'),
    'select public.match_jobs_tick()',
    format('select public.send_notification(%L, %L, %L)', v_booker, 'squad_post', '{}'),
    'select * from public.push_deliveries_due(1)',
    format('select public.push_delivery_result(%L, %L, null)', gen_random_uuid(), 'sent')
  ] loop
    v_error := tests.error_of(v_table);
    assert v_error like 'permission denied%', format('%s: authenticated is refused, got %s', v_table, v_error);
  end loop;
  perform tests.act_as_postgres();
end $$;

-- RLS on every new table; search_path pinned on every new security definer function.
do $$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ') into v_missing
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and c.relname in ('matches', 'match_sides', 'match_players', 'match_attendance', 'match_result_submissions',
                      'match_check_in_codes', 'notification_types', 'notification_settings', 'notification_quiet_hours',
                      'notification_deliveries')
    and not c.relrowsecurity;
  assert v_missing is null, format('RLS off on %s', v_missing);
  assert (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
          and relname in ('matches', 'match_sides', 'match_players', 'match_attendance', 'match_result_submissions',
                          'match_check_in_codes', 'notification_types', 'notification_settings', 'notification_quiet_hours',
                          'notification_deliveries')) = 10, 'all ten tables exist';

  select string_agg(p.proname, ', ') into v_missing
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and (p.proname like '%match%' or p.proname like '%notification%' or p.proname like 'push_%' or p.proname = 'is_venue_staff')
    and not coalesce('search_path=""' = any (p.proconfig), false);
  assert v_missing is null, format('security definer without search_path = '''': %s', v_missing);
end $$;

select 'match record 7 (security) passed' as result;

rollback;
