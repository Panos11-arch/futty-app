-- S18: illustrated avatars (20261125135506_pay_avatar_illustration.sql). A
-- player picks one of the 48 bundled ids; the owner changes only their own;
-- other players see it through the eight functions that return the avatar,
-- which keep every rule and column they had before.
begin;

-- A player of this age (in whole years, on today's Cyprus date).
create function tests.pai_user(p_email text, p_age integer, p_name text)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
    'full_name', p_name));
$$;

-- Runs p_sql as p_user and returns its first column as text (null if no row).
create function tests.pai_value(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as(p_user);
  execute p_sql into v;
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- ---- The column: defaults, checks, owner only ------------------------------------
do $$
declare
  v_owner uuid := tests.create_user('pai-owner@futty.test');
  v_other uuid := tests.create_user('pai-other@futty.test');
  v_style text;
  v_ill text;
  v_count int;
  v_error text;
begin
  perform tests.act_as(v_owner);

  -- A new profile shows initials, with no illustration.
  select avatar_style, avatar_illustration into v_style, v_ill from public.profiles where id = v_owner;
  assert v_style = 'initials' and v_ill is null, format('initials by default: %s %s', v_style, v_ill);

  -- The owner picks an illustration and reads it back.
  update public.profiles set avatar_style = 'illustration', avatar_illustration = 'avatar-07' where id = v_owner;
  select avatar_style, avatar_illustration into v_style, v_ill from public.profiles where id = v_owner;
  assert v_style = 'illustration' and v_ill = 'avatar-07', format('illustration saved: %s %s', v_style, v_ill);

  -- The first and last bundled ids save.
  update public.profiles set avatar_illustration = 'avatar-01' where id = v_owner;
  update public.profiles set avatar_illustration = 'avatar-48' where id = v_owner;
  select avatar_illustration into v_ill from public.profiles where id = v_owner;
  assert v_ill = 'avatar-48', format('last id saves: %s', v_ill);

  -- Refused: an id that isn't bundled, an illustration without an id.
  v_error := tests.error_of(format('update public.profiles set avatar_illustration = %L where id = %L', 'avatar-49', v_owner));
  assert v_error like '%profiles_avatar_illustration_check%', format('avatar-49 refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_illustration = %L where id = %L', 'avatar-00', v_owner));
  assert v_error like '%profiles_avatar_illustration_check%', format('avatar-00 refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_illustration = %L where id = %L',
    'https://example.com/me.png', v_owner));
  assert v_error like '%profiles_avatar_illustration_check%', format('a URL refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_illustration = null where id = %L', v_owner));
  assert v_error like '%profiles_avatar_illustration_required_check%', format('illustration without id refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_style = %L where id = %L', 'photo', v_owner));
  assert v_error like '%profiles_avatar_style_check%', format('a photo style is still refused: %s', v_error);

  -- Initials and kit still save, clearing the illustration.
  update public.profiles set avatar_style = 'initials', avatar_illustration = null where id = v_owner;
  update public.profiles
  set avatar_style = 'kit', avatar_kit_colour = 'kitRed', avatar_number = 9, avatar_illustration = null
  where id = v_owner;
  select avatar_style into v_style from public.profiles where id = v_owner;
  assert v_style = 'kit', format('kit still saves: %s', v_style);
  update public.profiles
  set avatar_style = 'illustration', avatar_kit_colour = null, avatar_number = null, avatar_illustration = 'avatar-12'
  where id = v_owner;

  -- Another player can't change it: the row isn't theirs, so nothing updates.
  perform tests.act_as(v_other);
  update public.profiles set avatar_illustration = 'avatar-01' where id = v_owner;
  get diagnostics v_count = row_count;
  assert v_count = 0, format('another player updates no row: %s', v_count);

  perform tests.act_as_postgres();
  select avatar_illustration into v_ill from public.profiles where id = v_owner;
  assert v_ill = 'avatar-12', format('unchanged: %s', v_ill);

  -- Signed out: no update at all.
  perform tests.act_as_anon();
  v_error := tests.error_of(format('update public.profiles set avatar_illustration = %L where id = %L', 'avatar-01', v_owner));
  assert v_error like '%permission denied%', format('anon refused: %s', v_error);
  perform tests.act_as_postgres();
end $$;

-- ---- The four public profile functions -------------------------------------------
do $$
declare
  v_owner uuid := tests.pai_user('pai-pub-owner@futty.test', 30, 'Illy Owner');
  v_viewer uuid := tests.pai_user('pai-pub-viewer@futty.test', 28, 'Vic Viewer');
  v_minor uuid := tests.pai_user('pai-pub-minor@futty.test', 15, 'Mia Minor');
  v_team uuid := tests.create_team('Illustrated FC');
  v_row jsonb;
begin
  update public.profiles
  set username = 'pai_owner', phone = '+35799000001', show_phone_publicly = false,
      avatar_style = 'illustration', avatar_illustration = 'avatar-05'
  where id = v_owner;
  update public.profiles set username = 'pai_viewer' where id = v_viewer;
  update public.profiles set username = 'pai_minor', avatar_style = 'illustration', avatar_illustration = 'avatar-30'
  where id = v_minor;
  perform tests.join_team(v_team, v_owner);
  perform tests.join_team(v_team, v_minor);

  perform tests.act_as(v_viewer);

  select to_jsonb(p) into v_row from public.get_public_profile(v_owner) p;
  assert v_row->>'avatar_style' = 'illustration' and v_row->>'avatar_illustration' = 'avatar-05'
    and v_row->>'full_name' = 'Illy Owner' and (v_row->>'xp') is not null,
    format('get_public_profile: %s', v_row);

  select to_jsonb(p) into v_row from public.get_public_profiles(array[v_owner]) p;
  assert v_row->>'avatar_illustration' = 'avatar-05' and v_row->>'username' = 'pai_owner',
    format('get_public_profiles: %s', v_row);

  select to_jsonb(r) into v_row from public.get_team_roster(v_team) r where r.profile_id = v_owner;
  assert v_row->>'avatar_illustration' = 'avatar-05' and v_row->>'role' is not null,
    format('get_team_roster: %s', v_row);

  select to_jsonb(p) into v_row from public.list_players() p where p.id = v_owner;
  assert v_row->>'avatar_illustration' = 'avatar-05', format('list_players: %s', v_row);
  assert v_row->>'phone' is null, format('phone stays private: %s', v_row);

  -- The minor rules still hold: an adult doesn't find a minor in the list,
  -- and sees only their first name, with their avatar.
  assert not exists (select 1 from public.list_players() p where p.id = v_minor), 'adults do not list minors';
  select to_jsonb(p) into v_row from public.get_public_profiles(array[v_minor]) p;
  assert v_row->'username' = 'null'::jsonb and v_row->>'full_name' = 'Mia' and v_row->>'avatar_illustration' = 'avatar-30',
    format('minor: first name only, avatar shown: %s', v_row);
  select to_jsonb(r) into v_row from public.get_team_roster(v_team) r where r.profile_id = v_minor;
  assert v_row->>'full_name' = 'Mia' and v_row->>'avatar_illustration' = 'avatar-30', format('roster minor: %s', v_row);

  -- A player on initials reads as initials, with no illustration.
  select to_jsonb(p) into v_row from public.get_public_profiles(array[v_viewer]) p;
  assert v_row->>'avatar_style' = 'initials' and v_row->'avatar_illustration' = 'null'::jsonb,
    format('initials: %s', v_row);

  perform tests.act_as_postgres();
end $$;

-- The same grants: signed in and service role only.
do $$
declare
  v_error text;
begin
  perform tests.act_as_anon();
  v_error := tests.error_of(format('select * from public.get_public_profile(%L)', gen_random_uuid()));
  assert v_error like '%permission denied%', format('anon get_public_profile: %s', v_error);
  v_error := tests.error_of(format('select * from public.get_public_profiles(array[%L]::uuid[])', gen_random_uuid()));
  assert v_error like '%permission denied%', format('anon get_public_profiles: %s', v_error);
  v_error := tests.error_of(format('select * from public.get_team_roster(%L)', gen_random_uuid()));
  assert v_error like '%permission denied%', format('anon get_team_roster: %s', v_error);
  v_error := tests.error_of('select * from public.list_players()');
  assert v_error like '%permission denied%', format('anon list_players: %s', v_error);
  v_error := tests.error_of(format('select * from public.league_captain_contacts(%L)', gen_random_uuid()));
  assert v_error like '%permission denied%', format('anon league_captain_contacts: %s', v_error);
  v_error := tests.error_of('select * from public.list_my_conversations()');
  assert v_error like '%permission denied%', format('anon list_my_conversations: %s', v_error);
  v_error := tests.error_of(format('select * from public.conversation_header(%L)', gen_random_uuid()));
  assert v_error like '%permission denied%', format('anon conversation_header: %s', v_error);
  perform tests.act_as_postgres();

  assert not has_function_privilege('authenticated', 'public.conversation_other_side(uuid, uuid)', 'execute'),
    'conversation_other_side stays internal';
  assert not has_function_privilege('anon', 'public.conversation_other_side(uuid, uuid)', 'execute'),
    'conversation_other_side: not anon';
  assert has_function_privilege('service_role', 'public.conversation_other_side(uuid, uuid)', 'execute'),
    'conversation_other_side: service role';
  assert has_function_privilege('authenticated', 'public.my_unread_message_count()', 'execute'),
    'my_unread_message_count still signed in';
end $$;

-- ---- The four message functions -----------------------------------------------------
do $$
declare
  v_ana uuid := tests.pai_user('pai-ana@futty.test', 30, 'Ana Adult');
  v_ben uuid := tests.pai_user('pai-ben@futty.test', 25, 'Ben Adult');
  v_tigers uuid := tests.create_team('Pai Tigers');
  v_lions uuid := tests.create_team('Pai Lions');
  v_league uuid;
  v_conv uuid;
begin
  perform tests.join_team(v_tigers, v_ana, 'captain');
  perform tests.join_team(v_lions, v_ben, 'captain');
  insert into public.leagues (format, scope, name, capacity) values ('5-a-side', 'Island-wide', 'Pai league', 8)
  returning id into v_league;
  insert into public.league_teams (league_id, team_id) values (v_league, v_tigers), (v_league, v_lions);
  update public.profiles set avatar_style = 'illustration', avatar_illustration = 'avatar-21' where id = v_ana;

  -- Message a captain: Ben sees Ana's illustration in the list.
  assert tests.pai_value(v_ben, format(
    'select avatar_illustration from public.league_captain_contacts(%L) where captain_id = %L', v_league, v_ana)) = 'avatar-21',
    'league_captain_contacts shows the illustration';
  assert tests.pai_value(v_ben, format(
    'select captain_name from public.league_captain_contacts(%L) where captain_id = %L', v_league, v_ana)) = 'Ana Adult',
    'with the name as before';

  -- Ana opens the chat and writes; Ben's inbox row and header show her illustration.
  perform tests.act_as(v_ana);
  v_conv := public.open_captain_conversation(v_tigers, v_lions);
  perform public.send_message(v_conv, 'Hello Lions', gen_random_uuid());
  perform tests.act_as_postgres();

  assert tests.pai_value(v_ben, 'select avatar_illustration from public.list_my_conversations()') = 'avatar-21',
    'list_my_conversations shows the illustration';
  assert tests.pai_value(v_ben, 'select title from public.list_my_conversations()') = 'Ana Adult', 'inbox title as before';
  assert tests.pai_value(v_ben, 'select unread from public.list_my_conversations()')::integer = 1, 'inbox unread as before';
  assert tests.pai_value(v_ben, 'select public.my_unread_message_count()')::integer = 1, 'the badge still counts';

  assert tests.pai_value(v_ben, format('select avatar_illustration from public.conversation_header(%L)', v_conv)) = 'avatar-21',
    'conversation_header shows the illustration';
  assert tests.pai_value(v_ben, format('select avatar_style from public.conversation_header(%L)', v_conv)) = 'illustration',
    'with its style';
  assert tests.pai_value(v_ben, format('select send_refusal from public.conversation_header(%L)', v_conv)) is null,
    'Ben can still write';

  -- Ana sees Ben on initials: no illustration.
  assert tests.pai_value(v_ana, format('select avatar_illustration from public.conversation_header(%L)', v_conv)) is null,
    'initials: no illustration';

  -- Blocks still apply.
  insert into public.blocked_users (blocker_id, blocked_id) values (v_ben, v_ana);
  assert tests.pai_value(v_ben, format('select send_refusal from public.conversation_header(%L)', v_conv)) = 'blocked',
    'blocked still refuses';
  assert tests.pai_value(v_ben, format('select blocked_by_me from public.conversation_header(%L)', v_conv))::boolean,
    'blocked_by_me as before';

  -- Someone outside the chat still gets nothing.
  assert tests.error_as(tests.pai_user('pai-out@futty.test', 30, 'Out Sider'),
    format('select * from public.conversation_header(%L)', v_conv)) = 'not_in_conversation',
    'outsiders refused';

  -- A deleted account's avatar is hidden.
  update auth.users set deleted_at = now() where id = v_ana;
  assert tests.pai_value(v_ben, format('select avatar_illustration from public.conversation_header(%L)', v_conv)) is null,
    'a deleted account shows no illustration';
end $$;

-- ---- The message functions keep their columns, security and grants --------------
-- (pay-profile-avatar.test.sql checks the four profile functions the same way.)
do $$
declare
  v_fn record;
  v_result text;
  v_config text[];
  v_definer boolean;
  v_acl text;
begin
  for v_fn in
    select * from (values
      ('public.league_captain_contacts(uuid)',
       'TABLE(my_team_id uuid, team_id uuid, team_name text, captain_id uuid, captain_name text, avatar_style text, avatar_kit_colour text, avatar_number smallint, avatar_illustration text)',
       '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
      ('public.conversation_other_side(uuid, uuid)',
       'TABLE(title text, subtitle text, other_profile_id uuid, other_team_id uuid, avatar_style text, avatar_kit_colour text, avatar_number smallint, avatar_illustration text)',
       '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.list_my_conversations()',
       'TABLE(id uuid, kind text, title text, subtitle text, other_profile_id uuid, other_team_id uuid, avatar_style text, avatar_kit_colour text, avatar_number smallint, last_body text, last_at timestamp with time zone, last_mine boolean, unread integer, avatar_illustration text)',
       '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
      ('public.conversation_header(uuid)',
       'TABLE(id uuid, kind text, title text, subtitle text, other_profile_id uuid, other_team_id uuid, my_team_id uuid, avatar_style text, avatar_kit_colour text, avatar_number smallint, send_refusal text, blocked_by_me boolean, other_read_at timestamp with time zone, other_delivered_at timestamp with time zone, friend_team_id uuid, my_captain_team_id uuid, avatar_illustration text)',
       '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}')
    ) as t(sig, expected, acl)
  loop
    select pg_get_function_result(p.oid), p.proconfig, p.prosecdef, (select array_agg(a::text order by a::text) from unnest(p.proacl) a)::text
    into v_result, v_config, v_definer, v_acl
    from pg_proc p where p.oid = v_fn.sig::regprocedure;

    assert v_result = v_fn.expected, format('%s returns %s', v_fn.sig, v_result);
    assert v_definer, format('%s is security definer', v_fn.sig);
    assert v_config = array['search_path=""'], format('%s search_path: %s', v_fn.sig, v_config);
    assert v_acl = v_fn.acl, format('%s grants: %s', v_fn.sig, v_acl);
  end loop;
end $$;

rollback;
