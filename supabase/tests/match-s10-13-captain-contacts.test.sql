-- S10 screens (20261127090000_match_s10_captain_contacts.sql): the competition
-- page shows a fixture row's message button only when the captain chat would
-- open. league_captain_contacts.can_message says so, with the same check
-- open_captain_conversation makes: blocked either way, or an adult and a minor
-- who aren't friends (A4), against every captain of the other team.
begin;

create function tests.s10c_user(p_email text, p_age integer, p_name text)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
    'full_name', p_name));
$$;

-- can_message for p_team as seen by p_user (null when the team isn't listed).
create function tests.s10c_can(p_user uuid, p_league uuid, p_team uuid)
returns boolean
language plpgsql
as $$
declare
  v boolean;
begin
  perform tests.act_as(p_user);
  select c.can_message into v from public.league_captain_contacts(p_league) c where c.team_id = p_team;
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- The error open_captain_conversation raises as p_user, or null when it opens.
create function tests.s10c_open(p_user uuid, p_mine uuid, p_other uuid)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as(p_user);
  v := tests.error_of(format('select public.open_captain_conversation(%L, %L)', p_mine, p_other));
  perform tests.act_as_postgres();
  return v;
end;
$$;

create temporary table s10c (k text primary key, v uuid) on commit drop;
grant all on s10c to authenticated;

-- ---- Setup: Tigers (Ana, 30), Lions (Ben, 25, and co-captain Cleo, 27) and
-- Minors (Mia, 16) in one league.
do $$
declare
  ana uuid := tests.s10c_user('s10c-ana@futty.test', 30, 'Ana Adult');
  ben uuid := tests.s10c_user('s10c-ben@futty.test', 25, 'Ben Adult');
  cleo uuid := tests.s10c_user('s10c-cleo@futty.test', 27, 'Cleo Adult');
  mia uuid := tests.s10c_user('s10c-mia@futty.test', 16, 'Mia Minor');
  tigers uuid := tests.create_team('Tigers');
  lions uuid := tests.create_team('Lions');
  minors uuid := tests.create_team('Minors');
  v_league uuid;
begin
  perform tests.join_team(tigers, ana, 'captain');
  perform tests.join_team(lions, ben, 'captain');
  perform tests.join_team(lions, cleo, 'captain');
  perform tests.join_team(minors, mia, 'captain');
  insert into public.leagues (format, scope, name, capacity) values ('5-a-side', 'Island-wide', 'S10 contacts', 8)
  returning id into v_league;
  insert into public.league_teams (league_id, team_id) values (v_league, tigers), (v_league, lions), (v_league, minors);
  insert into s10c values ('ana', ana), ('ben', ben), ('cleo', cleo), ('mia', mia),
    ('tigers', tigers), ('lions', lions), ('minors', minors), ('league', v_league);
end $$;

-- ---- Allowed: two adult captains, no block --------------------------------------
do $$
declare
  ana uuid := (select v from s10c where k = 'ana');
  ben uuid := (select v from s10c where k = 'ben');
  league uuid := (select v from s10c where k = 'league');
  tigers uuid := (select v from s10c where k = 'tigers');
  lions uuid := (select v from s10c where k = 'lions');
begin
  assert tests.s10c_can(ana, league, lions) is true, 'Ana can message Lions';
  assert tests.s10c_can(ben, league, tigers) is true, 'Ben can message Tigers';
  assert tests.s10c_open(ana, tigers, lions) is null, 'and the chat opens';
end $$;

-- ---- Refused: an adult and a minor ----------------------------------------------
do $$
declare
  ana uuid := (select v from s10c where k = 'ana');
  mia uuid := (select v from s10c where k = 'mia');
  league uuid := (select v from s10c where k = 'league');
  tigers uuid := (select v from s10c where k = 'tigers');
  minors uuid := (select v from s10c where k = 'minors');
  v_error text;
begin
  -- Still listed (first name only, A5), but no button.
  assert tests.s10c_can(ana, league, minors) is false, 'adult to minor: can_message false';
  assert tests.s10c_can(mia, league, tigers) is false, 'minor to adult: can_message false';
  v_error := tests.s10c_open(ana, tigers, minors);
  assert v_error like '%age_pair_refused%', format('the server refuses it too: %s', v_error);
  v_error := tests.s10c_open(mia, minors, tigers);
  assert v_error like '%age_pair_refused%', format('either way: %s', v_error);
end $$;

-- ---- Refused: blocked, either way -----------------------------------------------
do $$
declare
  ana uuid := (select v from s10c where k = 'ana');
  ben uuid := (select v from s10c where k = 'ben');
  league uuid := (select v from s10c where k = 'league');
  tigers uuid := (select v from s10c where k = 'tigers');
  lions uuid := (select v from s10c where k = 'lions');
  v_error text;
begin
  insert into public.blocked_users (blocker_id, blocked_id) values (ben, ana);
  assert tests.s10c_can(ana, league, lions) is false, 'blocked by the other captain: false';
  assert tests.s10c_can(ben, league, tigers) is false, 'who blocked: false too';
  v_error := tests.s10c_open(ana, tigers, lions);
  assert v_error like '%blocked%', format('the server refuses it: %s', v_error);
  delete from public.blocked_users where blocker_id = ben and blocked_id = ana;
  assert tests.s10c_can(ana, league, lions) is true, 'unblocked: true again';
end $$;

-- ---- Refused: a block by any captain of that team counts ------------------------
do $$
declare
  ana uuid := (select v from s10c where k = 'ana');
  cleo uuid := (select v from s10c where k = 'cleo');
  league uuid := (select v from s10c where k = 'league');
  tigers uuid := (select v from s10c where k = 'tigers');
  lions uuid := (select v from s10c where k = 'lions');
  v_error text;
begin
  insert into public.blocked_users (blocker_id, blocked_id) values (ana, cleo);
  assert tests.s10c_can(ana, league, lions) is false, 'Ana blocked Lions'' co-captain: false';
  v_error := tests.s10c_open(ana, tigers, lions);
  assert v_error like '%blocked%', format('the server refuses it: %s', v_error);
  delete from public.blocked_users where blocker_id = ana and blocked_id = cleo;
end $$;

-- ---- Grants unchanged -----------------------------------------------------------
do $$
begin
  assert has_function_privilege('authenticated', 'public.league_captain_contacts(uuid)', 'execute'), 'signed-in players';
  assert not has_function_privilege('anon', 'public.league_captain_contacts(uuid)', 'execute'), 'not signed out';
  assert (select prosecdef from pg_proc where oid = 'public.league_captain_contacts(uuid)'::regprocedure), 'security definer';
  assert (select proconfig from pg_proc where oid = 'public.league_captain_contacts(uuid)'::regprocedure) = array['search_path=""'],
    'search_path is empty';
end $$;

rollback;
