-- S13A: Futty AI chats.
--
--   * A player's chats with Futty AI: the title is the first question; each
--     message is the player's (with up to 3 photos) or Futty AI's (with up to
--     2 action buttons from a fixed list).
--   * Only the owner reads them. Nothing is written from the app: the
--     futty-ai-chat function writes the question and the answer together with
--     the service role, after checking the caller owns the chat, so a player
--     can never write an answer of their own.
--   * Photos live in the private ai-chat-photos bucket at
--     <profile id>/<chat id>/<uuid>.jpg (JPEG, 1600 px on the long edge,
--     resized on the phone). Only the owner reads them; only the function
--     uploads them.
--   * Chats and their photos are deleted 7 days after the last message
--     (decided 22 November) by the daily futty-ai-cleanup job, and with the
--     account (delete-account).

create table public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index ai_chats_profile_idx on public.ai_chats (profile_id, last_message_at desc);
create index ai_chats_last_message_idx on public.ai_chats (last_message_at);

create table public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.ai_chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null default '' check (char_length(body) <= 8000),
  -- The action buttons under an answer: the app's fixed list only.
  actions text[] not null default '{}' check (
    cardinality(actions) <= 2
    and actions <@ array['book', 'my_bookings', 'payments', 'premium', 'find_game', 'leagues', 'settings', 'contact_support']
  ),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 3),
  created_at timestamptz not null default now()
);
create index ai_chat_messages_chat_idx on public.ai_chat_messages (chat_id, created_at);

alter table public.ai_chats enable row level security;
alter table public.ai_chat_messages enable row level security;

revoke all on public.ai_chats from public, anon, authenticated;
revoke all on public.ai_chat_messages from public, anon, authenticated;
grant select on public.ai_chats to authenticated;
grant select on public.ai_chat_messages to authenticated;
grant all on public.ai_chats to service_role;
grant all on public.ai_chat_messages to service_role;

create policy "Players read their own Futty AI chats" on public.ai_chats
  for select to authenticated using (profile_id = (select auth.uid()));

create policy "Players read the messages of their own Futty AI chats" on public.ai_chat_messages
  for select to authenticated using (
    exists (select 1 from public.ai_chats c where c.id = chat_id and c.profile_id = (select auth.uid()))
  );

-- ---- Photos ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-chat-photos', 'ai-chat-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Players read their own Futty AI photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'ai-chat-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---- Expiry -----------------------------------------------------------------------

-- How long a chat is kept after its last message (decided 22 November).
create or replace function public.ai_chat_keep_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 7 $$;

revoke all on function public.ai_chat_keep_days() from public, anon, authenticated;
grant execute on function public.ai_chat_keep_days() to service_role;

-- The chats quiet for longer than that, oldest first, with every photo path,
-- for the daily futty-ai-cleanup job: it removes the photos, then the chats.
create or replace function public.ai_chats_expired(p_limit integer)
returns table (chat_id uuid, photo_paths text[])
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         coalesce(
           (select array_agg(p order by p) from public.ai_chat_messages m, unnest(m.photo_paths) p where m.chat_id = c.id),
           '{}'
         )
  from public.ai_chats c
  where c.last_message_at < now() - make_interval(days => public.ai_chat_keep_days())
  order by c.last_message_at
  limit greatest(p_limit, 0);
$$;

revoke all on function public.ai_chats_expired(integer) from public, anon, authenticated;
grant execute on function public.ai_chats_expired(integer) to service_role;
