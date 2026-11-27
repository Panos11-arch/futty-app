-- S20A (a): your own teams (decided by Panos, 22 November; docs/specs/14,
-- redesign step S20A). Teams already exist (team_members with roles, team
-- invites); this builds on them.
--
--   teams.kit_colour     the team's kit, one of the eight kit tokens players
--                        use for their avatar (constants/futty-theme.ts)
--   teams.deleted_at     "Delete team": the team is hidden and keeps its
--                        history (decided by Anghelo, 27 November)
--   create_my_team       any player, any number of teams; members chosen from
--                        their friends (friends, not blocked, A4), each sent
--                        an invite (push + in-app); only accepted members count
--   invite_team_member   re-created: adds the blocked and A4 checks only. Adding
--                        by username stays open to non-friends (team page and
--                        league sign-up)
--   accept_invite        re-created: the team branch refuses a blocked or A4
--                        pair (invitee and the inviting captain) and a deleted
--                        team. The booking branch is unchanged
--   cancel_team_invite, remove_team_member, pass_captaincy, leave_team,
--   delete_team          captain and member tools
--   team_pending_invites the team's open invites, for its captain
--   team_competitions    the leagues a team plays in, for its public page
--
-- Tournaments (S10A, #237) aren't merged yet, so delete_team doesn't check
-- them; S20A's follow-up adds tournament_teams to team_in_competition.

-- ---- Columns ---------------------------------------------------------------------

alter table public.teams
  add column kit_colour text
    constraint teams_kit_colour_check
    check (kit_colour in ('kitRed', 'kitBlue', 'kitSky', 'kitGreen', 'kitYellow', 'kitOrange', 'kitBlack', 'kitWhite')),
  add column deleted_at timestamptz;

comment on column public.teams.kit_colour is 'S20A: the team''s kit token (null for teams made before S20A).';
comment on column public.teams.deleted_at is 'S20A: set by delete_team. The team is hidden; its games and history stay.';

-- A captain can cancel an invite they sent.
alter table public.invites drop constraint invites_status_check;
alter table public.invites add constraint invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

insert into public.notification_types (type, always_sent) values
  ('team_member_removed', false),
  ('team_captain', false)
on conflict (type) do nothing;

-- ---- Helpers (internal) ------------------------------------------------------------

-- Why p_me can't put p_other in a team, or null.
create function public.team_member_refusal(p_me uuid, p_other uuid, p_friends_only boolean)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_other is null or p_other = p_me or public.profile_is_deleted(p_other) then 'player_not_found'
    when public.blocked_between(p_me, p_other) then 'blocked'
    when not public.age_pair_allowed(p_me, p_other) then 'age_pair_refused'
    when p_friends_only and not public.are_friends(p_me, p_other) then 'not_friends'
  end;
$$;

-- The team is in a league, season or division that isn't finished
-- (sign-up counts; decided by Anghelo, 27 November), or waiting in one's pool.
create function public.team_in_competition(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.league_teams lt join public.leagues l on l.id = lt.league_id
      where lt.team_id = p_team_id and coalesce(l.stage, 'signup') <> 'finished')
    or exists (
      select 1 from public.level_pool lp join public.leagues l on l.id = lp.league_id
      where lp.team_id = p_team_id and coalesce(l.stage, 'signup') <> 'finished');
$$;

-- The team has a booking that isn't cancelled and hasn't kicked off.
create function public.team_has_upcoming_booking(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venue_bookings b
    where b.status <> 'cancelled'
      and public.booking_kickoff_at(b.booking_day, b.start_time) > now()
      and (b.team_id = p_team_id
           or exists (select 1 from public.booking_sides s
                      where s.booking_id = b.id and s.team_id = p_team_id and s.left_at is null)));
$$;

-- ---- create_my_team ---------------------------------------------------------------------

create function public.create_my_team(
  p_name text,
  p_city text,
  p_kit_colour text,
  p_roster_size integer,
  p_substitute_slots integer,
  p_member_ids uuid[]
)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_team public.teams;
  v_members uuid[];
  v_member uuid;
  v_refusal text;
  v_invite public.invites;
  v_captain text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'name_required';
  end if;
  if p_kit_colour is null
     or p_kit_colour not in ('kitRed', 'kitBlue', 'kitSky', 'kitGreen', 'kitYellow', 'kitOrange', 'kitBlack', 'kitWhite') then
    raise exception 'invalid_kit_colour';
  end if;
  if p_roster_size is null or p_roster_size < 1 then
    raise exception 'roster_too_small';
  end if;
  if p_substitute_slots is null or p_substitute_slots < 0 then
    raise exception 'invalid_substitute_slots';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_members
  from unnest(coalesce(p_member_ids, '{}')) m
  where m is distinct from v_me;

  foreach v_member in array v_members loop
    v_refusal := public.team_member_refusal(v_me, v_member, true);
    if v_refusal is not null then
      raise exception '%', v_refusal;
    end if;
  end loop;
  -- roster_size counts the captain.
  if 1 + cardinality(v_members) > p_roster_size then
    raise exception 'team_full';
  end if;

  insert into public.teams
    (name, city, kit_colour, created_by, xp, played, won, drawn, lost, goals, roster_size, substitute_slots)
  values
    (trim(p_name), nullif(trim(p_city), ''), p_kit_colour, v_me, 0, 0, 0, 0, 0, 0, p_roster_size, p_substitute_slots)
  returning * into v_team;

  insert into public.team_members (team_id, profile_id, role) values (v_team.id, v_me, 'captain');

  v_captain := public.friend_display_name(v_me);
  foreach v_member in array v_members loop
    insert into public.invites (kind, team_id, team_role, invited_profile_id, invited_by)
    values ('team', v_team.id, 'player', v_member, v_me)
    returning * into v_invite;
    perform public.send_notification(v_member, 'team_invite', jsonb_build_object(
      'title', 'Team invite',
      'body', format('%s invited you to join %s.', v_captain, v_team.name),
      'inviteId', v_invite.id,
      'teamId', v_team.id));
  end loop;

  return v_team;
end;
$$;

-- ---- invite_team_member --------------------------------------------------------------------
-- As in 20261108235704_pay_guards_invites.sql, plus the blocked and A4 checks
-- after player_not_found. No friends check: adding by username stays open.
create or replace function public.invite_team_member(p_team_id uuid, p_profile_id uuid, p_role text default 'player')
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_inviter text;
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;
  if p_role is null or p_role not in ('player', 'substitute') then
    raise exception 'invalid_role';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'player_not_found';
  end if;
  -- S20A: blocks and A4.
  if public.blocked_between(auth.uid(), p_profile_id) then
    raise exception 'blocked';
  end if;
  if not public.age_pair_allowed(auth.uid(), p_profile_id) then
    raise exception 'age_pair_refused';
  end if;
  if exists (select 1 from public.team_members where team_id = p_team_id and profile_id = p_profile_id) then
    raise exception 'already_on_team';
  end if;
  if exists (
    select 1 from public.invites
    where kind = 'team' and team_id = p_team_id and invited_profile_id = p_profile_id and status = 'pending'
  ) then
    raise exception 'already_invited';
  end if;
  if not public.team_has_room(p_team_id, p_role) then
    raise exception 'team_full';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  select coalesce(username, full_name, 'A captain') into v_inviter from public.profiles where id = auth.uid();

  insert into public.invites (kind, team_id, team_role, invited_profile_id, invited_by)
  values ('team', p_team_id, p_role, p_profile_id, auth.uid())
  returning * into v_invite;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    p_profile_id, 'team_invite', 'Team invite',
    format('%s invited you to join %s%s.', v_inviter, v_team.name,
           case when p_role = 'substitute' then ' as a substitute' else '' end),
    jsonb_build_object('inviteId', v_invite.id, 'teamId', p_team_id)
  );

  return v_invite;
end;
$$;

-- ---- accept_invite --------------------------------------------------------------------------
-- As in 20261123190000_pay_b1c_pay_whole.sql; S20A adds three checks to the
-- team branch only. The booking branch is unchanged.
CREATE OR REPLACE FUNCTION public.accept_invite(p_invite_id uuid)
 RETURNS public.invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invite public.invites;
  v_booking public.venue_bookings;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_team public.teams;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_invite from public.invites where id = p_invite_id for update;
  if v_invite.id is null or v_invite.invited_profile_id <> auth.uid() then
    raise exception 'not_your_invite';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending';
  end if;

  if v_invite.kind = 'team' then
    -- Lock the team so two acceptances can't both take its last place.
    select * into v_team from public.teams where id = v_invite.team_id for update;
    -- S20A: a deleted team, a block or an adult-minor pair (A4).
    if v_team.deleted_at is not null then
      raise exception 'team_deleted';
    end if;
    if public.blocked_between(auth.uid(), v_invite.invited_by) then
      raise exception 'blocked';
    end if;
    if not public.age_pair_allowed(auth.uid(), v_invite.invited_by) then
      raise exception 'age_pair_refused';
    end if;
    if not public.team_has_room(v_invite.team_id, v_invite.team_role, v_invite.id) then
      raise exception 'team_full';
    end if;
    insert into public.team_members (team_id, profile_id, role)
    values (v_invite.team_id, auth.uid(), v_invite.team_role)
    on conflict (team_id, profile_id) do nothing;
  else
    select * into v_booking from public.venue_bookings where id = v_invite.booking_id for update;
    -- A walk-in or phone booking is never an app booking.
    if v_booking.booking_type = 'counter' then
      raise exception 'counter_booking';
    end if;
    if v_booking.status = 'cancelled' then
      raise exception 'booking_cancelled';
    end if;
    if v_booking.booking_day < v_now::date
       or (v_booking.booking_day = v_now::date and v_booking.start_time <= v_now::time) then
      raise exception 'slot_in_past';
    end if;
    perform public.assert_venue_live(v_booking.venue_id);
    -- B1c: on a half pitch a player joins the side of the captain who
    -- invited him (a captain of both sides fills side A first).
    if v_booking.booking_kind = 'half' then
      perform public.add_booking_side_share_internal(v_invite.booking_id, auth.uid(),
        public.invite_side(v_invite.booking_id, v_invite.invited_by));
    else
      perform public.add_booking_share_internal(v_invite.booking_id, auth.uid());
    end if;
  end if;

  update public.invites set status = 'accepted', responded_at = now()
  where id = p_invite_id
  returning * into v_invite;
  return v_invite;
end;
$function$;

-- ---- Captain and member tools --------------------------------------------------------------

-- The caller's role in the team (locked), or null.
create function public.my_team_role_locked(p_team_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform 1 from public.teams where id = p_team_id for update;
  select role into v_role from public.team_members where team_id = p_team_id and profile_id = auth.uid();
  return v_role;
end;
$$;

create function public.cancel_team_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_invite from public.invites where id = p_invite_id and kind = 'team' for update;
  if v_invite.id is null or public.my_team_role_locked(v_invite.team_id) is distinct from 'captain' then
    raise exception 'not_captain';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending';
  end if;
  update public.invites set status = 'cancelled', responded_at = now() where id = p_invite_id;
end;
$$;

create function public.remove_team_member(p_team_id uuid, p_profile_id uuid)
returns void
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
  if public.my_team_role_locked(p_team_id) is distinct from 'captain' then
    raise exception 'not_captain';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'use_leave';
  end if;
  delete from public.team_members where team_id = p_team_id and profile_id = p_profile_id;
  if not found then
    raise exception 'not_member';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  perform public.send_notification(p_profile_id, 'team_member_removed', jsonb_build_object(
    'title', 'Removed from team',
    'body', format('You''re no longer in %s.', v_team.name)));
end;
$$;

-- The old captain takes the new captain's place in the squad (player or
-- substitute), so the squad sizes don't change.
create function public.pass_captaincy(p_team_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_team public.teams;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if public.my_team_role_locked(p_team_id) is distinct from 'captain' then
    raise exception 'not_captain';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'already_captain';
  end if;
  select role into v_role from public.team_members where team_id = p_team_id and profile_id = p_profile_id for update;
  if v_role is null then
    raise exception 'not_member';
  end if;

  update public.team_members set role = v_role where team_id = p_team_id and profile_id = auth.uid();
  update public.team_members set role = 'captain' where team_id = p_team_id and profile_id = p_profile_id;

  select * into v_team from public.teams where id = p_team_id;
  perform public.send_notification(p_profile_id, 'team_captain', jsonb_build_object(
    'title', 'You''re captain',
    'body', format('You''re now captain of %s.', v_team.name),
    'teamId', p_team_id));
end;
$$;

create function public.leave_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  v_role := public.my_team_role_locked(p_team_id);
  if v_role is null then
    raise exception 'not_member';
  end if;
  if v_role = 'captain' then
    if exists (select 1 from public.team_members where team_id = p_team_id and profile_id <> auth.uid()) then
      raise exception 'captain_must_pass';
    end if;
    raise exception 'use_delete';
  end if;
  delete from public.team_members where team_id = p_team_id and profile_id = auth.uid();
end;
$$;

-- "Delete team" (the last member only): hides the team and keeps its
-- history (decided by Anghelo, 27 November). Its games, power ranking
-- history (its own and its opponents'), payments and Team Premium stay;
-- with no members nobody captains it, so it can't be booked, registered or
-- invited to again.
create function public.delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if public.my_team_role_locked(p_team_id) is distinct from 'captain' then
    raise exception 'not_captain';
  end if;
  if exists (select 1 from public.team_members where team_id = p_team_id and profile_id <> auth.uid()) then
    raise exception 'not_last_member';
  end if;
  if public.team_in_competition(p_team_id) then
    raise exception 'team_in_competition';
  end if;
  if public.team_has_upcoming_booking(p_team_id) then
    raise exception 'team_has_booking';
  end if;

  update public.teams set deleted_at = now() where id = p_team_id;
  delete from public.team_members where team_id = p_team_id;
  update public.invites set status = 'cancelled', responded_at = now()
  where kind = 'team' and team_id = p_team_id and status = 'pending';
end;
$$;

-- The team's open invites, for its captain (the invites table shows an
-- invite only to whoever sent it, and the captaincy can change hands).
create function public.team_pending_invites(p_team_id uuid)
returns table (invite_id uuid, profile_id uuid, name text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.team_members tm
                 where tm.team_id = p_team_id and tm.profile_id = auth.uid() and tm.role = 'captain') then
    raise exception 'not_captain';
  end if;
  return query
    select i.id, i.invited_profile_id, public.message_display_name(i.invited_profile_id), i.team_role
    from public.invites i
    where i.kind = 'team' and i.team_id = p_team_id and i.status = 'pending'
    order by i.created_at;
end;
$$;

-- ---- team_competitions -----------------------------------------------------------------------

-- The leagues the team is in, by their top-level league (the competition
-- page's id), running ones first.
create function public.team_competitions(p_team_id uuid)
returns table (league_id uuid, name text, format text, running boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with rows as (
    select coalesce(g.id, p.id, l.id) as hub_id,
           coalesce(l.stage, 'signup') <> 'finished' as running
    from public.league_teams lt
    join public.leagues l on l.id = lt.league_id
    left join public.leagues p on p.id = l.parent_league_id
    left join public.leagues g on g.id = p.parent_league_id
    where lt.team_id = p_team_id
  )
  select h.id, coalesce(h.name, h.format), h.format, bool_or(r.running)
  from rows r
  join public.leagues h on h.id = r.hub_id
  group by h.id, h.name, h.format
  order by bool_or(r.running) desc, coalesce(h.name, h.format);
$$;

-- ---- Grants ----------------------------------------------------------------------------------

revoke all on function public.team_member_refusal(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.team_in_competition(uuid) from public, anon, authenticated;
revoke all on function public.team_has_upcoming_booking(uuid) from public, anon, authenticated;
revoke all on function public.my_team_role_locked(uuid) from public, anon, authenticated;
grant execute on function public.team_member_refusal(uuid, uuid, boolean) to service_role;
grant execute on function public.team_in_competition(uuid) to service_role;
grant execute on function public.team_has_upcoming_booking(uuid) to service_role;
grant execute on function public.my_team_role_locked(uuid) to service_role;

revoke all on function public.create_my_team(text, text, text, integer, integer, uuid[]) from public, anon;
revoke all on function public.cancel_team_invite(uuid) from public, anon;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
revoke all on function public.pass_captaincy(uuid, uuid) from public, anon;
revoke all on function public.leave_team(uuid) from public, anon;
revoke all on function public.delete_team(uuid) from public, anon;
revoke all on function public.team_competitions(uuid) from public, anon;
revoke all on function public.team_pending_invites(uuid) from public, anon;
grant execute on function public.team_pending_invites(uuid) to authenticated, service_role;
grant execute on function public.create_my_team(text, text, text, integer, integer, uuid[]) to authenticated, service_role;
grant execute on function public.cancel_team_invite(uuid) to authenticated, service_role;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.pass_captaincy(uuid, uuid) to authenticated, service_role;
grant execute on function public.leave_team(uuid) to authenticated, service_role;
grant execute on function public.delete_team(uuid) to authenticated, service_role;
grant execute on function public.team_competitions(uuid) to authenticated, service_role;
