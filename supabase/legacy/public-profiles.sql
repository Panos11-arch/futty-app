-- Read-only public profile view (item 5) — lets any signed-in user see
-- another player's public stats (tapping them in Contacts) without
-- broadening profiles' RLS itself.
--
-- profiles' only SELECT policy (supabase/legacy/schema.sql) is `auth.uid() = id` —
-- own row only. That's deliberately NOT relaxed here: doing so would expose
-- every column, including email/phone/gender/date_of_birth, to any signed-in
-- user. Same pattern as get_team_roster (supabase/legacy/teams.sql) instead — a
-- security-definer function that explicitly lists only the public columns,
-- so there's no way to widen this by accident later the way a blanket RLS
-- policy could be.
--
-- Run AFTER supabase/legacy/schema.sql. Run in the Supabase dashboard: SQL Editor >
-- New query > Run. Safe to re-run.

-- "position" is a reserved word (the POSITION(... IN ...) function), so the
-- returns-table column and the select-list reference both need quoting.
create or replace function public.get_public_profile(p_profile_id uuid)
returns table (
  id uuid,
  username text,
  full_name text,
  city text,
  "position" text,
  preferred_foot text,
  xp integer,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  goals integer
)
language sql
security definer
set search_path = ''
stable
as $$
  select id, username, full_name, city, "position", preferred_foot, xp, played, won, drawn, lost, goals
  from public.profiles
  where id = p_profile_id;
$$;

grant execute on function public.get_public_profile(uuid) to authenticated;

-- Bulk variant — the venue dashboard (item 7, "who booked it") and the
-- squad-post roster (item 5 from the previous batch, joined players' XP
-- tiers) both need several other users' public fields in one round trip.
-- Both call sites were silently getting back zero rows for anyone but the
-- signed-in user before this existed, since a plain `.from('profiles')`
-- select is still subject to the owner-only RLS policy — this is the actual
-- root cause of names/tiers showing as blank for players who aren't you.
create or replace function public.get_public_profiles(p_profile_ids uuid[])
returns table (
  id uuid,
  username text,
  full_name text,
  xp integer
)
language sql
security definer
set search_path = ''
stable
as $$
  select id, username, full_name, xp
  from public.profiles
  where id = any(p_profile_ids);
$$;

grant execute on function public.get_public_profiles(uuid[]) to authenticated;
