-- Community: a follow directory for players and teams. Run in the Supabase
-- dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- Only the caller's own follow state is ever exposed — no follower counts or
-- "who follows me" list, matching the prototype (a personal follow/unfollow
-- toggle, nothing public).

create table if not exists public.user_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('player', 'team')),
  target_id uuid not null,
  created_at timestamptz not null default now()
);

create unique index if not exists user_follows_unique
  on public.user_follows (follower_id, target_type, target_id);

alter table public.user_follows enable row level security;

drop policy if exists "Users manage their own follows" on public.user_follows;
create policy "Users manage their own follows"
  on public.user_follows for all
  to authenticated
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());

-- Lists profiles for the directory. Same reasoning as find_profile_by_username
-- (schema.sql): profiles' own RLS only lets a user read their own row, and
-- exposes only username/full_name (plus phone, opt-in only) here — never
-- email. Broadening an exact lookup into a browsable list is a bigger
-- discoverability step, worth noting: any signed-in user can now see every
-- other user who has set a username. Phone is null unless the player has
-- turned on show_phone_publicly (profile-details.sql) — it's off by default.
--
-- Dropped first: CREATE OR REPLACE FUNCTION can't change a function's return
-- columns in place (adding `phone` here) — Postgres errors with "cannot
-- change return type of existing function" and leaves the old 3-column
-- version in place otherwise.
drop function if exists public.list_players();
create or replace function public.list_players()
returns table (id uuid, username text, full_name text, phone text)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.username, p.full_name,
    case when p.show_phone_publicly then p.phone else null end as phone
  from public.profiles p
  where p.username is not null
    and p.id <> auth.uid()
  order by p.username
  limit 200;
$$;

grant execute on function public.list_players() to authenticated;
