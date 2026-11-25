-- S14 security: signed-in players read the teams, their players and the
-- shapes; signed-out users read nothing; the skips, the pick and the
-- placement are service_role only; nobody else writes; a player switches
-- "Premium and offers" for themselves only. Security definer functions set
-- search_path = ''.
begin;

do $$
declare
  v_user uuid := tests.create_user('s14sec@futty.test');
  v_other uuid := tests.create_user('s14sec-other@futty.test');
  v_table text;
  v_error text;
begin
  -- Signed in: read.
  perform tests.act_as(v_user);
  foreach v_table in array array['team_of_the_week', 'team_of_the_week_players', 'team_of_the_week_shapes'] loop
    assert tests.error_of(format('select count(*) from public.%I', v_table)) is null, format('%s readable', v_table);
  end loop;
  assert (select count(*) from public.team_of_the_week_shapes) = 5, 'the five shapes';
  assert (select array[keepers, defenders, midfielders, strikers] from public.team_of_the_week_shapes
          where format = '9-a-side') = array[1, 3, 3, 2], '9-a-side: 1, 3, 3, 2';

  -- Service role only.
  v_error := tests.error_of('select count(*) from public.team_of_the_week_skips');
  assert v_error like 'permission denied%', format('skips: %s', v_error);
  assert tests.error_of('select public.team_of_the_week_tick()') like 'permission denied%', 'tick';
  assert tests.error_of('select * from public.team_of_the_week_place(''5-a-side'', ''[]'')') like 'permission denied%',
    'placement';
  assert tests.error_of('select public.team_of_the_week_skip_scope(''general'', ''all'', '''')') like 'permission denied%',
    'skip scope';

  -- No writes.
  v_error := tests.error_of(format(
    'insert into public.team_of_the_week (week_start, kind, area, area_key, area_name, format, matches) values (%L, %L, %L, %L, %L, %L, 1)',
    '2026-11-09', 'general', 'all', '', 'All Cyprus', '5-a-side'));
  assert v_error like 'permission denied%', format('insert a team: %s', v_error);
  v_error := tests.error_of('delete from public.team_of_the_week_players');
  assert v_error like 'permission denied%', format('delete players: %s', v_error);
  v_error := tests.error_of('update public.team_of_the_week_shapes set strikers = 4');
  assert v_error like 'permission denied%', format('change a shape: %s', v_error);
  v_error := tests.error_of('update public.notification_types set default_enabled = true');
  assert v_error like 'permission denied%', format('change a default: %s', v_error);

  -- Premium and offers: own setting only.
  assert tests.error_of(format('insert into public.notification_settings (profile_id, type, enabled) values (%L, %L, true)',
                               v_user, 'premium_offers')) is null, 'own: switched on';
  assert tests.error_of(format('insert into public.notification_settings (profile_id, type, enabled) values (%L, %L, true)',
                               v_other, 'premium_offers')) is not null, 'someone else''s: refused';
  assert (select default_enabled from public.notification_types where type = 'premium_offers') = false
         and (select not always_sent from public.notification_types where type = 'premium_offers'),
    'readable: off by default, can be switched';

  -- Signed out: nothing.
  perform tests.act_as_anon();
  foreach v_table in array array['team_of_the_week', 'team_of_the_week_players', 'team_of_the_week_shapes'] loop
    assert tests.error_of(format('select count(*) from public.%I', v_table)) like 'permission denied%',
      format('%s hidden from anon', v_table);
  end loop;
  perform tests.act_as_postgres();

  -- RLS on every new table.
  assert (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname in ('team_of_the_week', 'team_of_the_week_players', 'team_of_the_week_shapes',
                              'team_of_the_week_skips')), 'RLS on';

  -- Security definer functions set search_path = ''.
  assert (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('team_of_the_week_tick', 'team_of_the_week_place', 'team_of_the_week_skip_scope',
                              'send_notification', 'venue_highlights')),
    'security definer with search_path = ''''';
end $$;

rollback;
