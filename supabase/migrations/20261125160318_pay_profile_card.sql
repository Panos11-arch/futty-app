-- S19: the player card (docs/specs/15-design.md section 0.6, image 20).
--
-- Profiles gain a favourite player (at most 40 characters, reportable), and
-- position and strong foot (preferred_foot) get the values the card and Edit
-- profile use: Goalkeeper, Defender, Midfielder, Forward; Left, Right, Both.
-- The owner changes only their own (the existing "Users can update their own
-- profile" policy and column grants).
--
-- my_player_card() returns everything the card shows for the signed-in
-- player, and nothing private (no phone, email or date of birth). Age rule
-- A5 (docs/specs/05-product.md section 16): others never see a minor's
-- username, so a minor's card has no QR for futty.app/p/<username> and
-- nothing to share (show_qr false). The server decides who is a minor.
--
-- Reports of a favourite player use the existing reports table with
-- context 'favourite_player' and reported_user_id; reports_flag_urgent
-- makes one urgent when that player is a minor (A7). No change needed here.

-- ---- Existing values ---------------------------------------------------------
-- Edit profile saved 'Striker' until now: it becomes 'Forward' (decided
-- 25 November). Any other value outside the lists (only possible from
-- before Edit profile had pickers) is cleared, so the checks can be added.
update public.profiles
set "position" = case lower(btrim("position"))
    when 'goalkeeper' then 'Goalkeeper'
    when 'defender' then 'Defender'
    when 'midfielder' then 'Midfielder'
    when 'forward' then 'Forward'
    when 'striker' then 'Forward'
  end
where "position" is not null
  and "position" not in ('Goalkeeper', 'Defender', 'Midfielder', 'Forward');

update public.profiles
set preferred_foot = case lower(btrim(preferred_foot))
    when 'left' then 'Left'
    when 'right' then 'Right'
    when 'both' then 'Both'
  end
where preferred_foot is not null
  and preferred_foot not in ('Left', 'Right', 'Both');

-- ---- Columns and checks --------------------------------------------------------
alter table public.profiles add column if not exists favourite_player text;

alter table public.profiles
  add constraint profiles_position_check
  check ("position" is null or "position" in ('Goalkeeper', 'Defender', 'Midfielder', 'Forward'));

alter table public.profiles
  add constraint profiles_preferred_foot_check
  check (preferred_foot is null or preferred_foot in ('Left', 'Right', 'Both'));

-- 1 to 40 characters, no spaces around it (the app trims, and sends null
-- for an empty field).
alter table public.profiles
  add constraint profiles_favourite_player_check
  check (favourite_player is null
         or (char_length(favourite_player) between 1 and 40 and favourite_player = btrim(favourite_player)));

grant update (favourite_player) on public.profiles to authenticated;

-- ---- The card ------------------------------------------------------------------
-- teams: at most two, league teams first (a team in league_teams), each
-- group in the order the player joined; team_count is every team, so the
-- card shows "+N" for the rest. member_since is the Cyprus date the account
-- was made.
create or replace function public.my_player_card()
returns table (
  username text,
  full_name text,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  avatar_illustration text,
  level numeric,
  "position" text,
  preferred_foot text,
  favourite_player text,
  member_since date,
  teams jsonb,
  team_count integer,
  show_qr boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  return query
  with mine as (
    select t.id, t.name,
           exists (select 1 from public.league_teams lt where lt.team_id = t.id) as in_league,
           tm.joined_at
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.profile_id = v_me
  ),
  ranked as (
    select m.id, m.name,
           row_number() over (order by m.in_league desc, m.joined_at, m.name, m.id) as n
    from mine m
  )
  select p.username,
         p.full_name,
         p.avatar_style,
         p.avatar_kit_colour,
         p.avatar_number,
         p.avatar_illustration,
         pl.level,
         p."position",
         p.preferred_foot,
         p.favourite_player,
         (p.created_at at time zone 'Asia/Nicosia')::date,
         coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.n)
                   from ranked r where r.n <= 2), '[]'::jsonb),
         (select count(*)::integer from mine),
         p.username is not null and not public.is_minor(v_me)
  from public.profiles p
  left join public.player_levels pl on pl.profile_id = p.id
  where p.id = v_me;
end;
$$;

revoke all on function public.my_player_card() from public, anon;
grant execute on function public.my_player_card() to authenticated, service_role;
