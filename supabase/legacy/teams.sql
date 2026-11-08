-- Teams: creation and membership. Run in the Supabase dashboard: SQL Editor >
-- New query > Run. Safe to re-run.
--
-- teams/team_members already existed in your database before this file (you
-- set them up separately) — this only adds RLS, a create-team RPC, and a
-- privacy-safe username lookup for adding members.

-- Squad composition, chosen once at team creation. roster_size counts the
-- captain as the first main-squad slot (so roster_size - 1 more main players
-- get added); substitute_slots is separate and optional (0 = no subs).
alter table public.teams add column if not exists roster_size integer not null default 11;
alter table public.teams add column if not exists substitute_slots integer not null default 0;

-- The pre-existing constraint only allowed ('captain','player') — no
-- 'substitute', even though the app has always let a captain add substitutes.
-- Widened rather than left alone since substitute_slots (above) exists
-- specifically to support that roster shape.
alter table public.team_members drop constraint if exists team_members_role_check;
alter table public.team_members add constraint team_members_role_check
  check (role in ('captain', 'player', 'substitute'));

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- Team names/rosters aren't sensitive — same "browsable like a catalogue"
-- reasoning as venues.
drop policy if exists "Authenticated users can read teams" on public.teams;
create policy "Authenticated users can read teams"
  on public.teams for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read team members" on public.team_members;
create policy "Authenticated users can read team members"
  on public.team_members for select
  to authenticated
  using (true);

-- No direct insert policy on teams — creation always goes through
-- create_team() below, so the team row and its captain's membership row are
-- guaranteed to be created together. A team with no captain can't happen.

-- Adding a member IS a plain, RLS-checked insert: only an existing captain of
-- the team can add someone else to it.
drop policy if exists "Captains can add team members" on public.team_members;
create policy "Captains can add team members"
  on public.team_members for insert
  to authenticated
  with check (
    exists (
      select 1 from public.team_members captain
      where captain.team_id = team_members.team_id
        and captain.profile_id = auth.uid()
        and captain.role = 'captain'
    )
  );

create unique index if not exists team_members_unique_membership
  on public.team_members (team_id, profile_id);

create or replace function public.create_team(
  p_name text,
  p_city text,
  p_roster_size integer default 11,
  p_substitute_slots integer default 0
)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'name_required';
  end if;

  if p_roster_size < 1 then
    raise exception 'roster_too_small';
  end if;
  if p_substitute_slots < 0 then
    raise exception 'invalid_substitute_slots';
  end if;

  insert into public.teams
    (name, city, created_by, xp, played, won, drawn, lost, goals, roster_size, substitute_slots)
  values
    (trim(p_name), nullif(trim(p_city), ''), auth.uid(), 0, 0, 0, 0, 0, 0, p_roster_size, p_substitute_slots)
  returning * into v_team;

  insert into public.team_members (team_id, profile_id, role)
  values (v_team.id, auth.uid(), 'captain');

  return v_team;
end;
$$;

grant execute on function public.create_team(text, text, integer, integer) to authenticated;

-- Lets a captain add a member by username without exposing that user's email
-- or other profile fields — profiles' own RLS only allows reading your own row.
create or replace function public.find_profile_by_username(p_username text)
returns table (id uuid, username text, full_name text)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.username, p.full_name
  from public.profiles p
  where lower(p.username) = lower(trim(p_username));
$$;

grant execute on function public.find_profile_by_username(text) to authenticated;

-- Team rosters need each member's username, but profiles' own RLS only lets a
-- user read their own row — this exposes just enough (username, full_name)
-- for teammates to recognize each other, same reasoning as the lookup above.
create or replace function public.get_team_roster(p_team_id uuid)
returns table (profile_id uuid, username text, full_name text, role text, joined_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select tm.profile_id, p.username, p.full_name, tm.role, tm.joined_at
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = p_team_id
  order by tm.joined_at;
$$;

grant execute on function public.get_team_roster(uuid) to authenticated;


