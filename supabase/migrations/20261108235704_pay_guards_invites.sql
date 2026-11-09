-- P2 rule 6: joining a team or a booking is an invite the invited user
-- accepts, never something someone else does to them.
--
-- Before: a captain inserted team_members rows directly (RLS policy
-- "Captains can add team members"), and add_booking_player put a payment
-- share on another user's account straight away.

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('team', 'booking')),
  team_id uuid references public.teams (id) on delete cascade,
  team_role text check (team_role in ('player', 'substitute')),
  booking_id uuid references public.venue_bookings (id) on delete cascade,
  invited_profile_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint invites_shape check (
    (kind = 'team' and team_id is not null and team_role is not null and booking_id is null)
    or (kind = 'booking' and booking_id is not null and team_id is null and team_role is null)
  )
);

-- One open invite per person per team or booking.
create unique index if not exists invites_one_pending_team
  on public.invites (team_id, invited_profile_id) where kind = 'team' and status = 'pending';
create unique index if not exists invites_one_pending_booking
  on public.invites (booking_id, invited_profile_id) where kind = 'booking' and status = 'pending';
create index if not exists invites_invited_profile_idx on public.invites (invited_profile_id);

alter table public.invites enable row level security;

-- Read-only from the app: the invitee and the inviter see an invite; all
-- writes go through the functions below.
create policy "Invitee and inviter read the invite" on public.invites
  for select to authenticated
  using (invited_profile_id = auth.uid() or invited_by = auth.uid());

grant select on public.invites to authenticated;
grant all on public.invites to service_role;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed', 'match_payment_due',
  'team_invite', 'booking_invite'
]));

-- Team members are added only by accepting an invite (or by create_team,
-- for the captain).
drop policy if exists "Captains can add team members" on public.team_members;
revoke insert on public.team_members from anon, authenticated;

-- Main-squad and substitute places, counting members plus pending invites
-- (roster_size includes the captain).
create or replace function public.team_has_room(p_team_id uuid, p_role text, p_ignore_invite uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_role = 'substitute' then t.substitute_slots else t.roster_size end
         > (select count(*) from public.team_members m
            where m.team_id = t.id and (m.role = 'substitute') = (p_role = 'substitute'))
         + (select count(*) from public.invites i
            where i.kind = 'team' and i.team_id = t.id and i.status = 'pending'
              and i.team_role = p_role and i.id is distinct from p_ignore_invite)
  from public.teams t
  where t.id = p_team_id;
$$;

revoke all on function public.team_has_room(uuid, text, uuid) from public, anon, authenticated;

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

-- Same name and arguments as before, so released app builds keep working;
-- it now sends an invite instead of adding a share to the other account.
create or replace function public.add_booking_player(p_booking_id uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_profile_id uuid;
  v_inviter text;
  v_venue_name text;
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.created_by is distinct from auth.uid() then
    raise exception 'not_your_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  perform public.assert_venue_live(v_booking.venue_id);

  select id into v_profile_id from public.profiles where lower(username) = lower(trim(p_username));
  if v_profile_id is null then
    raise exception 'player_not_found';
  end if;
  if v_profile_id = auth.uid()
     or exists (select 1 from public.booking_payment_shares where booking_id = p_booking_id and profile_id = v_profile_id) then
    raise exception 'already_in_booking';
  end if;
  if exists (
    select 1 from public.invites
    where kind = 'booking' and booking_id = p_booking_id and invited_profile_id = v_profile_id and status = 'pending'
  ) then
    raise exception 'already_invited';
  end if;

  select coalesce(username, full_name, 'A player') into v_inviter from public.profiles where id = auth.uid();
  select name into v_venue_name from public.venues where id = v_booking.venue_id;

  insert into public.invites (kind, booking_id, invited_profile_id, invited_by)
  values ('booking', p_booking_id, v_profile_id, auth.uid())
  returning * into v_invite;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    v_profile_id, 'booking_invite', 'Game invite',
    format('%s invited you to play at %s on %s at %s.', v_inviter, v_venue_name,
           to_char(v_booking.booking_day, 'Dy DD Mon'), to_char(v_booking.start_time, 'HH24:MI')),
    jsonb_build_object('inviteId', v_invite.id, 'bookingId', p_booking_id)
  );
end;
$$;

create or replace function public.accept_invite(p_invite_id uuid)
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invites;
  v_booking public.venue_bookings;
  v_now timestamp := now() at time zone 'Asia/Nicosia';
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
    perform 1 from public.teams where id = v_invite.team_id for update;
    if not public.team_has_room(v_invite.team_id, v_invite.team_role, v_invite.id) then
      raise exception 'team_full';
    end if;
    insert into public.team_members (team_id, profile_id, role)
    values (v_invite.team_id, auth.uid(), v_invite.team_role)
    on conflict (team_id, profile_id) do nothing;
  else
    select * into v_booking from public.venue_bookings where id = v_invite.booking_id for update;
    if v_booking.status = 'cancelled' then
      raise exception 'booking_cancelled';
    end if;
    if v_booking.booking_day < v_now::date
       or (v_booking.booking_day = v_now::date and v_booking.start_time <= v_now::time) then
      raise exception 'slot_in_past';
    end if;
    perform public.assert_venue_live(v_booking.venue_id);
    perform public.add_booking_share_internal(v_invite.booking_id, auth.uid());
  end if;

  update public.invites set status = 'accepted', responded_at = now()
  where id = p_invite_id
  returning * into v_invite;
  return v_invite;
end;
$$;

create or replace function public.decline_invite(p_invite_id uuid)
returns public.invites
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

  select * into v_invite from public.invites where id = p_invite_id for update;
  if v_invite.id is null or v_invite.invited_profile_id <> auth.uid() then
    raise exception 'not_your_invite';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending';
  end if;

  update public.invites set status = 'declined', responded_at = now()
  where id = p_invite_id
  returning * into v_invite;
  return v_invite;
end;
$$;

revoke all on function public.invite_team_member(uuid, uuid, text) from public, anon;
revoke all on function public.accept_invite(uuid) from public, anon;
revoke all on function public.decline_invite(uuid) from public, anon;
grant execute on function public.invite_team_member(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.accept_invite(uuid) to authenticated, service_role;
grant execute on function public.decline_invite(uuid) to authenticated, service_role;
