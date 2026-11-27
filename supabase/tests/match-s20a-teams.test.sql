-- S20A (a): your own teams (match_s20a_teams migration). Any player makes as
-- many teams as they like, with members chosen from their friends; each
-- friend gets an invite (push + in-app) and only accepted members count. The
-- captain removes members, cancels invites and passes the captaincy; a
-- member leaves; the last member deletes the team, which hides it and keeps
-- its history (decided by Anghelo, 27 November). invite_team_member keeps
-- adding by username (no friends check) but now refuses blocked and
-- adult-minor pairs (A4).
begin;

create function tests.s20a_user(p_email text, p_age integer, p_name text, p_username text)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
    'full_name', p_name,
    'username', p_username));
$$;

create function tests.s20a_friends(p_a uuid, p_b uuid)
returns void
language sql
as $$
  insert into public.friendships (requester_id, addressee_id, status, accepted_at) values (p_a, p_b, 'accepted', now());
$$;

-- Runs p_sql as p_user and returns its single value as text.
create function tests.s20a_value(p_user uuid, p_sql text)
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

-- p_user makes a team with p_members; returns its id.
create function tests.s20a_team(p_user uuid, p_name text, p_members uuid[] default '{}', p_roster integer default 11)
returns uuid
language sql
as $$
  select tests.s20a_value(p_user, format(
    'select (public.create_my_team(%L, ''Nicosia'', ''kitBlue'', %s, 0, %L::uuid[])).id',
    p_name, p_roster, p_members))::uuid;
$$;

create function tests.s20a_invite(p_team uuid, p_profile uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.invites where kind = 'team' and team_id = p_team and invited_profile_id = p_profile
  order by created_at desc limit 1;
$$;

create function tests.s20a_role(p_team uuid, p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.team_members where team_id = p_team and profile_id = p_profile;
$$;

create temporary table s20a (k text primary key, v uuid) on commit drop;
grant all on s20a to authenticated;

do $$
declare
  ana uuid := tests.s20a_user('s20a-ana@futty.test', 30, 'Ana Captain', 'ana_s20a');
  ben uuid := tests.s20a_user('s20a-ben@futty.test', 25, 'Ben Friend', 'ben_s20a');
  cy uuid := tests.s20a_user('s20a-cy@futty.test', 27, 'Cy Friend', 'cy_s20a');
  dee uuid := tests.s20a_user('s20a-dee@futty.test', 28, 'Dee Stranger', 'dee_s20a');
  eve uuid := tests.s20a_user('s20a-eve@futty.test', 33, 'Eve Blocked', 'eve_s20a');
  mia uuid := tests.s20a_user('s20a-mia@futty.test', 16, 'Mia Minor', 'mia_s20a');
  tom uuid := tests.s20a_user('s20a-tom@futty.test', 17, 'Tom Minor', 'tom_s20a');
begin
  perform tests.s20a_friends(ana, ben);
  perform tests.s20a_friends(cy, ana);
  perform tests.s20a_friends(ana, eve);
  perform tests.s20a_friends(ana, mia);   -- made while both were allowed; A4 refuses now
  perform tests.s20a_friends(mia, tom);
  insert into public.blocked_users (blocker_id, blocked_id) values (eve, ana);
  insert into s20a values ('ana', ana), ('ben', ben), ('cy', cy), ('dee', dee), ('eve', eve), ('mia', mia), ('tom', tom);
end $$;

-- ---- create_my_team ------------------------------------------------------------------------
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  ben uuid := (select v from s20a where k = 'ben');
  cy uuid := (select v from s20a where k = 'cy');
  team uuid;
  t public.teams;
  n record;
begin
  team := tests.s20a_team(ana, '  Ana FC  ', array[ben, cy, ben]);
  insert into s20a values ('team', team);
  select * into t from public.teams where id = team;
  assert t.name = 'Ana FC', 'trimmed name';
  assert t.city = 'Nicosia' and t.kit_colour = 'kitBlue', 'city and kit colour';
  assert t.created_by = ana and t.deleted_at is null, 'made by Ana, not deleted';
  assert tests.s20a_role(team, ana) = 'captain', 'the maker is captain';
  assert (select count(*) from public.team_members where team_id = team) = 1, 'only the captain counts until they accept';
  assert (select count(*) from public.invites where team_id = team and status = 'pending') = 2, 'one invite each, duplicates ignored';
  select * into n from public.notifications where profile_id = ben and type = 'team_invite' order by created_at desc limit 1;
  assert n.data ->> 'inviteId' = tests.s20a_invite(team, ben)::text and n.data ->> 'teamId' = team::text, 'invite data';
  assert n.body = 'Ana Captain invited you to join Ana FC.', format('invite text: %s', n.body);
  assert n.title = 'Team invite', 'title';
end $$;

-- A player makes as many teams as they like.
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  i integer;
begin
  for i in 1..12 loop
    perform tests.s20a_team(ana, format('Ana %s', i));
  end loop;
  assert (select count(*) from public.team_members where profile_id = ana and role = 'captain') = 13, 'no limit on teams';
end $$;

-- Refusals: each creates nothing.
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  ben uuid := (select v from s20a where k = 'ben');
  cy uuid := (select v from s20a where k = 'cy');
  dee uuid := (select v from s20a where k = 'dee');
  eve uuid := (select v from s20a where k = 'eve');
  mia uuid := (select v from s20a where k = 'mia');
  before integer := (select count(*) from public.teams);
  e text;
begin
  e := tests.error_as(ana, format('select public.create_my_team(''X'', ''Nicosia'', ''kitRed'', 11, 0, %L::uuid[])', array[ben, dee]));
  assert e = 'not_friends', format('a non-friend: %s', e);
  e := tests.error_as(ana, format('select public.create_my_team(''X'', ''Nicosia'', ''kitRed'', 11, 0, %L::uuid[])', array[eve]));
  assert e = 'blocked', format('blocked: %s', e);
  e := tests.error_as(ana, format('select public.create_my_team(''X'', ''Nicosia'', ''kitRed'', 11, 0, %L::uuid[])', array[mia]));
  assert e = 'age_pair_refused', format('adult and minor: %s', e);
  e := tests.error_as(ana, 'select public.create_my_team(''X'', ''Nicosia'', ''kitPink'', 11, 0, ''{}'')');
  assert e = 'invalid_kit_colour', format('kit colour: %s', e);
  e := tests.error_as(ana, 'select public.create_my_team(''  '', ''Nicosia'', ''kitRed'', 11, 0, ''{}'')');
  assert e = 'name_required', format('name: %s', e);
  e := tests.error_as(ana, format('select public.create_my_team(''X'', ''Nicosia'', ''kitRed'', 2, 0, %L::uuid[])', array[ben, cy]));
  assert e = 'team_full', format('more members than the roster: %s', e);
  perform tests.act_as_anon();
  e := tests.error_of('select public.create_my_team(''X'', ''Nicosia'', ''kitRed'', 11, 0, ''{}'')');
  perform tests.act_as_postgres();
  assert e like 'permission denied%', format('anon: %s', e);
  assert (select count(*) from public.teams) = before, 'nothing created';
end $$;

-- Two minors can make a team together.
do $$
declare
  mia uuid := (select v from s20a where k = 'mia');
  tom uuid := (select v from s20a where k = 'tom');
  team uuid := tests.s20a_team(mia, 'Minors FC', array[tom]);
begin
  assert tests.s20a_invite(team, tom) is not null, 'minor friends';
end $$;

-- ---- Accept and decline ----------------------------------------------------------------------
do $$
declare
  team uuid := (select v from s20a where k = 'team');
  ben uuid := (select v from s20a where k = 'ben');
  cy uuid := (select v from s20a where k = 'cy');
begin
  perform tests.s20a_value(ben, format('select public.accept_invite(%L)', tests.s20a_invite(team, ben)));
  assert tests.s20a_role(team, ben) = 'player', 'accepted: a member';
  perform tests.s20a_value(cy, format('select public.decline_invite(%L)', tests.s20a_invite(team, cy)));
  assert tests.s20a_role(team, cy) is null, 'declined: not a member';
end $$;

-- An invite answered after a block, or once a pair is refused (A4), is refused.
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  cy uuid := (select v from s20a where k = 'cy');
  team uuid := tests.s20a_team(ana, 'Later FC', array[cy]);
  e text;
begin
  insert into public.blocked_users (blocker_id, blocked_id) values (cy, ana);
  e := tests.error_as(cy, format('select public.accept_invite(%L)', tests.s20a_invite(team, cy)));
  assert e = 'blocked', format('blocked after the invite: %s', e);
  assert tests.s20a_role(team, cy) is null, 'not joined';
  delete from public.blocked_users where blocker_id = cy and blocked_id = ana;
end $$;

do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  mia uuid := (select v from s20a where k = 'mia');
  team uuid := tests.create_team('Old Invite FC');
  invite uuid;
  e text;
begin
  -- An invite from before A4 checks (inserted directly).
  perform tests.join_team(team, ana, 'captain');
  insert into public.invites (kind, team_id, team_role, invited_profile_id, invited_by)
  values ('team', team, 'player', mia, ana) returning id into invite;
  e := tests.error_as(mia, format('select public.accept_invite(%L)', invite));
  assert e = 'age_pair_refused', format('adult captain, minor invitee: %s', e);
end $$;

-- ---- invite_team_member: by username still works for non-friends; blocks and A4 refused ------
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  dee uuid := (select v from s20a where k = 'dee');
  eve uuid := (select v from s20a where k = 'eve');
  mia uuid := (select v from s20a where k = 'mia');
  team uuid := (select v from s20a where k = 'team');
  e text;
begin
  perform tests.s20a_value(ana, format('select (public.invite_team_member(%L, %L, ''player'')).id', team, dee));
  assert tests.s20a_invite(team, dee) is not null, 'a non-friend is still invited';
  e := tests.error_as(ana, format('select public.invite_team_member(%L, %L, ''player'')', team, eve));
  assert e = 'blocked', format('blocked: %s', e);
  e := tests.error_as(ana, format('select public.invite_team_member(%L, %L, ''player'')', team, mia));
  assert e = 'age_pair_refused', format('adult and minor: %s', e);
end $$;

-- ---- Captain tools ---------------------------------------------------------------------------
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  ben uuid := (select v from s20a where k = 'ben');
  cy uuid := (select v from s20a where k = 'cy');
  dee uuid := (select v from s20a where k = 'dee');
  team uuid := (select v from s20a where k = 'team');
  invite uuid := tests.s20a_invite(team, dee);
  e text;
begin
  -- Cancel a pending invite.
  e := tests.error_as(ben, format('select public.cancel_team_invite(%L)', invite));
  assert e = 'not_captain', format('a player cancels: %s', e);
  perform tests.s20a_value(ana, format('select public.cancel_team_invite(%L)', invite));
  assert (select status from public.invites where id = invite) = 'cancelled', 'cancelled';
  e := tests.error_as(dee, format('select public.accept_invite(%L)', invite));
  assert e = 'invite_not_pending', format('a cancelled invite: %s', e);

  -- Remove.
  e := tests.error_as(ben, format('select public.remove_team_member(%L, %L)', team, ana));
  assert e = 'not_captain', format('a player removes: %s', e);
  e := tests.error_as(ana, format('select public.remove_team_member(%L, %L)', team, ana));
  assert e = 'use_leave', format('remove yourself: %s', e);
  e := tests.error_as(ana, format('select public.remove_team_member(%L, %L)', team, cy));
  assert e = 'not_member', format('remove a non-member: %s', e);

  -- Pass the captaincy.
  e := tests.error_as(ben, format('select public.pass_captaincy(%L, %L)', team, ben));
  assert e = 'not_captain', format('a player passes: %s', e);
  e := tests.error_as(ana, format('select public.pass_captaincy(%L, %L)', team, cy));
  assert e = 'not_member', format('to a non-member: %s', e);
  e := tests.error_as(ana, format('select public.pass_captaincy(%L, %L)', team, ana));
  assert e = 'already_captain', format('to yourself: %s', e);
  perform tests.s20a_value(ana, format('select public.pass_captaincy(%L, %L)', team, ben));
  assert tests.s20a_role(team, ben) = 'captain' and tests.s20a_role(team, ana) = 'player', 'roles swapped';
  assert exists (select 1 from public.notifications where profile_id = ben and type = 'team_captain'
                 and data ->> 'teamId' = team::text), 'the new captain is told';

  -- Leave.
  e := tests.error_as(ben, format('select public.leave_team(%L)', team));
  assert e = 'captain_must_pass', format('the captain leaves with others: %s', e);
  e := tests.error_as(cy, format('select public.leave_team(%L)', team));
  assert e = 'not_member', format('a non-member leaves: %s', e);
  perform tests.s20a_value(ana, format('select public.leave_team(%L)', team));
  assert tests.s20a_role(team, ana) is null, 'a member left';

  -- Remove, now that Ben is captain and Ana is back.
  perform tests.join_team(team, ana, 'player');
  perform tests.s20a_value(ben, format('select public.remove_team_member(%L, %L)', team, ana));
  assert tests.s20a_role(team, ana) is null, 'removed';
  assert exists (select 1 from public.notifications where profile_id = ana and type = 'team_member_removed'), 'told';

  -- The last member can't leave; they delete.
  e := tests.error_as(ben, format('select public.leave_team(%L)', team));
  assert e = 'use_delete', format('the last member leaves: %s', e);
end $$;

-- The captain sees the team's open invites, whoever sent them; nobody else does.
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  ben uuid := (select v from s20a where k = 'ben');
  cy uuid := (select v from s20a where k = 'cy');
  team uuid := tests.s20a_team(ana, 'Pending FC', array[ben, cy]);
  r jsonb;
  e text;
begin
  perform tests.s20a_value(ben, format('select public.accept_invite(%L)', tests.s20a_invite(team, ben)));
  perform tests.s20a_value(ana, format('select public.pass_captaincy(%L, %L)', team, ben));
  r := tests.s20a_value(ben, format('select jsonb_agg(r) from public.team_pending_invites(%L) r', team))::jsonb;
  assert jsonb_array_length(r) = 1, 'one open invite';
  assert r -> 0 ->> 'profile_id' = cy::text and r -> 0 ->> 'name' = 'Cy Friend' and r -> 0 ->> 'role' = 'player',
    format('the invite: %s', r);
  assert r -> 0 ->> 'invite_id' = tests.s20a_invite(team, cy)::text, 'its id';
  e := tests.error_as(ana, format('select public.team_pending_invites(%L)', team));
  assert e = 'not_captain', format('a player: %s', e);
  perform tests.s20a_value(ben, format('select public.cancel_team_invite(%L)', tests.s20a_invite(team, cy)));
  assert tests.s20a_value(ben, format('select count(*) from public.team_pending_invites(%L)', team)) = '0', 'none left';
end $$;

-- A substitute who becomes captain swaps roles with the old captain (squad sizes don't change).
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  ben uuid := (select v from s20a where k = 'ben');
  team uuid := tests.s20a_team(ana, 'Subs FC');
begin
  perform tests.join_team(team, ben, 'substitute');
  perform tests.s20a_value(ana, format('select public.pass_captaincy(%L, %L)', team, ben));
  assert tests.s20a_role(team, ben) = 'captain' and tests.s20a_role(team, ana) = 'substitute', 'swapped';
end $$;

-- ---- Delete (hide, keep history) -------------------------------------------------------------
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  ben uuid := (select v from s20a where k = 'ben');
  cy uuid := (select v from s20a where k = 'cy');
  dee uuid := (select v from s20a where k = 'dee');
  team uuid := tests.s20a_team(ana, 'Delete FC', array[cy]);
  rival uuid := tests.s10_team('Rival FC', dee);
  match uuid;
  rival_history integer;
  e text;
begin
  perform tests.join_team(team, ben, 'player');
  e := tests.error_as(ben, format('select public.delete_team(%L)', team));
  assert e = 'not_captain', format('a player deletes: %s', e);
  e := tests.error_as(ana, format('select public.delete_team(%L)', team));
  assert e = 'not_last_member', format('others still in: %s', e);
  delete from public.team_members where team_id = team and profile_id = ben;

  -- A played game stays in both teams' history.
  match := tests.pr_match(team, rival, 2, 1, now() - interval '2 days');
  perform tests.pr_tick();
  rival_history := (select count(*) from public.power_ranking_history where team_id = rival);

  perform tests.s20a_value(ana, format('select public.delete_team(%L)', team));
  assert (select deleted_at from public.teams where id = team) is not null, 'hidden';
  assert not exists (select 1 from public.team_members where team_id = team), 'no members';
  assert (select status from public.invites where id = tests.s20a_invite(team, cy)) = 'cancelled', 'open invites cancelled';
  assert exists (select 1 from public.match_sides where team_id = team), 'its games stay';
  assert (select count(*) from public.power_ranking_history where team_id = rival) = rival_history,
    'the opponent''s power ranking history is unchanged';
  e := tests.error_as(cy, format('select public.accept_invite(%L)', tests.s20a_invite(team, cy)));
  assert e = 'invite_not_pending', format('an invite to a deleted team: %s', e);
  e := tests.error_as(ana, format('select public.invite_team_member(%L, %L, ''player'')', team, cy));
  assert e = 'not_captain', format('nobody captains a deleted team: %s', e);
  e := tests.error_as(ana, format('select public.delete_team(%L)', team));
  assert e = 'not_captain', format('deleted twice: %s', e);
end $$;

-- Refused while the team is in a league that isn't finished (sign-up counts).
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  team uuid := tests.s20a_team(ana, 'League FC');
  hub uuid := tests.s10_league();
  e text;
begin
  insert into public.league_teams (league_id, team_id) values (hub, team);
  e := tests.error_as(ana, format('select public.delete_team(%L)', team));
  assert e = 'team_in_competition', format('in sign-up: %s', e);
  update public.leagues set stage = 'season' where id = hub;
  e := tests.error_as(ana, format('select public.delete_team(%L)', team));
  assert e = 'team_in_competition', format('season running: %s', e);
  update public.leagues set stage = 'finished', ended_at = now() where id = hub;
  perform tests.s20a_value(ana, format('select public.delete_team(%L)', team));
  assert (select deleted_at from public.teams where id = team) is not null, 'finished: deleted';
end $$;

-- Refused while the team has an upcoming booking; a past or cancelled one doesn't block.
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  team uuid := tests.s20a_team(ana, 'Booked FC');
  venue uuid := tests.create_venue(p_price => 60);
  booking public.venue_bookings;
  e text;
begin
  perform tests.act_as(ana);
  booking := public.book_slot(venue, tests.cyprus_today() + 1, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  update public.venue_bookings set team_id = team where id = booking.id;
  e := tests.error_as(ana, format('select public.delete_team(%L)', team));
  assert e = 'team_has_booking', format('upcoming booking: %s', e);
  update public.venue_bookings set status = 'cancelled' where id = booking.id;
  perform tests.s20a_value(ana, format('select public.delete_team(%L)', team));
  assert (select deleted_at from public.teams where id = team) is not null, 'cancelled booking: deleted';
end $$;

-- ---- The public page: anyone signed in reads the team, members (A5) and competitions ---------
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  dee uuid := (select v from s20a where k = 'dee');
  mia uuid := (select v from s20a where k = 'mia');
  tom uuid := (select v from s20a where k = 'tom');
  team uuid := tests.s20a_team(mia, 'Public FC', array[tom]);
  hub uuid := tests.s10_league();
  r jsonb;
begin
  perform tests.s20a_value(tom, format('select public.accept_invite(%L)', tests.s20a_invite(team, tom)));
  insert into public.league_teams (league_id, team_id) values (hub, team);

  assert tests.s20a_value(dee, format('select name from public.teams where id = %L', team)) = 'Public FC', 'team readable';
  assert tests.s20a_value(dee, format('select kit_colour from public.teams where id = %L', team)) = 'kitBlue', 'kit readable';
  r := tests.s20a_value(dee, format('select jsonb_agg(r) from public.get_team_roster(%L) r', team))::jsonb;
  assert jsonb_array_length(r) = 2, 'both members';
  assert not exists (select 1 from jsonb_array_elements(r) x where x ->> 'username' is not null), 'minors: no usernames (A5)';
  assert exists (select 1 from jsonb_array_elements(r) x where x ->> 'full_name' = 'Mia'), 'minors: first name only (A5)';

  r := tests.s20a_value(dee, format('select jsonb_agg(r) from public.team_competitions(%L) r', team))::jsonb;
  assert jsonb_array_length(r) = 1 and r -> 0 ->> 'league_id' = hub::text, 'its league';
  assert (r -> 0 ->> 'running')::boolean, 'running';
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.team_competitions(%L)', team)) like 'permission denied%', 'anon refused';
  perform tests.act_as_postgres();
end $$;

-- A deleted team stays readable by id (its history) and lists no competitions twice.
do $$
declare
  ana uuid := (select v from s20a where k = 'ana');
  dee uuid := (select v from s20a where k = 'dee');
  team uuid := tests.s20a_team(ana, 'Gone FC');
begin
  perform tests.s20a_value(ana, format('select public.delete_team(%L)', team));
  assert tests.s20a_value(dee, format('select name from public.teams where id = %L', team)) = 'Gone FC', 'still readable';
end $$;

rollback;
