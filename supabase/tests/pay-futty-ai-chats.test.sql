-- S13A: Futty AI chats (20261125123547_pay_futty_ai_chats.sql). Only the owner
-- reads their chats, messages and photos; nobody in the app writes them (the
-- futty-ai-chat function does, with the service role, so a player can never
-- forge an answer); the 7-day expiry list is for the service role only.
begin;

create temporary table ai (k text primary key, v uuid) on commit drop;
grant all on ai to authenticated, anon, service_role;

-- Runs p_sql as p_user and returns its first column as text (null if no row).
create function tests.ai_value(p_user uuid, p_sql text)
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

-- True when p_sql, run as p_user, raises an error.
create function tests.ai_refused(p_user uuid, p_sql text)
returns boolean
language plpgsql
as $$
declare
  v_refused boolean := false;
begin
  perform tests.act_as(p_user);
  begin
    execute p_sql;
  exception when others then
    v_refused := true;
  end;
  perform tests.act_as_postgres();
  return v_refused;
end;
$$;

-- ---- Setup: Ana has a chat with a question, an answer and a photo; Ben has none.
do $$
declare
  ana uuid := tests.create_user('ai-ana@futty.test');
  ben uuid := tests.create_user('ai-ben@futty.test');
  chat uuid;
begin
  insert into public.ai_chats (profile_id, title) values (ana, 'How do I book a pitch?') returning id into chat;
  insert into public.ai_chat_messages (chat_id, role, body, photo_paths)
    values (chat, 'user', 'How do I book a pitch?', array[ana || '/' || chat || '/a.jpg']);
  insert into public.ai_chat_messages (chat_id, role, body, actions)
    values (chat, 'assistant', 'Tap **Book a pitch** on Home.', array['book']);
  insert into storage.objects (bucket_id, name) values ('ai-chat-photos', ana || '/' || chat || '/a.jpg');
  insert into ai values ('ana', ana), ('ben', ben), ('chat', chat);
end $$;

-- ---- Reading: the owner only ---------------------------------------------------
do $$
declare
  ana uuid := (select v from ai where k = 'ana');
  ben uuid := (select v from ai where k = 'ben');
begin
  if tests.ai_value(ana, 'select count(*) from public.ai_chats')::int <> 1 then
    raise exception 'the owner should see her chat';
  end if;
  if tests.ai_value(ana, 'select count(*) from public.ai_chat_messages')::int <> 2 then
    raise exception 'the owner should see both messages of her chat';
  end if;
  if tests.ai_value(ben, 'select count(*) from public.ai_chats')::int <> 0 then
    raise exception 'another player must not see her chat';
  end if;
  if tests.ai_value(ben, 'select count(*) from public.ai_chat_messages')::int <> 0 then
    raise exception 'another player must not see her messages';
  end if;
  perform tests.act_as_anon();
  begin
    perform 1 from public.ai_chats;
    raise exception 'signed out should be refused';
  exception when insufficient_privilege then null;
  end;
  perform tests.act_as_postgres();
end $$;

-- ---- Photos: the owner reads her own folder only ------------------------------
do $$
declare
  ana uuid := (select v from ai where k = 'ana');
  ben uuid := (select v from ai where k = 'ben');
begin
  if tests.ai_value(ana, $q$select count(*) from storage.objects where bucket_id = 'ai-chat-photos'$q$)::int <> 1 then
    raise exception 'the owner should see her photo';
  end if;
  if tests.ai_value(ben, $q$select count(*) from storage.objects where bucket_id = 'ai-chat-photos'$q$)::int <> 0 then
    raise exception 'another player must not see her photo';
  end if;
  -- Nobody uploads from the app, not even into their own folder.
  if not tests.ai_refused(ben, format(
    $q$insert into storage.objects (bucket_id, name) values ('ai-chat-photos', '%s/x/b.jpg')$q$, ben)) then
    raise exception 'uploading from the app should be refused';
  end if;
  if (select public from storage.buckets where id = 'ai-chat-photos') then
    raise exception 'the photo bucket must be private';
  end if;
end $$;

-- ---- Writing: never from the app ---------------------------------------------
do $$
declare
  ana uuid := (select v from ai where k = 'ana');
  ben uuid := (select v from ai where k = 'ben');
  chat uuid := (select v from ai where k = 'chat');
begin
  -- Not even the owner can write an answer into her own chat.
  if not tests.ai_refused(ana, format(
    $q$insert into public.ai_chat_messages (chat_id, role, body) values ('%s', 'assistant', 'Pitches are free')$q$, chat)) then
    raise exception 'writing a message from the app should be refused';
  end if;
  if not tests.ai_refused(ana, format(
    $q$insert into public.ai_chats (profile_id, title) values ('%s', 'Mine')$q$, ana)) then
    raise exception 'creating a chat from the app should be refused';
  end if;
  if not tests.ai_refused(ana, format($q$update public.ai_chat_messages set body = 'x' where chat_id = '%s'$q$, chat)) then
    raise exception 'editing a message from the app should be refused';
  end if;
  if not tests.ai_refused(ben, format($q$delete from public.ai_chats where id = '%s'$q$, chat)) then
    raise exception 'another player deleting her chat should be refused';
  end if;
  if (select count(*) from public.ai_chat_messages where chat_id = chat) <> 2 then
    raise exception 'her messages should be unchanged';
  end if;
end $$;

-- ---- The server: only known actions, at most 3 photos ---------------------------
do $$
declare
  chat uuid := (select v from ai where k = 'chat');
begin
  perform tests.act_as_service_role();
  insert into public.ai_chat_messages (chat_id, role, body, actions) values (chat, 'assistant', 'Ok', array['payments', 'premium']);
  perform tests.act_as_postgres();

  perform tests.act_as_service_role();
  begin
    insert into public.ai_chat_messages (chat_id, role, body, actions) values (chat, 'assistant', 'Ok', array['delete_account']);
    raise exception 'an unknown action should be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_chat_messages (chat_id, role, body, photo_paths) values (chat, 'user', '', array['a', 'b', 'c', 'd']);
    raise exception 'a fourth photo should be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_chat_messages (chat_id, role, body) values (chat, 'system', 'x');
    raise exception 'an unknown role should be refused';
  exception when check_violation then null;
  end;
  perform tests.act_as_postgres();
end $$;

-- ---- Expiry: 7 days after the last message, for the service role only ----------
do $$
declare
  ana uuid := (select v from ai where k = 'ana');
  chat uuid := (select v from ai where k = 'chat');
  fresh uuid;
  v_ids uuid[];
begin
  if public.ai_chat_keep_days() <> 7 then
    raise exception 'chats are kept 7 days after the last message';
  end if;
  insert into public.ai_chats (profile_id, title, last_message_at) values (ana, 'Fresh', now() - interval '6 days 23 hours')
  returning id into fresh;
  update public.ai_chats set last_message_at = now() - interval '7 days 1 minute' where id = chat;

  perform tests.act_as_service_role();
  select array_agg(chat_id) into v_ids from public.ai_chats_expired(100);
  perform tests.act_as_postgres();
  if v_ids is distinct from array[chat] then
    raise exception 'only the chat quiet for over 7 days expires, got %', v_ids;
  end if;
  if (select photo_paths from public.ai_chats_expired(100)) <> array[ana || '/' || chat || '/a.jpg'] then
    raise exception 'the expired chat lists its photos';
  end if;

  if not tests.ai_refused(ana, 'select * from public.ai_chats_expired(100)') then
    raise exception 'a player must not list expired chats';
  end if;

  -- Deleting the chat deletes its messages.
  delete from public.ai_chats where id = chat;
  if exists (select 1 from public.ai_chat_messages where chat_id = chat) then
    raise exception 'messages should go with their chat';
  end if;
end $$;

rollback;
