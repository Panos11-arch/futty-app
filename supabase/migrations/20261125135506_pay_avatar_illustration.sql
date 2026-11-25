-- S18: illustrated avatars. Besides initials (the default) and a kit
-- (pay_profile_avatar), a player can pick one of 48 illustrations bundled in
-- the app (lib/avatar-illustrations.ts holds the ids, assets/avatars the
-- drawings). Only the id is stored; the check below is the bundled id list,
-- and lib/avatar-illustrations.test.ts keeps the two the same. There are no
-- photo uploads.
--
--   avatar_style         'initials' (default), 'kit' or 'illustration'
--   avatar_illustration  one of the bundled ids, required for 'illustration'
--
-- Owner only, as for the kit columns: authenticated gets column-level UPDATE
-- on the new column, and the existing owner-only update policy keeps other
-- players' rows read-only.
--
-- Other players see the illustration wherever they see the avatar: the eight
-- functions that return the avatar columns return avatar_illustration after
-- every column they returned before. Their return types change, so each is
-- dropped (no cascade) and created again with the body of its latest
-- definition, the same security settings and exactly the same grants:
--
--   get_public_profile, get_public_profiles, get_team_roster, list_players
--     latest: 20261124224929_match_age_safety.sql
--   league_captain_contacts, conversation_other_side, list_my_conversations,
--   conversation_header
--     latest: 20261125014424_match_messages.sql
--
-- my_unread_message_count reads list_my_conversations().unread by name, so it
-- keeps working unchanged.

alter table public.profiles
  drop constraint profiles_avatar_style_check,
  add column avatar_illustration text,
  add constraint profiles_avatar_style_check
    check (avatar_style in ('initials', 'kit', 'illustration')),
  add constraint profiles_avatar_illustration_check
    check (avatar_illustration in (
      'avatar-01', 'avatar-02', 'avatar-03', 'avatar-04', 'avatar-05', 'avatar-06', 'avatar-07', 'avatar-08',
      'avatar-09', 'avatar-10', 'avatar-11', 'avatar-12', 'avatar-13', 'avatar-14', 'avatar-15', 'avatar-16',
      'avatar-17', 'avatar-18', 'avatar-19', 'avatar-20', 'avatar-21', 'avatar-22', 'avatar-23', 'avatar-24',
      'avatar-25', 'avatar-26', 'avatar-27', 'avatar-28', 'avatar-29', 'avatar-30', 'avatar-31', 'avatar-32',
      'avatar-33', 'avatar-34', 'avatar-35', 'avatar-36', 'avatar-37', 'avatar-38', 'avatar-39', 'avatar-40',
      'avatar-41', 'avatar-42', 'avatar-43', 'avatar-44', 'avatar-45', 'avatar-46', 'avatar-47', 'avatar-48'
    )),
  add constraint profiles_avatar_illustration_required_check
    check (avatar_style <> 'illustration' or avatar_illustration is not null);

grant update (avatar_illustration) on public.profiles to authenticated;

-- get_public_profile -----------------------------------------------------------

drop function public.get_public_profile(uuid);

create function public.get_public_profile(p_profile_id uuid)
returns table (
  id uuid, username text, full_name text, city text, "position" text, preferred_foot text,
  xp integer, played integer, won integer, drawn integer, lost integer, goals integer,
  avatar_style text, avatar_kit_colour text, avatar_number smallint, avatar_illustration text
)
language sql
stable
security definer
set search_path = ''
as $$
  select id,
    case when public.name_hidden(id, date_of_birth) then null else username end,
    case when public.name_hidden(id, date_of_birth) then public.minor_first_name(first_name, full_name) else full_name end,
    city, "position", preferred_foot, xp, played, won, drawn, lost, goals,
    avatar_style, avatar_kit_colour, avatar_number, avatar_illustration
  from public.profiles
  where id = p_profile_id;
$$;

alter function public.get_public_profile(uuid) owner to postgres;
revoke all on function public.get_public_profile(uuid) from public, anon;
grant all on function public.get_public_profile(uuid) to authenticated;
grant all on function public.get_public_profile(uuid) to service_role;

-- get_public_profiles ----------------------------------------------------------

drop function public.get_public_profiles(uuid[]);

create function public.get_public_profiles(p_profile_ids uuid[])
returns table (
  id uuid, username text, full_name text, xp integer,
  avatar_style text, avatar_kit_colour text, avatar_number smallint, avatar_illustration text
)
language sql
stable
security definer
set search_path = ''
as $$
  select id,
    case when public.name_hidden(id, date_of_birth) then null else username end,
    case when public.name_hidden(id, date_of_birth) then public.minor_first_name(first_name, full_name) else full_name end,
    xp, avatar_style, avatar_kit_colour, avatar_number, avatar_illustration
  from public.profiles
  where id = any(p_profile_ids);
$$;

alter function public.get_public_profiles(uuid[]) owner to postgres;
revoke all on function public.get_public_profiles(uuid[]) from public, anon;
grant all on function public.get_public_profiles(uuid[]) to authenticated;
grant all on function public.get_public_profiles(uuid[]) to service_role;

-- get_team_roster --------------------------------------------------------------

drop function public.get_team_roster(uuid);

create function public.get_team_roster(p_team_id uuid)
returns table (
  profile_id uuid, username text, full_name text, role text, joined_at timestamp with time zone,
  avatar_style text, avatar_kit_colour text, avatar_number smallint, avatar_illustration text
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id,
    case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end,
    case when public.name_hidden(p.id, p.date_of_birth) then public.minor_first_name(p.first_name, p.full_name) else p.full_name end,
    tm.role, tm.joined_at,
    p.avatar_style, p.avatar_kit_colour, p.avatar_number, p.avatar_illustration
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = p_team_id
  order by tm.joined_at;
$$;

alter function public.get_team_roster(uuid) owner to postgres;
revoke all on function public.get_team_roster(uuid) from public, anon;
grant all on function public.get_team_roster(uuid) to authenticated;
grant all on function public.get_team_roster(uuid) to service_role;

-- list_players -----------------------------------------------------------------

drop function public.list_players();

create function public.list_players()
returns table (
  id uuid, username text, full_name text, phone text,
  avatar_style text, avatar_kit_colour text, avatar_number smallint, avatar_illustration text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
    case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end,
    case when public.name_hidden(p.id, p.date_of_birth) then public.minor_first_name(p.first_name, p.full_name) else p.full_name end,
    case when p.show_phone_publicly then p.phone else null end as phone,
    p.avatar_style, p.avatar_kit_colour, p.avatar_number, p.avatar_illustration
  from public.profiles p
  where p.username is not null
    and p.id <> auth.uid()
    and (public.is_minor(auth.uid()) or not public.is_minor_dob(p.date_of_birth))
  order by p.username
  limit 200;
$$;

alter function public.list_players() owner to postgres;
revoke all on function public.list_players() from public, anon;
grant all on function public.list_players() to authenticated;
grant all on function public.list_players() to service_role;

-- league_captain_contacts ------------------------------------------------------

drop function public.league_captain_contacts(uuid);

create function public.league_captain_contacts(p_league_id uuid)
returns table (
  my_team_id uuid,
  team_id uuid,
  team_name text,
  captain_id uuid,
  captain_name text,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  avatar_illustration text
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
    p.avatar_style, p.avatar_kit_colour, p.avatar_number, p.avatar_illustration
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

revoke all on function public.league_captain_contacts(uuid) from public, anon;
grant execute on function public.league_captain_contacts(uuid) to authenticated, service_role;

-- conversation_other_side (internal), list_my_conversations, conversation_header

drop function public.conversation_header(uuid);
drop function public.list_my_conversations();
drop function public.conversation_other_side(uuid, uuid);

create function public.conversation_other_side(p_conversation_id uuid, p_me uuid)
returns table (
  title text,
  subtitle text,
  other_profile_id uuid,
  other_team_id uuid,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  avatar_illustration text
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
             pr.avatar_style, pr.avatar_kit_colour, pr.avatar_number, pr.avatar_illustration
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
             pr.avatar_style, pr.avatar_kit_colour, pr.avatar_number, pr.avatar_illustration
      from (select 1) one
      left join public.profiles pr on pr.id = v_other and not public.profile_is_deleted(v_other);
  end if;
end;
$$;

revoke all on function public.conversation_other_side(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conversation_other_side(uuid, uuid) to service_role;

create function public.list_my_conversations()
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
  unread integer,
  avatar_illustration text
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
            and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
         o.avatar_illustration
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

revoke all on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated, service_role;

create function public.conversation_header(p_conversation_id uuid)
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
  my_captain_team_id uuid,
  avatar_illustration text
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
           end,
           s.avatar_illustration
    from public.conversation_other_side(p_conversation_id, v_me) s;
end;
$$;

revoke all on function public.conversation_header(uuid) from public, anon;
grant execute on function public.conversation_header(uuid) to authenticated, service_role;
