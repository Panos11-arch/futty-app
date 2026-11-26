-- S20: friends (match_friends migration). Requests (send, accept, decline,
-- cancel, unfriend), who sees them (RLS), blocks both ways, the adult-minor
-- rule (A4), what others see of a minor (A5), the two pushes, are_friends()
-- switching friend chats on, and turning 18 (spec 05: friendships and chats
-- stay). Every rule has its allowed case and each refused case.
begin;

-- A player of this age (in whole years, on today's Cyprus date).
create function tests.fr_user(p_email text, p_age integer, p_name text, p_username text)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
    'full_name', p_name,
    'username', p_username));
$$;

-- Runs p_sql as p_user and returns its first column as text (null if no row).
create function tests.fr_value(p_user uuid, p_sql text)
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

create temporary table fr (k text primary key, v uuid) on commit drop;
grant all on fr to authenticated;

do $$
begin
  insert into fr values
    ('ana', tests.fr_user('fr-ana@futty.test', 30, 'Ana Adult', 'ana_fr')),
    ('ben', tests.fr_user('fr-ben@futty.test', 25, 'Ben Adult', 'ben_fr')),
    ('cara', tests.fr_user('fr-cara@futty.test', 28, 'Cara Third', 'cara_fr')),
    ('dan', tests.fr_user('fr-dan@futty.test', 40, 'Dan Blocked', 'dan_fr')),
    ('mia', tests.fr_user('fr-mia@futty.test', 16, 'Mia Minor', 'mia_fr')),
    ('max', tests.fr_user('fr-max@futty.test', 15, 'Max Minor', 'max_fr')),
    ('kid', tests.fr_user('fr-kid@futty.test', 15, 'Kid Locked', 'kid_fr'));
  -- An existing account under 14 (A2): locked. The sign-up guard refuses
  -- the date, so set it past the trigger.
  set local session_replication_role = replica;
  update public.profiles set date_of_birth = (tests.cyprus_today() - interval '12 years')::date
  where id = (select v from fr where k = 'kid');
  set local session_replication_role = origin;
end $$;

-- ---- Send: allowed, and every refusal ------------------------------------------
do $$
declare
  ana uuid := (select v from fr where k = 'ana');
  ben uuid := (select v from fr where k = 'ben');
  dan uuid := (select v from fr where k = 'dan');
  mia uuid := (select v from fr where k = 'mia');
  max uuid := (select v from fr where k = 'max');
  kid uuid := (select v from fr where k = 'kid');
  req uuid;
  n public.notifications;
begin
  assert tests.error_as(ana, format('select public.send_friend_request(%L)', ben)) is null, 'adult to adult';
  req := (select id from public.friendships where requester_id = ana and addressee_id = ben);
  assert req is not null, 'the request is stored';
  assert (select status from public.friendships where id = req) = 'pending', 'as pending';
  insert into fr values ('ana_ben', req);

  n := tests.last_notification(ben, 'friend_request');
  assert n.id is not null, 'the receiver is pushed';
  assert n.data ->> 'profileId' = ana::text, 'with the sender';
  assert n.data ->> 'requestId' = req::text, 'and the request';
  assert n.title = 'Friend request', 'titled';
  assert n.body = 'Ana Adult wants to be friends', 'one line';

  assert tests.error_as(ana, format('select public.send_friend_request(%L)', ben)) = 'already_requested', 'twice';
  assert tests.error_as(ben, format('select public.send_friend_request(%L)', ana)) = 'request_incoming', 'the other way while one waits';
  assert tests.error_as(ana, format('select public.send_friend_request(%L)', ana)) = 'player_not_found', 'yourself';
  assert tests.error_as(ana, format('select public.send_friend_request(%L)', gen_random_uuid())) = 'player_not_found', 'nobody';
  assert tests.error_as(ana, 'select public.send_friend_request(null)') = 'player_not_found', 'null';

  -- Blocks, both ways.
  insert into public.blocked_users (blocker_id, blocked_id) values (ana, dan);
  assert tests.error_as(ana, format('select public.send_friend_request(%L)', dan)) = 'blocked', 'blocked by me';
  assert tests.error_as(dan, format('select public.send_friend_request(%L)', ana)) = 'blocked', 'blocked by them';

  -- A4 and A5: an adult can't find a minor; a minor can't ask an adult.
  assert tests.error_as(ana, format('select public.send_friend_request(%L)', mia)) = 'player_not_found', 'adult to minor';
  assert tests.error_as(mia, format('select public.send_friend_request(%L)', ana)) = 'age_pair_refused', 'minor to adult';
  assert tests.error_as(mia, format('select public.send_friend_request(%L)', max)) is null, 'minor to minor';
  insert into fr values ('mia_max', (select id from public.friendships where requester_id = mia and addressee_id = max));
  assert (tests.last_notification(max, 'friend_request')).body = 'Mia wants to be friends', 'a minor by first name (A5)';

  -- A2: a locked account can't act.
  assert tests.error_as(kid, format('select public.send_friend_request(%L)', max)) = 'too_young', 'locked account';

  -- Signed out.
  perform tests.act_as_anon();
  assert not has_function_privilege('anon', 'public.send_friend_request(uuid)', 'execute'), 'signed out';
  perform tests.act_as_postgres();
end $$;

-- ---- Who sees a request (RLS) ------------------------------------------------------
do $$
declare
  ana uuid := (select v from fr where k = 'ana');
  ben uuid := (select v from fr where k = 'ben');
  cara uuid := (select v from fr where k = 'cara');
  req uuid := (select v from fr where k = 'ana_ben');
begin
  assert tests.fr_value(ana, format('select count(*) from public.friendships where id = %L', req))::integer = 1, 'the sender sees it';
  assert tests.fr_value(ben, format('select count(*) from public.friendships where id = %L', req))::integer = 1, 'the receiver sees it';
  assert tests.fr_value(cara, format('select count(*) from public.friendships where id = %L', req))::integer = 0, 'nobody else';
  assert tests.error_as(cara, format(
    'insert into public.friendships (requester_id, addressee_id, status) values (%L, %L, %L)', cara, ana, 'accepted')) is not null,
    'no direct insert';
  assert tests.error_as(ana, format('update public.friendships set status = %L where id = %L', 'accepted', req)) is not null,
    'the sender cannot accept by hand';
  assert tests.error_as(ben, format('delete from public.friendships where id = %L', req)) is not null, 'no direct delete';
end $$;

-- ---- Accept: only the receiver ---------------------------------------------------------
do $$
declare
  ana uuid := (select v from fr where k = 'ana');
  ben uuid := (select v from fr where k = 'ben');
  cara uuid := (select v from fr where k = 'cara');
  req uuid := (select v from fr where k = 'ana_ben');
  conv uuid;
  n public.notifications;
begin
  assert not public.are_friends(ana, ben), 'not friends while pending';
  assert tests.error_as(ana, format('select public.accept_friend_request(%L)', req)) = 'request_not_found', 'the sender cannot accept';
  assert tests.error_as(cara, format('select public.accept_friend_request(%L)', req)) = 'request_not_found', 'nor anyone else';
  assert tests.error_as(ben, format('select public.accept_friend_request(%L)', gen_random_uuid())) = 'request_not_found', 'unknown';

  conv := tests.fr_value(ben, format('select public.accept_friend_request(%L)', req))::uuid;
  assert conv is not null, 'accepting returns the chat';
  assert (select status from public.friendships where id = req) = 'accepted', 'accepted';
  assert public.are_friends(ana, ben) and public.are_friends(ben, ana), 'friends both ways';
  assert (select kind from public.conversations where id = conv) = 'friends', 'a friend chat';

  n := tests.last_notification(ana, 'friend_accepted');
  assert n.id is not null, 'the sender is pushed';
  assert n.data ->> 'conversationId' = conv::text, 'opening the chat';
  assert n.data ->> 'profileId' = ben::text, 'from the friend';
  assert n.title = 'New friend', 'titled';
  assert n.body = 'Ben Adult accepted your request', 'one line';
  assert (tests.last_notification(ben, 'friend_request')).read_at is not null, 'the request push is read';

  assert tests.error_as(ben, format('select public.accept_friend_request(%L)', req)) = 'request_not_found', 'only once';
  assert tests.error_as(ana, format('select public.send_friend_request(%L)', ben)) = 'already_friends', 'already friends';

  -- Friend chats are on: open and send, both of them.
  assert tests.fr_value(ana, format('select public.open_friend_conversation(%L)', ben))::uuid = conv, 'the same chat';
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, 'hi', gen_random_uuid())) is null, 'ana sends';
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'hey', gen_random_uuid())) is null, 'ben sends';
  assert tests.fr_value(cara, format('select count(*) from public.messages where conversation_id = %L', conv))::integer = 0,
    'nobody else reads it';
  insert into fr values ('conv', conv);
end $$;

-- ---- Accept rechecks blocks --------------------------------------------------------------
do $$
declare
  cara uuid := (select v from fr where k = 'cara');
  ben uuid := (select v from fr where k = 'ben');
  req uuid;
begin
  perform tests.fr_value(cara, format('select public.send_friend_request(%L)', ben));
  req := (select id from public.friendships where requester_id = cara and addressee_id = ben);
  insert into public.blocked_users (blocker_id, blocked_id) values (ben, cara);
  assert tests.error_as(ben, format('select public.accept_friend_request(%L)', req)) = 'blocked', 'blocked after the request';
  delete from public.blocked_users where blocker_id = ben and blocked_id = cara;
  insert into fr values ('cara_ben', req);
end $$;

-- ---- Decline and cancel ------------------------------------------------------------------
do $$
declare
  ana uuid := (select v from fr where k = 'ana');
  ben uuid := (select v from fr where k = 'ben');
  cara uuid := (select v from fr where k = 'cara');
  req uuid := (select v from fr where k = 'cara_ben');
begin
  assert tests.error_as(cara, format('select public.decline_friend_request(%L)', req)) = 'request_not_found', 'the sender cannot decline';
  assert tests.error_as(ana, format('select public.decline_friend_request(%L)', req)) = 'request_not_found', 'nor anyone else';
  assert tests.error_as(ben, format('select public.cancel_friend_request(%L)', req)) = 'request_not_found', 'the receiver cannot cancel';
  assert tests.error_as(ben, format('select public.decline_friend_request(%L)', req)) is null, 'the receiver declines';
  assert not exists (select 1 from public.friendships where id = req), 'gone';
  assert (tests.last_notification(ben, 'friend_request')).read_at is not null, 'its push is read';
  assert tests.notified(cara, 'friend_accepted') = 0, 'no push for a decline';

  -- Ask again, then cancel.
  perform tests.fr_value(cara, format('select public.send_friend_request(%L)', ben));
  req := (select id from public.friendships where requester_id = cara and addressee_id = ben);
  assert tests.error_as(cara, format('select public.cancel_friend_request(%L)', req)) is null, 'the sender cancels';
  assert not exists (select 1 from public.friendships where id = req), 'gone';
  assert not exists (
    select 1 from public.notifications n where n.profile_id = ben and n.type = 'friend_request'
      and n.data ->> 'requestId' = req::text and n.read_at is null), 'its push is read';
  assert tests.error_as(cara, format('select public.cancel_friend_request(%L)', req)) = 'request_not_found', 'only once';
  -- An accepted friendship is not cancelled or declined: unfriend it.
  assert tests.error_as(ana, format('select public.cancel_friend_request(%L)', (select v from fr where k = 'ana_ben'))) = 'request_not_found',
    'not a pending request';
end $$;

-- ---- What each sees: my_friends and the profile card ----------------------------------------
do $$
declare
  ana uuid := (select v from fr where k = 'ana');
  ben uuid := (select v from fr where k = 'ben');
  cara uuid := (select v from fr where k = 'cara');
  dan uuid := (select v from fr where k = 'dan');
  mia uuid := (select v from fr where k = 'mia');
  max uuid := (select v from fr where k = 'max');
  tigers uuid := tests.create_team('Tigers');
begin
  perform tests.join_team(tigers, ben, 'captain');
  perform tests.fr_value(cara, format('select public.send_friend_request(%L)', ben));

  -- Ben: Cara's request first, then his friend Ana.
  assert tests.fr_value(ben, 'select string_agg(kind || '':'' || name, '','' order by ord) from public.my_friends()')
    = 'request:Cara Third,friend:Ana Adult', 'requests first, then friends';
  assert tests.fr_value(ben, 'select public.my_friend_request_count()')::integer = 1, 'one waiting';
  assert tests.fr_value(cara, 'select count(*) from public.my_friends()')::integer = 0, 'a sent request is not listed';
  assert tests.fr_value(cara, 'select public.my_friend_request_count()')::integer = 0, 'nor counted';

  -- The card: by username or id, never a QR, with the friendship.
  assert tests.fr_value(ana, 'select friend_status from public.player_profile_card(''BEN_FR'', null)') = 'friends', 'friends';
  assert tests.fr_value(ana, format('select full_name from public.player_profile_card(null, %L)', ben)) = 'Ben Adult', 'by id';
  assert tests.fr_value(ana, 'select show_qr::text from public.player_profile_card(''ben_fr'', null)') = 'false', 'no QR';
  assert tests.fr_value(ana, 'select first_name from public.player_profile_card(''ben_fr'', null)') = 'Ben', 'first name';
  assert tests.fr_value(ana, 'select teams ->> 0 from public.player_profile_card(''ben_fr'', null)')::jsonb ->> 'name' = 'Tigers', 'teams';
  assert tests.fr_value(cara, 'select friend_status from public.player_profile_card(''ben_fr'', null)') = 'requested', 'requested';
  assert tests.fr_value(cara, 'select request_id from public.player_profile_card(''ben_fr'', null)') is not null, 'with the request';
  assert tests.fr_value(ben, 'select friend_status from public.player_profile_card(''cara_fr'', null)') = 'incoming', 'incoming';
  assert tests.fr_value(ana, 'select friend_status from public.player_profile_card(''cara_fr'', null)') = 'none', 'none';
  assert tests.fr_value(ana, 'select friend_status from public.player_profile_card(''ana_fr'', null)') = 'self', 'yourself';

  -- Blocked either way, or an adult looking up a minor: not found.
  assert tests.error_as(ana, 'select * from public.player_profile_card(''dan_fr'', null)') = 'player_not_found', 'blocked by me';
  assert tests.error_as(dan, 'select * from public.player_profile_card(''ana_fr'', null)') = 'player_not_found', 'blocked by them';
  assert tests.error_as(ana, 'select * from public.player_profile_card(''mia_fr'', null)') = 'player_not_found', 'adult, minor';
  assert tests.error_as(ana, 'select * from public.player_profile_card(''nobody_here'', null)') = 'player_not_found', 'nobody';
  -- A minor sees an adult, without Add friend; another minor by first name only.
  assert tests.fr_value(mia, 'select friend_status from public.player_profile_card(''ana_fr'', null)') = 'unavailable', 'A5: no Add friend';
  assert tests.fr_value(mia, 'select full_name from public.player_profile_card(''max_fr'', null)') = 'Max', 'A5: first name';
  assert tests.fr_value(mia, 'select username from public.player_profile_card(''max_fr'', null)') is null, 'A5: no username';

  -- Blocked friends leave the list.
  insert into public.blocked_users (blocker_id, blocked_id) values (ben, ana);
  assert tests.fr_value(ben, 'select count(*) from public.my_friends() where kind = ''friend''')::integer = 0, 'blocked: hidden';
  assert not public.are_friends(ana, ben), 'blocked: no friend chat';
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', (select v from fr where k = 'conv'), 'x', gen_random_uuid()))
    = 'not_in_conversation', 'blocked: no sending';
  delete from public.blocked_users where blocker_id = ben and blocked_id = ana;
  assert public.are_friends(ana, ben), 'unblocked: friends again';
end $$;

-- ---- Unfriend ---------------------------------------------------------------------------------
do $$
declare
  ana uuid := (select v from fr where k = 'ana');
  ben uuid := (select v from fr where k = 'ben');
  cara uuid := (select v from fr where k = 'cara');
  conv uuid := (select v from fr where k = 'conv');
begin
  assert tests.error_as(ana, format('select public.unfriend(%L)', cara)) = 'not_friends', 'not friends';
  assert tests.error_as(cara, format('select public.unfriend(%L)', ben)) = 'not_friends', 'a pending request is not a friendship';
  assert tests.error_as(ben, format('select public.unfriend(%L)', ana)) is null, 'either side unfriends';
  assert not public.are_friends(ana, ben), 'no longer friends';
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, 'still?', gen_random_uuid()))
    = 'not_in_conversation', 'the chat closes';
  assert tests.error_as(ana, format('select public.open_friend_conversation(%L)', ben)) = 'not_friends', 'and stays closed';
end $$;

-- ---- Turning 18 (spec 05): friendships and chats stay ------------------------------------------------
do $$
declare
  mia uuid := (select v from fr where k = 'mia');
  max uuid := (select v from fr where k = 'max');
  ana uuid := (select v from fr where k = 'ana');
  conv uuid;
begin
  conv := tests.fr_value(max, format('select public.accept_friend_request(%L)', (select v from fr where k = 'mia_max')))::uuid;
  assert tests.error_as(mia, format('select * from public.send_message(%L, %L, %L)', conv, 'hi', gen_random_uuid())) is null, 'minor friends chat';

  -- Mia turns 18 today (Cyprus date).
  update public.profiles set date_of_birth = (tests.cyprus_today() - interval '18 years')::date where id = mia;
  assert not public.is_minor(mia) and public.is_minor(max), 'an adult and a minor now';
  assert public.are_friends(mia, max), 'still friends';
  assert tests.fr_value(mia, format('select public.open_friend_conversation(%L)', max))::uuid = conv, 'the chat opens';
  assert tests.error_as(mia, format('select * from public.send_message(%L, %L, %L)', conv, 'happy birthday', gen_random_uuid())) is null,
    'she sends';
  assert tests.error_as(max, format('select * from public.send_message(%L, %L, %L)', conv, 'thanks', gen_random_uuid())) is null,
    'he sends';
  assert tests.fr_value(max, format('select send_refusal from public.conversation_header(%L)', conv)) is null, 'no refusal shown';
  -- New adult-minor requests are still refused.
  assert tests.error_as(max, format('select public.send_friend_request(%L)', ana)) = 'age_pair_refused', 'a new pair still refused';
end $$;

-- ---- Grants ----------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.are_friends(uuid, uuid)', 'public.friend_refusal(uuid, uuid)', 'public.friend_display_name(uuid)',
    'public.player_visible_to(uuid, uuid)'
  ] loop
    assert not has_function_privilege('authenticated', f, 'execute'), f || ' is internal';
    assert not has_function_privilege('anon', f, 'execute'), f || ' is internal (anon)';
    assert has_function_privilege('service_role', f, 'execute'), f || ' for service_role';
  end loop;
  foreach f in array array[
    'public.send_friend_request(uuid)', 'public.accept_friend_request(uuid)', 'public.decline_friend_request(uuid)',
    'public.cancel_friend_request(uuid)', 'public.unfriend(uuid)', 'public.my_friends()', 'public.my_friend_request_count()',
    'public.player_profile_card(text, uuid)'
  ] loop
    assert has_function_privilege('authenticated', f, 'execute'), f || ' for signed-in players';
    assert not has_function_privilege('anon', f, 'execute'), f || ' not signed out';
  end loop;
  assert (select relrowsecurity from pg_class where oid = 'public.friendships'::regclass), 'RLS on friendships';
  assert exists (select 1 from public.notification_types where type = 'friend_request'), 'friend_request type';
  assert exists (select 1 from public.notification_types where type = 'friend_accepted'), 'friend_accepted type';
end $$;

rollback;
