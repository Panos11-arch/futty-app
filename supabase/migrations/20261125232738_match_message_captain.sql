-- Message the other captain from a match (follow-up to S13 and S13B,
-- decided by Dimitris 24-25 November). When the two captains log different
-- scores, the mismatch screen offers "Message <captain>". Until now a captain
-- chat could only be opened between two teams of the same league
-- (open_captain_conversation). Now the current captains of the two teams of a
-- match can open theirs too, even when the teams share no league.
--
-- Nothing existing is re-created. The chat is the same captains
-- conversation, one per pair of teams, so writing already works: send_message
-- lets in the CURRENT captains of both teams (conversation_participants) and
-- keeps every rule (blocks both ways, adult-minor refused (A4), the rate
-- limit). A former captain is refused, as before.
--
-- New:
--   match_captain_contact(match)            the other team and its current
--                                           captain, for the mismatch button
--   open_match_captain_conversation(match)  the chat, created the first time
--
-- The match's teams are match_sides.team_id. A pickup (no teams), a game
-- where one side has no team, or a caller who isn't the current captain of
-- either team gets no button and not_captain.

-- The caller's team and the other team of a match, when the caller is the
-- current captain of one of its two teams. No row otherwise.
create or replace function public.match_captain_teams(p_match_id uuid, p_me uuid)
returns table (my_team_id uuid, other_team_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select mine.team_id, other.team_id
  from public.match_sides mine
  join public.match_sides other on other.match_id = mine.match_id and other.side <> mine.side
  where mine.match_id = p_match_id
    and mine.team_id is not null
    and other.team_id is not null
    and mine.team_id <> other.team_id
    and exists (
      select 1 from public.team_members tm
      where tm.team_id = mine.team_id and tm.profile_id = p_me and tm.role = 'captain'
    )
  order by mine.side
  limit 1;
$$;

-- "Message <captain>": the other team of the match and its current captain,
-- named as the caller sees them (a minor's first name only, A5). No row: no
-- button.
create or replace function public.match_captain_contact(p_match_id uuid)
returns table (
  my_team_id uuid,
  team_id uuid,
  team_name text,
  captain_id uuid,
  captain_name text,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select mt.my_team_id, t.id, t.name, tm.profile_id, public.message_display_name(tm.profile_id),
         p.avatar_style, p.avatar_kit_colour, p.avatar_number
  from public.match_captain_teams(p_match_id, auth.uid()) mt
  join public.teams t on t.id = mt.other_team_id
  join public.team_members tm on tm.team_id = t.id and tm.role = 'captain'
  join public.profiles p on p.id = tm.profile_id
  where auth.uid() is not null
    and tm.profile_id <> auth.uid()
    and not public.profile_is_deleted(tm.profile_id)
  order by tm.joined_at, tm.profile_id
  limit 1;
$$;

-- The captain chat between the two teams of a match, created the first
-- time. The same checks as open_captain_conversation, with the match in
-- place of the league.
create or replace function public.open_match_captain_conversation(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_mine uuid;
  v_other uuid;
  v_others uuid[];
  v_refusal text;
  v_id uuid;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  select my_team_id, other_team_id into v_mine, v_other
  from public.match_captain_teams(p_match_id, v_me);
  if v_mine is null then
    raise exception 'not_captain';
  end if;

  select array_agg(tm.profile_id) into v_others
  from public.team_members tm
  where tm.team_id = v_other and tm.role = 'captain' and tm.profile_id <> v_me;
  if v_others is null then
    raise exception 'no_captain';
  end if;
  v_refusal := public.message_refusal(v_me, v_others);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  insert into public.conversations (kind, team_a_id, team_b_id)
  values ('captains', least(v_mine, v_other), greatest(v_mine, v_other))
  on conflict do nothing;

  select id into v_id from public.conversations
  where kind = 'captains'
    and team_a_id = least(v_mine, v_other)
    and team_b_id = greatest(v_mine, v_other);
  return v_id;
end;
$$;

-- ---- Grants ------------------------------------------------------------------

-- Internal: service_role only.
revoke all on function public.match_captain_teams(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_captain_teams(uuid, uuid) to service_role;

-- Signed in.
revoke all on function public.match_captain_contact(uuid) from public, anon;
grant execute on function public.match_captain_contact(uuid) to authenticated, service_role;
revoke all on function public.open_match_captain_conversation(uuid) from public, anon;
grant execute on function public.open_match_captain_conversation(uuid) to authenticated, service_role;
