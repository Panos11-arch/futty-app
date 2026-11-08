-- Position/level filters for "Need players" squad posts (item 5).
-- Run AFTER supabase/legacy/squads.sql. Run in the Supabase dashboard: SQL Editor >
-- New query > Run. Safe to re-run.
--
-- position_needed and level_needed are new, both optional, both only set on
-- 'players' posts (the app never sets them for 'opposition' posts, though
-- nothing here enforces that at the DB level). level_needed is deliberately
-- separate from the existing free-text `level` column (the poster's own
-- "Skill level (optional)" description, Beginner..Elite) — it uses the
-- Bronze/Silver/Gold/Platinum XP-tier vocabulary instead, matching
-- profiles.xp / teams.xp elsewhere in the app.

alter table public.squad_posts add column if not exists position_needed text;
alter table public.squad_posts drop constraint if exists squad_posts_position_needed_check;
alter table public.squad_posts add constraint squad_posts_position_needed_check
  check (position_needed is null or position_needed in ('Goalkeeper', 'Defender', 'Midfielder', 'Striker'));

alter table public.squad_posts add column if not exists level_needed text;
alter table public.squad_posts drop constraint if exists squad_posts_level_needed_check;
alter table public.squad_posts add constraint squad_posts_level_needed_check
  check (level_needed is null or level_needed in ('Bronze', 'Silver', 'Gold', 'Platinum'));

-- Dropped first: adding parameters changes the function's identity — same
-- reasoning as the drop in supabase/legacy/squads.sql.
drop function if exists public.create_squad_post(uuid, timestamptz, text, text, text, uuid, integer, uuid);

create or replace function public.create_squad_post(
  p_venue_id uuid,
  p_scheduled_at timestamptz,
  p_format text,
  p_post_type text,
  p_level text default null,
  p_team_id uuid default null,
  p_players_needed integer default null,
  p_venue_booking_id uuid default null,
  p_position_needed text default null,
  p_level_needed text default null
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
    (venue_id, scheduled_at, format, type, level, team_id, players_needed, posted_by, status, venue_booking_id, position_needed, level_needed)
  values
    (p_venue_id, p_scheduled_at, p_format, p_post_type, p_level, p_team_id, p_players_needed, auth.uid(), 'open', p_venue_booking_id, p_position_needed, p_level_needed)
  returning * into v_post;

  return v_post;
end;
$$;

grant execute on function public.create_squad_post(uuid, timestamptz, text, text, text, uuid, integer, uuid, text, text) to authenticated;
