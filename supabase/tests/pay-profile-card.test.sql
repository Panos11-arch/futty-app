-- S19: the player card (20261125160318_pay_profile_card.sql). Position,
-- strong foot and favourite player on profiles, owner only, checked by the
-- server; my_player_card() returns everything the card shows, for the
-- signed-in player only, with the QR hidden for a minor (age rule A5).
begin;

-- A player of this age (in whole years, on today's Cyprus date).
create function tests.ppc_user(p_email text, p_age integer, p_name text)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
    'full_name', p_name));
$$;

-- my_player_card() as p_user, as one jsonb row (null if no row).
create function tests.ppc_card(p_user uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  select to_jsonb(c) into v from public.my_player_card() c;
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- ---- The columns: values, checks, owner only ------------------------------------
do $$
declare
  v_owner uuid := tests.create_user('ppc-owner@futty.test');
  v_other uuid := tests.create_user('ppc-other@futty.test');
  v_row record;
  v_count int;
  v_error text;
begin
  perform tests.act_as(v_owner);

  -- Empty by default.
  select "position", preferred_foot, favourite_player into v_row from public.profiles where id = v_owner;
  assert v_row.position is null and v_row.preferred_foot is null and v_row.favourite_player is null,
    format('empty by default: %s', to_jsonb(v_row));

  -- Every allowed value saves.
  update public.profiles set "position" = 'Goalkeeper', preferred_foot = 'Left' where id = v_owner;
  update public.profiles set "position" = 'Defender', preferred_foot = 'Right' where id = v_owner;
  update public.profiles set "position" = 'Midfielder', preferred_foot = 'Both' where id = v_owner;
  update public.profiles set "position" = 'Forward' where id = v_owner;
  update public.profiles set favourite_player = repeat('a', 40) where id = v_owner;
  update public.profiles set favourite_player = 'Iniesta' where id = v_owner;
  select "position", preferred_foot, favourite_player into v_row from public.profiles where id = v_owner;
  assert v_row.position = 'Forward' and v_row.preferred_foot = 'Both' and v_row.favourite_player = 'Iniesta',
    format('saved: %s', to_jsonb(v_row));

  -- Refused: another position (Striker is now Forward), another foot, a
  -- favourite player over 40 characters, blank, or with spaces around it.
  v_error := tests.error_of(format('update public.profiles set "position" = %L where id = %L', 'Striker', v_owner));
  assert v_error like '%profiles_position_check%', format('Striker refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set "position" = %L where id = %L', 'Winger', v_owner));
  assert v_error like '%profiles_position_check%', format('Winger refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set preferred_foot = %L where id = %L', 'left', v_owner));
  assert v_error like '%profiles_preferred_foot_check%', format('lower-case foot refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set favourite_player = %L where id = %L', repeat('a', 41), v_owner));
  assert v_error like '%profiles_favourite_player_check%', format('41 characters refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set favourite_player = %L where id = %L', '   ', v_owner));
  assert v_error like '%profiles_favourite_player_check%', format('blank refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set favourite_player = %L where id = %L', ' Iniesta', v_owner));
  assert v_error like '%profiles_favourite_player_check%', format('untrimmed refused: %s', v_error);

  -- Cleared with null.
  update public.profiles set "position" = null, preferred_foot = null, favourite_player = null where id = v_owner;
  update public.profiles set favourite_player = 'Iniesta' where id = v_owner;

  -- Another player can't change it: the row isn't theirs, so nothing updates.
  perform tests.act_as(v_other);
  update public.profiles set favourite_player = 'Someone else' where id = v_owner;
  get diagnostics v_count = row_count;
  assert v_count = 0, format('another player updates no row: %s', v_count);

  perform tests.act_as_postgres();
  select favourite_player into v_row from public.profiles where id = v_owner;
  assert v_row.favourite_player = 'Iniesta', format('unchanged: %s', to_jsonb(v_row));

  -- Signed out: no update at all.
  perform tests.act_as_anon();
  v_error := tests.error_of(format('update public.profiles set favourite_player = %L where id = %L', 'Anon', v_owner));
  assert v_error like '%permission denied%', format('anon refused: %s', v_error);
  perform tests.act_as_postgres();
end $$;

-- ---- my_player_card(): an adult with everything filled in -----------------------
do $$
declare
  v_me uuid := tests.ppc_user('ppc-me@futty.test', 30, 'Dimi Card');
  v_league_old uuid := tests.create_team('Old League FC');
  v_league_new uuid := tests.create_team('New League FC');
  v_casual uuid := tests.create_team('Sunday Casuals');
  v_other_team uuid := tests.create_team('Not Mine FC');
  v_league uuid;
  v_card jsonb;
begin
  update public.profiles
  set username = 'ppc_me', "position" = 'Midfielder', preferred_foot = 'Right', favourite_player = 'Iniesta',
      created_at = '2026-03-31 22:30:00+00'  -- 1 April 01:30 in Cyprus
  where id = v_me;
  insert into public.player_levels (profile_id, level, source) values (v_me, 4.25, 'questionnaire');

  -- The casual team is joined first; the two league teams later.
  perform tests.join_team(v_casual, v_me);
  update public.team_members set joined_at = now() - interval '3 days' where team_id = v_casual and profile_id = v_me;
  perform tests.join_team(v_league_old, v_me);
  update public.team_members set joined_at = now() - interval '2 days' where team_id = v_league_old and profile_id = v_me;
  perform tests.join_team(v_league_new, v_me, 'captain');
  update public.team_members set joined_at = now() - interval '1 day' where team_id = v_league_new and profile_id = v_me;

  insert into public.leagues (format, scope, capacity) values ('5', 'ppc-test', 8) returning id into v_league;
  insert into public.league_teams (league_id, team_id) values (v_league, v_league_old), (v_league, v_league_new),
    (v_league, v_other_team);

  v_card := tests.ppc_card(v_me);
  assert v_card->>'username' = 'ppc_me', format('username: %s', v_card);
  assert v_card->>'full_name' = 'Dimi Card', format('name: %s', v_card);
  assert (v_card->>'level')::numeric = 4.25, format('level: %s', v_card);
  assert v_card->>'position' = 'Midfielder' and v_card->>'preferred_foot' = 'Right'
    and v_card->>'favourite_player' = 'Iniesta', format('details: %s', v_card);
  -- Member since is the Cyprus date the account was made.
  assert v_card->>'member_since' = '2026-04-01', format('member since in Cyprus time: %s', v_card);
  -- League teams first (oldest first), then the rest; at most 2, plus the count.
  assert v_card->'teams' = jsonb_build_array(
      jsonb_build_object('id', v_league_old, 'name', 'Old League FC'),
      jsonb_build_object('id', v_league_new, 'name', 'New League FC')),
    format('league teams first, two at most: %s', v_card->'teams');
  assert (v_card->>'team_count')::int = 3, format('team count: %s', v_card);
  assert (v_card->>'show_qr')::boolean, format('an adult with a username shows the QR: %s', v_card);
  -- Nothing private: no phone, email or date of birth.
  assert not (v_card ? 'phone' or v_card ? 'email' or v_card ? 'date_of_birth'),
    format('nothing private: %s', v_card);

  -- The avatar comes with it.
  assert v_card ? 'avatar_style' and v_card ? 'avatar_illustration', format('avatar: %s', v_card);
end $$;

-- ---- my_player_card(): empty profile, a minor, no username, signed out ------------
do $$
declare
  v_new uuid := tests.ppc_user('ppc-new@futty.test', 25, 'New Player');
  v_minor uuid := tests.ppc_user('ppc-minor@futty.test', 15, 'Mia Minor');
  v_card jsonb;
  v_error text;
  v_ok boolean;
begin
  -- No username, no level, no teams: the card still loads, without a QR.
  update public.profiles set username = null where id = v_new;
  v_card := tests.ppc_card(v_new);
  assert v_card->>'level' is null and v_card->>'position' is null and v_card->>'favourite_player' is null,
    format('empty fields are null: %s', v_card);
  assert v_card->'teams' = '[]'::jsonb and (v_card->>'team_count')::int = 0, format('no teams: %s', v_card);
  assert not (v_card->>'show_qr')::boolean, format('no username, no QR: %s', v_card);

  -- A minor sees their own full card, but never the QR (A5).
  update public.profiles set username = 'ppc_minor' where id = v_minor;
  v_card := tests.ppc_card(v_minor);
  assert v_card->>'full_name' = 'Mia Minor' and v_card->>'username' = 'ppc_minor',
    format('a minor sees their own name: %s', v_card);
  assert not (v_card->>'show_qr')::boolean, format('a minor has no QR: %s', v_card);

  -- Signed out: refused.
  perform tests.act_as_anon();
  v_error := tests.error_of('select * from public.my_player_card()');
  assert v_error like '%permission denied%', format('anon refused: %s', v_error);
  perform tests.act_as_postgres();

  -- Grants: signed-in players only.
  select has_function_privilege('authenticated', 'public.my_player_card()', 'execute') into v_ok;
  assert v_ok, 'authenticated can call it';
  select has_function_privilege('anon', 'public.my_player_card()', 'execute') into v_ok;
  assert not v_ok, 'anon cannot call it';
  select prosecdef and proconfig @> array['search_path=""'] into v_ok
  from pg_proc where oid = 'public.my_player_card()'::regprocedure;
  assert v_ok, 'security definer with an empty search_path';
end $$;

-- ---- Reports of a favourite player -----------------------------------------------
do $$
declare
  v_reporter uuid := tests.ppc_user('ppc-reporter@futty.test', 30, 'Rita Reporter');
  v_adult uuid := tests.ppc_user('ppc-adult@futty.test', 30, 'Adam Adult');
  v_minor uuid := tests.ppc_user('ppc-minor2@futty.test', 16, 'Max Minor');
  v_urgent boolean;
begin
  perform tests.act_as(v_reporter);
  insert into public.reports (reporter_id, reported_user_id, context, reason)
  values (v_reporter, v_adult, 'favourite_player', 'Offensive');
  insert into public.reports (reporter_id, reported_user_id, context, reason)
  values (v_reporter, v_minor, 'favourite_player', 'Offensive');
  perform tests.act_as_postgres();

  select urgent into v_urgent from public.reports where reported_user_id = v_adult and context = 'favourite_player';
  assert not v_urgent, 'an adult''s favourite player: not urgent';
  -- A7: a report involving a minor is urgent.
  select urgent into v_urgent from public.reports where reported_user_id = v_minor and context = 'favourite_player';
  assert v_urgent, 'a minor''s favourite player: urgent';
end $$;

rollback;
