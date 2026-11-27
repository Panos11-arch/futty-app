-- S10A: only admins run tournaments (match-record.md decision 1o). Admins
-- are rows in app_admins, which only service_role writes (Anghelo, 27
-- November): an admin can't make another admin, and the app is never
-- trusted.
begin;

do $$
declare
  v_admin uuid := tests.s10a_admin('s10a-1-admin@futty.test');
  v_user uuid := tests.create_user('s10a-1-user@futty.test');
  v_other uuid := tests.create_user('s10a-1-other@futty.test');
  v_t uuid;
  v_error text;
  v_sql text;
  v_any uuid := gen_random_uuid();
begin
  -- is_app_admin reads the caller.
  perform tests.act_as(v_admin);
  assert public.is_app_admin(), 'the admin is an admin';
  perform tests.act_as(v_user);
  assert not public.is_app_admin(), 'a player is not';
  perform tests.act_as_postgres();

  -- A non-admin is refused by every admin function.
  foreach v_sql in array array[
    'select public.admin_create_tournament(''{}'')',
    format('select public.admin_update_tournament(%L, ''{}'')', v_any),
    format('select public.admin_open_registration(%L)', v_any),
    format('select public.admin_set_groups(%L, ''{}'')', v_any),
    format('select public.admin_draw_groups(%L)', v_any),
    format('select public.admin_set_fixture_time(%L, now())', v_any),
    format('select public.admin_set_result(%L, 1, 0, null, null)', v_any),
    format('select public.admin_set_draw_order(%L, ''A'', ''{}'')', v_any),
    format('select public.admin_set_squad(%L, %L, ''{}'')', v_any, v_any),
    format('select public.admin_close_tournament(%L)', v_any)
  ] loop
    v_error := tests.error_as(v_user, v_sql);
    assert v_error = 'not_admin', v_sql || ': got ' || coalesce(v_error, 'no error');
  end loop;

  -- Signed out: no access at all.
  perform tests.act_as_anon();
  v_error := tests.error_of('select public.admin_create_tournament(''{}'')');
  perform tests.act_as_postgres();
  assert v_error like 'permission denied%', 'anon is refused, got ' || coalesce(v_error, 'no error');
  perform tests.act_as_anon();
  v_error := tests.error_of('select public.is_app_admin()');
  perform tests.act_as_postgres();
  assert v_error like 'permission denied%', 'anon cannot ask, got ' || coalesce(v_error, 'no error');

  -- An admin can't make another admin, nor read the list.
  v_error := tests.error_as(v_admin, format('insert into public.app_admins (profile_id) values (%L)', v_other));
  assert v_error like 'permission denied%', 'an admin cannot add an admin, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, 'select count(*) from public.app_admins');
  assert v_error like 'permission denied%', 'nor read app_admins, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, format('delete from public.app_admins where profile_id = %L', v_admin));
  assert v_error like 'permission denied%', 'nor remove one, got ' || coalesce(v_error, 'no error');
  -- service_role can.
  perform tests.act_as_service_role();
  insert into public.app_admins (profile_id) values (v_other);
  delete from public.app_admins where profile_id = v_other;
  perform tests.act_as_postgres();

  -- Creating: the 16-team structure only, every amount and length set by the admin.
  v_error := tests.error_as(v_admin, 'select public.admin_create_tournament(''{"name":"Cup","area":"Limassol","format":"5-a-side","maxTeams":8,"entryFeeCents":0,"matchMinutes":50}'')');
  assert v_error = 'unsupported_structure', '8 teams refused, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, 'select public.admin_create_tournament(''{"name":"Cup","area":"Limassol","format":"5-a-side","maxTeams":16,"matchMinutes":50}'')');
  assert v_error = 'invalid_entry_fee', 'entry fee required, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, 'select public.admin_create_tournament(''{"name":"Cup","area":"Limassol","format":"5-a-side","maxTeams":16,"entryFeeCents":-1,"matchMinutes":50}'')');
  assert v_error = 'invalid_entry_fee', 'no negative fee, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, 'select public.admin_create_tournament(''{"name":"Cup","area":"Limassol","format":"5-a-side","maxTeams":16,"entryFeeCents":0}'')');
  assert v_error = 'invalid_match_minutes', 'match length required, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, 'select public.admin_create_tournament(''{"name":"","area":"Limassol","format":"5-a-side","maxTeams":16,"entryFeeCents":0,"matchMinutes":50}'')');
  assert v_error = 'invalid_tournament', 'name required, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, 'select public.admin_create_tournament(''{"name":"Cup","area":"Limassol","format":"4-a-side","maxTeams":16,"entryFeeCents":0,"matchMinutes":50}'')');
  assert v_error = 'invalid_tournament', 'a known format, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_admin, 'select public.admin_create_tournament(''{"name":"Cup","area":"Limassol","format":"5-a-side","maxTeams":16,"entryFeeCents":0,"matchMinutes":50,"startDate":"2027-03-02","endDate":"2027-03-01"}'')');
  assert v_error = 'invalid_dates', 'end before start refused, got ' || coalesce(v_error, 'no error');

  -- Without dates (the Nuevo Campo cup): Coming soon until sign-up opens.
  v_t := tests.s10a_tournament(v_admin, false);
  assert (select status from public.tournaments where id = v_t) = 'coming_soon', 'created as coming_soon';
  assert (select start_date is null and end_date is null and country = 'CY' and entry_fee_cents = 500
                 and match_minutes = 50 and max_teams = 16 from public.tournaments where id = v_t), 'stored as given';
  v_error := tests.error_as(v_admin, format('select public.admin_update_tournament(%L, %L)', v_t,
                                            '{"startDate":"2027-03-06","endDate":"2027-03-07","entryFeeCents":600}'));
  assert v_error is null, 'dates and fee updated, got ' || coalesce(v_error, '');
  assert (select (start_date, end_date, entry_fee_cents) = ('2027-03-06'::date, '2027-03-07'::date, 600)
          from public.tournaments where id = v_t), 'updated';
  v_error := tests.error_as(v_admin, format('select public.admin_open_registration(%L)', v_t));
  assert v_error is null, 'opened, got ' || coalesce(v_error, '');
  assert (select status from public.tournaments where id = v_t) = 'registration', 'registration';
  v_error := tests.error_as(v_admin, format('select public.admin_open_registration(%L)', v_t));
  assert v_error = 'invalid_status', 'only once, got ' || coalesce(v_error, 'no error');

  -- No direct writes, even for an admin; everyone signed in reads.
  v_error := tests.error_as(v_admin, format('update public.tournaments set entry_fee_cents = 0 where id = %L', v_t));
  assert v_error like 'permission denied%', 'no direct update, got ' || coalesce(v_error, 'no error');
  v_error := tests.error_as(v_user, 'insert into public.tournaments (name, area, format, entry_fee_cents, match_minutes) values (''X'', ''Y'', ''5-a-side'', 0, 50)');
  assert v_error like 'permission denied%', 'no direct insert, got ' || coalesce(v_error, 'no error');
  perform tests.act_as(v_user);
  assert (select count(*) from public.tournaments where id = v_t) = 1, 'a player reads the tournament';
  perform tests.act_as_postgres();
end $$;

rollback;
