-- S10 screens: a captain messages the other captain from their own fixture
-- row on the competition page. The row shows its message button only when
-- that chat would open, so league_captain_contacts now says so.
--
-- Re-created from its latest definition (20261125135506_pay_avatar_illustration.sql).
-- The one change is a new last column, can_message: true when
-- open_captain_conversation would let the caller open this chat, i.e.
-- message_refusal (blocked either way, or an adult-minor pair that aren't
-- friends, A4) finds nothing for any captain of that team. The rows are the
-- same as before, so the existing callers and tests keep working.

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
  avatar_illustration text,
  can_message boolean
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
    p.avatar_style, p.avatar_kit_colour, p.avatar_number, p.avatar_illustration,
    -- The same check open_captain_conversation makes, against every captain
    -- of that team.
    public.message_refusal(
      auth.uid(),
      array(
        select c.profile_id from public.team_members c
        where c.team_id = t.id and c.role = 'captain' and c.profile_id <> auth.uid()
      )
    ) is null
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
