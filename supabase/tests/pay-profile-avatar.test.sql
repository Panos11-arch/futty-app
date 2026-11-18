-- A12: a player's Futty avatar (pay_profile_avatar). Initials by default; a
-- kit shirt in one of 8 kit colours with a number from 1 to 99. The owner
-- changes only their own; other players read it through the public profile
-- functions, which keep every column they returned before.
begin;

-- Defaults, checks, owner edits, someone else's row.
do $$
declare
  v_owner uuid := tests.create_user('ppa-owner@futty.test');
  v_other uuid := tests.create_user('ppa-other@futty.test');
  v_style text;
  v_colour text;
  v_number int;
  v_count int;
  v_error text;
begin
  -- A new profile shows initials.
  perform tests.act_as(v_owner);
  select avatar_style, avatar_kit_colour, avatar_number into v_style, v_colour, v_number
  from public.profiles where id = v_owner;
  assert v_style = 'initials' and v_colour is null and v_number is null,
    format('initials by default: %s %s %s', v_style, v_colour, v_number);

  -- The owner picks a kit and reads it back.
  update public.profiles set avatar_style = 'kit', avatar_kit_colour = 'kitRed', avatar_number = 10 where id = v_owner;
  select avatar_style, avatar_kit_colour, avatar_number into v_style, v_colour, v_number
  from public.profiles where id = v_owner;
  assert v_style = 'kit' and v_colour = 'kitRed' and v_number = 10, format('kit saved: %s %s %s', v_style, v_colour, v_number);

  -- Every one of the 8 kit colours saves; the numbers 1 and 99 save.
  update public.profiles set avatar_kit_colour = c, avatar_number = 1
  from unnest(array['kitRed', 'kitBlue', 'kitSky', 'kitGreen', 'kitYellow', 'kitOrange', 'kitBlack', 'kitWhite']) c
  where id = v_owner;
  update public.profiles set avatar_kit_colour = 'kitWhite', avatar_number = 99 where id = v_owner;
  select avatar_kit_colour, avatar_number into v_colour, v_number from public.profiles where id = v_owner;
  assert v_colour = 'kitWhite' and v_number = 99, format('limits save: %s %s', v_colour, v_number);

  -- Refused: unknown style, unknown colour, numbers outside 1 to 99, a kit
  -- without its colour or number.
  v_error := tests.error_of(format('update public.profiles set avatar_style = %L where id = %L', 'photo', v_owner));
  assert v_error like '%profiles_avatar_style_check%', format('unknown style refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_kit_colour = %L where id = %L', 'kitPurple', v_owner));
  assert v_error like '%profiles_avatar_kit_colour_check%', format('unknown colour refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_kit_colour = %L where id = %L', '#FF0000', v_owner));
  assert v_error like '%profiles_avatar_kit_colour_check%', format('raw colour refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_number = 0 where id = %L', v_owner));
  assert v_error like '%profiles_avatar_number_check%', format('0 refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_number = 100 where id = %L', v_owner));
  assert v_error like '%profiles_avatar_number_check%', format('100 refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_kit_colour = null where id = %L', v_owner));
  assert v_error like '%profiles_avatar_kit_check%', format('kit without colour refused: %s', v_error);
  v_error := tests.error_of(format('update public.profiles set avatar_number = null where id = %L', v_owner));
  assert v_error like '%profiles_avatar_kit_check%', format('kit without number refused: %s', v_error);
  v_error := tests.error_of(format(
    'update public.profiles set avatar_style = %L, avatar_kit_colour = null, avatar_number = null where id = %L', 'kit', v_owner));
  assert v_error like '%profiles_avatar_kit_check%', format('bare kit refused: %s', v_error);

  -- Back to initials, clearing the kit.
  update public.profiles set avatar_style = 'initials', avatar_kit_colour = null, avatar_number = null where id = v_owner;
  select avatar_style into v_style from public.profiles where id = v_owner;
  assert v_style = 'initials', 'back to initials';
  update public.profiles set avatar_style = 'kit', avatar_kit_colour = 'kitBlue', avatar_number = 7 where id = v_owner;

  -- Another player can't change it: the row isn't theirs, so nothing updates.
  perform tests.act_as(v_other);
  update public.profiles set avatar_style = 'initials', avatar_kit_colour = null, avatar_number = null where id = v_owner;
  get diagnostics v_count = row_count;
  assert v_count = 0, format('another player updates no row: %s', v_count);

  perform tests.act_as_postgres();
  select avatar_style, avatar_kit_colour, avatar_number into v_style, v_colour, v_number
  from public.profiles where id = v_owner;
  assert v_style = 'kit' and v_colour = 'kitBlue' and v_number = 7, format('unchanged: %s %s %s', v_style, v_colour, v_number);

  -- Signed out: no update at all.
  perform tests.act_as_anon();
  v_error := tests.error_of(format('update public.profiles set avatar_number = 9 where id = %L', v_owner));
  assert v_error like '%permission denied%', format('anon refused: %s', v_error);
  perform tests.act_as_postgres();
end $$;

-- Other players see the avatar through the public profile functions.
do $$
declare
  v_owner uuid := tests.create_user('ppa-pub-owner@futty.test');
  v_other uuid := tests.create_user('ppa-pub-other@futty.test');
  v_team uuid := tests.create_team('Avatar FC');
  v_row jsonb;
begin
  update public.profiles
  set username = 'ppa_owner', full_name = 'Avatar Owner', phone = '+35799000000', show_phone_publicly = false,
      avatar_style = 'kit', avatar_kit_colour = 'kitGreen', avatar_number = 23
  where id = v_owner;
  update public.profiles set username = 'ppa_other' where id = v_other;
  perform tests.join_team(v_team, v_owner);

  perform tests.act_as(v_other);

  select to_jsonb(p) into v_row from public.get_public_profile(v_owner) p;
  assert v_row->>'avatar_style' = 'kit' and v_row->>'avatar_kit_colour' = 'kitGreen' and (v_row->>'avatar_number')::int = 23,
    format('get_public_profile: %s', v_row);

  select to_jsonb(p) into v_row from public.get_public_profiles(array[v_owner]) p;
  assert v_row->>'avatar_style' = 'kit' and v_row->>'avatar_kit_colour' = 'kitGreen' and (v_row->>'avatar_number')::int = 23,
    format('get_public_profiles: %s', v_row);

  select to_jsonb(r) into v_row from public.get_team_roster(v_team) r;
  assert v_row->>'avatar_style' = 'kit' and v_row->>'avatar_kit_colour' = 'kitGreen' and (v_row->>'avatar_number')::int = 23,
    format('get_team_roster: %s', v_row);

  select to_jsonb(p) into v_row from public.list_players() p where p.id = v_owner;
  assert v_row->>'avatar_style' = 'kit' and v_row->>'avatar_kit_colour' = 'kitGreen' and (v_row->>'avatar_number')::int = 23,
    format('list_players: %s', v_row);
  -- list_players still hides a phone the player hasn't made public.
  assert v_row->>'phone' is null, format('phone stays private: %s', v_row);

  -- A player on initials reads as initials.
  select to_jsonb(p) into v_row from public.get_public_profiles(array[v_other]) p;
  assert v_row->>'avatar_style' = 'initials' and v_row->'avatar_kit_colour' = 'null'::jsonb and v_row->'avatar_number' = 'null'::jsonb,
    format('initials player: %s', v_row);

  perform tests.act_as_postgres();
end $$;

-- Each function returns every column it returned before, in the same order
-- and with the same types, plus the three avatar columns; security and
-- grants are unchanged.
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
      ('public.get_public_profile(uuid)',
       'TABLE(id uuid, username text, full_name text, city text, "position" text, preferred_foot text, xp integer, played integer, won integer, drawn integer, lost integer, goals integer, avatar_style text, avatar_kit_colour text, avatar_number smallint)'),
      ('public.get_public_profiles(uuid[])',
       'TABLE(id uuid, username text, full_name text, xp integer, avatar_style text, avatar_kit_colour text, avatar_number smallint)'),
      ('public.get_team_roster(uuid)',
       'TABLE(profile_id uuid, username text, full_name text, role text, joined_at timestamp with time zone, avatar_style text, avatar_kit_colour text, avatar_number smallint)'),
      ('public.list_players()',
       'TABLE(id uuid, username text, full_name text, phone text, avatar_style text, avatar_kit_colour text, avatar_number smallint)')
    ) as t(sig, expected)
  loop
    select pg_get_function_result(p.oid), p.proconfig, p.prosecdef, (select array_agg(a::text order by a::text) from unnest(p.proacl) a)::text
    into v_result, v_config, v_definer, v_acl
    from pg_proc p where p.oid = v_fn.sig::regprocedure;

    assert v_result = v_fn.expected, format('%s returns %s', v_fn.sig, v_result);
    assert v_definer, format('%s is security definer', v_fn.sig);
    assert v_config = array['search_path=""'], format('%s search_path: %s', v_fn.sig, v_config);
    assert has_function_privilege('authenticated', v_fn.sig, 'execute'), format('%s: authenticated executes', v_fn.sig);
    assert has_function_privilege('service_role', v_fn.sig, 'execute'), format('%s: service_role executes', v_fn.sig);
    assert not has_function_privilege('anon', v_fn.sig, 'execute'), format('%s: anon does not execute', v_fn.sig);
    -- The same grants as before, exactly: no default privileges picked up on re-create.
    assert v_acl = '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', format('%s grants: %s', v_fn.sig, v_acl);
  end loop;
end $$;

rollback;
