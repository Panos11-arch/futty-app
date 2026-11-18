-- A7a: season stats for players and named teams, team recent matches and
-- leaderboards (docs/specs/match-record.md section 7, decision 1g).
--
-- Built on the A3b form views (20261112000755_match_form_views.sql), so the
-- same rules hold: confirmed matches only; a player counts only if they
-- checked in (1b.2), or held a spot in a confirmed forfeit (1b.3); a named
-- team counts every confirmed match it played (1b.3); guests never count.
-- A forfeit is a 3-0 win for the other side (decision 1g.3): the score
-- counts in goals for and against and clean sheets, but no player is
-- credited with a goal.
--
-- Like the A3b views these run as their owner (not security_invoker) and
-- expose aggregates only: never an individual rating or vote. A match
-- rating (decision 1f.4) counts once the ratings window has closed
-- (confirmed_at + 24 hours) and the player has 3 or more ratings; a man of
-- the match once voting has closed (decision 1e.3, ties shared).
--
-- Seasons (decision 1g.2): 'year' is the calendar year in Cyprus time and
-- holds every confirmed match that year, league games included; 'league'
-- holds one league's matches (a league is its own season); 'all' is every
-- match ever.

-- Decision 1g.1: the fewest appearances a player needs to be on a
-- leaderboard. There is no minimum (18 November): one game is enough.
create or replace function public.stats_min_appearances()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 1;
$$;

-- Decision 1g.3: a side's goals in a match, a forfeit counting 3-0.
create or replace function public.stats_side_goals(p_goals integer, p_forfeit_side text, p_side text, p_for boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
           when p_forfeit_side is null then p_goals
           when (p_forfeit_side = p_side) = p_for then 0
           else 3
         end;
$$;

-- A player's match rating once it is shown on the match page (decision
-- 1f.4): the match is confirmed and not a forfeit, the ratings window has
-- closed, and there are 3 or more ratings; otherwise null. The views below
-- call it as the reader, so it is granted to authenticated; it shows no more
-- than get_match_ratings does to everyone signed in.
create or replace function public.match_rating_shown(p_match_id uuid, p_player_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select (public.match_rating_for(m.id, p_player_id) ->> 'rating')::numeric
  from public.matches m
  where m.id = p_match_id and m.status = 'confirmed' and m.forfeit_side is null
    and now() >= m.confirmed_at + interval '24 hours';
$$;

-- Internal: one row per player per confirmed match they count in, with
-- their goals, assists, man of the match and match rating.
create view public.match_stat_players as
select
  p.profile_id,
  p.match_id,
  mp.id as player_id,
  p.kickoff_at,
  extract(year from p.kickoff_at at time zone 'Asia/Nicosia')::integer as season_year,
  lf.league_id,
  p.venue_id,
  nullif(lower(btrim(v.city)), '') as city_key,
  p.side,
  p.team_id,
  p.result,
  p.forfeit_side is not null as is_forfeit,
  public.stats_side_goals(p.goals_for, p.forfeit_side, p.side, true) as team_goals_for,
  public.stats_side_goals(p.goals_against, p.forfeit_side, p.side, false) as team_goals_against,
  case
    when mp.position = 'gk' then 'gk'
    when mp.position like 'd%' then 'def'
    when mp.position like 'm%' then 'mid'
    when mp.position like 'f%' then 'fwd'
    else 'outfield'
  end as position_group,
  (select count(*) from public.match_goals g where g.match_id = p.match_id and g.scorer_player_id = mp.id)::integer as goals,
  (select count(*) from public.match_goals g where g.match_id = p.match_id and g.assist_player_id = mp.id)::integer as assists,
  (m.forfeit_side is null and now() >= m.confirmed_at + interval '24 hours'
   and exists (
     with tally as (
       select x.nominee_player_id, count(*) as votes
       from public.motm_votes x where x.match_id = p.match_id
       group by x.nominee_player_id
     )
     select 1 from tally t
     where t.nominee_player_id = mp.id and t.votes = (select max(votes) from tally))) as motm,
  public.match_rating_shown(p.match_id, mp.id) as rating
from public.match_form_players p
join public.matches m on m.id = p.match_id
join public.match_players mp on mp.match_id = p.match_id and mp.profile_id = p.profile_id
left join public.venues v on v.id = p.venue_id
left join public.league_fixtures lf on lf.id = m.league_fixture_id;

-- Internal: one row per named team per confirmed match.
create view public.match_stat_teams as
select
  s.team_id,
  s.match_id,
  s.side,
  s.kickoff_at,
  extract(year from s.kickoff_at at time zone 'Asia/Nicosia')::integer as season_year,
  lf.league_id,
  s.venue_id,
  s.result,
  s.forfeit_side is not null as is_forfeit,
  public.stats_side_goals(s.goals_for, s.forfeit_side, s.side, true) as goals_for,
  public.stats_side_goals(s.goals_against, s.forfeit_side, s.side, false) as goals_against
from public.match_form_sides s
join public.matches m on m.id = s.match_id
left join public.league_fixtures lf on lf.id = m.league_fixture_id
where s.team_id is not null;

-- A player's season: appearances, W/D/L, win %, goals, assists, men of the
-- match, average match rating (over the matches that have one), and their
-- level at the start and end of the season (player_level_history).
create view public.player_season_stats as
with rows as (
  select k.season_kind, k.season_year, k.league_id, s.profile_id, s.match_id, s.result, s.goals, s.assists,
         s.motm, s.rating
  from public.match_stat_players s
  cross join lateral (values ('year', s.season_year, null::uuid),
                             ('league', null::integer, s.league_id),
                             ('all', null::integer, null::uuid)) as k(season_kind, season_year, league_id)
  where k.season_kind <> 'league' or s.league_id is not null
),
agg as (
  select
    r.profile_id,
    r.season_kind,
    r.season_year,
    r.league_id,
    count(*)::integer as appearances,
    count(*) filter (where r.result = 'W')::integer as won,
    count(*) filter (where r.result = 'D')::integer as drawn,
    count(*) filter (where r.result in ('L', 'L_forfeit'))::integer as lost,
    round(100.0 * count(*) filter (where r.result = 'W') / count(*))::integer as win_pct,
    sum(r.goals)::integer as goals,
    sum(r.assists)::integer as assists,
    count(*) filter (where r.motm)::integer as motm,
    round(avg(r.rating), 2) as average_rating,
    count(r.rating)::integer as rated_matches,
    array_agg(r.match_id) as match_ids
  from rows r
  group by r.profile_id, r.season_kind, r.season_year, r.league_id
)
select
  a.profile_id, a.season_kind, a.season_year, a.league_id, a.appearances, a.won, a.drawn, a.lost, a.win_pct,
  a.goals, a.assists, a.motm, a.average_rating, a.rated_matches,
  (select h.level_before from public.player_level_history h
   where h.profile_id = a.profile_id and h.match_id = any(a.match_ids)
   order by h.created_at, h.id limit 1) as level_start,
  (select h.level_after from public.player_level_history h
   where h.profile_id = a.profile_id and h.match_id = any(a.match_ids)
   order by h.created_at desc, h.id desc limit 1) as level_end
from agg a;

-- A named team's season: as a player's, plus goals for and against, clean
-- sheets (a forfeit win counts 3-0, so it is one), the longest run of wins in a row, and
-- the men of the match and average rating of its players in its matches.
create view public.team_season_stats as
with rows as (
  select k.season_kind, k.season_year, k.league_id, t.team_id, t.match_id, t.side, t.kickoff_at, t.result,
         t.is_forfeit, t.goals_for, t.goals_against
  from public.match_stat_teams t
  cross join lateral (values ('year', t.season_year, null::uuid),
                             ('league', null::integer, t.league_id),
                             ('all', null::integer, null::uuid)) as k(season_kind, season_year, league_id)
  where k.season_kind <> 'league' or t.league_id is not null
),
runs as (
  select r.*,
         row_number() over (partition by r.team_id, r.season_kind, r.season_year, r.league_id
                            order by r.kickoff_at, r.match_id)
         - row_number() over (partition by r.team_id, r.season_kind, r.season_year, r.league_id, r.result = 'W'
                              order by r.kickoff_at, r.match_id) as island
  from rows r
),
longest as (
  select team_id, season_kind, season_year, league_id, max(n)::integer as longest_win_run
  from (select team_id, season_kind, season_year, league_id, island, count(*) as n
        from runs where result = 'W'
        group by team_id, season_kind, season_year, league_id, island) w
  group by team_id, season_kind, season_year, league_id
),
players as (
  select r.team_id, r.season_kind, r.season_year, r.league_id,
         count(*) filter (where p.motm)::integer as motm,
         round(avg(p.rating), 2) as average_rating
  from rows r
  join public.match_stat_players p on p.match_id = r.match_id and p.side = r.side
  group by r.team_id, r.season_kind, r.season_year, r.league_id
)
select
  r.team_id,
  r.season_kind,
  r.season_year,
  r.league_id,
  count(*)::integer as played,
  count(*) filter (where r.result = 'W')::integer as won,
  count(*) filter (where r.result = 'D')::integer as drawn,
  count(*) filter (where r.result in ('L', 'L_forfeit'))::integer as lost,
  round(100.0 * count(*) filter (where r.result = 'W') / count(*))::integer as win_pct,
  coalesce(sum(r.goals_for), 0)::integer as goals_for,
  coalesce(sum(r.goals_against), 0)::integer as goals_against,
  count(*) filter (where r.goals_against = 0)::integer as clean_sheets,
  coalesce(l.longest_win_run, 0) as longest_win_run,
  coalesce(pl.motm, 0) as motm,
  pl.average_rating
from rows r
left join longest l
  on l.team_id = r.team_id and l.season_kind = r.season_kind
 and l.season_year is not distinct from r.season_year and l.league_id is not distinct from r.league_id
left join players pl
  on pl.team_id = r.team_id and pl.season_kind = r.season_kind
 and pl.season_year is not distinct from r.season_year and pl.league_id is not distinct from r.league_id
group by r.team_id, r.season_kind, r.season_year, r.league_id, l.longest_win_run, pl.motm, pl.average_rating;

-- Recent matches on a team's profile (missing since A3b-2b): every
-- confirmed match the named team played, from its side. The app orders by
-- kickoff_at and pages.
create view public.team_recent_matches as
select
  s.team_id,
  s.match_id,
  s.kickoff_at,
  s.kickoff_at at time zone 'Asia/Nicosia' as kickoff_local,
  s.venue_id,
  v.name as venue_name,
  s.side,
  s.label,
  s.opponent_label,
  s.opponent_team_id,
  s.goals_for,
  s.goals_against,
  s.result,
  s.forfeit_side,
  s.forfeit_reason
from public.match_form_sides s
left join public.venues v on v.id = s.venue_id
where s.team_id is not null;

-- Leaderboards per venue and per city for a calendar year (Cyprus time):
-- every player with stats_min_appearances() (1) or more appearances there.
-- Ranks are shared on ties (1, 1, 3). The win-rate board breaks ties by
-- appearances.
create view public.stats_leaderboards as
with rows as (
  select k.scope, k.scope_key, s.*
  from public.match_stat_players s
  cross join lateral (values ('venue', s.venue_id::text), ('city', s.city_key)) as k(scope, scope_key)
  where k.scope_key is not null
),
agg as (
  select
    r.scope,
    r.scope_key,
    r.season_year,
    r.profile_id,
    count(*)::integer as appearances,
    sum(r.goals)::integer as goals,
    count(*) filter (where r.motm)::integer as motm,
    count(*) filter (where r.result = 'W')::integer as won,
    round(100.0 * count(*) filter (where r.result = 'W') / count(*))::integer as win_pct
  from rows r
  group by r.scope, r.scope_key, r.season_year, r.profile_id
  having count(*) >= public.stats_min_appearances()
)
select
  a.scope,
  a.scope_key,
  case when a.scope = 'venue' then (select v.name from public.venues v where v.id::text = a.scope_key)
       else (select min(btrim(v.city)) from public.venues v where lower(btrim(v.city)) = a.scope_key) end as scope_name,
  a.season_year,
  a.profile_id,
  a.appearances,
  a.goals,
  a.motm,
  a.won,
  a.win_pct,
  public.stats_min_appearances() as min_appearances,
  rank() over (partition by a.scope, a.scope_key, a.season_year order by a.goals desc)::integer as goals_rank,
  rank() over (partition by a.scope, a.scope_key, a.season_year order by a.motm desc)::integer as motm_rank,
  rank() over (partition by a.scope, a.scope_key, a.season_year order by a.win_pct desc, a.appearances desc)::integer
    as win_rate_rank
from agg a;

revoke all on public.match_stat_players, public.match_stat_teams from public, anon, authenticated;
grant select on public.match_stat_players, public.match_stat_teams to service_role;

revoke all on public.player_season_stats, public.team_season_stats, public.team_recent_matches,
  public.stats_leaderboards from public, anon, authenticated;
grant select on public.player_season_stats, public.team_season_stats, public.team_recent_matches,
  public.stats_leaderboards to authenticated, service_role;

revoke all on function public.match_rating_shown(uuid, uuid) from public, anon;
grant execute on function public.match_rating_shown(uuid, uuid) to authenticated, service_role;
revoke all on function public.stats_side_goals(integer, text, text, boolean) from public, anon;
grant execute on function public.stats_side_goals(integer, text, text, boolean) to authenticated, service_role;
revoke all on function public.stats_min_appearances() from public, anon;
grant execute on function public.stats_min_appearances() to authenticated, service_role;
