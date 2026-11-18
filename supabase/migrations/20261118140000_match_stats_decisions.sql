-- A7 follow-up: the decisions of 18 November (docs/specs/match-record.md
-- decisions 1g.1, 1g.3 and 1g.4). Migrations 20261118010000 and
-- 20261118010100 were merged before these decisions, so this migration
-- replaces what they created rather than editing them:
--   1g.1  no minimum number of games for the leaderboards (1, was 5);
--   1g.3  a forfeit counts as a 3-0 win in goals for and against and clean
--         sheets (no player is credited with a goal);
--   1g.4  one team of the week for all of Futty, picked on average points
--         per game by position (was one team per venue, city and league,
--         picked on average match rating).
-- The old team-of-the-week tables are dropped and made again in the new
-- shape. They only ever held picks made under the old rules.

-- Drop what the two earlier migrations made, dependants first.
drop function if exists public.team_of_the_week_tick(timestamptz);
drop function if exists public.team_of_the_week_save(date, text, uuid, text, uuid, text, uuid[]);
drop table if exists public.team_of_the_week_players;
drop table if exists public.team_of_the_week;
drop table if exists public.team_of_the_week_runs;
drop view if exists public.stats_leaderboards;
drop view if exists public.team_recent_matches;
drop view if exists public.team_season_stats;
drop view if exists public.player_season_stats;
drop view if exists public.match_stat_teams;
drop view if exists public.match_stat_players;

-- ---------------------------------------------------------------------------
-- Season stats and leaderboards (as 20261118010000, with 1g.1 and 1g.3).
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- Team of the week (replaces 20261118010100, decision 1g.4).
-- ---------------------------------------------------------------------------

-- A7a: team of the week (docs/specs/match-record.md section 7, decision 1g.4,
-- agreed 18 November).
--
-- One team of the week for all of Futty, picked every Monday from 09:00
-- Cyprus time by match_jobs_tick, once per week (team_of_the_week_runs),
-- from every confirmed match of the week that ended on Sunday (Monday 00:00
-- to Monday 00:00, Cyprus time).
--
-- Players score points in each match they count in (checked in, or holding
-- a spot in a forfeit; 1b.2, 1b.3), by their position in that match's
-- lineup (none counts as a midfielder):
--   forward      3 per goal, 2 per assist
--   midfielder   3 per assist, 2 per goal, 1 if their side scored 3 or more
--   defender     4 for a clean sheet, 2 per goal, 1 per assist, 1 if their
--                side conceded 1 or fewer
--   keeper       5 for a clean sheet, 2 if their side conceded 1 or fewer
--   everyone     1 for a win, 3 for man of the match (once voting has closed)
-- A forfeit counts as 3-0 (1g.3): the winners get the win, the clean sheet
-- and "scored 3 or more", no one gets a goal; the side that forfeited gets
-- nothing.
-- A player's score is their average points per game that week. Their
-- position is the one from their latest match that week.
-- The team: the best keeper, defender, midfielder and forward (each only if
-- there is one), then the best other player who isn't a keeper. Ties go to
-- more men of the match, then the higher average match rating, then more
-- goals. Each player picked gets a team_of_the_week notification.

insert into public.notification_types (type, always_sent) values ('team_of_the_week', false)
on conflict (type) do nothing;

create table public.team_of_the_week (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check (extract(isodow from week_start) = 1),
  matches integer not null,
  created_at timestamptz not null default now()
);

create table public.team_of_the_week_players (
  team_of_the_week_id uuid not null references public.team_of_the_week (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  position_group text not null check (position_group in ('gk', 'def', 'mid', 'fwd')),
  sort integer not null check (sort between 1 and 5),
  average_points numeric(5, 2) not null,
  games integer not null,
  goals integer not null,
  assists integer not null,
  clean_sheets integer not null,
  motm integer not null,
  average_rating numeric(4, 2),
  primary key (team_of_the_week_id, profile_id),
  unique (team_of_the_week_id, sort)
);

create table public.team_of_the_week_runs (
  week_start date primary key,
  teams integer not null,
  ran_at timestamptz not null default now()
);

alter table public.team_of_the_week enable row level security;
alter table public.team_of_the_week_players enable row level security;
alter table public.team_of_the_week_runs enable row level security;

create policy "Signed-in users read teams of the week" on public.team_of_the_week
  for select to authenticated using (true);
create policy "Signed-in users read team of the week players" on public.team_of_the_week_players
  for select to authenticated using (true);

revoke all on public.team_of_the_week, public.team_of_the_week_players, public.team_of_the_week_runs
  from public, anon, authenticated;
grant select on public.team_of_the_week, public.team_of_the_week_players to authenticated;
grant all on public.team_of_the_week, public.team_of_the_week_players, public.team_of_the_week_runs to service_role;

-- Internal: one row per player per counted match, with their position for
-- the team of the week and their points (the rules above).
create view public.team_of_the_week_points as
select
  s.profile_id,
  s.match_id,
  s.kickoff_at,
  g.position_group,
  s.goals,
  s.assists,
  s.motm,
  s.rating,
  (s.team_goals_against = 0) as clean_sheet,
  case
    when s.result = 'L_forfeit' then 0
    else
      case g.position_group
        when 'fwd' then 3 * s.goals + 2 * s.assists
        when 'mid' then 3 * s.assists + 2 * s.goals + case when s.team_goals_for >= 3 then 1 else 0 end
        when 'def' then case when s.team_goals_against = 0 then 4 else 0 end + 2 * s.goals + s.assists
                        + case when s.team_goals_against <= 1 then 1 else 0 end
        else case when s.team_goals_against = 0 then 5 else 0 end
             + case when s.team_goals_against <= 1 then 2 else 0 end
      end
      + case when s.result = 'W' then 1 else 0 end
      + case when s.motm then 3 else 0 end
  end as points
from public.match_stat_players s
cross join lateral (select case when s.position_group = 'outfield' then 'mid' else s.position_group end as position_group) g;

revoke all on public.team_of_the_week_points from public, anon, authenticated;
grant select on public.team_of_the_week_points to service_role;

-- The pick for the week that ended last Sunday, once, from Monday 09:00
-- Cyprus time. Returns 1 when it made a team, 0 otherwise (before 09:00 on
-- a Monday, already picked, or no confirmed match that week).
create or replace function public.team_of_the_week_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Nicosia';
  v_monday date := date_trunc('week', v_local)::date;
  v_week date := v_monday - 7;
  v_from timestamptz := v_week::timestamp at time zone 'Asia/Nicosia';
  v_to timestamptz := v_monday::timestamp at time zone 'Asia/Nicosia';
  v_id uuid;
  v_matches integer;
  v_row record;
  v_sort integer := 0;
begin
  if v_local < v_monday + time '09:00' then
    return 0;
  end if;
  insert into public.team_of_the_week_runs (week_start, teams) values (v_week, 0)
  on conflict (week_start) do nothing;
  if not found then
    return 0;
  end if;

  select count(*) into v_matches from public.matches m
  where m.status = 'confirmed' and m.kickoff_at >= v_from and m.kickoff_at < v_to;
  if v_matches = 0 then
    return 0;
  end if;

  insert into public.team_of_the_week (week_start, matches) values (v_week, v_matches) returning id into v_id;

  for v_row in
    with week as (
      select * from public.team_of_the_week_points p where p.kickoff_at >= v_from and p.kickoff_at < v_to
    ),
    candidates as (
      select w.profile_id,
             round(avg(w.points), 2) as average_points,
             count(*)::integer as games,
             sum(w.goals)::integer as goals,
             sum(w.assists)::integer as assists,
             count(*) filter (where w.clean_sheet)::integer as clean_sheets,
             count(*) filter (where w.motm)::integer as motm,
             round(avg(w.rating), 2) as average_rating,
             (array_agg(w.position_group order by w.kickoff_at desc, w.match_id desc))[1] as position_group
      from week w
      group by w.profile_id
    ),
    ranked as (
      select c.*,
             row_number() over (partition by c.position_group
                                order by c.average_points desc, c.motm desc, c.average_rating desc nulls last,
                                         c.goals desc, c.profile_id) as group_rank,
             row_number() over (order by c.average_points desc, c.motm desc, c.average_rating desc nulls last,
                                         c.goals desc, c.profile_id) as overall_rank
      from candidates c
    ),
    firsts as (
      select r.*, case r.position_group when 'gk' then 1 when 'def' then 2 when 'mid' then 3 else 4 end as slot
      from ranked r
      where r.group_rank = 1
    ),
    rest as (
      select r.*, 5 as slot
      from ranked r
      where r.position_group <> 'gk' and r.profile_id not in (select f.profile_id from firsts f)
      order by r.overall_rank
      limit 1
    )
    select * from firsts
    union all
    select * from rest
    order by slot
  loop
    v_sort := v_sort + 1;
    insert into public.team_of_the_week_players (team_of_the_week_id, profile_id, position_group, sort, average_points,
                                                 games, goals, assists, clean_sheets, motm, average_rating)
    values (v_id, v_row.profile_id, v_row.position_group, v_sort, v_row.average_points, v_row.games, v_row.goals,
            v_row.assists, v_row.clean_sheets, v_row.motm, v_row.average_rating);
    perform public.send_notification(v_row.profile_id, 'team_of_the_week', jsonb_build_object(
      'title', 'Team of the week',
      'body', 'You''re in Futty''s team of the week.',
      'teamOfTheWeekId', v_id,
      'weekStart', v_week));
  end loop;

  update public.team_of_the_week_runs set teams = 1 where week_start = v_week;
  return 1;
end;
$$;

-- match_jobs_tick, from 20261117192224_match_levels_functions.sql, now also
-- runs the team of the week pick ("team_of_the_week" in the counts).
create or replace function public.match_jobs_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voided integer;
  v_played integer;
  v_confirmed integer := 0;
  v_no_result integer;
  v_row record;
begin
  update public.matches m
  set status = 'void'
  from public.venue_bookings b
  where b.id = m.booking_id
    and b.status = 'cancelled'
    and m.status in ('scheduled', 'played')
    and coalesce((select min(c.cancelled_at) from public.booking_cancellations c
                  where c.booking_id = b.id and c.scope <> 'my_spot'), now()) < m.ends_at;
  get diagnostics v_voided = row_count;

  update public.matches set status = 'played' where status = 'scheduled' and ends_at <= now();
  get diagnostics v_played = row_count;

  for v_row in
    select m.id, m.result_deadline_at, s.side_a_score, s.side_b_score
    from public.matches m
    join public.match_result_submissions s on s.match_id = m.id
    where m.status in ('scheduled', 'played') and m.result_deadline_at <= now() and s.response is null
    order by m.result_deadline_at, m.id
    for update of m
  loop
    update public.matches
    set status = 'confirmed', side_a_score = v_row.side_a_score, side_b_score = v_row.side_b_score,
        confirmed_via = 'deadline', confirmed_at = v_row.result_deadline_at
    where id = v_row.id;
    perform public.match_notify(v_row.id, 'match_result_confirmed', 'Result confirmed',
      public.match_score_line(v_row.id, v_row.side_a_score, v_row.side_b_score), array['a', 'b'], true, null);
    v_confirmed := v_confirmed + 1;
  end loop;

  update public.matches m
  set status = 'no_result'
  where m.status in ('scheduled', 'played') and m.result_deadline_at <= now()
    and not exists (select 1 from public.match_result_submissions s where s.match_id = m.id);
  get diagnostics v_no_result = row_count;

  return jsonb_build_object('played', v_played, 'confirmed', v_confirmed, 'no_result', v_no_result, 'voided', v_voided)
         || public.match_reminders_tick(now())
         || jsonb_build_object('levels', public.match_levels_tick(now()))
         || jsonb_build_object('team_of_the_week', public.team_of_the_week_tick(now()));
end;
$$;

revoke all on function public.team_of_the_week_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.team_of_the_week_tick(timestamptz) to service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
grant execute on function public.match_jobs_tick() to service_role;
