-- Message the other captain from a match (20261125..._match_message_captain.sql).
-- The current captains of the two teams of a match can open their captain
-- chat and write in it even when the teams share no league. Every S13 rule
-- stays: current captains only, blocks both ways, adult-minor refused (A4),
-- a minor's first name only (A5), the rate limit.
begin;

-- A player of this age (in whole years, on today's Cyprus date).
create function tests.mmc_user(p_email text, p_age integer, p_name text)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
    'full_name', p_name));
$$;

-- Runs p_sql as p_user and returns its first column as text (null if no row).
create function tests.mmc_value(p_user uuid, p_sql text)
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

-- The error p_sql raises as p_user, or null.
create function tests.mmc_error(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as(p_user);
  v := tests.error_of(p_sql);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create temporary table mmc (k text primary key, v uuid) on commit drop;
grant all on mmc to authenticated;

-- ---- Setup: Tigers (Ana captains, Pete plays) v Wolves (Cara captains), in
-- no league together; Lions (Ben captains) not in the match; Minors (Mia, 16,
-- captains); a pickup with no teams.
do $$
declare
  ana uuid := tests.mmc_user('mmc-ana@futty.test', 30, 'Ana Adult');
  pete uuid := tests.mmc_user('mmc-pete@futty.test', 22, 'Pete Player');
  cara uuid := tests.mmc_user('mmc-cara@futty.test', 28, 'Cara Wolf');
  ben uuid := tests.mmc_user('mmc-ben@futty.test', 25, 'Ben Lion');
  mia uuid := tests.mmc_user('mmc-mia@futty.test', 16, 'Mia Minor');
  tigers uuid := tests.create_team('Tigers');
  wolves uuid := tests.create_team('Wolves');
  lions uuid := tests.create_team('Lions');
  minors uuid := tests.create_team('Minors');
begin
  perform tests.join_team(tigers, ana, 'captain');
  perform tests.join_team(tigers, pete, 'player');
  perform tests.join_team(wolves, cara, 'captain');
  perform tests.join_team(lions, ben, 'captain');
  perform tests.join_team(minors, mia, 'captain');
  insert into mmc values ('ana', ana), ('pete', pete), ('cara', cara), ('ben', ben), ('mia', mia),
    ('tigers', tigers), ('wolves', wolves), ('lions', lions), ('minors', minors),
    ('match', tests.form_match(now() - interval '3 hours', 'played', null, null, tigers, wolves)),
    ('minor_match', tests.form_match(now() - interval '3 hours', 'played', null, null, tigers, minors)),
    ('pickup', tests.form_match(now() - interval '3 hours', 'played'));
  assert not public.teams_share_league(tigers, wolves), 'Tigers and Wolves share no league';
end $$;

-- ---- Allowed: the two match captains, no shared league -------------------------
do $$
declare
  ana uuid := (select v from mmc where k = 'ana');
  cara uuid := (select v from mmc where k = 'cara');
  v_match uuid := (select v from mmc where k = 'match');
  v_row jsonb;
  v_conv uuid;
  v_again uuid;
  v_error text;
begin
  -- The button: Ana sees Wolves and Cara; Cara sees Tigers and Ana.
  perform tests.act_as(ana);
  select to_jsonb(c) into v_row from public.match_captain_contact(v_match) c;
  perform tests.act_as_postgres();
  assert v_row->>'my_team_id' = (select v from mmc where k = 'tigers')::text
     and v_row->>'team_id' = (select v from mmc where k = 'wolves')::text
     and v_row->>'team_name' = 'Wolves'
     and v_row->>'captain_id' = cara::text
     and v_row->>'captain_name' = 'Cara Wolf', format('Ana sees Cara: %s', v_row);
  assert tests.mmc_value(cara, format('select captain_name from public.match_captain_contact(%L)', v_match)) = 'Ana Adult',
    'Cara sees Ana';

  -- Ana opens the chat; Cara opening it gets the same one.
  v_conv := tests.mmc_value(ana, format('select public.open_match_captain_conversation(%L)', v_match))::uuid;
  v_again := tests.mmc_value(cara, format('select public.open_match_captain_conversation(%L)', v_match))::uuid;
  assert v_conv is not null and v_conv = v_again, format('one chat for both: %s %s', v_conv, v_again);
  assert (select kind from public.conversations where id = v_conv) = 'captains', 'a captain chat';
  assert (select count(*) from public.conversations
          where kind = 'captains' and v_conv = id
            and least(team_a_id, team_b_id) = least((select v from mmc where k = 'tigers'), (select v from mmc where k = 'wolves'))) = 1,
    'between the two teams of the match';

  -- Both write.
  v_error := tests.mmc_error(ana, format('select * from public.send_message(%L, %L, gen_random_uuid())', v_conv, 'Good game?'));
  assert v_error is null, format('Ana writes: %s', v_error);
  v_error := tests.mmc_error(cara, format('select * from public.send_message(%L, %L, gen_random_uuid())', v_conv, 'We had 3'));
  assert v_error is null, format('Cara writes: %s', v_error);
  assert (select count(*) from public.messages where conversation_id = v_conv) = 2, 'two messages';

  -- The league route stays as it was: no shared league, refused there.
  v_error := tests.mmc_error(ana, format('select public.open_captain_conversation(%L, %L)',
    (select v from mmc where k = 'tigers'), (select v from mmc where k = 'wolves')));
  assert v_error like '%teams_not_in_league%', format('league chat unchanged: %s', v_error);
end $$;

-- ---- Refused: not a captain of that match --------------------------------------
do $$
declare
  v_match uuid := (select v from mmc where k = 'match');
  v_error text;
begin
  -- A player of one of the teams.
  v_error := tests.mmc_error((select v from mmc where k = 'pete'),
    format('select public.open_match_captain_conversation(%L)', v_match));
  assert v_error like '%not_captain%', format('a player: %s', v_error);
  assert tests.mmc_value((select v from mmc where k = 'pete'),
    format('select count(*) from public.match_captain_contact(%L)', v_match)) = '0', 'a player sees no button';

  -- A captain of a team that isn't in the match.
  v_error := tests.mmc_error((select v from mmc where k = 'ben'),
    format('select public.open_match_captain_conversation(%L)', v_match));
  assert v_error like '%not_captain%', format('another team''s captain: %s', v_error);
  assert tests.mmc_value((select v from mmc where k = 'ben'),
    format('select count(*) from public.match_captain_contact(%L)', v_match)) = '0', 'no button for him';

  -- A pickup has no teams.
  v_error := tests.mmc_error((select v from mmc where k = 'ana'),
    format('select public.open_match_captain_conversation(%L)', (select v from mmc where k = 'pickup')));
  assert v_error like '%not_captain%', format('a pickup: %s', v_error);

  -- No such match.
  v_error := tests.mmc_error((select v from mmc where k = 'ana'),
    format('select public.open_match_captain_conversation(%L)', gen_random_uuid()));
  assert v_error like '%not_captain%', format('no match: %s', v_error);

  -- Signed out.
  perform tests.act_as_anon();
  v_error := tests.error_of(format('select public.open_match_captain_conversation(%L)', v_match));
  assert v_error like '%permission denied%', format('anon open: %s', v_error);
  v_error := tests.error_of(format('select * from public.match_captain_contact(%L)', v_match));
  assert v_error like '%permission denied%', format('anon contact: %s', v_error);
  perform tests.act_as_postgres();
end $$;

-- ---- Refused: a former captain --------------------------------------------------
do $$
declare
  ana uuid := (select v from mmc where k = 'ana');
  pete uuid := (select v from mmc where k = 'pete');
  v_match uuid := (select v from mmc where k = 'match');
  v_conv uuid;
  v_new uuid;
  v_error text;
begin
  v_conv := tests.mmc_value(ana, format('select public.open_match_captain_conversation(%L)', v_match))::uuid;

  -- Pete takes over the Tigers.
  update public.team_members set role = 'player' where profile_id = ana and team_id = (select v from mmc where k = 'tigers');
  update public.team_members set role = 'captain' where profile_id = pete and team_id = (select v from mmc where k = 'tigers');

  v_error := tests.mmc_error(ana, format('select public.open_match_captain_conversation(%L)', v_match));
  assert v_error like '%not_captain%', format('former captain can''t open: %s', v_error);
  v_error := tests.mmc_error(ana, format('select * from public.send_message(%L, %L, gen_random_uuid())', v_conv, 'Still me'));
  assert v_error like '%not_in_conversation%', format('former captain can''t write: %s', v_error);
  assert tests.mmc_value(ana, format('select count(*) from public.match_captain_contact(%L)', v_match)) = '0',
    'former captain sees no button';

  -- The new captain gets the same chat.
  v_new := tests.mmc_value(pete, format('select public.open_match_captain_conversation(%L)', v_match))::uuid;
  assert v_new = v_conv, 'the new captain gets the same chat';

  -- Back as before for the next blocks.
  update public.team_members set role = 'captain' where profile_id = ana and team_id = (select v from mmc where k = 'tigers');
  update public.team_members set role = 'player' where profile_id = pete and team_id = (select v from mmc where k = 'tigers');
end $$;

-- ---- Refused: blocked, either way -----------------------------------------------
do $$
declare
  ana uuid := (select v from mmc where k = 'ana');
  cara uuid := (select v from mmc where k = 'cara');
  v_match uuid := (select v from mmc where k = 'match');
  v_conv uuid := (select id from public.conversations c where c.kind = 'captains'
                  and (select v from mmc where k = 'tigers') in (c.team_a_id, c.team_b_id)
                  and (select v from mmc where k = 'wolves') in (c.team_a_id, c.team_b_id));
  v_error text;
begin
  insert into public.blocked_users (blocker_id, blocked_id) values (cara, ana);
  v_error := tests.mmc_error(ana, format('select public.open_match_captain_conversation(%L)', v_match));
  assert v_error like '%blocked%', format('blocked by the other captain: %s', v_error);
  v_error := tests.mmc_error(cara, format('select public.open_match_captain_conversation(%L)', v_match));
  assert v_error like '%blocked%', format('who blocked can''t open either: %s', v_error);
  v_error := tests.mmc_error(ana, format('select * from public.send_message(%L, %L, gen_random_uuid())', v_conv, 'Hello?'));
  assert v_error like '%blocked%', format('no writing while blocked: %s', v_error);
  delete from public.blocked_users where blocker_id = cara and blocked_id = ana;
end $$;

-- ---- Refused: an adult and a minor (A4); the minor's first name only (A5) ------
do $$
declare
  ana uuid := (select v from mmc where k = 'ana');
  mia uuid := (select v from mmc where k = 'mia');
  v_match uuid := (select v from mmc where k = 'minor_match');
  v_error text;
begin
  assert tests.mmc_value(ana, format('select captain_name from public.match_captain_contact(%L)', v_match)) = 'Mia',
    'an adult sees the minor captain''s first name only';
  v_error := tests.mmc_error(ana, format('select public.open_match_captain_conversation(%L)', v_match));
  assert v_error like '%age_pair_refused%', format('adult to minor refused: %s', v_error);
  v_error := tests.mmc_error(mia, format('select public.open_match_captain_conversation(%L)', v_match));
  assert v_error like '%age_pair_refused%', format('minor to adult refused: %s', v_error);
  assert not exists (select 1 from public.conversations c where c.kind = 'captains'
                     and (select v from mmc where k = 'minors') in (c.team_a_id, c.team_b_id)), 'no chat made';
end $$;

-- ---- The rate limit still applies ---------------------------------------------
do $$
declare
  ana uuid := (select v from mmc where k = 'ana');
  v_conv uuid := tests.mmc_value(ana, format('select public.open_match_captain_conversation(%L)', (select v from mmc where k = 'match')))::uuid;
  v_error text;
  i int;
begin
  -- Ana already sent one above; 29 more fill the minute.
  for i in 1..29 loop
    v_error := tests.mmc_error(ana, format('select * from public.send_message(%L, %L, gen_random_uuid())', v_conv, 'msg ' || i));
    assert v_error is null, format('message %s: %s', i, v_error);
  end loop;
  v_error := tests.mmc_error(ana, format('select * from public.send_message(%L, %L, gen_random_uuid())', v_conv, 'one too many'));
  assert v_error like '%rate_limited%', format('31st in a minute refused: %s', v_error);
end $$;

-- ---- Grants and security ----------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  assert has_function_privilege('authenticated', 'public.open_match_captain_conversation(uuid)', 'execute'), 'open: signed in';
  assert has_function_privilege('authenticated', 'public.match_captain_contact(uuid)', 'execute'), 'contact: signed in';
  assert not has_function_privilege('anon', 'public.open_match_captain_conversation(uuid)', 'execute'), 'open: not anon';
  assert not has_function_privilege('anon', 'public.match_captain_contact(uuid)', 'execute'), 'contact: not anon';
  assert not has_function_privilege('authenticated', 'public.match_captain_teams(uuid, uuid)', 'execute'), 'helper: internal';
  assert has_function_privilege('service_role', 'public.match_captain_teams(uuid, uuid)', 'execute'), 'helper: service role';
  select bool_and(prosecdef and proconfig @> array['search_path=""']) into v_ok
  from pg_proc where proname in ('open_match_captain_conversation', 'match_captain_contact') and pronamespace = 'public'::regnamespace;
  assert v_ok, 'security definer, empty search_path';
end $$;

rollback;
