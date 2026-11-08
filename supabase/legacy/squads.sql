-- Squads: "need players" / "need opposition" posts.
-- Run in the Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- squad_posts and squad_post_joiners already existed in your database before
-- this file (you set them up separately) — this only adds the columns that
-- were missing (posted_by, matched_team_id, players_needed), RLS, and the
-- create/join/offer RPCs.
--
-- Real shape found by probing: squad_posts has id, venue_id, type, team_id,
-- status, created_at, format, level, scheduled_at — a single timestamp, not a
-- link to a specific venue_bookings row. So a post is NOT tied to one of your
-- bookings at the database level; it stands alone as "this venue, this time,
-- this format". The app still only offers creating one from an existing
-- booking (prefilling venue + time from it) — a fully freeform "new post,
-- pick any venue and time" flow is a separate, larger UI (date/time picker)
-- not built here.
--
-- NOT ported from the prototype: individual XP for joining (profiles has no
-- XP column — only teams do, see supabase/legacy/teams.sql), and the post-match
-- friendly-score logging with its 3-try mismatch/dispute mechanic — the same
-- class of two-sided score-submission work already deferred for league
-- fixtures (supabase/legacy/leagues.sql). A "matched" opposition post is as far as
-- this goes.

alter table public.squad_posts add column if not exists posted_by uuid references public.profiles (id);
alter table public.squad_posts add column if not exists matched_team_id uuid references public.teams (id);
-- Recorded when a post is created from an existing booking (the only way
-- the app creates one today), so a matched opposition post can be traced
-- back to the exact venue_bookings row it came from — see the home screen's
-- dedup between a plain booking's own result log and its friendly_matches
-- score, which used to guess this from matching venue+time and broke on any
-- post created before booking-actions.sql's timezone fix.
alter table public.squad_posts add column if not exists venue_booking_id uuid references public.venue_bookings (id);
-- How many MORE players are wanted, not the total headcount — matches how
-- many empty spots are actually being advertised. 'opposition' posts leave
-- this null (their capacity question is just "matched or not").
alter table public.squad_posts add column if not exists players_needed integer;

alter table public.squad_posts enable row level security;
alter table public.squad_post_joiners enable row level security;

-- Browsable like venues/leagues — no direct write policies, every write goes
-- through one of the functions below so the invariants below stay atomic.
drop policy if exists "Authenticated users can read squad posts" on public.squad_posts;
create policy "Authenticated users can read squad posts"
  on public.squad_posts for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read squad joiners" on public.squad_post_joiners;
create policy "Authenticated users can read squad joiners"
  on public.squad_post_joiners for select
  to authenticated
  using (true);

-- Dropped first: adding a parameter changes the function's identity, so
-- CREATE OR REPLACE would leave the old 7-argument version in place as a
-- separate overload instead of replacing it — same reasoning as
-- list_players() in community.sql, just for the argument list instead of
-- the return columns.
drop function if exists public.create_squad_post(uuid, timestamptz, text, text, text, uuid, integer);

create or replace function public.create_squad_post(
  p_venue_id uuid,
  p_scheduled_at timestamptz,
  p_format text,
  p_post_type text,
  p_level text default null,
  p_team_id uuid default null,
  p_players_needed integer default null,
  p_venue_booking_id uuid default null
)
returns public.squad_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_post_type = 'opposition' then
    if p_team_id is null then
      raise exception 'team_required';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
    ) then
      raise exception 'not_captain';
    end if;
  elsif p_post_type = 'players' then
    if p_players_needed is null or p_players_needed < 1 then
      raise exception 'players_needed_required';
    end if;
  else
    raise exception 'invalid_post_type';
  end if;

  insert into public.squad_posts
    (venue_id, scheduled_at, format, type, level, team_id, players_needed, posted_by, status, venue_booking_id)
  values
    (p_venue_id, p_scheduled_at, p_format, p_post_type, p_level, p_team_id, p_players_needed, auth.uid(), 'open', p_venue_booking_id)
  returning * into v_post;

  return v_post;
end;
$$;

grant execute on function public.create_squad_post(uuid, timestamptz, text, text, text, uuid, integer, uuid) to authenticated;

create or replace function public.join_squad_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
  v_joined_count integer;
begin
  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'players' then
    raise exception 'not_a_players_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;

  select count(*) into v_joined_count from public.squad_post_joiners where post_id = p_post_id;
  if v_joined_count >= v_post.players_needed then
    raise exception 'squad_full';
  end if;

  begin
    insert into public.squad_post_joiners (post_id, profile_id) values (p_post_id, auth.uid());
  exception when unique_violation then
    raise exception 'already_joined';
  end;
end;
$$;

grant execute on function public.join_squad_post(uuid) to authenticated;

create or replace function public.offer_opposition(p_post_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;
  if v_post.type <> 'opposition' then
    raise exception 'not_an_opposition_post';
  end if;
  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;
  if v_post.team_id = p_team_id then
    raise exception 'cannot_offer_own_post';
  end if;

  update public.squad_posts
  set status = 'matched', matched_team_id = p_team_id
  where id = p_post_id;
end;
$$;

grant execute on function public.offer_opposition(uuid, uuid) to authenticated;

-- Withdraws your own still-open post (either type). Once a post is matched,
-- offer_opposition (or, after supabase/legacy/scores.sql runs, its friendly_matches
-- row too) is already downstream of it, so cancelling stops there rather
-- than trying to unwind a match — same "cancel is a dead end past a certain
-- point" shape as book_slot/cancel_booking.
create or replace function public.cancel_squad_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.squad_posts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_post from public.squad_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post_not_found';
  end if;

  -- `is distinct from`, not `<>`: posted_by is null on any post created
  -- before that column existed, and `null <> auth.uid()` is null (neither
  -- true nor false), which would silently skip this check instead of
  -- blocking the cancel.
  if v_post.posted_by is distinct from auth.uid() then
    raise exception 'not_your_post';
  end if;

  if v_post.status <> 'open' then
    raise exception 'post_closed';
  end if;

  update public.squad_posts set status = 'cancelled' where id = p_post_id;
end;
$$;

grant execute on function public.cancel_squad_post(uuid) to authenticated;

-- Leaves a "need players" post you joined — no time limit, unlike
-- cancel_opposition_offer (supabase/legacy/scores.sql), since dropping out of a
-- players post doesn't unwind anything else (no friendly_matches row, no
-- other captain to leave stranded without notice).
create or replace function public.leave_squad_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.squad_post_joiners
  where post_id = p_post_id and profile_id = auth.uid();

  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'not_joined';
  end if;
end;
$$;

grant execute on function public.leave_squad_post(uuid) to authenticated;
