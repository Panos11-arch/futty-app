-- In-app notification bell: one row per notification, fanned out by triggers
-- on the three source events (a fixture chat message, a squad post update, a
-- booking slot freeing up) rather than the client polling three separate
-- tables itself. Run AFTER supabase/legacy/league-fixtures.sql, supabase/legacy/squads.sql
-- and supabase/legacy/booking-payments.sql. Run in the Supabase dashboard: SQL
-- Editor > New query > Run. Safe to re-run.
--
-- This is the in-app list only (app/notifications.tsx) — it does not send a
-- push notification. Wiring push too would mean also inserting into
-- push_tokens-backed delivery (see supabase/legacy/push-notifications.sql), which
-- this file deliberately leaves alone.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('fixture_message', 'squad_post', 'booking_slot')),
  title text not null,
  body text not null,
  -- Where tapping the row should navigate — the client interprets this per
  -- `type` (see lib/notifications.ts), rather than storing a route string
  -- here that would break if a route were ever renamed.
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_created_idx
  on public.notifications (profile_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Users read their own notifications" on public.notifications;
create policy "Users read their own notifications"
  on public.notifications for select
  to authenticated
  using (profile_id = auth.uid());

-- The only client write allowed is flipping read_at on your own rows — who
-- a notification is FOR is decided entirely by the trigger functions below.
drop policy if exists "Users mark their own notifications read" on public.notifications;
create policy "Users mark their own notifications read"
  on public.notifications for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

revoke insert, delete on public.notifications from authenticated;

-- 1. Fixture chat — notify the OTHER captain when a message is sent.
create or replace function public.notify_fixture_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home uuid;
  v_away uuid;
  v_other_team uuid;
  v_recipient uuid;
  v_sender_name text;
begin
  select home_team_id, away_team_id into v_home, v_away
  from public.league_fixtures where id = new.fixture_id;

  v_other_team := case when new.sender_team_id = v_home then v_away else v_home end;

  select profile_id into v_recipient
  from public.team_members
  where team_id = v_other_team and role = 'captain'
  limit 1;

  if v_recipient is null then
    return new;
  end if;

  select name into v_sender_name from public.teams where id = new.sender_team_id;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    v_recipient,
    'fixture_message',
    coalesce(v_sender_name, 'The other captain') || ' sent a message',
    left(new.message, 120),
    jsonb_build_object('fixtureId', new.fixture_id)
  );

  return new;
end;
$$;

drop trigger if exists on_fixture_message_notify on public.fixture_messages;
create trigger on_fixture_message_notify
  after insert on public.fixture_messages
  for each row execute function public.notify_fixture_message();

-- 2a. Squad posts — notify the poster when someone joins their "need
-- players" post.
create or replace function public.notify_squad_post_joiner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_joiner_name text;
begin
  select * into v_post from public.squad_posts where id = new.post_id;

  if v_post.posted_by is null or v_post.posted_by = new.profile_id then
    return new;
  end if;

  select username into v_joiner_name from public.profiles where id = new.profile_id;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    v_post.posted_by,
    'squad_post',
    'New player joined',
    coalesce(v_joiner_name, 'A player') || ' joined your "need players" post',
    jsonb_build_object('postId', v_post.id, 'postType', v_post.type)
  );

  return new;
end;
$$;

drop trigger if exists on_squad_post_joiner_notify on public.squad_post_joiners;
create trigger on_squad_post_joiner_notify
  after insert on public.squad_post_joiners
  for each row execute function public.notify_squad_post_joiner();

-- 2b. Squad posts — notify the poster and everyone who joined once a post is
-- matched (a "need opposition" post got an offer, or a "need players" post
-- became a confirmed game).
create or replace function public.notify_squad_post_matched()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
begin
  if new.status <> 'matched' or old.status is not distinct from new.status then
    return new;
  end if;

  if new.posted_by is not null then
    insert into public.notifications (profile_id, type, title, body, data)
    values (
      new.posted_by,
      'squad_post',
      'Your post was matched',
      'Your "' || new.type || '" post found a match.',
      jsonb_build_object('postId', new.id, 'postType', new.type)
    );
  end if;

  for v_recipient in
    select profile_id from public.squad_post_joiners where post_id = new.id
  loop
    insert into public.notifications (profile_id, type, title, body, data)
    values (
      v_recipient,
      'squad_post',
      'Game confirmed',
      'A game you joined is now confirmed.',
      jsonb_build_object('postId', new.id, 'postType', new.type)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists on_squad_post_matched_notify on public.squad_posts;
create trigger on_squad_post_matched_notify
  after update on public.squad_posts
  for each row execute function public.notify_squad_post_matched();

-- 3. Booking slots — notify anyone with an open squad post at a venue/day
-- when a booking there is cancelled, since that frees up a pitch they might
-- want (there's no per-user venue-follow list to key this off instead).
create or replace function public.notify_booking_slot_freed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_venue_name text;
begin
  if new.status <> 'cancelled' or old.status is not distinct from new.status then
    return new;
  end if;

  select name into v_venue_name from public.venues where id = new.venue_id;

  for v_recipient in
    select distinct posted_by from public.squad_posts
    where venue_id = new.venue_id
      and status = 'open'
      and posted_by is not null
      and scheduled_at::date = new.booking_day
  loop
    insert into public.notifications (profile_id, type, title, body, data)
    values (
      v_recipient,
      'booking_slot',
      'A slot just opened up',
      coalesce(v_venue_name, 'A venue') || ' has a free slot on ' || new.booking_day::text,
      jsonb_build_object('venueId', new.venue_id, 'day', new.booking_day)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists on_booking_slot_freed_notify on public.venue_bookings;
create trigger on_booking_slot_freed_notify
  after update on public.venue_bookings
  for each row execute function public.notify_booking_slot_freed();
