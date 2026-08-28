-- Run this in the Supabase dashboard: SQL Editor > New query > Run.
-- Safe to re-run.

-- 1. The profiles table, keyed to auth.users so deleting a user cleans up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- Added after the first version of this file, so existing databases get them too.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists full_name text;

-- Case-insensitive unique usernames. NULLs don't collide in a unique index, so
-- a profile without a username is still allowed.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- 2. Row level security. Without this the anon key would expose every row,
--    since that key ships in plain text inside the app bundle.
alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3. Username availability check for the sign-up form.
--    RLS hides other users' rows, so an unauthenticated client has no way to
--    discover whether a username is taken. This runs as the definer to answer
--    that one question: it returns a boolean, never a row.
create or replace function public.is_username_available(candidate text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select nullif(trim(candidate), '') is not null
     and not exists (
       select 1
       from public.profiles
       where lower(profiles.username) = lower(trim(candidate))
     );
$$;

grant execute on function public.is_username_available(text) to anon, authenticated;

-- 4. Server-side profile creation.
--    With "Confirm email" enabled there is no session at sign-up time, so the
--    client cannot insert its own row — RLS would reject it. Everything the
--    profile needs therefore rides along in raw_user_meta_data (set via the
--    `options.data` argument to signUp) and is copied across here.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  meta_full_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  begin
    insert into public.profiles (id, email, username, full_name)
    values (new.id, new.email, meta_username, meta_full_name)
    on conflict (id) do nothing;
  exception when unique_violation then
  
    -- The username was claimed between the client's availability check and this
    -- insert. Losing a rare race is not a reason to fail account creation, so
    -- keep the account and leave username null for the user to set later.
    insert into public.profiles (id, email, username, full_name)
    values (new.id, new.email, null, meta_full_name)
    on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
