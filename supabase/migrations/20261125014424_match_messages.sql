-- S13: messages. One messaging system for captain to captain (two teams in a
-- league) and friend to friend, with the age and safety rules of
-- docs/specs/05-product.md section 16 (A3-A6) applied on the server.
--
--   conversations       one per pair: two teams (captains) or two players (friends)
--   messages            text only, 1 to 1000 characters, from one player
--   conversation_reads  each player's last-read and last-delivered time: the
--                       read receipts and the unread counts
--
-- Who is in a conversation is worked out each time, never stored:
--   captains  the CURRENT captains of the two teams (team_members.role)
--   friends   the two players, only while are_friends() says so
-- are_friends() returns false until S20 (friends) replaces it: friend chats
-- are built but nobody can open one yet (decided by Dimitris, 25 November).
--
-- Every send is refused when either side blocked the other (both ways), or
-- for an adult and a minor together (A4), or past the rate limit: 30
-- messages a minute and 500 in 24 hours per player, across captain, friend
-- and fixture chats (decided by Dimitris, 25 November).
--
-- A deleted account (delete-account soft-deletes the login and scrubs the
-- profile) shows as "Former player".
--
-- A new message pushes "message_new" through send_notification to the other
-- side, once per unread run: a player who hasn't read the last one isn't
-- pushed again until they do.
--
-- Re-created: send_fixture_message (latest: 20261124224929_match_age_safety.sql)
-- with the rate limit and its sender recorded; nothing else changes in it.

-- ---- Tables ----------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('captains', 'friends')),
  team_a_id uuid references public.teams (id) on delete cascade,
  team_b_id uuid references public.teams (id) on delete cascade,
  profile_a_id uuid references public.profiles (id) on delete cascade,
  profile_b_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  -- Each pair is stored once, the smaller id first.
  constraint conversations_pair check (
    (kind = 'captains' and team_a_id is not null and team_b_id is not null and team_a_id < team_b_id
      and profile_a_id is null and profile_b_id is null)
    or (kind = 'friends' and profile_a_id is not null and profile_b_id is not null and profile_a_id < profile_b_id
      and team_a_id is null and team_b_id is null)
  )
);
create unique index conversations_captains_pair on public.conversations (team_a_id, team_b_id) where kind = 'captains';
create unique index conversations_friends_pair on public.conversations (profile_a_id, profile_b_id) where kind = 'friends';

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  -- Captain chats: the side the sender wrote for.
  sender_team_id uuid references public.teams (id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  -- The app's id for the message, so a retried send never doubles it.
  client_id uuid not null,
  -- clock_timestamp(): two sends in one transaction still come in order.
  created_at timestamptz not null default clock_timestamp()
);
create unique index messages_sender_client on public.messages (sender_id, client_id);
create index messages_conversation_time on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender_time on public.messages (sender_id, created_at desc);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  last_delivered_at timestamptz,
  primary key (conversation_id, profile_id)
);

-- Fixture chat messages count towards the same rate limit, so they record
-- who sent them (they still show as the team).
alter table public.fixture_messages
  add column if not exists sender_profile_id uuid references public.profiles (id) on delete set null;
create index if not exists fixture_messages_sender_time on public.fixture_messages (sender_profile_id, created_at desc);

insert into public.notification_types (type, always_sent) values ('message_new', false)
on conflict (type) do nothing;

-- ---- Internal helpers (service_role only) ----------------------------------

-- S20 replaces this with the real friendships check. Until then nobody is
-- friends, so no friend chat can be opened or written to.
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

-- Either player blocked the other.
create or replace function public.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- A deleted account: no live login (delete-account soft-deletes it).
create or replace function public.profile_is_deleted(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is null
      or not exists (select 1 from auth.users u where u.id = p_profile_id and u.deleted_at is null);
$$;

-- A player's name as the caller sees it in messages: "Former player" for a
-- deleted account, the first name only for a minor (A5).
create or replace function public.message_display_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.profile_is_deleted(p_profile_id) then 'Former player'
    else coalesce((
      select case
        when public.name_hidden(p.id, p.date_of_birth) then public.minor_first_name(p.first_name, p.full_name)
        else coalesce(nullif(trim(p.full_name), ''), p.username, 'Player')
      end
      from public.profiles p where p.id = p_profile_id), 'Former player')
  end;
$$;

-- Both teams are in the same league (or division).
create or replace function public.teams_share_league(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_teams x
    join public.league_teams y on y.league_id = x.league_id
    where x.team_id = p_a and y.team_id = p_b
  );
$$;

-- Who is in a conversation right now, and the side (team) they are on.
create or replace function public.conversation_participants(p_conversation_id uuid)
returns table (profile_id uuid, team_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id, tm.team_id
  from public.conversations c
  join public.team_members tm on tm.team_id in (c.team_a_id, c.team_b_id) and tm.role = 'captain'
  where c.id = p_conversation_id and c.kind = 'captains' and tm.profile_id is not null
  union
  select x.profile_id, null::uuid
  from public.conversations c
  cross join lateral (values (c.profile_a_id), (c.profile_b_id)) as x (profile_id)
  where c.id = p_conversation_id and c.kind = 'friends' and public.are_friends(c.profile_a_id, c.profile_b_id);
$$;

-- The caller's side of a conversation: their team for a captain chat, or
-- not found. Raises not_in_conversation when the caller isn't in it.
create or replace function public.my_conversation_side(p_conversation_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.conversations where id = p_conversation_id) then
    raise exception 'conversation_not_found';
  end if;
  select p.team_id into v_team
  from public.conversation_participants(p_conversation_id) p
  where p.profile_id = auth.uid()
  order by p.team_id
  limit 1;
  if not found then
    raise exception 'not_in_conversation';
  end if;
  return v_team;
end;
$$;

-- The other side: every participant not on the caller's side.
create or replace function public.conversation_others(p_conversation_id uuid, p_me uuid)
returns table (profile_id uuid, team_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select p.team_id from public.conversation_participants(p_conversation_id) p where p.profile_id = p_me limit 1
  )
  select p.profile_id, p.team_id
  from public.conversation_participants(p_conversation_id) p
  where p.profile_id <> p_me
    and (p.team_id is null or p.team_id is distinct from (select team_id from mine));
$$;

-- Why p_me can't write to these players, or null: a block either way first,
-- then an adult and a minor together (A4).
create or replace function public.message_refusal(p_me uuid, p_others uuid[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from unnest(p_others) o where public.blocked_between(p_me, o)) then 'blocked'
    when exists (select 1 from unnest(p_others) o where not public.age_pair_allowed(p_me, o)) then 'age_pair_refused'
  end;
$$;

-- The rate limit, for every chat: 30 messages a minute and 500 in 24 hours.
-- Takes a per-player lock so two sends at once can't both slip under it.
create or replace function public.assert_message_rate(p_me uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_minute integer;
  v_day integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('message_rate:' || p_me::text, 0));
  select
    (select count(*) from public.messages m where m.sender_id = p_me and m.created_at > now() - interval '1 minute')
    + (select count(*) from public.fixture_messages f where f.sender_profile_id = p_me and f.created_at > now() - interval '1 minute'),
    (select count(*) from public.messages m where m.sender_id = p_me and m.created_at > now() - interval '24 hours')
    + (select count(*) from public.fixture_messages f where f.sender_profile_id = p_me and f.created_at > now() - interval '24 hours')
  into v_minute, v_day;
  if v_minute >= 30 or v_day >= 500 then
    raise exception 'rate_limited';
  end if;
end;
$$;

-- A message's body: trimmed, 1 to 1000 characters.
create or replace function public.message_body(p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text := trim(coalesce(p_body, ''));
begin
  if v_body = '' then
    raise exception 'message_required';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'message_too_long';
  end if;
  return v_body;
end;
$$;

-- ---- Row level security -----------------------------------------------------

-- Policy helper (so authenticated may run it): the caller is in it now.
create or replace function public.can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.conversation_participants(p_conversation_id) p where p.profile_id = auth.uid()
  );
$$;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;

-- Reads only (the app reads through the functions below; realtime needs
-- these). Every write goes through a function.
create policy "Participants read their conversations"
  on public.conversations for select to authenticated
  using (public.can_access_conversation(id));
create policy "Participants read their messages"
  on public.messages for select to authenticated
  using (public.can_access_conversation(conversation_id));
create policy "Participants read the read receipts"
  on public.conversation_reads for select to authenticated
  using (public.can_access_conversation(conversation_id));

revoke all on public.conversations, public.messages, public.conversation_reads from anon;
revoke insert, update, delete, truncate on public.conversations, public.messages, public.conversation_reads from authenticated;

-- Realtime: new messages and read receipts.
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'conversation_reads'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---- Opening a conversation -------------------------------------------------

-- "Message a captain": the other teams of a league with their current
-- captains, for a captain of a team in that league. Anyone else gets no rows
-- (the button is hidden).
create or replace function public.league_captain_contacts(p_league_id uuid)
returns table (
  my_team_id uuid,
  team_id uuid,
  team_name text,
  captain_id uuid,
  captain_name text,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select lt.team_id
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id and tm.role = 'captain' and tm.profile_id = auth.uid()
    where lt.league_id = p_league_id
    order by lt.joined_at, lt.team_id
    limit 1
  )
  select distinct on (t.name, t.id)
    (select team_id from mine), t.id, t.name, tm.profile_id, public.message_display_name(tm.profile_id),
    p.avatar_style, p.avatar_kit_colour, p.avatar_number
  from public.league_teams lt
  join public.teams t on t.id = lt.team_id
  join public.team_members tm on tm.team_id = t.id and tm.role = 'captain'
  join public.profiles p on p.id = tm.profile_id
  where lt.league_id = p_league_id
    and exists (select 1 from mine)
    and t.id <> (select team_id from mine)
    and tm.profile_id <> auth.uid()
    and not public.profile_is_deleted(tm.profile_id)
  order by t.name, t.id, tm.joined_at;
$$;

-- The captain chat between the caller's team and another team in one of
-- its leagues, created the first time.
create or replace function public.open_captain_conversation(p_my_team_id uuid, p_other_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_others uuid[];
  v_refusal text;
  v_id uuid;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = p_my_team_id and profile_id = v_me and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;
  if p_other_team_id is null or p_other_team_id = p_my_team_id
     or not public.teams_share_league(p_my_team_id, p_other_team_id) then
    raise exception 'teams_not_in_league';
  end if;

  select array_agg(tm.profile_id) into v_others
  from public.team_members tm
  where tm.team_id = p_other_team_id and tm.role = 'captain' and tm.profile_id <> v_me;
  if v_others is null then
    raise exception 'no_captain';
  end if;
  v_refusal := public.message_refusal(v_me, v_others);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  insert into public.conversations (kind, team_a_id, team_b_id)
  values ('captains', least(p_my_team_id, p_other_team_id), greatest(p_my_team_id, p_other_team_id))
  on conflict do nothing;

  select id into v_id from public.conversations
  where kind = 'captains'
    and team_a_id = least(p_my_team_id, p_other_team_id)
    and team_b_id = greatest(p_my_team_id, p_other_team_id);
  return v_id;
end;
$$;

-- The friend chat with another player, created the first time.
create or replace function public.open_friend_conversation(p_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_refusal text;
  v_id uuid;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_profile_id is null or p_profile_id = v_me or not public.are_friends(v_me, p_profile_id) then
    raise exception 'not_friends';
  end if;
  v_refusal := public.message_refusal(v_me, array[p_profile_id]);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  insert into public.conversations (kind, profile_a_id, profile_b_id)
  values ('friends', least(v_me, p_profile_id), greatest(v_me, p_profile_id))
  on conflict do nothing;

  select id into v_id from public.conversations
  where kind = 'friends' and profile_a_id = least(v_me, p_profile_id) and profile_b_id = greatest(v_me, p_profile_id);
  return v_id;
end;
$$;

-- ---- Sending ----------------------------------------------------------------

create or replace function public.send_message(p_conversation_id uuid, p_body text, p_client_id uuid)
returns table (id uuid, client_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_side uuid;
  v_others uuid[];
  v_refusal text;
  v_body text;
  v_row public.messages;
  v_other uuid;
  v_title text;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_client_id is null then
    raise exception 'client_id_required';
  end if;

  -- A retry of a send that already went through returns it again.
  select * into v_row from public.messages m where m.sender_id = v_me and m.client_id = p_client_id;
  if found then
    if v_row.conversation_id <> p_conversation_id then
      raise exception 'client_id_reused';
    end if;
    return query select v_row.id, v_row.client_id, v_row.created_at;
    return;
  end if;

  v_side := public.my_conversation_side(p_conversation_id);
  select array_agg(o.profile_id) into v_others from public.conversation_others(p_conversation_id, v_me) o;
  if v_others is null then
    raise exception 'no_captain';
  end if;
  v_refusal := public.message_refusal(v_me, v_others);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  v_body := public.message_body(p_body);
  perform public.assert_message_rate(v_me);

  insert into public.messages (conversation_id, sender_id, sender_team_id, body, client_id)
  values (p_conversation_id, v_me, v_side, v_body, p_client_id)
  returning * into v_row;

  update public.conversations set last_message_at = v_row.created_at where conversations.id = p_conversation_id;

  insert into public.conversation_reads as r (conversation_id, profile_id, last_read_at, last_delivered_at)
  values (p_conversation_id, v_me, v_row.created_at, v_row.created_at)
  on conflict (conversation_id, profile_id)
  do update set last_read_at = greatest(r.last_read_at, excluded.last_read_at),
                last_delivered_at = greatest(r.last_delivered_at, excluded.last_delivered_at);

  -- Push the other side, once per unread run.
  v_title := public.message_display_name(v_me);
  foreach v_other in array v_others loop
    if not exists (
      select 1 from public.messages m
      left join public.conversation_reads r on r.conversation_id = m.conversation_id and r.profile_id = v_other
      where m.conversation_id = p_conversation_id
        and m.id <> v_row.id
        and m.sender_id is distinct from v_other
        and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    ) then
      perform public.send_notification(v_other, 'message_new', jsonb_build_object(
        'title', v_title,
        'body', left(v_body, 100),
        'conversationId', p_conversation_id));
    end if;
  end loop;

  return query select v_row.id, v_row.client_id, v_row.created_at;
end;
$$;

-- ---- Reading ----------------------------------------------------------------

-- The caller has read the conversation up to now: their unread count drops
-- to 0, the other side sees "read", and the conversation's pushes are read.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  perform public.my_conversation_side(p_conversation_id);
  insert into public.conversation_reads as r (conversation_id, profile_id, last_read_at, last_delivered_at)
  values (p_conversation_id, v_me, clock_timestamp(), clock_timestamp())
  on conflict (conversation_id, profile_id)
  do update set last_read_at = excluded.last_read_at, last_delivered_at = excluded.last_delivered_at;

  update public.notifications n set read_at = now()
  where n.profile_id = v_me and n.type = 'message_new' and n.read_at is null
    and n.data ->> 'conversationId' = p_conversation_id::text;
end;
$$;

-- The caller's app has every message up to now ("delivered").
create or replace function public.mark_messages_delivered()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  insert into public.conversation_reads as r (conversation_id, profile_id, last_delivered_at)
  select c.id, v_me, clock_timestamp()
  from public.conversations c
  where c.last_message_at is not null
    and exists (select 1 from public.conversation_participants(c.id) p where p.profile_id = v_me)
  on conflict (conversation_id, profile_id)
  do update set last_delivered_at = excluded.last_delivered_at;
end;
$$;

-- What the header and the list rows show for the other side.
create or replace function public.conversation_other_side(p_conversation_id uuid, p_me uuid)
returns table (
  title text,
  subtitle text,
  other_profile_id uuid,
  other_team_id uuid,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_my_team uuid;
  v_other_team uuid;
  v_other uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.kind = 'captains' then
    select p.team_id into v_my_team from public.conversation_participants(p_conversation_id) p
    where p.profile_id = p_me order by p.team_id limit 1;
    v_other_team := case when v_my_team = v_conv.team_a_id then v_conv.team_b_id else v_conv.team_a_id end;
    select tm.profile_id into v_other from public.team_members tm
    where tm.team_id = v_other_team and tm.role = 'captain' and tm.profile_id <> p_me
    order by tm.joined_at, tm.profile_id limit 1;
    return query
      -- No captain right now: the team's name.
      select case when v_other is null then t.name else public.message_display_name(v_other) end,
             t.name, v_other, v_other_team,
             pr.avatar_style, pr.avatar_kit_colour, pr.avatar_number
      from public.teams t
      left join public.profiles pr on pr.id = v_other and not public.profile_is_deleted(v_other)
      where t.id = v_other_team;
  else
    v_other := case when v_conv.profile_a_id = p_me then v_conv.profile_b_id else v_conv.profile_a_id end;
    return query
      select public.message_display_name(v_other),
             (select t.name from public.team_members tm join public.teams t on t.id = tm.team_id
              where tm.profile_id = v_other order by tm.joined_at, t.id limit 1),
             v_other, null::uuid,
             pr.avatar_style, pr.avatar_kit_colour, pr.avatar_number
      from (select 1) one
      left join public.profiles pr on pr.id = v_other and not public.profile_is_deleted(v_other);
  end if;
end;
$$;

-- Inbox: the caller's conversations with at least one message, newest first.
create or replace function public.list_my_conversations()
returns table (
  id uuid,
  kind text,
  title text,
  subtitle text,
  other_profile_id uuid,
  other_team_id uuid,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  last_body text,
  last_at timestamptz,
  last_mine boolean,
  unread integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, o.title, o.subtitle, o.other_profile_id, o.other_team_id,
         o.avatar_style, o.avatar_kit_colour, o.avatar_number,
         last.body, last.created_at, last.sender_id = auth.uid(),
         (select count(*)::integer from public.messages m
          where m.conversation_id = c.id and m.sender_id is distinct from auth.uid()
            and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
  from public.conversations c
  cross join lateral public.conversation_other_side(c.id, auth.uid()) o
  cross join lateral (
    select m.body, m.created_at, m.sender_id from public.messages m
    where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1
  ) last
  left join public.conversation_reads r on r.conversation_id = c.id and r.profile_id = auth.uid()
  where auth.uid() is not null
    and c.last_message_at is not null
    and exists (select 1 from public.conversation_participants(c.id) p where p.profile_id = auth.uid())
  order by last.created_at desc, c.id;
$$;

-- The badge: unread messages across all the caller's conversations.
create or replace function public.my_unread_message_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(unread), 0)::integer from public.list_my_conversations();
$$;

-- The chat header: the other side, whether the caller can write, and how
-- far the other side has received and read.
create or replace function public.conversation_header(p_conversation_id uuid)
returns table (
  id uuid,
  kind text,
  title text,
  subtitle text,
  other_profile_id uuid,
  other_team_id uuid,
  my_team_id uuid,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  send_refusal text,
  blocked_by_me boolean,
  other_read_at timestamptz,
  other_delivered_at timestamptz,
  friend_team_id uuid,
  my_captain_team_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_side uuid;
  v_others uuid[];
  v_kind text;
begin
  v_side := public.my_conversation_side(p_conversation_id);
  select array_agg(o.profile_id) into v_others from public.conversation_others(p_conversation_id, v_me) o;
  select c.kind into v_kind from public.conversations c where c.id = p_conversation_id;

  return query
    select p_conversation_id, v_kind, s.title, s.subtitle, s.other_profile_id, s.other_team_id, v_side,
           s.avatar_style, s.avatar_kit_colour, s.avatar_number,
           case when v_others is null then 'no_captain' else public.message_refusal(v_me, v_others) end,
           exists (select 1 from public.blocked_users b where b.blocker_id = v_me and b.blocked_id = s.other_profile_id),
           (select max(r.last_read_at) from public.conversation_reads r
            where r.conversation_id = p_conversation_id and r.profile_id = any (coalesce(v_others, '{}'))),
           (select max(r.last_delivered_at) from public.conversation_reads r
            where r.conversation_id = p_conversation_id and r.profile_id = any (coalesce(v_others, '{}'))),
           -- Friend chats, "Team vs team": a team each of them captains.
           case when v_kind = 'friends' then
             (select tm.team_id from public.team_members tm
              where tm.profile_id = s.other_profile_id and tm.role = 'captain' order by tm.joined_at, tm.team_id limit 1)
           end,
           case when v_kind = 'friends' then
             (select tm.team_id from public.team_members tm
              where tm.profile_id = v_me and tm.role = 'captain' order by tm.joined_at, tm.team_id limit 1)
           end
    from public.conversation_other_side(p_conversation_id, v_me) s;
end;
$$;

-- A page of messages, newest first, older than (p_before, p_before_id).
create or replace function public.list_messages(
  p_conversation_id uuid,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  mine boolean,
  body text,
  client_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.my_conversation_side(p_conversation_id);
  return query
    select m.id, m.sender_id, public.message_display_name(m.sender_id), m.sender_id = auth.uid(),
           m.body, case when m.sender_id = auth.uid() then m.client_id end, m.created_at
    from public.messages m
    where m.conversation_id = p_conversation_id
      and (p_before is null or (m.created_at, m.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- ---- Fixture chat: the rate limit -------------------------------------------

-- send_fixture_message (latest: 20261124224929_match_age_safety.sql). S13:
-- the rate limit, and the sender recorded. Nothing else changes.
create or replace function public.send_fixture_message(p_fixture_id uuid, p_message text)
returns public.fixture_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
  v_row public.fixture_messages;
begin
  perform public.assert_age_ok();

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if public.fixture_has_minor_captain(p_fixture_id) then
    raise exception 'minor_chat_blocked';
  end if;

  if nullif(trim(p_message), '') is null then
    raise exception 'message_required';
  end if;

  -- S13: the rate limit, shared with captain and friend chats.
  perform public.assert_message_rate(auth.uid());

  -- S13: sender_profile_id, for the rate limit.
  insert into public.fixture_messages (fixture_id, sender_team_id, message, sender_profile_id)
  values (p_fixture_id, v_my_team, trim(p_message), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ---- Grants -------------------------------------------------------------------

-- Signed in.
revoke all on function public.league_captain_contacts(uuid) from public, anon;
grant execute on function public.league_captain_contacts(uuid) to authenticated, service_role;
revoke all on function public.open_captain_conversation(uuid, uuid) from public, anon;
grant execute on function public.open_captain_conversation(uuid, uuid) to authenticated, service_role;
revoke all on function public.open_friend_conversation(uuid) from public, anon;
grant execute on function public.open_friend_conversation(uuid) to authenticated, service_role;
revoke all on function public.send_message(uuid, text, uuid) from public, anon;
grant execute on function public.send_message(uuid, text, uuid) to authenticated, service_role;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated, service_role;
revoke all on function public.mark_messages_delivered() from public, anon;
grant execute on function public.mark_messages_delivered() to authenticated, service_role;
revoke all on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated, service_role;
revoke all on function public.my_unread_message_count() from public, anon;
grant execute on function public.my_unread_message_count() to authenticated, service_role;
revoke all on function public.conversation_header(uuid) from public, anon;
grant execute on function public.conversation_header(uuid) to authenticated, service_role;
revoke all on function public.list_messages(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_messages(uuid, timestamptz, uuid, integer) to authenticated, service_role;
-- The RLS policies call it as the signed-in player.
revoke all on function public.can_access_conversation(uuid) from public, anon;
grant execute on function public.can_access_conversation(uuid) to authenticated, service_role;

-- Internal: service_role only.
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public.profile_is_deleted(uuid) from public, anon, authenticated;
revoke all on function public.message_display_name(uuid) from public, anon, authenticated;
revoke all on function public.teams_share_league(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conversation_participants(uuid) from public, anon, authenticated;
revoke all on function public.my_conversation_side(uuid) from public, anon, authenticated;
revoke all on function public.conversation_others(uuid, uuid) from public, anon, authenticated;
revoke all on function public.message_refusal(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.assert_message_rate(uuid) from public, anon, authenticated;
revoke all on function public.message_body(text) from public, anon, authenticated;
revoke all on function public.conversation_other_side(uuid, uuid) from public, anon, authenticated;
grant execute on function public.are_friends(uuid, uuid) to service_role;
grant execute on function public.blocked_between(uuid, uuid) to service_role;
grant execute on function public.profile_is_deleted(uuid) to service_role;
grant execute on function public.message_display_name(uuid) to service_role;
grant execute on function public.teams_share_league(uuid, uuid) to service_role;
grant execute on function public.conversation_participants(uuid) to service_role;
grant execute on function public.my_conversation_side(uuid) to service_role;
grant execute on function public.conversation_others(uuid, uuid) to service_role;
grant execute on function public.message_refusal(uuid, uuid[]) to service_role;
grant execute on function public.assert_message_rate(uuid) to service_role;
grant execute on function public.message_body(text) to service_role;
grant execute on function public.conversation_other_side(uuid, uuid) to service_role;
