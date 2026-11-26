-- S7 Community, part 2: player search (search_players). Same age group only
-- (A5), first names only for minors, blocks either way, short queries.
begin;

create function tests.cs_user(p_dob date, p_full_name text, p_username text)
returns uuid
language sql
as $$
  select tests.create_user('cs-' || gen_random_uuid() || '@futty.test', jsonb_build_object(
    'date_of_birth', p_dob, 'full_name', p_full_name, 'username', p_username));
$$;

create function tests.cs_search(p_as uuid, p_query text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_as);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'username', s.username)
                            order by s.full_name), '[]') into v
  from public.search_players(p_query) s;
  perform tests.act_as_postgres();
  return v;
end;
$$;

do $$
declare
  v_adult uuid := tests.cs_user((tests.cyprus_today() - interval '30 years')::date, 'Andreas Zorbas', 'andreas_z');
  v_adult2 uuid := tests.cs_user((tests.cyprus_today() - interval '25 years')::date, 'Anna Zorba', 'anna_z');
  v_blocked uuid := tests.cs_user((tests.cyprus_today() - interval '25 years')::date, 'Zeno Blocked', 'zeno_z');
  v_blocker uuid := tests.cs_user((tests.cyprus_today() - interval '25 years')::date, 'Zack Blocker', 'zack_z');
  v_minor uuid := tests.cs_user((tests.cyprus_today() - interval '15 years')::date, 'Maria Zorbaki', 'maria_z');
  v_minor2 uuid := tests.cs_user((tests.cyprus_today() - interval '16 years')::date, 'Marios Kypriou', 'marios_k');
  v_rows jsonb;
  v_error text;
begin
  insert into public.blocked_users (blocker_id, blocked_id) values (v_adult, v_blocked);
  insert into public.blocked_users (blocker_id, blocked_id) values (v_blocker, v_adult);

  -- An adult: adults only, not blocked either way, not themselves.
  v_rows := tests.cs_search(v_adult, 'zorb');
  assert jsonb_array_length(v_rows) = 1, 'adult finds only Anna, got ' || v_rows::text;
  assert v_rows -> 0 ->> 'id' = v_adult2::text, 'Anna';
  assert v_rows -> 0 ->> 'username' = 'anna_z', 'an adult''s username';
  assert tests.cs_search(v_adult, 'maria') = '[]', 'an adult never finds a minor by first name';
  assert tests.cs_search(v_adult, 'maria_z') = '[]', 'nor by username';
  assert tests.cs_search(v_adult, 'zeno') = '[]', 'a player I blocked: hidden';
  assert tests.cs_search(v_adult, 'zack') = '[]', 'a player who blocked me: hidden';
  assert jsonb_array_length(tests.cs_search(v_adult2, 'zeno')) = 1, 'someone else still finds Zeno';

  -- By username prefix.
  assert tests.cs_search(v_adult, 'anna_') -> 0 ->> 'id' = v_adult2::text, 'username prefix';
  -- Wildcards are literal.
  assert tests.cs_search(v_adult, '%%') = '[]', 'a % query matches nothing';

  -- Short or empty queries return nothing.
  assert tests.cs_search(v_adult, 'a') = '[]', 'one character: nothing';
  assert tests.cs_search(v_adult, '  ') = '[]', 'blank: nothing';
  assert tests.cs_search(v_adult, null) = '[]', 'null: nothing';

  -- A minor: minors only, first name only, never a hidden surname.
  v_rows := tests.cs_search(v_minor, 'mari');
  assert jsonb_array_length(v_rows) = 1, 'minor finds Marios only, got ' || v_rows::text;
  assert v_rows -> 0 ->> 'name' = 'Marios', 'first name only';
  assert v_rows -> 0 ->> 'username' is null, 'no username for a minor';
  assert tests.cs_search(v_minor, 'kypriou') = '[]', 'a minor''s hidden surname never matches';
  assert tests.cs_search(v_minor, 'marios_k') = '[]', 'a minor''s hidden username never matches';
  assert tests.cs_search(v_minor, 'zorb') = '[]', 'a minor finds no adult';

  -- Anon: refused.
  perform tests.act_as_anon();
  v_error := tests.error_of('select * from public.search_players(''zorb'')');
  perform tests.act_as_postgres();
  assert v_error is not null, 'anon: refused';
end;
$$;

rollback;
