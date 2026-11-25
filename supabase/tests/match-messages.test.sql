-- S13: messages (20261125014424_match_messages.sql). Captain chats between two
-- teams of a league, friend chats (closed until S20), blocks both ways, the
-- adult-minor rule (A4), the rate limit, read receipts, pushes and
-- "Former player". Every rule has its allowed case and each refused case.
begin;

-- A player of this age (in whole years, on today's Cyprus date).
create function tests.msg_user(p_email text, p_age integer, p_name text)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
    'full_name', p_name));
$$;

-- A league with these teams in it.
create function tests.msg_league(p_teams uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league uuid;
begin
  insert into public.leagues (format, scope, name, capacity) values ('5-a-side', 'Island-wide', 'Test league', 8)
  returning id into v_league;
  insert into public.league_teams (league_id, team_id) select v_league, t from unnest(p_teams) t;
  return v_league;
end;
$$;

-- Runs p_sql as p_user and returns its first column as text (null if no row).
create function tests.msg_value(p_user uuid, p_sql text)
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

create temporary table msg (k text primary key, v uuid) on commit drop;
grant all on msg to authenticated;

-- ---- Setup: Tigers (Ana captains, Pete plays) and Lions (Ben captains) in a
-- league; Wolves (Cara captains) outside it; two minor captains' teams.
do $$
declare
  ana uuid := tests.msg_user('msg-ana@futty.test', 30, 'Ana Adult');
  ben uuid := tests.msg_user('msg-ben@futty.test', 25, 'Ben Adult');
  pete uuid := tests.msg_user('msg-pete@futty.test', 22, 'Pete Player');
  cara uuid := tests.msg_user('msg-cara@futty.test', 28, 'Cara Outside');
  mia uuid := tests.msg_user('msg-mia@futty.test', 16, 'Mia Minor');
  max uuid := tests.msg_user('msg-max@futty.test', 15, 'Max Minor');
  tigers uuid := tests.create_team('Tigers');
  lions uuid := tests.create_team('Lions');
  wolves uuid := tests.create_team('Wolves');
  minors_a uuid := tests.create_team('Minors A');
  minors_b uuid := tests.create_team('Minors B');
begin
  perform tests.join_team(tigers, ana, 'captain');
  perform tests.join_team(tigers, pete, 'player');
  perform tests.join_team(lions, ben, 'captain');
  perform tests.join_team(wolves, cara, 'captain');
  perform tests.join_team(minors_a, mia, 'captain');
  perform tests.join_team(minors_b, max, 'captain');
  insert into msg values ('ana', ana), ('ben', ben), ('pete', pete), ('cara', cara), ('mia', mia), ('max', max),
    ('tigers', tigers), ('lions', lions), ('wolves', wolves), ('minors_a', minors_a), ('minors_b', minors_b),
    ('league', tests.msg_league(array[tigers, lions, minors_a, minors_b]));
end $$;

-- ---- Message a captain: who sees the button ----------------------------------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  pete uuid := (select v from msg where k = 'pete');
  cara uuid := (select v from msg where k = 'cara');
  league uuid := (select v from msg where k = 'league');
  n integer;
begin
  perform tests.act_as(ana);
  select count(*) into n from public.league_captain_contacts(league);
  assert n = 3, 'a captain sees the three other teams: ' || n;
  assert (select captain_name from public.league_captain_contacts(league) where team_name = 'Lions') = 'Ben Adult',
    'with their captain';
  assert (select my_team_id from public.league_captain_contacts(league) limit 1) = (select v from msg where k = 'tigers'),
    'and the team the caller writes for';
  assert not exists (select 1 from public.league_captain_contacts(league) where team_name = 'Tigers'), 'not their own team';
  perform tests.act_as_postgres();

  perform tests.act_as(pete);
  assert not exists (select 1 from public.league_captain_contacts(league)), 'a player who is not a captain: nothing';
  perform tests.act_as_postgres();

  perform tests.act_as(cara);
  assert not exists (select 1 from public.league_captain_contacts(league)), 'a captain of a team outside the league: nothing';
  perform tests.act_as_postgres();

  -- A minor's name is the first name only (A5).
  perform tests.act_as(ana);
  assert (select captain_name from public.league_captain_contacts(league) where team_name = 'Minors A') = 'Mia',
    'a minor captain: first name only';
  perform tests.act_as_postgres();
end $$;

-- ---- Opening a captain chat ----------------------------------------------------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  ben uuid := (select v from msg where k = 'ben');
  pete uuid := (select v from msg where k = 'pete');
  cara uuid := (select v from msg where k = 'cara');
  mia uuid := (select v from msg where k = 'mia');
  max uuid := (select v from msg where k = 'max');
  tigers uuid := (select v from msg where k = 'tigers');
  lions uuid := (select v from msg where k = 'lions');
  wolves uuid := (select v from msg where k = 'wolves');
  minors_a uuid := (select v from msg where k = 'minors_a');
  minors_b uuid := (select v from msg where k = 'minors_b');
  c1 uuid;
  c2 uuid;
begin
  perform tests.act_as(ana);
  c1 := public.open_captain_conversation(tigers, lions);
  perform tests.act_as_postgres();
  perform tests.act_as(ben);
  c2 := public.open_captain_conversation(lions, tigers);
  perform tests.act_as_postgres();
  assert c1 is not null and c1 = c2, 'both captains open the same conversation';
  insert into msg values ('tl', c1);

  assert tests.error_as(pete, format('select public.open_captain_conversation(%L, %L)', tigers, lions)) = 'not_captain',
    'a player who is not the captain';
  assert tests.error_as(ana, format('select public.open_captain_conversation(%L, %L)', lions, tigers)) = 'not_captain',
    'for a team the caller does not captain';
  assert tests.error_as(ana, format('select public.open_captain_conversation(%L, %L)', tigers, wolves)) = 'teams_not_in_league',
    'a team in no league with ours';
  assert tests.error_as(ana, format('select public.open_captain_conversation(%L, %L)', tigers, tigers)) = 'teams_not_in_league',
    'our own team';
  assert tests.error_as(cara, format('select public.open_captain_conversation(%L, %L)', wolves, lions)) = 'teams_not_in_league',
    'a captain outside the league';

  -- A4: an adult and a minor, either way round; two minors may talk.
  assert tests.error_as(ana, format('select public.open_captain_conversation(%L, %L)', tigers, minors_a)) = 'age_pair_refused',
    'adult to minor';
  assert tests.error_as(mia, format('select public.open_captain_conversation(%L, %L)', minors_a, tigers)) = 'age_pair_refused',
    'minor to adult';
  assert tests.error_as(mia, format('select public.open_captain_conversation(%L, %L)', minors_a, minors_b)) is null,
    'minor to minor';
  perform tests.act_as(max);
  assert (select title from public.conversation_header(public.open_captain_conversation(minors_b, minors_a))) = 'Mia',
    'a minor sees the other minor by first name';
  perform tests.act_as_postgres();

  -- Signed out.
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.open_captain_conversation(%L, %L)', tigers, lions)) like 'permission denied%',
    'anon cannot open';
  perform tests.act_as_postgres();
end $$;

-- ---- Sending: allowed, trimmed, idempotent, 1 to 1000 characters --------------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  ben uuid := (select v from msg where k = 'ben');
  pete uuid := (select v from msg where k = 'pete');
  conv uuid := (select v from msg where k = 'tl');
  cid uuid := gen_random_uuid();
  m1 uuid;
  m2 uuid;
begin
  perform tests.act_as(ana);
  select id into m1 from public.send_message(conv, '  Hello Lions  ', cid);
  select id into m2 from public.send_message(conv, 'Hello Lions', cid);
  perform tests.act_as_postgres();
  assert m1 = m2, 'a retried send returns the same message';
  assert (select count(*) from public.messages where conversation_id = conv) = 1, 'and does not double it';
  assert (select body from public.messages where id = m1) = 'Hello Lions', 'trimmed';
  assert (select sender_team_id from public.messages where id = m1) = (select v from msg where k = 'tigers'), 'for the Tigers';
  assert (select last_message_at from public.conversations where id = conv) is not null, 'the inbox order moves';

  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, '   ', gen_random_uuid())) = 'message_required',
    'blank';
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, '', gen_random_uuid())) = 'message_required',
    'empty';
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, repeat('a', 1001), gen_random_uuid())) = 'message_too_long',
    '1001 characters';
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, repeat('é', 1000), gen_random_uuid())) is null,
    '1000 characters (not bytes)';
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, null)', conv, 'hi')) = 'client_id_required',
    'no client id';
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', gen_random_uuid(), 'hi', gen_random_uuid())) = 'conversation_not_found',
    'no such conversation';
  assert tests.error_as(pete, format('select * from public.send_message(%L, %L, %L)', conv, 'hi', gen_random_uuid())) = 'not_in_conversation',
    'a player who is not a captain';
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'Hi Tigers', gen_random_uuid())) is null,
    'the other captain replies';
  -- The same client id in another conversation is a bug, not a retry.
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', gen_random_uuid(), 'x', cid)) = 'client_id_reused',
    'a client id from another conversation';

  -- Direct writes are refused: only send_message writes.
  assert tests.error_as(ana, format(
    'insert into public.messages (conversation_id, sender_id, body, client_id) values (%L, %L, %L, %L)',
    conv, ana, 'sneaky', gen_random_uuid())) like 'permission denied%', 'no direct insert';
  assert tests.error_as(ana, format('update public.messages set body = %L where conversation_id = %L', 'edited', conv)) like 'permission denied%',
    'no direct update';
end $$;

-- ---- Reading: RLS, paging, unread, read receipts --------------------------------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  ben uuid := (select v from msg where k = 'ben');
  pete uuid := (select v from msg where k = 'pete');
  conv uuid := (select v from msg where k = 'tl');
  page1_last timestamptz;
  page1_last_id uuid;
  n integer;
begin
  assert tests.msg_value(ana, format('select count(*) from public.messages where conversation_id = %L', conv))::integer = 3,
    'a participant reads the messages';
  assert tests.msg_value(pete, format('select count(*) from public.messages where conversation_id = %L', conv))::integer = 0,
    'anyone else reads none';
  assert tests.msg_value(pete, format('select count(*) from public.conversations where id = %L', conv))::integer = 0,
    'nor the conversation';
  assert tests.error_as(pete, format('select * from public.list_messages(%L)', conv)) = 'not_in_conversation',
    'nor through list_messages';
  assert tests.error_as(pete, format('select * from public.conversation_header(%L)', conv)) = 'not_in_conversation',
    'nor the header';
  assert tests.error_as(pete, format('select public.mark_conversation_read(%L)', conv)) = 'not_in_conversation',
    'nor marks it read';

  -- Ana has 1 unread (Ben's reply; her own don't count). Ben replied after
  -- her messages, which reads them.
  assert tests.msg_value(ana, 'select unread from public.list_my_conversations()')::integer = 1, 'Ana: 1 unread';
  assert tests.msg_value(ben, 'select unread from public.list_my_conversations()')::integer = 0, 'Ben: replying reads';
  assert tests.msg_value(ana, 'select public.my_unread_message_count()')::integer = 1, 'the badge';
  assert tests.msg_value(ben, 'select title from public.list_my_conversations()') = 'Ana Adult', 'the row shows the other captain';
  assert tests.msg_value(ben, 'select subtitle from public.list_my_conversations()') = 'Tigers', 'with the team under';
  assert tests.msg_value(ben, 'select last_mine from public.list_my_conversations()')::boolean, 'the last one is Ben''s';
  assert not tests.msg_value(ana, 'select last_mine from public.list_my_conversations()')::boolean, 'not Ana''s';
  assert tests.msg_value(ana, 'select last_body from public.list_my_conversations()') = 'Hi Tigers', 'the last message';
  assert tests.msg_value(pete, 'select count(*) from public.list_my_conversations()')::integer = 0, 'Pete has no inbox rows';

  -- Delivered when Ana's app fetches, read when she opens the chat.
  assert tests.msg_value(ben, format('select other_delivered_at from public.conversation_header(%L)', conv)) is not null,
    'Ana''s own send counts as delivered to her';
  update public.conversation_reads set last_delivered_at = null, last_read_at = now() - interval '1 hour'
  where conversation_id = conv and profile_id = ana;
  assert tests.msg_value(ben, format('select other_delivered_at from public.conversation_header(%L)', conv)) is null, 'not delivered yet';
  perform tests.act_as(ana);
  perform public.mark_messages_delivered();
  perform tests.act_as_postgres();
  assert tests.msg_value(ben, format('select other_delivered_at from public.conversation_header(%L)', conv)) is not null, 'delivered';
  assert tests.msg_value(ben, format('select other_read_at from public.conversation_header(%L)', conv))::timestamptz < now() - interval '59 minutes', 'not read yet';
  perform tests.act_as(ana);
  perform public.mark_conversation_read(conv);
  perform tests.act_as_postgres();
  assert tests.msg_value(ana, 'select public.my_unread_message_count()')::integer = 0, 'read: no unread';
  assert tests.msg_value(ben, format('select other_read_at from public.conversation_header(%L)', conv))::timestamptz >= now(),
    'Ben sees Ana read up to now';

  -- Paging: 35 more, newest first, 30 then the rest, no overlap.
  for i in 1..35 loop
    insert into public.messages (conversation_id, sender_id, body, client_id, created_at)
    values (conv, ana, 'old ' || i, gen_random_uuid(), now() - interval '3 days' + make_interval(mins => i));
  end loop;
  perform tests.act_as(ana);
  select count(*) into n from public.list_messages(conv);
  assert n = 30, 'a page is 30';
  select created_at, id into page1_last, page1_last_id from public.list_messages(conv) order by created_at, id limit 1;
  select count(*) into n from public.list_messages(conv, page1_last, page1_last_id);
  assert n = 38 - 30, 'the next page has the rest: ' || n;
  assert not exists (
    select 1 from public.list_messages(conv, page1_last, page1_last_id) p
    where p.id in (select id from public.list_messages(conv))), 'no overlap';
  assert (select body from public.list_messages(conv, null, null, 1)) <> 'old 1', 'newest first';
  assert (select bool_and(mine) from public.list_messages(conv) where sender_id = ana), 'mine for my own';
  perform tests.act_as_postgres();
end $$;

-- ---- Pushes: once per unread run, opening the chat ------------------------------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  ben uuid := (select v from msg where k = 'ben');
  conv uuid := (select v from msg where k = 'tl');
begin
  delete from public.notifications where profile_id in (ana, ben) and type = 'message_new';
  -- Ben has read everything (above). Two messages: one push.
  perform tests.act_as(ana);
  perform public.send_message(conv, 'One', gen_random_uuid());
  perform public.send_message(conv, 'Two', gen_random_uuid());
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications where profile_id = ben and type = 'message_new') = 1, 'one push per unread run';
  assert (select data ->> 'conversationId' from public.notifications where profile_id = ben and type = 'message_new') = conv::text,
    'the push opens the chat';
  assert (select title from public.notifications where profile_id = ben and type = 'message_new') = 'Ana Adult', 'from Ana';
  assert (select body from public.notifications where profile_id = ben and type = 'message_new') = 'One', 'with the message';
  assert not exists (select 1 from public.notifications where profile_id = ana and type = 'message_new'), 'never to the sender';

  -- Reading marks the push read; the next message pushes again.
  perform tests.act_as(ben);
  perform public.mark_conversation_read(conv);
  perform tests.act_as_postgres();
  assert (select read_at from public.notifications where profile_id = ben and type = 'message_new') is not null, 'push read with the chat';
  perform tests.act_as(ana);
  perform public.send_message(conv, 'Three', gen_random_uuid());
  perform tests.act_as_postgres();
  assert (select count(*) from public.notifications where profile_id = ben and type = 'message_new') = 2, 'pushed again after reading';
end $$;

-- ---- Blocks stop both ways --------------------------------------------------------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  ben uuid := (select v from msg where k = 'ben');
  tigers uuid := (select v from msg where k = 'tigers');
  lions uuid := (select v from msg where k = 'lions');
  conv uuid := (select v from msg where k = 'tl');
begin
  perform tests.act_as(ben);
  insert into public.blocked_users (blocker_id, blocked_id) values (ben, ana);
  perform tests.act_as_postgres();
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, 'hi', gen_random_uuid())) = 'blocked',
    'the blocked player can''t send';
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'hi', gen_random_uuid())) = 'blocked',
    'nor can the blocker';
  assert tests.error_as(ana, format('select public.open_captain_conversation(%L, %L)', tigers, lions)) = 'blocked',
    'nor open it';
  assert tests.msg_value(ben, format('select send_refusal from public.conversation_header(%L)', conv)) = 'blocked',
    'the header says why';
  assert tests.msg_value(ben, format('select blocked_by_me from public.conversation_header(%L)', conv))::boolean,
    'and that Ben blocked';
  assert not tests.msg_value(ana, format('select blocked_by_me from public.conversation_header(%L)', conv))::boolean,
    'Ana did not';
  delete from public.blocked_users where blocker_id = ben and blocked_id = ana;
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, 'hi again', gen_random_uuid())) is null,
    'unblocked: sends again';
end $$;

-- ---- Current captains only ---------------------------------------------------------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  pete uuid := (select v from msg where k = 'pete');
  tigers uuid := (select v from msg where k = 'tigers');
  conv uuid := (select v from msg where k = 'tl');
begin
  -- Pete becomes captain, Ana steps down.
  update public.team_members set role = 'player' where team_id = tigers and profile_id = ana;
  update public.team_members set role = 'captain' where team_id = tigers and profile_id = pete;
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, 'still me', gen_random_uuid())) = 'not_in_conversation',
    'a former captain can''t send';
  assert tests.msg_value(ana, format('select count(*) from public.messages where conversation_id = %L', conv))::integer = 0,
    'nor read';
  assert tests.msg_value(pete, format('select count(*) from public.list_messages(%L, null, null, 100)', conv))::integer > 0,
    'the new captain reads the history';
  assert tests.error_as(pete, format('select * from public.send_message(%L, %L, %L)', conv, 'New captain here', gen_random_uuid())) is null,
    'and writes';
  update public.team_members set role = 'captain' where team_id = tigers and profile_id = ana;
  update public.team_members set role = 'player' where team_id = tigers and profile_id = pete;
end $$;

-- ---- A4 on send: a captain who is now a minor's opponent ------------------------
do $$
declare
  ben uuid := (select v from msg where k = 'ben');
  mia uuid := (select v from msg where k = 'mia');
  lions uuid := (select v from msg where k = 'lions');
  conv uuid := (select v from msg where k = 'tl');
begin
  -- Mia becomes a second Lions captain: Ana (adult) can no longer write.
  perform tests.join_team(lions, mia, 'captain');
  assert tests.error_as((select v from msg where k = 'ana'), format('select * from public.send_message(%L, %L, %L)', conv, 'hi', gen_random_uuid())) = 'age_pair_refused',
    'an adult to a side with a minor captain';
  delete from public.team_members where team_id = lions and profile_id = mia;
end $$;

-- ---- Former player -----------------------------------------------------------------
do $$
declare
  ben uuid := (select v from msg where k = 'ben');
  ana uuid := (select v from msg where k = 'ana');
  conv uuid := (select v from msg where k = 'tl');
begin
  update auth.users set deleted_at = now() where id = ana;
  assert tests.msg_value(ben, format('select sender_name from public.list_messages(%L) where sender_id = %L limit 1', conv, ana)) = 'Former player',
    'a deleted account shows as Former player';
  update auth.users set deleted_at = null where id = ana;
  assert tests.msg_value(ben, format('select sender_name from public.list_messages(%L) where sender_id = %L limit 1', conv, ana)) = 'Ana Adult',
    'until then, the name';
end $$;

-- ---- Friend chats: closed until S20 -------------------------------------------------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  ben uuid := (select v from msg where k = 'ben');
  conv uuid;
begin
  assert tests.error_as(ana, format('select public.open_friend_conversation(%L)', ben)) = 'not_friends', 'not friends: refused';
  assert tests.error_as(ana, format('select public.open_friend_conversation(%L)', ana)) = 'not_friends', 'nor with yourself';
  insert into public.conversations (kind, profile_a_id, profile_b_id) values ('friends', least(ana, ben), greatest(ana, ben))
  returning id into conv;
  assert tests.error_as(ana, format('select * from public.send_message(%L, %L, %L)', conv, 'hi', gen_random_uuid())) = 'not_in_conversation',
    'a friend chat without the friendship: no sending';
  assert tests.msg_value(ana, format('select count(*) from public.conversations where id = %L', conv))::integer = 0,
    'nor reading';
end $$;

-- ---- The rate limit: 30 a minute, 500 in 24 hours, fixture chat included --------
do $$
declare
  ana uuid := (select v from msg where k = 'ana');
  ben uuid := (select v from msg where k = 'ben');
  tigers uuid := (select v from msg where k = 'tigers');
  lions uuid := (select v from msg where k = 'lions');
  conv uuid := (select v from msg where k = 'tl');
  fixture uuid;
begin
  delete from public.messages where sender_id = ben;
  for i in 1..29 loop
    insert into public.messages (conversation_id, sender_id, body, client_id) values (conv, ben, 'm' || i, gen_random_uuid());
  end loop;
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'the 30th', gen_random_uuid())) is null,
    'the 30th in a minute';
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'the 31st', gen_random_uuid())) = 'rate_limited',
    'the 31st in a minute';
  -- A minute later the minute is clear.
  update public.messages set created_at = now() - interval '61 seconds' where sender_id = ben;
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'later', gen_random_uuid())) is null,
    'a minute later';

  -- 24 hours: 499 earlier today, the 500th goes, the 501st doesn't.
  delete from public.messages where sender_id = ben;
  insert into public.messages (conversation_id, sender_id, body, client_id, created_at)
  select conv, ben, 'day ' || i, gen_random_uuid(), now() - interval '2 hours' from generate_series(1, 499) i;
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'the 500th', gen_random_uuid())) is null,
    'the 500th in 24 hours';
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'the 501st', gen_random_uuid())) = 'rate_limited',
    'the 501st in 24 hours';
  update public.messages set created_at = now() - interval '25 hours' where sender_id = ben;
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'next day', gen_random_uuid())) is null,
    '24 hours later';

  -- Fixture chat messages count, and fixture chat obeys the limit.
  delete from public.messages where sender_id = ben;
  insert into public.league_fixtures (league_id, home_team_id, away_team_id) values ((select v from msg where k = 'league'), tigers, lions)
  returning id into fixture;
  assert tests.error_as(ben, format('select public.send_fixture_message(%L, %L)', fixture, 'fixture hi')) is null,
    'fixture chat still sends';
  assert (select sender_profile_id from public.fixture_messages where fixture_id = fixture) = ben, 'and records the sender';
  insert into public.fixture_messages (fixture_id, sender_team_id, message, sender_profile_id)
  select fixture, lions, 'f' || i, ben from generate_series(1, 29) i;
  assert tests.error_as(ben, format('select * from public.send_message(%L, %L, %L)', conv, 'over', gen_random_uuid())) = 'rate_limited',
    'fixture messages count towards the limit';
  assert tests.error_as(ben, format('select public.send_fixture_message(%L, %L)', fixture, 'over')) = 'rate_limited',
    'and fixture chat is limited too';
end $$;

-- ---- Grants ----------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.are_friends(uuid, uuid)', 'public.blocked_between(uuid, uuid)', 'public.profile_is_deleted(uuid)',
    'public.message_display_name(uuid)', 'public.teams_share_league(uuid, uuid)',
    'public.conversation_participants(uuid)', 'public.my_conversation_side(uuid)',
    'public.conversation_others(uuid, uuid)', 'public.message_refusal(uuid, uuid[])',
    'public.assert_message_rate(uuid)', 'public.message_body(text)', 'public.conversation_other_side(uuid, uuid)'
  ] loop
    assert not has_function_privilege('authenticated', f, 'execute'), f || ' is internal';
    assert not has_function_privilege('anon', f, 'execute'), f || ' is internal (anon)';
    assert has_function_privilege('service_role', f, 'execute'), f || ' for service_role';
  end loop;
  foreach f in array array[
    'public.league_captain_contacts(uuid)', 'public.open_captain_conversation(uuid, uuid)',
    'public.open_friend_conversation(uuid)', 'public.send_message(uuid, text, uuid)',
    'public.mark_conversation_read(uuid)', 'public.mark_messages_delivered()', 'public.list_my_conversations()',
    'public.my_unread_message_count()', 'public.conversation_header(uuid)',
    'public.list_messages(uuid, timestamptz, uuid, integer)', 'public.can_access_conversation(uuid)'
  ] loop
    assert has_function_privilege('authenticated', f, 'execute'), f || ' for signed-in players';
    assert not has_function_privilege('anon', f, 'execute'), f || ' not signed out';
  end loop;
  assert (select relrowsecurity from pg_class where oid = 'public.conversations'::regclass), 'RLS on conversations';
  assert (select relrowsecurity from pg_class where oid = 'public.messages'::regclass), 'RLS on messages';
  assert (select relrowsecurity from pg_class where oid = 'public.conversation_reads'::regclass), 'RLS on conversation_reads';
  assert exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages'), 'messages are live';
  assert exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_reads'), 'receipts are live';
end $$;

rollback;
