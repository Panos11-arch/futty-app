-- Block/report: the minimum Apple's App Store review expects from any app
-- with user-to-user contact (guideline 1.2, User Generated Content) — Futty
-- has fixture chat and a community/follow directory, both of which put you
-- in contact with people you didn't choose. Run in the Supabase dashboard:
-- SQL Editor > New query > Run. Safe to re-run.
--
-- Deliberately minimal: no admin dashboard, no automated action on reports.
-- Reports land in a table you check directly (Table Editor, or a `select *
-- from public.reports order by created_at desc`) — proportionate for an app
-- this size. Blocking is enforced by filtering what a blocked-by-you person
-- can show you (list_players below), not by trying to stop them from using
-- the app themselves.

create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocked_users_not_self check (blocker_id <> blocked_id)
);

create unique index if not exists blocked_users_unique
  on public.blocked_users (blocker_id, blocked_id);

alter table public.blocked_users enable row level security;

-- Same "manage your own state" shape as user_follows (community.sql) — a
-- user can see, create, and remove only their own blocks. Nobody, including
-- the blocked person, can see who blocked them.
drop policy if exists "Users manage their own blocks" on public.blocked_users;
create policy "Users manage their own blocks"
  on public.blocked_users for all
  to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- context/context_id are free-text pointers ("player" + profile id,
-- "fixture_chat" + fixture id, etc.) rather than foreign keys — a report
-- needs to keep making sense even if the reported content is later deleted,
-- which a strict FK would prevent.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid references public.profiles (id) on delete set null,
  context text not null,
  context_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- Insert-only, on purpose: nobody can read reports back through the API,
-- not even their own — this is intentionally a one-way mailbox to whoever
-- has direct (dashboard) access to the database, not a feature with its own
-- UI. Reduces this to "write a row", the smallest useful version of the
-- capability Apple wants to see.
drop policy if exists "Users can submit reports" on public.reports;
create policy "Users can submit reports"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

-- Excludes anyone you've blocked from the community directory — the actual
-- enforcement of "block" for this list. No return-column change, so a plain
-- CREATE OR REPLACE is enough (contrast the DROP FUNCTION this same
-- function needed in community.sql when `phone` was added to its output).
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
    and not exists (
      select 1 from public.blocked_users b
      where b.blocker_id = auth.uid() and b.blocked_id = p.id
    )
  order by p.username
  limit 200;
$$;

grant execute on function public.list_players() to authenticated;
