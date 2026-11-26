-- S8 Profile tab (docs/specs/15-design.md, image 19). Three read-only
-- functions for the caller's own Profile. Each uses auth.uid() and takes no
-- profile id, so no one can read another player's numbers through them.
--
--   my_profile_summary()       followers, following, level, this month's level change
--   my_profile_season(format)  this season's tiles (Cyprus calendar year)
--   my_profile_recent(limit)   recent games with the caller's goals, assists, rating
--
-- Followers and following leave out blocked pairs (either way), adult and
-- minor pairs, and deleted accounts: the same check as S7's
-- community_player_visible (blocked_between, age_pair_allowed,
-- profile_is_deleted), so the number matches what Community shows.
-- Counts only, never a list: who follows you stays private.
--
-- Season and recent games read match_stat_players (latest:
-- 20261125213559_match_s14_totw_rules.sql). That view already counts only
-- checked-in players in confirmed matches, combines goals with S13B's
-- match_assists, and shows only ratings that may be shown
-- (match_rating_shown). These are personal stats, so Friendly games count
-- (match-record.md, 25 November: "still counts for personal progress").
-- The season figures match player_season_stats (season_kind 'year'), with a
-- format filter added. TOTW is the number of distinct weeks the caller was
-- picked in any Team of the Week, not the number of teams.

create or replace function public.my_profile_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_month_start timestamptz;
  v_level public.player_levels;
  v_before numeric;
begin
  if v_me is null then
    return null;
  end if;

  select * into v_level from public.player_levels l where l.profile_id = v_me;

  v_month_start := date_trunc('month', now() at time zone 'Asia/Nicosia') at time zone 'Asia/Nicosia';
  select h.level_before into v_before
  from public.player_level_history h
  where h.profile_id = v_me and h.created_at >= v_month_start
  order by h.created_at, h.id
  limit 1;

  return jsonb_build_object(
    'followers', (
      select count(*) from public.user_follows f
      where f.target_type = 'player' and f.target_id = v_me
        and not public.blocked_between(v_me, f.follower_id)
        and public.age_pair_allowed(v_me, f.follower_id)
        and not public.profile_is_deleted(f.follower_id)),
    'following', (
      select count(*) from public.user_follows f
      where f.follower_id = v_me
        and (f.target_type <> 'player'
             or (not public.blocked_between(v_me, f.target_id)
                 and public.age_pair_allowed(v_me, f.target_id)
                 and not public.profile_is_deleted(f.target_id)))),
    'level', v_level.level,
    'provisional', v_level.provisional,
    'levelChangeMonth', case when v_level.level is not null and v_before is not null
                             then round(v_level.level - v_before, 2) end);
end;
$$;

create or replace function public.my_profile_season(p_format text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_year integer := extract(year from now() at time zone 'Asia/Nicosia')::integer;
  v jsonb;
begin
  if v_me is null then
    return null;
  end if;

  with mine as (
    select s.*, m.format
    from public.match_stat_players s
    join public.matches m on m.id = s.match_id
    where s.profile_id = v_me and s.season_year = v_year
  ),
  rows as (
    select * from mine where p_format is null or format = p_format
  )
  select jsonb_build_object(
    'formats', coalesce((select jsonb_agg(f order by f) from (select distinct format as f from mine) x), '[]'),
    'games', (select count(*) from rows),
    'wins', (select count(*) from rows where result = 'W'),
    'goals', (select coalesce(sum(goals), 0) from rows),
    'assists', (select coalesce(sum(assists), 0) from rows),
    'motm', (select count(*) from rows where motm),
    'avgRating', (select round(avg(rating), 2) from rows),
    'totw', (
      select count(distinct t.week_start)
      from public.team_of_the_week_players tp
      join public.team_of_the_week t on t.id = tp.team_of_the_week_id
      where tp.profile_id = v_me
        and extract(year from t.week_start)::integer = v_year
        and (p_format is null or t.format = p_format)))
  into v;
  return v;
end;
$$;

create or replace function public.my_profile_recent(p_limit integer default 3)
returns table (
  match_id uuid,
  kickoff_at timestamptz,
  venue_id uuid,
  venue_name text,
  format text,
  label text,
  opponent_label text,
  team_id uuid,
  opponent_team_id uuid,
  goals_for integer,
  goals_against integer,
  result text,
  goals integer,
  assists integer,
  rating numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.match_id, r.kickoff_at, r.venue_id, r.venue_name, m.format, r.label, r.opponent_label,
         r.team_id, r.opponent_team_id, s.team_goals_for, s.team_goals_against, r.result,
         s.goals, s.assists, s.rating
  from public.player_recent_matches r
  join public.match_stat_players s on s.match_id = r.match_id and s.profile_id = r.profile_id
  join public.matches m on m.id = r.match_id
  where auth.uid() is not null and r.profile_id = auth.uid()
  order by r.kickoff_at desc, r.match_id
  limit greatest(1, least(coalesce(p_limit, 3), 20));
$$;

revoke all on function public.my_profile_summary() from public, anon;
revoke all on function public.my_profile_season(text) from public, anon;
revoke all on function public.my_profile_recent(integer) from public, anon;
grant execute on function public.my_profile_summary() to authenticated, service_role;
grant execute on function public.my_profile_season(text) to authenticated, service_role;
grant execute on function public.my_profile_recent(integer) to authenticated, service_role;
