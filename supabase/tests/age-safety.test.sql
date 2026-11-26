-- S12: age and safety (docs/specs/05-product.md section 16, A1-A7).
--
-- Date edges use fixed instants. Where a rule can only read the clock (the
-- sign-up guard, set_date_of_birth, the A5 and A6 functions), the test reads
-- today's Cyprus date once into v_today and builds every date of birth from
-- it; now() is the transaction's start time, so it is the same instant for
-- every call inside the test.
begin;

-- Runs p_sql as p_user (or anon) and returns the error it raised, or null.
create function tests.age_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  if p_user is null then
    perform tests.act_as_anon();
  else
    perform tests.act_as(p_user);
  end if;
  v_error := tests.error_of(p_sql);
  perform tests.act_as_postgres();
  return v_error;
end;
$$;

-- A player with this date of birth (null: none yet) and name.
create function tests.age_user(p_email text, p_dob date, p_full_name text default null, p_username text default null)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_strip_nulls(jsonb_build_object(
    'date_of_birth', p_dob, 'full_name', p_full_name, 'username', p_username)));
$$;

-- Sets auth.uid() for functions called as postgres (service_role-only
-- functions that read the caller, like match_player_json).
create function tests.age_claims(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', p_user)::text, true);
$$;

-- ---- A3: Cyprus date, turning 18, 29 February ---------------------------------
do $$
begin
  -- Just before and just after midnight in Cyprus. Winter is UTC+2.
  assert public.cyprus_date('2026-11-24 21:59:59+00') = date '2026-11-24', 'winter 23:59:59 Cyprus';
  assert public.cyprus_date('2026-11-24 22:00:00+00') = date '2026-11-25', 'winter 00:00 Cyprus';
  -- Summer is UTC+3.
  assert public.cyprus_date('2026-07-14 20:59:59+00') = date '2026-07-14', 'summer 23:59:59 Cyprus';
  assert public.cyprus_date('2026-07-14 21:00:00+00') = date '2026-07-15', 'summer 00:00 Cyprus';

  -- Turning 18 on 25 November 2026: a minor the day before, an adult that day.
  assert public.is_minor_dob('2008-11-25', '2026-11-24 10:00:00+00'), 'the day before 18: minor';
  assert not public.is_minor_dob('2008-11-25', '2026-11-25 10:00:00+00'), 'the 18th birthday: adult';
  assert not public.is_minor_dob('2008-11-25', '2027-01-01 10:00:00+00'), 'after: adult';
  -- At Cyprus midnight, while it is still the 24th in UTC.
  assert public.is_minor_dob('2008-11-25', '2026-11-24 21:59:59+00'), '23:59:59 Cyprus the day before: minor';
  assert not public.is_minor_dob('2008-11-25', '2026-11-24 22:00:00+00'), '00:00 Cyprus on the birthday: adult';
  assert not public.is_minor_dob(null, '2026-11-24 22:00:00+00'), 'no date of birth is not a minor';

  -- 29 February birthdays complete a year on 1 March in other years.
  assert public.age_in_years('2008-02-29', '2026-02-28') = 17, '29 Feb: 28 Feb 2026 is still 17';
  assert public.age_in_years('2008-02-29', '2026-03-01') = 18, '29 Feb: 1 March 2026 is 18';
  assert public.age_in_years('2008-02-29', '2024-02-29') = 16, '29 Feb: a leap year birthday';
  assert public.age_in_years('2008-02-29', '2024-02-28') = 15, '29 Feb: the day before in a leap year';
  assert public.is_minor_dob('2008-02-29', '2026-02-28 21:59:59+00'), '29 Feb: 23:59:59 Cyprus on 28 Feb: minor';
  assert not public.is_minor_dob('2008-02-29', '2026-02-28 22:00:00+00'), '29 Feb: 00:00 Cyprus on 1 March: adult';
  -- 14 on 29 February (A2).
  assert public.age_in_years('2012-02-29', '2026-02-28') = 13, '29 Feb: 13 on 28 Feb 2026';
  assert public.age_in_years('2012-02-29', '2026-03-01') = 14, '29 Feb: 14 on 1 March 2026';
end;
$$;

-- ---- A2: 14 and the age status, at fixed instants ------------------------------
do $$
declare
  fourteen uuid := tests.age_user('age-14-fixed@futty.test', null);
  none uuid := tests.age_user('age-none@futty.test', null);
begin
  -- Written as the server (no JWT), so the sign-up guard's own clock doesn't matter.
  update public.profiles set date_of_birth = '2012-11-25' where id = fourteen;

  assert public.age_status(none, '2026-11-24 10:00:00+00') = 'needs_dob', 'no date of birth';
  assert public.age_status(fourteen, '2026-11-24 21:59:59+00') = 'too_young', '13 years 364 days at 23:59:59 Cyprus';
  assert public.age_status(fourteen, '2026-11-24 22:00:00+00') = 'ok', '14 at 00:00 Cyprus';
  assert public.age_status(fourteen, '2026-11-24 10:00:00+00') = 'too_young', 'the day before 14';
  assert public.age_status(fourteen, '2026-11-25 10:00:00+00') = 'ok', 'the 14th birthday';
end;
$$;

-- ---- A1, A2: sign-up ----------------------------------------------------------
do $$
declare
  v_today date := tests.cyprus_today();
  v_fourteen date := (v_today - interval '14 years')::date;
  v_error text;
  v_ok uuid;
begin
  -- Exactly 14 today: allowed, and the date is stored.
  v_ok := tests.age_user('age-signup-14@futty.test', v_fourteen, 'Fourteen Today', 'fourteen_today');
  assert (select date_of_birth from public.profiles where id = v_ok) = v_fourteen, 'sign-up stores the date of birth';
  assert public.age_status(v_ok) = 'ok', '14 today is ok';

  -- 13 years and 364 days: refused, no account.
  v_error := tests.error_of(format(
    'select tests.age_user(%L, %L::date)', 'age-signup-13@futty.test', v_fourteen + 1));
  assert v_error = 'too_young', format('13 years 364 days signs up: %s', v_error);
  assert not exists (select 1 from auth.users where email = 'age-signup-13@futty.test'), 'no account under 14';

  -- A future date is refused; no date at all is allowed (asked on first open).
  v_error := tests.error_of(format('select tests.age_user(%L, %L::date)', 'age-future@futty.test', v_today + 1));
  assert v_error = 'invalid_date', format('future date of birth: %s', v_error);
  v_ok := tests.age_user('age-signup-none@futty.test', null);
  assert public.age_status(v_ok) = 'needs_dob', 'Apple and Google users are asked later';

  -- A metadata value that isn't a date is ignored.
  v_ok := tests.create_user('age-signup-junk@futty.test', '{"date_of_birth":"not a date"}');
  assert public.age_status(v_ok) = 'needs_dob', 'junk date of birth is asked again';

  -- The sign-up form's check, signed out.
  perform tests.act_as_anon();
  assert public.date_of_birth_allowed(v_fourteen), 'anon: 14 today allowed';
  assert not public.date_of_birth_allowed(v_fourteen + 1), 'anon: 13 years 364 days refused';
  assert not public.date_of_birth_allowed(v_today + 1), 'anon: future refused';
  assert not public.date_of_birth_allowed(null), 'anon: none refused';
  perform tests.act_as_postgres();
end;
$$;

-- ---- A1: set once, locked, owner only -----------------------------------------
do $$
declare
  v_today date := tests.cyprus_today();
  me uuid := tests.age_user('age-me@futty.test', null);
  other uuid := tests.age_user('age-other@futty.test', '1990-05-05');
  young uuid := tests.age_user('age-young@futty.test', null);
  v_error text;
  v_status text;
begin
  perform tests.act_as(me);
  assert public.my_age_status() = 'needs_dob', 'asked on next open';
  perform tests.act_as_postgres();

  v_error := tests.age_as(me, format('select public.set_date_of_birth(%L)', v_today + 1));
  assert v_error = 'invalid_date', format('future: %s', v_error);
  v_error := tests.age_as(me, 'select public.set_date_of_birth(null)');
  assert v_error = 'invalid_date', format('null: %s', v_error);

  perform tests.act_as(me);
  v_status := public.set_date_of_birth('2000-01-01');
  assert v_status = 'ok', format('set: %s', v_status);
  assert public.my_age_status() = 'ok', 'ok after setting';
  perform tests.act_as_postgres();

  -- Locked: not through the function, nor a direct write, nor clearing it.
  v_error := tests.age_as(me, 'select public.set_date_of_birth(''1990-01-01'')');
  assert v_error = 'date_of_birth_locked', format('second set: %s', v_error);
  v_error := tests.age_as(me, format('update public.profiles set date_of_birth = %L where id = %L', '1990-01-01', me));
  assert v_error = 'date_of_birth_locked', format('direct change: %s', v_error);
  v_error := tests.age_as(me, format('update public.profiles set date_of_birth = null where id = %L', me));
  assert v_error = 'date_of_birth_locked', format('clear: %s', v_error);
  -- Writing the same date back (an older app's Edit profile) is fine.
  v_error := tests.age_as(me, format('update public.profiles set date_of_birth = %L, city = %L where id = %L',
    '2000-01-01', 'Limassol', me));
  assert v_error is null, format('same date: %s', v_error);
  assert (select date_of_birth from public.profiles where id = me) = date '2000-01-01', 'unchanged';

  -- Account deletion (service_role) clears it.
  perform tests.act_as_service_role();
  update public.profiles set date_of_birth = null where id = other;
  update public.profiles set date_of_birth = '1990-05-05' where id = other;
  perform tests.act_as_postgres();

  -- Nobody else reads it: no row through RLS, no column in any public function.
  perform tests.act_as(other);
  assert not exists (select 1 from public.profiles where id = me), 'another player reads my profile row';
  perform tests.act_as_postgres();
  assert not exists (
    select 1 from information_schema.routines r
    join information_schema.parameters p on p.specific_name = r.specific_name
    where r.routine_schema = 'public'
      and r.routine_name in ('get_public_profile', 'get_public_profiles', 'get_team_roster', 'list_players',
                             'find_profile_by_username')
      and p.parameter_name ilike '%birth%'), 'a public function returns the date of birth';

  -- An existing player under 14 is locked (and the date is kept, A2).
  perform tests.act_as(young);
  v_status := public.set_date_of_birth((v_today - interval '14 years')::date + 1);
  assert v_status = 'too_young', format('existing under 14: %s', v_status);
  assert public.my_age_status() = 'too_young', 'locked';
  perform tests.act_as_postgres();
  v_error := tests.age_as(young, 'select public.set_date_of_birth(''1990-01-01'')');
  assert v_error = 'date_of_birth_locked', format('locked player changes it: %s', v_error);

  -- Signed out.
  v_error := tests.age_as(null, 'select public.my_age_status()');
  assert v_error like 'permission denied%', format('anon my_age_status: %s', v_error);
  v_error := tests.age_as(null, 'select public.set_date_of_birth(''2000-01-01'')');
  assert v_error like 'permission denied%', format('anon set_date_of_birth: %s', v_error);
end;
$$;

-- ---- Internal functions: service_role only --------------------------------------
do $$
declare
  me uuid := tests.age_user('age-internal@futty.test', '1990-01-01');
  v_sql text;
  v_error text;
begin
  foreach v_sql in array array[
    format('select public.is_minor(%L)', me),
    format('select public.age_pair_allowed(%L, %L)', me, me),
    format('select public.age_status(%L)', me),
    'select public.is_minor_dob(''2000-01-01'')',
    'select public.cyprus_date(now())',
    'select public.age_in_years(''2000-01-01'', ''2020-01-01'')',
    'select public.assert_age_ok()',
    'select public.minor_first_name(''a'', ''b'')',
    format('select public.name_hidden(%L, null)', me),
    format('select public.fixture_has_minor_captain(%L)', me),
    'select * from public.urgent_report_alerts_due()',
    format('select public.urgent_report_alert_emailed(%L)', me),
    'select * from public.admin_reports'
  ] loop
    v_error := tests.age_as(me, v_sql);
    assert v_error like 'permission denied%', format('authenticated runs %s: %s', v_sql, v_error);
    v_error := tests.age_as(null, v_sql);
    assert v_error like 'permission denied%', format('anon runs %s: %s', v_sql, v_error);
  end loop;
end;
$$;

-- ---- A4: adult and minor pairs --------------------------------------------------
do $$
declare
  adult uuid := tests.age_user('age-pair-adult@futty.test', '1990-01-01');
  adult2 uuid := tests.age_user('age-pair-adult2@futty.test', '1985-06-01');
  minor uuid := tests.age_user('age-pair-minor@futty.test', '2010-03-03');
  minor2 uuid := tests.age_user('age-pair-minor2@futty.test', '2011-04-04');
  turning uuid := tests.age_user('age-pair-turning@futty.test', '2008-11-25');
  none uuid := tests.age_user('age-pair-none@futty.test', null);
begin
  assert public.age_pair_allowed(adult, adult2, '2026-11-24 10:00:00+00'), 'adult and adult';
  assert public.age_pair_allowed(minor, minor2, '2026-11-24 10:00:00+00'), 'minor and minor';
  assert not public.age_pair_allowed(adult, minor, '2026-11-24 10:00:00+00'), 'adult and minor';
  assert not public.age_pair_allowed(minor, adult, '2026-11-24 10:00:00+00'), 'minor and adult';
  -- Turning 18 on 25 November: refused with an adult until Cyprus midnight.
  assert not public.age_pair_allowed(adult, turning, '2026-11-24 21:59:59+00'), 'turning 18: 23:59:59 the day before';
  assert public.age_pair_allowed(adult, turning, '2026-11-24 22:00:00+00'), 'turning 18: 00:00 on the birthday';
  assert public.age_pair_allowed(minor, turning, '2026-11-24 21:59:59+00'), 'turning 18 with a minor the day before';
  assert not public.age_pair_allowed(minor, turning, '2026-11-24 22:00:00+00'), 'turned 18 with a minor';
  -- is_minor reads the profile.
  assert public.is_minor(minor, '2026-11-24 10:00:00+00'), 'is_minor: minor';
  assert not public.is_minor(adult, '2026-11-24 10:00:00+00'), 'is_minor: adult';
  assert not public.is_minor(none, '2026-11-24 10:00:00+00'), 'is_minor: no date of birth';
  assert not public.is_minor(gen_random_uuid(), '2026-11-24 10:00:00+00'), 'is_minor: no profile';
end;
$$;

-- ---- A5: names and search -------------------------------------------------------
do $$
declare
  v_today date := tests.cyprus_today();
  adult uuid := tests.age_user('age-name-adult@futty.test', '1990-01-01', 'Andreas Adult', 'andreas_adult');
  minor uuid := tests.age_user('age-name-minor@futty.test', (v_today - interval '15 years')::date,
                               'Maria Georgiou', 'maria_minor');
  minor2 uuid := tests.age_user('age-name-minor2@futty.test', (v_today - interval '16 years')::date,
                                'Nikos Minor', 'nikos_minor');
  -- 18 today: an adult. 18 tomorrow: still a minor.
  eighteen uuid := tests.age_user('age-name-18@futty.test', (v_today - interval '18 years')::date,
                                  'Eleni Eighteen', 'eleni_18');
  almost uuid := tests.age_user('age-name-17@futty.test', (v_today - interval '18 years')::date + 1,
                                'Petros Almost', 'petros_17');
  no_name uuid := tests.age_user('age-name-noname@futty.test', (v_today - interval '15 years')::date, null, 'noname_minor');
  v_team uuid := tests.create_team('Age Name FC');
  v_match uuid;
  v_player uuid;
  v_row record;
begin
  perform tests.join_team(v_team, minor);
  perform tests.join_team(v_team, adult);

  -- An adult sees the minor's first name only, and no username.
  perform tests.act_as(adult);
  select * into v_row from public.get_public_profile(minor);
  assert v_row.full_name = 'Maria' and v_row.username is null, format('adult reads a minor: %s', row_to_json(v_row));
  select * into v_row from public.get_public_profile(eighteen);
  assert v_row.full_name = 'Eleni Eighteen' and v_row.username = 'eleni_18', '18 today: full name';
  select * into v_row from public.get_public_profile(almost);
  assert v_row.full_name = 'Petros' and v_row.username is null, '18 tomorrow: first name';
  select * into v_row from public.get_public_profile(no_name);
  assert v_row.full_name = 'Player' and v_row.username is null, 'a minor with no name';
  assert (select full_name from public.get_public_profiles(array[minor, adult]) where id = minor) = 'Maria',
    'get_public_profiles: minor';
  assert (select full_name from public.get_public_profiles(array[minor, adult]) where id = adult) = 'Andreas Adult',
    'get_public_profiles: adult';
  assert (select username from public.get_public_profiles(array[minor]) where id = minor) is null,
    'get_public_profiles: no username';
  assert (select full_name from public.get_team_roster(v_team) where profile_id = minor) = 'Maria', 'roster: minor';
  assert (select username from public.get_team_roster(v_team) where profile_id = minor) is null, 'roster: no username';
  assert (select full_name from public.get_team_roster(v_team) where profile_id = adult) = 'Andreas Adult', 'roster: adult';

  -- Adults' player search leaves minors out.
  assert not exists (select 1 from public.list_players() where id in (minor, minor2, almost)), 'adult lists minors';
  assert exists (select 1 from public.list_players() where id = eighteen), 'adult lists an 18-year-old';
  assert not exists (select 1 from public.find_profile_by_username('maria_minor')), 'adult finds a minor by username';
  assert exists (select 1 from public.find_profile_by_username('eleni_18')), 'adult finds an adult by username';
  perform tests.act_as_postgres();

  -- A minor sees their own full name, and another minor's first name.
  perform tests.act_as(minor);
  select * into v_row from public.get_public_profile(minor);
  assert v_row.full_name = 'Maria Georgiou' and v_row.username = 'maria_minor', 'a minor reads themselves';
  select * into v_row from public.get_public_profile(minor2);
  assert v_row.full_name = 'Nikos' and v_row.username is null, 'a minor reads another minor';
  assert exists (select 1 from public.list_players() where id = minor2 and full_name = 'Nikos' and username is null),
    'a minor lists another minor, first name only';
  assert exists (select 1 from public.list_players() where id = adult), 'a minor lists adults';
  select * into v_row from public.find_profile_by_username('nikos_minor');
  assert v_row.full_name = 'Nikos' and v_row.username is null, 'a minor finds another minor';
  select * into v_row from public.find_profile_by_username('maria_minor');
  assert v_row.full_name = 'Maria Georgiou', 'a minor finds themselves';
  perform tests.act_as_postgres();

  -- The match page.
  v_match := tests.form_match('2026-11-07T17:00:00Z', 'confirmed', 3, 1);
  perform tests.form_player(v_match, minor, 'a', false, false);
  select id into v_player from public.match_players where match_id = v_match and profile_id = minor;
  perform tests.age_claims(adult);
  assert public.match_player_json(v_player) ->> 'name' = 'Maria', 'match page: adult sees the first name';
  perform tests.age_claims(minor);
  assert public.match_player_json(v_player) ->> 'name' = 'Maria Georgiou', 'match page: the minor sees their name';
end;
$$;

-- ---- A6: fixture chat -------------------------------------------------------------
do $$
declare
  v_today date := tests.cyprus_today();
  adult_cap uuid := tests.age_user('age-chat-adult@futty.test', '1990-01-01');
  minor_cap uuid := tests.age_user('age-chat-minor@futty.test', (v_today - interval '16 years')::date);
  adult_cap2 uuid := tests.age_user('age-chat-adult2@futty.test', '1988-01-01');
  turned_cap uuid := tests.age_user('age-chat-18@futty.test', (v_today - interval '18 years')::date);
  almost_cap uuid := tests.age_user('age-chat-17@futty.test', (v_today - interval '18 years')::date + 1);
  minor_player uuid := tests.age_user('age-chat-minor-player@futty.test', (v_today - interval '15 years')::date);
  t_adult uuid := tests.create_team('Chat Adults');
  t_minor uuid := tests.create_team('Chat Minors');
  t_adult2 uuid := tests.create_team('Chat Adults 2');
  t_turned uuid := tests.create_team('Chat Turned 18');
  t_almost uuid := tests.create_team('Chat Almost 18');
  v_league uuid;
  f_mixed uuid;
  f_adults uuid;
  f_turned uuid;
  f_almost uuid;
  v_venue uuid := tests.create_venue();
  v_error text;
begin
  perform tests.join_team(t_adult, adult_cap, 'captain');
  perform tests.join_team(t_minor, minor_cap, 'captain');
  perform tests.join_team(t_adult2, adult_cap2, 'captain');
  -- A minor who is only a player doesn't block the captains' chat.
  perform tests.join_team(t_adult2, minor_player, 'player');
  perform tests.join_team(t_turned, turned_cap, 'captain');
  perform tests.join_team(t_almost, almost_cap, 'captain');

  insert into public.leagues (format, scope, capacity, name) values ('5-a-side', 'city', 8, 'Age League')
  on conflict (format, scope) where parent_league_id is null do update set name = excluded.name
  returning id into v_league;
  insert into public.league_fixtures (league_id, home_team_id, away_team_id) values (v_league, t_adult, t_minor)
  returning id into f_mixed;
  insert into public.league_fixtures (league_id, home_team_id, away_team_id) values (v_league, t_adult, t_adult2)
  returning id into f_adults;
  insert into public.league_fixtures (league_id, home_team_id, away_team_id) values (v_league, t_adult, t_turned)
  returning id into f_turned;
  insert into public.league_fixtures (league_id, home_team_id, away_team_id) values (v_league, t_adult, t_almost)
  returning id into f_almost;

  -- Either captain a minor: free text refused, from both sides.
  v_error := tests.age_as(adult_cap, format('select public.send_fixture_message(%L, %L)', f_mixed, 'hi'));
  assert v_error = 'minor_chat_blocked', format('adult captain writes to a minor captain: %s', v_error);
  v_error := tests.age_as(minor_cap, format('select public.send_fixture_message(%L, %L)', f_mixed, 'hi'));
  assert v_error = 'minor_chat_blocked', format('minor captain writes: %s', v_error);
  v_error := tests.age_as(almost_cap, format('select public.send_fixture_message(%L, %L)', f_almost, 'hi'));
  assert v_error = 'minor_chat_blocked', format('18 tomorrow: %s', v_error);
  assert not exists (select 1 from public.fixture_messages where fixture_id in (f_mixed, f_almost)), 'no message stored';

  -- Adult captains (a minor in a squad doesn't count), and 18 today: allowed.
  v_error := tests.age_as(adult_cap, format('select public.send_fixture_message(%L, %L)', f_adults, 'hi'));
  assert v_error is null, format('adult captains: %s', v_error);
  v_error := tests.age_as(turned_cap, format('select public.send_fixture_message(%L, %L)', f_turned, 'hi'));
  assert v_error is null, format('18 today: %s', v_error);
  -- The existing checks still come first.
  v_error := tests.age_as(minor_player, format('select public.send_fixture_message(%L, %L)', f_mixed, 'hi'));
  assert v_error = 'not_captain', format('not a captain: %s', v_error);

  -- Date proposals keep working.
  v_error := tests.age_as(minor_cap, format('select public.propose_fixture_schedule(%L, %L, %L, %L)',
    f_mixed, v_today + 1, '19:00', v_venue));
  assert v_error is null, format('minor captain proposes a date: %s', v_error);
  v_error := tests.age_as(adult_cap, format('select public.propose_fixture_schedule(%L, %L, %L, %L)',
    f_mixed, v_today + 1, '19:00', v_venue));
  assert v_error is null, format('adult captain proposes a date: %s', v_error);

  -- Scores keep working.
  update public.league_fixtures
  set status = 'agreed', scheduled_day = v_today - 1, scheduled_time = '18:00'
  where id = f_mixed;
  v_error := tests.age_as(minor_cap, format('select public.submit_fixture_score(%L, 2, 1)', f_mixed));
  assert v_error is null, format('minor captain submits a score: %s', v_error);
  v_error := tests.age_as(adult_cap, format('select public.submit_fixture_score(%L, 2, 1)', f_mixed));
  assert v_error is null, format('adult captain submits a score: %s', v_error);
end;
$$;

-- ---- A2: a locked account can't chat ------------------------------------------------
do $$
declare
  v_today date := tests.cyprus_today();
  young uuid := tests.age_user('age-locked@futty.test', null);
  adult uuid := tests.age_user('age-locked-adult@futty.test', '1990-01-01');
  t_young uuid := tests.create_team('Locked FC');
  t_adult uuid := tests.create_team('Open FC');
  v_league uuid;
  v_fixture uuid;
  v_error text;
begin
  update public.profiles set date_of_birth = (v_today - interval '13 years')::date where id = young;
  perform tests.join_team(t_young, young, 'captain');
  perform tests.join_team(t_adult, adult, 'captain');
  insert into public.leagues (format, scope, capacity, name) values ('5-a-side', 'city', 8, 'Locked League')
  on conflict (format, scope) where parent_league_id is null do update set name = excluded.name
  returning id into v_league;
  insert into public.league_fixtures (league_id, home_team_id, away_team_id) values (v_league, t_young, t_adult)
  returning id into v_fixture;

  v_error := tests.age_as(young, format('select public.send_fixture_message(%L, %L)', v_fixture, 'hi'));
  assert v_error = 'too_young', format('locked account: %s', v_error);
end;
$$;

-- ---- A7: reports ----------------------------------------------------------------------
do $$
declare
  v_today date := tests.cyprus_today();
  adult uuid := tests.age_user('age-report-adult@futty.test', '1990-01-01');
  adult2 uuid := tests.age_user('age-report-adult2@futty.test', '1991-01-01');
  minor uuid := tests.age_user('age-report-minor@futty.test', (v_today - interval '15 years')::date);
  turned uuid := tests.age_user('age-report-18@futty.test', (v_today - interval '18 years')::date);
  t_adult uuid := tests.create_team('Report Adults');
  t_minor uuid := tests.create_team('Report Minors');
  v_league uuid;
  v_fixture uuid;
  v_error text;
  v_due record;
  v_count integer;
begin
  perform tests.join_team(t_adult, adult, 'captain');
  perform tests.join_team(t_minor, minor, 'captain');
  insert into public.leagues (format, scope, capacity, name) values ('5-a-side', 'city', 8, 'Report League')
  on conflict (format, scope) where parent_league_id is null do update set name = excluded.name
  returning id into v_league;
  insert into public.league_fixtures (league_id, home_team_id, away_team_id) values (v_league, t_adult, t_minor)
  returning id into v_fixture;

  -- Adult reports adult: not urgent, even if the app says so; no alert.
  v_error := tests.age_as(adult, format(
    'insert into public.reports (reporter_id, reported_user_id, context, reason, urgent) values (%L, %L, %L, %L, true)',
    adult, adult2, 'player', 'adult-adult'));
  assert v_error is null, format('adult reports adult: %s', v_error);
  assert (select not urgent from public.reports where reason = 'adult-adult'), 'adult-adult not urgent';
  -- 18 today is an adult.
  v_error := tests.age_as(adult, format(
    'insert into public.reports (reporter_id, reported_user_id, context, reason) values (%L, %L, %L, %L)',
    adult, turned, 'player', 'adult-18'));
  assert v_error is null, format('adult reports an 18-year-old: %s', v_error);
  assert (select not urgent from public.reports where reason = 'adult-18'), 'an 18-year-old is not a minor';

  -- Adult reports a minor; a minor reports an adult; a chat with a minor captain.
  v_error := tests.age_as(adult, format(
    'insert into public.reports (reporter_id, reported_user_id, context, reason) values (%L, %L, %L, %L)',
    adult, minor, 'player', 'about-minor'));
  assert v_error is null, format('adult reports a minor: %s', v_error);
  v_error := tests.age_as(minor, format(
    'insert into public.reports (reporter_id, reported_user_id, context, reason) values (%L, %L, %L, %L)',
    minor, adult, 'player', 'by-minor'));
  assert v_error is null, format('minor reports an adult: %s', v_error);
  v_error := tests.age_as(adult, format(
    'insert into public.reports (reporter_id, context, context_id, reason) values (%L, %L, %L, %L)',
    adult, 'fixture_chat', v_fixture, 'minor-chat'));
  assert v_error is null, format('report a chat with a minor captain: %s', v_error);
  v_error := tests.age_as(adult, format(
    'insert into public.reports (reporter_id, context, context_id, reason) values (%L, %L, %L, %L)',
    adult, 'team', t_minor, 'minor-team'));
  assert v_error is null, format('report a team with a minor: %s', v_error);
  assert (select bool_and(urgent) from public.reports where reason in ('about-minor', 'by-minor', 'minor-chat', 'minor-team')),
    'reports involving a minor are urgent';

  -- Refused: reporting as someone else, reading reports back, signed out.
  v_error := tests.age_as(adult, format(
    'insert into public.reports (reporter_id, context, reason) values (%L, %L, %L)', adult2, 'player', 'forged'));
  assert v_error like '%row-level security%', format('report as someone else: %s', v_error);
  perform tests.act_as(adult);
  assert not exists (select 1 from public.reports), 'a player reads reports';
  perform tests.act_as_postgres();
  v_error := tests.age_as(null, format(
    'insert into public.reports (reporter_id, context, reason) values (%L, %L, %L)', adult, 'player', 'anon'));
  assert v_error like 'permission denied%', format('anon reports: %s', v_error);

  -- One alert per urgent report, emailed once.
  select count(*) into v_count from public.admin_alerts a
  where a.kind = 'minor_report'
    and (a.details ->> 'report_id')::uuid in (select id from public.reports where reason like 'adult-%');
  assert v_count = 0, 'no alert for adult reports';

  perform tests.act_as_service_role();
  select count(*) into v_count from public.urgent_report_alerts_due();
  assert v_count = 4, format('four alerts due: %s', v_count);
  for v_due in select * from public.urgent_report_alerts_due() loop
    assert v_due.report_id in (select id from public.reports where urgent), 'the alert names the report';
    perform public.urgent_report_alert_emailed(v_due.alert_id);
  end loop;
  select count(*) into v_count from public.urgent_report_alerts_due();
  assert v_count = 0, 'emailed alerts are not due again';

  -- The founders' list: urgent first.
  assert (select flag from public.admin_reports limit 1) = 'Urgent', 'urgent reports first';
  assert (select count(*) from public.admin_reports where flag = 'Urgent') = 4, 'four urgent reports';
  perform tests.act_as_postgres();
end;
$$;

-- ---- Blocks: own rows only ---------------------------------------------------------------
do $$
declare
  a uuid := tests.age_user('age-block-a@futty.test', '1990-01-01');
  b uuid := tests.age_user('age-block-b@futty.test', '1990-01-01');
  v_error text;
begin
  v_error := tests.age_as(a, format('insert into public.blocked_users (blocker_id, blocked_id) values (%L, %L)', a, b));
  assert v_error is null, format('block: %s', v_error);
  v_error := tests.age_as(a, format('insert into public.blocked_users (blocker_id, blocked_id) values (%L, %L)', b, a));
  assert v_error like '%row-level security%', format('block as someone else: %s', v_error);
  perform tests.act_as(b);
  assert not exists (select 1 from public.blocked_users), 'the blocked player sees the block';
  perform tests.act_as_postgres();
end;
$$;

rollback;
