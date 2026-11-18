-- A12: a player's Futty avatar (decided 18 November). Initials stay the
-- default; a player can instead pick a kit shirt in one of the 8 kit colour
-- tokens (constants/futty-theme.ts kitColours) with a number from 1 to 99.
-- There are no photo uploads.
--
--   avatar_style       'initials' (default) or 'kit'
--   avatar_kit_colour  a kit colour token name, required for 'kit'
--   avatar_number      1 to 99, required for 'kit'
--
-- Owner only: authenticated has column-level UPDATE on profiles (no
-- table-wide UPDATE), so the three columns get their own grant, and the
-- existing owner-only update policy keeps other players' rows read-only.
--
-- Other players see the avatar wherever they see the name: the four public
-- profile functions return the three columns after every column they
-- returned before. Their return types change, so each is dropped (no
-- cascade) and created again with the body of its latest definition
-- (baseline.sql for all four), the same security settings and exactly the
-- same grants. The explicit revoke from anon undoes the schema's default
-- privileges, which a fresh create would otherwise pick up.

alter table public.profiles
  add column avatar_style text not null default 'initials',
  add column avatar_kit_colour text,
  add column avatar_number smallint,
  add constraint profiles_avatar_style_check
    check (avatar_style in ('initials', 'kit')),
  add constraint profiles_avatar_kit_colour_check
    check (avatar_kit_colour in ('kitRed', 'kitBlue', 'kitSky', 'kitGreen', 'kitYellow', 'kitOrange', 'kitBlack', 'kitWhite')),
  add constraint profiles_avatar_number_check
    check (avatar_number between 1 and 99),
  add constraint profiles_avatar_kit_check
    check (avatar_style <> 'kit' or (avatar_kit_colour is not null and avatar_number is not null));

grant update (avatar_style, avatar_kit_colour, avatar_number) on public.profiles to authenticated;

-- get_public_profile ---------------------------------------------------------

drop function public.get_public_profile(uuid);

create function public.get_public_profile(p_profile_id uuid)
returns table (
  id uuid, username text, full_name text, city text, "position" text, preferred_foot text,
  xp integer, played integer, won integer, drawn integer, lost integer, goals integer,
  avatar_style text, avatar_kit_colour text, avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select id, username, full_name, city, "position", preferred_foot, xp, played, won, drawn, lost, goals,
    avatar_style, avatar_kit_colour, avatar_number
  from public.profiles
  where id = p_profile_id;
$$;

alter function public.get_public_profile(uuid) owner to postgres;
revoke all on function public.get_public_profile(uuid) from public, anon;
grant all on function public.get_public_profile(uuid) to authenticated;
grant all on function public.get_public_profile(uuid) to service_role;

-- get_public_profiles --------------------------------------------------------

drop function public.get_public_profiles(uuid[]);

create function public.get_public_profiles(p_profile_ids uuid[])
returns table (
  id uuid, username text, full_name text, xp integer,
  avatar_style text, avatar_kit_colour text, avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select id, username, full_name, xp, avatar_style, avatar_kit_colour, avatar_number
  from public.profiles
  where id = any(p_profile_ids);
$$;

alter function public.get_public_profiles(uuid[]) owner to postgres;
revoke all on function public.get_public_profiles(uuid[]) from public, anon;
grant all on function public.get_public_profiles(uuid[]) to authenticated;
grant all on function public.get_public_profiles(uuid[]) to service_role;

-- get_team_roster ------------------------------------------------------------

drop function public.get_team_roster(uuid);

create function public.get_team_roster(p_team_id uuid)
returns table (
  profile_id uuid, username text, full_name text, role text, joined_at timestamp with time zone,
  avatar_style text, avatar_kit_colour text, avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id, p.username, p.full_name, tm.role, tm.joined_at,
    p.avatar_style, p.avatar_kit_colour, p.avatar_number
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = p_team_id
  order by tm.joined_at;
$$;

alter function public.get_team_roster(uuid) owner to postgres;
revoke all on function public.get_team_roster(uuid) from public, anon;
grant all on function public.get_team_roster(uuid) to authenticated;
grant all on function public.get_team_roster(uuid) to service_role;

-- list_players ---------------------------------------------------------------

drop function public.list_players();

create function public.list_players()
returns table (
  id uuid, username text, full_name text, phone text,
  avatar_style text, avatar_kit_colour text, avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.full_name,
    case when p.show_phone_publicly then p.phone else null end as phone,
    p.avatar_style, p.avatar_kit_colour, p.avatar_number
  from public.profiles p
  where p.username is not null
    and p.id <> auth.uid()
  order by p.username
  limit 200;
$$;

alter function public.list_players() owner to postgres;
revoke all on function public.list_players() from public, anon;
grant all on function public.list_players() to authenticated;
grant all on function public.list_players() to service_role;
