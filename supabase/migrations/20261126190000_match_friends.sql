-- S20: friends. A player asks another to be friends; only the receiver
-- accepts or declines, the sender can cancel, and either side can unfriend.
-- The age and safety rules (docs/specs/05-product.md section 16) apply on
-- the server:
--   A4  a friend request between an adult and a minor is refused
--   A5  an adult doesn't find a minor (no card, no Add friend); a minor is
--       shown by first name only
--   blocks, either way, refuse a request, hide the player's card and the
--       friendship, and close the friend chat
--   Turning 18 (decided 24 November): friendships made while both were
--       minors stay, and so does their chat.
--
--   friendships  one row per pair: 'pending' (a request) or 'accepted'.
--                Only the two see it (RLS); every write is a function.
--
-- Pushes: the receiver gets "friend_request" (opens Friends), the sender
-- gets "friend_accepted" when it's accepted (opens the chat).
--
-- Re-created (diffs in the PR):
--   are_friends      (latest: 20261125014424_match_messages.sql): the real
--                    check instead of "false", so friend chats switch on.
--   message_refusal  (latest: 20261125014424_match_messages.sql): an
--                    adult-minor pair who are already friends (one turned
--                    18) isn't refused, so their chat stays.

-- ---- Table -----------------------------------------------------------------

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id)
);

-- One row per pair, whoever asked.
create unique index friendships_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee on public.friendships (addressee_id, status);
create index friendships_requester on public.friendships (requester_id, status);

alter table public.friendships enable row level security;

create policy "The two players read their friendship"
  on public.friendships for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

revoke all on public.friendships from anon;
revoke insert, update, delete, truncate on public.friendships from authenticated;

-- On by default (default_enabled, since S14); a player can turn them off.
insert into public.notification_types (type, always_sent, default_enabled) values
  ('friend_request', false, true),
  ('friend_accepted', false, true)
on conflict (type) do nothing;

-- ---- Internal helpers (service_role only) ----------------------------------

-- S20: friends now. Accepted, and neither has blocked the other. No age
-- check: a friendship made by two minors stays when one turns 18.
-- Was (20261125014424_match_messages.sql): select false;
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and least(f.requester_id, f.addressee_id) = least(p_a, p_b)
        and greatest(f.requester_id, f.addressee_id) = greatest(p_a, p_b)
    )
    and not public.blocked_between(p_a, p_b);
$$;

-- As in 20261125014424_match_messages.sql, plus S20: an adult and a minor
-- who are already friends (made while both were minors) aren't refused.
create or replace function public.message_refusal(p_me uuid, p_others uuid[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from unnest(p_others) o where public.blocked_between(p_me, o)) then 'blocked'
    when exists (
      select 1 from unnest(p_others) o
      where not public.age_pair_allowed(p_me, o)
        and not public.are_friends(p_me, o)  -- S20: turning 18 keeps the chat
    ) then 'age_pair_refused'
  end;
$$;

-- A5: whether p_viewer may find p_target at all. An adult doesn't find a
-- minor; a deleted account is nobody.
create or replace function public.player_visible_to(p_viewer uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_target is not null
    and not public.profile_is_deleted(p_target)
    and exists (
      select 1 from public.profiles p
      where p.id = p_target
        and (p.id = p_viewer or public.is_minor(p_viewer) or not public.is_minor_dob(p.date_of_birth))
    );
$$;

-- Why p_me can't ask p_other to be friends, or null.
create or replace function public.friend_refusal(p_me uuid, p_other uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_other is null or p_other = p_me or not public.player_visible_to(p_me, p_other) then 'player_not_found'
    when public.blocked_between(p_me, p_other) then 'blocked'
    when not public.age_pair_allowed(p_me, p_other) then 'age_pair_refused'
  end;
$$;

-- A player's name in a friend push: the first name only for a minor (A5).
create or replace function public.friend_display_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_minor_dob(p.date_of_birth) then public.minor_first_name(p.first_name, p.full_name)
    else coalesce(nullif(trim(p.full_name), ''), p.username, 'A player')
  end
  from public.profiles p where p.id = p_profile_id;
$$;

-- ---- Requests ----------------------------------------------------------------

-- Ask p_profile_id to be friends. Returns the request.
create or replace function public.send_friend_request(p_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_refusal text;
  v_row public.friendships;
  v_id uuid;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  v_refusal := public.friend_refusal(v_me, p_profile_id);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  -- Two requests at once between the same pair: one waits for the other.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'friendship:' || least(v_me, p_profile_id)::text || greatest(v_me, p_profile_id)::text, 0));

  select * into v_row from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(v_me, p_profile_id)
    and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_profile_id);
  if found then
    if v_row.status = 'accepted' then
      raise exception 'already_friends';
    elsif v_row.requester_id = v_me then
      raise exception 'already_requested';
    else
      raise exception 'request_incoming';
    end if;
  end if;

  insert into public.friendships (requester_id, addressee_id) values (v_me, p_profile_id)
  returning id into v_id;

  perform public.send_notification(p_profile_id, 'friend_request', jsonb_build_object(
    'title', 'Friend request',
    'body', public.friend_display_name(v_me) || ' wants to be friends',
    'profileId', v_me,
    'requestId', v_id));
  return v_id;
end;
$$;

-- The receiver accepts. Returns the friend chat (opened now).
create or replace function public.accept_friend_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_row public.friendships;
  v_refusal text;
  v_conv uuid;
begin
  perform public.assert_age_ok();
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_row from public.friendships
  where id = p_request_id and addressee_id = v_me and status = 'pending'
  for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  -- Blocks and A4 again: either may have changed since the request.
  v_refusal := case
    when public.profile_is_deleted(v_row.requester_id) then 'player_not_found'
    when public.blocked_between(v_me, v_row.requester_id) then 'blocked'
    when not public.age_pair_allowed(v_me, v_row.requester_id) then 'age_pair_refused'
  end;
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  update public.friendships set status = 'accepted', accepted_at = now() where id = v_row.id;

  insert into public.conversations (kind, profile_a_id, profile_b_id)
  values ('friends', least(v_me, v_row.requester_id), greatest(v_me, v_row.requester_id))
  on conflict do nothing;
  select c.id into v_conv from public.conversations c
  where c.kind = 'friends'
    and c.profile_a_id = least(v_me, v_row.requester_id)
    and c.profile_b_id = greatest(v_me, v_row.requester_id);

  update public.notifications n set read_at = now()
  where n.profile_id = v_me and n.type = 'friend_request' and n.read_at is null
    and n.data ->> 'requestId' = v_row.id::text;

  perform public.send_notification(v_row.requester_id, 'friend_accepted', jsonb_build_object(
    'title', 'New friend',
    'body', public.friend_display_name(v_me) || ' accepted your request',
    'profileId', v_me,
    'conversationId', v_conv));
  return v_conv;
end;
$$;

-- The receiver declines: the request goes, without a push.
create or replace function public.decline_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  perform public.assert_age_ok();
  delete from public.friendships
  where id = p_request_id and addressee_id = v_me and status = 'pending';
  if not found then
    raise exception 'request_not_found';
  end if;
  update public.notifications n set read_at = now()
  where n.profile_id = v_me and n.type = 'friend_request' and n.read_at is null
    and n.data ->> 'requestId' = p_request_id::text;
end;
$$;

-- The sender cancels: the request and its unread push go.
create or replace function public.cancel_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_to uuid;
begin
  perform public.assert_age_ok();
  delete from public.friendships
  where id = p_request_id and requester_id = v_me and status = 'pending'
  returning addressee_id into v_to;
  if v_to is null then
    raise exception 'request_not_found';
  end if;
  update public.notifications n set read_at = now()
  where n.profile_id = v_to and n.type = 'friend_request' and n.read_at is null
    and n.data ->> 'requestId' = p_request_id::text;
end;
$$;

-- Either friend ends it. The friend chat closes with it.
create or replace function public.unfriend(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  perform public.assert_age_ok();
  delete from public.friendships f
  where f.status = 'accepted'
    and least(f.requester_id, f.addressee_id) = least(v_me, p_profile_id)
    and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_profile_id);
  if not found then
    raise exception 'not_friends';
  end if;
end;
$$;

-- ---- Reading -------------------------------------------------------------------

-- Community -> Friends: requests to the caller first (newest first), then
-- friends by name. Blocked and deleted players are left out.
create or replace function public.my_friends()
returns table (
  ord integer,
  kind text,
  request_id uuid,
  profile_id uuid,
  name text,
  first_name text,
  avatar_style text,
  avatar_kit_colour text,
  avatar_number smallint,
  avatar_illustration text,
  level numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with rows as (
    select case when f.status = 'pending' then 'request' else 'friend' end as kind,
           f.id as request_id,
           case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as other,
           f.created_at
    from public.friendships f
    where (f.status = 'pending' and f.addressee_id = auth.uid())
       or (f.status = 'accepted' and auth.uid() in (f.requester_id, f.addressee_id))
  ),
  shown as (
    select r.kind, r.request_id, r.other, r.created_at,
           public.message_display_name(r.other) as name,
           public.minor_first_name(p.first_name, p.full_name) as first_name,
           p.avatar_style, p.avatar_kit_colour, p.avatar_number, p.avatar_illustration,
           pl.level
    from rows r
    join public.profiles p on p.id = r.other
    left join public.player_levels pl on pl.profile_id = p.id
    where not public.blocked_between(auth.uid(), r.other)
      and not public.profile_is_deleted(r.other)
  )
  select (row_number() over (order by s.kind desc, case when s.kind = 'request' then s.created_at end desc,
                                      lower(s.name), s.other))::integer,
         s.kind, case when s.kind = 'request' then s.request_id end, s.other, s.name, s.first_name,
         s.avatar_style, s.avatar_kit_colour, s.avatar_number, s.avatar_illustration, s.level
  from shown s
  order by 1;
$$;

-- The Friends badge: requests waiting for the caller.
create or replace function public.my_friend_request_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.friendships f
  where f.status = 'pending' and f.addressee_id = auth.uid()
    and not public.blocked_between(auth.uid(), f.requester_id)
    and not public.profile_is_deleted(f.requester_id);
$$;

-- Another player's card (Scan, a futty.app/p/<username> link, a friend
-- row), by username or id: the fields of my_player_card, never a QR, and
-- where the caller stands with them:
--   self, friends, requested (the caller asked), incoming (they asked),
--   unavailable (an adult and a minor: no Add friend, A5), none.
-- player_not_found when there's nobody, either blocked the other, or an
-- adult looks up a minor (A5).
create or replace function public.player_profile_card(p_username text default null, p_profile_id uuid default null)
returns table (
  profile_id uuid,
  username text,
  full_name text,
  first_name text,
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
  show_qr boolean,
  friend_status text,
  request_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_row public.friendships;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_profile_id is not null then
    v_id := p_profile_id;
  else
    select p.id into v_id from public.profiles p where lower(p.username) = lower(trim(coalesce(p_username, '')));
  end if;
  if v_id is null or not public.player_visible_to(v_me, v_id)
     or (v_id <> v_me and public.blocked_between(v_me, v_id)) then
    raise exception 'player_not_found';
  end if;

  select * into v_row from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(v_me, v_id)
    and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_id);
  v_status := case
    when v_id = v_me then 'self'
    when v_row.status = 'accepted' then 'friends'
    when v_row.status = 'pending' and v_row.requester_id = v_me then 'requested'
    when v_row.status = 'pending' then 'incoming'
    when not public.age_pair_allowed(v_me, v_id) then 'unavailable'
    else 'none'
  end;

  return query
  with theirs as (
    select t.id, t.name,
           exists (select 1 from public.league_teams lt where lt.team_id = t.id) as in_league,
           tm.joined_at
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.profile_id = v_id
  ),
  ranked as (
    select m.id, m.name, row_number() over (order by m.in_league desc, m.joined_at, m.name, m.id) as n
    from theirs m
  )
  select p.id,
         case when public.name_hidden(p.id, p.date_of_birth) then null else p.username end,
         case when public.name_hidden(p.id, p.date_of_birth) then public.minor_first_name(p.first_name, p.full_name)
              else p.full_name end,
         public.minor_first_name(p.first_name, p.full_name),
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
         (select count(*)::integer from theirs),
         false,
         v_status,
         case when v_status in ('requested', 'incoming') then v_row.id end
  from public.profiles p
  left join public.player_levels pl on pl.profile_id = p.id
  where p.id = v_id;
end;
$$;

-- ---- Grants -------------------------------------------------------------------

revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.message_refusal(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.player_visible_to(uuid, uuid) from public, anon, authenticated;
revoke all on function public.friend_refusal(uuid, uuid) from public, anon, authenticated;
revoke all on function public.friend_display_name(uuid) from public, anon, authenticated;
grant execute on function public.are_friends(uuid, uuid) to service_role;
grant execute on function public.message_refusal(uuid, uuid[]) to service_role;
grant execute on function public.player_visible_to(uuid, uuid) to service_role;
grant execute on function public.friend_refusal(uuid, uuid) to service_role;
grant execute on function public.friend_display_name(uuid) to service_role;

revoke all on function public.send_friend_request(uuid) from public, anon;
revoke all on function public.accept_friend_request(uuid) from public, anon;
revoke all on function public.decline_friend_request(uuid) from public, anon;
revoke all on function public.cancel_friend_request(uuid) from public, anon;
revoke all on function public.unfriend(uuid) from public, anon;
revoke all on function public.my_friends() from public, anon;
revoke all on function public.my_friend_request_count() from public, anon;
revoke all on function public.player_profile_card(text, uuid) from public, anon;
grant execute on function public.send_friend_request(uuid) to authenticated, service_role;
grant execute on function public.accept_friend_request(uuid) to authenticated, service_role;
grant execute on function public.decline_friend_request(uuid) to authenticated, service_role;
grant execute on function public.cancel_friend_request(uuid) to authenticated, service_role;
grant execute on function public.unfriend(uuid) to authenticated, service_role;
grant execute on function public.my_friends() to authenticated, service_role;
grant execute on function public.my_friend_request_count() to authenticated, service_role;
grant execute on function public.player_profile_card(text, uuid) to authenticated, service_role;
