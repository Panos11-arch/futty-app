-- S20: Book together and Team vs team, from a friend chat (S13). The app
-- carries the friend (inviteProfileId) or the friend's team
-- (oppositionTeamId) through Book a pitch and checkout to the after-pay
-- screen, and preselects them in the existing Booking v2 Invite friends
-- and opposition invite. The ids are only a hint: these functions return a
-- friend or team only when it's allowed, and nothing here changes a price,
-- a hold, Losers pay or who pays what (docs/specs/13-payments-bookings.md).
--
--   booking_preselect         the friend and/or team to preselect, or null
--                             for each that isn't allowed:
--                               friend  friends (are_friends), not blocked,
--                                       not an adult and a minor (A4), has
--                                       a username (Invite friends needs it)
--                               team    one of its captains is such a
--                                       friend, and the caller is a captain
--                                       too (S13: "when both are captains")
--   invite_friend_to_booking  Invite friends for a preselected friend: the
--                             same friend checks, then the existing
--                             add_booking_player with their username, so
--                             every booking check still runs.
--
-- Nothing is re-created: add_booking_player and invite_opposition are
-- unchanged.

-- p_me may book with p_friend (internal).
create or replace function public.friend_allowed(p_me uuid, p_friend uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_me is not null and p_friend is not null and p_me <> p_friend
    and public.are_friends(p_me, p_friend)
    and not public.blocked_between(p_me, p_friend)
    and public.age_pair_allowed(p_me, p_friend)
    and not public.profile_is_deleted(p_friend);
$$;

create or replace function public.booking_preselect(p_profile_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_friend jsonb;
  v_team jsonb;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select jsonb_build_object('profile_id', p.id, 'name', public.message_display_name(p.id))
  into v_friend
  from public.profiles p
  where p.id = p_profile_id
    and p.username is not null
    and public.friend_allowed(v_me, p.id);

  select jsonb_build_object('id', t.id, 'name', t.name, 'city', t.city)
  into v_team
  from public.teams t
  where t.id = p_team_id
    and exists (
      select 1 from public.team_members tm
      where tm.team_id = t.id and tm.role = 'captain' and public.friend_allowed(v_me, tm.profile_id)
    )
    and not exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.profile_id = v_me)
    and exists (select 1 from public.team_members tm where tm.profile_id = v_me and tm.role = 'captain');

  return jsonb_build_object('friend', v_friend, 'team', v_team);
end;
$$;

create or replace function public.invite_friend_to_booking(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_username text;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_profile_id is null or p_profile_id = v_me or not public.are_friends(v_me, p_profile_id) then
    -- are_friends is false while either blocks the other: say which.
    if p_profile_id is not null and p_profile_id <> v_me and public.blocked_between(v_me, p_profile_id) then
      raise exception 'blocked';
    end if;
    raise exception 'not_friends';
  end if;
  if not public.age_pair_allowed(v_me, p_profile_id) then
    raise exception 'age_pair_refused';
  end if;
  select p.username into v_username from public.profiles p where p.id = p_profile_id;
  if v_username is null or public.profile_is_deleted(p_profile_id) then
    raise exception 'player_not_found';
  end if;
  perform public.add_booking_player(p_booking_id, v_username);
end;
$$;

revoke all on function public.friend_allowed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.friend_allowed(uuid, uuid) to service_role;

revoke all on function public.booking_preselect(uuid, uuid) from public, anon;
revoke all on function public.invite_friend_to_booking(uuid, uuid) from public, anon;
grant execute on function public.booking_preselect(uuid, uuid) to authenticated, service_role;
grant execute on function public.invite_friend_to_booking(uuid, uuid) to authenticated, service_role;
