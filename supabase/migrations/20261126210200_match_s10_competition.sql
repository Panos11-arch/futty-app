-- S10, part 3 of 3: what the competition page reads (match-record.md
-- decision 1n). Leagues only; the tournament parts (Knockout, By group,
-- penalties, group tables) come with S10A's tables. No bells and no
-- Discussion (decided by Panos, 26 November; Discussion comes with S7b).
-- No followers count: pins are private bookmarks (flagged for Panos).
--
-- Every function is for signed-in players, reads only, and computes
-- everything on the server from confirmed results and S13B ratings:
--
--   get_competition               header, Season ▾, the overview card,
--                                 Featured match and Titles
--   get_competition_standings     one table per division (or the season),
--                                 with the tiebreak rules in words
--   get_competition_matches       fixtures with their matchday
--   get_competition_player_stats  Premium only (premium_required)
--   get_competition_stats         Players, Teams and Performances cards
--   get_competition_awards        Player of the season, Team of the season
--                                 or of one matchday
--   get_competition_power_ranking the season's teams in app-wide order
--
-- A season: Season N of a city league, or a standard league (capacity 0),
-- which is its own season. A matchday is week n of the season, Monday to
-- Monday in Cyprus time, counted from the season's start date; a fixture
-- with no day yet has none ("Not scheduled") and counts in the whole
-- season once played. A rescheduled fixture moves to the week it's played
-- in.
--
-- Player and Team of the season: Team of the Week's selection and
-- placement (decision 1k item 4) over the season or one matchday. Whether
-- only Premium players are eligible is app_rules.competition_awards_premium_only
-- (default false), waiting on Panos.

-- ---- 1. Rules ------------------------------------------------------------------------

alter table public.app_rules
  add column competition_awards_premium_only boolean not null default false,
  add column competition_player_min_matches integer not null default 3
    constraint app_rules_competition_player_min_matches check (competition_player_min_matches >= 1);

-- ---- 2. Helpers ------------------------------------------------------------------------

-- The season a page shows: a season row as it is; a division's season; a
-- league's unfinished season, else its latest, else the league itself (a
-- standard league).
create function public.competition_season(p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.leagues;
begin
  select * into v from public.leagues where id = p_id;
  if not found then
    raise exception 'competition_not_found';
  end if;
  if v.kind = 'season' then
    return v.id;
  elsif v.kind = 'division' then
    return v.parent_league_id;
  end if;
  return coalesce(public.league_current_season(v.id),
                  (select s.id from public.leagues s where s.parent_league_id = v.id and s.kind = 'season'
                   order by s.season_number desc limit 1),
                  v.id);
end;
$$;

-- Week n of a season that starts on p_start (Monday to Monday).
create function public.competition_matchday(p_start date, p_day date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_start is null or p_day is null then null
              else ((date_trunc('week', p_day)::date - date_trunc('week', p_start)::date) / 7 + 1)::integer end;
$$;

-- One row per player per counted league match of the season (checked in
-- or ticked as played, confirmed, not a forfeit; S13B), with its matchday.
create function public.competition_player_rows(p_season_id uuid)
returns table (
  profile_id uuid,
  match_id uuid,
  player_id uuid,
  kickoff_at timestamptz,
  matchday integer,
  team_id uuid,
  goals integer,
  assists integer,
  motm boolean,
  rating numeric,
  goals_for integer,
  goals_against integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.profile_id, s.match_id, s.player_id, s.kickoff_at,
         public.competition_matchday(se.start_date, f.scheduled_day),
         s.team_id, s.goals, s.assists, s.motm, s.rating, s.team_goals_for, s.team_goals_against
  from public.match_stat_players s
  join public.matches m on m.id = s.match_id
  join public.league_fixtures f on f.id = m.league_fixture_id
  join public.leagues se on se.id = p_season_id
  where f.league_id in (select public.league_season_tables(p_season_id))
    and m.status = 'confirmed'
    and not s.is_forfeit
    and s.competitive;
$$;

-- A player as the caller may see them (a minor's first name only, A5).
create function public.competition_player_json(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profileId', p.id,
    'name', public.community_display_name(p),
    'avatarStyle', p.avatar_style,
    'avatarKitColour', p.avatar_kit_colour,
    'avatarNumber', p.avatar_number,
    'avatarIllustration', p.avatar_illustration)
  from public.profiles p where p.id = p_profile_id;
$$;

create function public.competition_require_player()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  return auth.uid();
end;
$$;

-- The standings position of every team in the season (within its table).
create function public.competition_positions(p_season_id uuid)
returns table (team_id uuid, pos integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.team_id, s.pos
  from public.league_season_tables(p_season_id) t(id)
  cross join lateral public.league_standings(t.id) s;
$$;

-- ---- 3. The page ---------------------------------------------------------------------

-- Header, Season ▾ (the page shows it with more than one season), the
-- overview card (start and end dates), Featured match and Titles.
-- Featured (decided 26 November): the next scheduled fixture whose two
-- teams have the best (lowest) combined standings position, ties to the
-- earlier kickoff; with none, the latest result.
create function public.get_competition(p_league_id uuid, p_season_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.competition_require_player();
  v_hub public.leagues;
  v_season public.leagues;
  v_featured jsonb;
begin
  select * into v_hub from public.leagues where id = public.league_hub(p_league_id);
  if not found then
    raise exception 'competition_not_found';
  end if;
  select * into v_season from public.leagues
  where id = public.competition_season(coalesce(p_season_id, p_league_id));
  if v_season.id is distinct from v_hub.id and v_season.parent_league_id is distinct from v_hub.id then
    raise exception 'competition_not_found';
  end if;

  with pos as (
    select * from public.competition_positions(v_season.id)
  ), fx as (
    select f.*, (f.scheduled_day + f.scheduled_time) at time zone 'Asia/Nicosia' as kickoff,
           (select m.id from public.matches m where m.league_fixture_id = f.id) as match_id
    from public.league_fixtures f
    where f.league_id in (select public.league_season_tables(v_season.id))
  ), nxt as (
    select fx.*, 'upcoming' as kind
    from fx
    where fx.status <> 'completed' and fx.forfeit_result is null and fx.kickoff >= now()
    order by coalesce((select pos.pos from pos where pos.team_id = fx.home_team_id), 999)
             + coalesce((select pos.pos from pos where pos.team_id = fx.away_team_id), 999),
             fx.kickoff, fx.id
    limit 1
  ), last as (
    select fx.*, 'result' as kind
    from fx
    where fx.status = 'completed' and fx.forfeit_result is null
      and fx.home_score is not null and fx.away_score is not null
    order by public.power_ranking_fixture_kickoff(fx.scheduled_day, fx.scheduled_time, fx.created_at) desc, fx.id
    limit 1
  ), pick as (
    select * from nxt
    union all
    select * from last where not exists (select 1 from nxt)
  )
  select jsonb_build_object(
           'kind', p.kind,
           'fixtureId', p.id,
           'matchId', p.match_id,
           'kickoffAt', public.power_ranking_fixture_kickoff(p.scheduled_day, p.scheduled_time, p.created_at),
           'home', jsonb_build_object('teamId', p.home_team_id, 'name', th.name, 'score', p.home_score),
           'away', jsonb_build_object('teamId', p.away_team_id, 'name', ta.name, 'score', p.away_score))
  into v_featured
  from pick p
  left join public.teams th on th.id = p.home_team_id
  left join public.teams ta on ta.id = p.away_team_id;

  return jsonb_build_object(
    'id', v_hub.id,
    'name', v_hub.name,
    'area', v_hub.scope,
    'format', v_hub.format,
    'stage', v_hub.stage,
    'isPinned', exists (select 1 from public.competition_pins cp
                        where cp.profile_id = v_me and cp.target_type = 'league'
                          and cp.scope = lower(btrim(v_hub.scope)) and cp.format = v_hub.format),
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'number', s.season_number,
               'startDate', s.start_date, 'finished', s.ended_at is not null)
             order by s.season_number desc)
      from public.leagues s where s.parent_league_id = v_hub.id and s.kind = 'season'), '[]'::jsonb),
    'season', jsonb_build_object(
      'id', v_season.id,
      'name', v_season.name,
      'number', v_season.season_number,
      'stage', v_season.stage,
      'startDate', v_season.start_date,
      'endDate', case when v_season.start_date is not null and v_season.season_weeks > 0
                      then v_season.start_date + v_season.season_weeks * 7 - 1 end,
      'finished', v_season.ended_at is not null,
      'tables', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name)
                          from public.leagues l where l.id in (select public.league_season_tables(v_season.id))),
                         '[]'::jsonb)),
    'featured', v_featured,
    'titles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seasonId', s.id, 'name', s.name, 'number', s.season_number,
               'year', extract(year from s.ended_at at time zone 'Asia/Nicosia')::integer,
               'teamId', s.champion_team_id, 'teamName', t.name,
               'holder', s.season_number = (select max(x.season_number) from public.leagues x
                                            where x.parent_league_id = v_hub.id and x.kind = 'season'
                                              and x.champion_team_id is not null))
             order by s.season_number desc)
      from public.leagues s
      join public.teams t on t.id = s.champion_team_id
      where s.parent_league_id = v_hub.id and s.kind = 'season'), '[]'::jsonb)
  );
end;
$$;

-- One table per division (or the season), with the Short, Full and Form
-- fields, and the tiebreak order in words (shown word for word under
-- "Rules").
create function public.get_competition_standings(p_season_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid;
begin
  perform public.competition_require_player();
  v_season := public.competition_season(p_season_id);
  return jsonb_build_object(
    'rules', 'Teams level on points: goal difference, then goals scored, then head-to-head points, then team name.',
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'name', l.name,
               'rows', coalesce((select jsonb_agg(jsonb_build_object(
                          'pos', s.pos, 'teamId', s.team_id, 'teamName', s.team_name,
                          'played', s.played, 'won', s.won, 'drawn', s.drawn, 'lost', s.lost,
                          'goalsFor', s.goals_for, 'goalsAgainst', s.goals_against, 'goalDiff', s.goal_diff,
                          'points', s.points, 'form', to_jsonb(s.form), 'zone', s.zone) order by s.pos)
                        from public.league_standings(l.id) s), '[]'::jsonb))
             order by l.name)
      from public.leagues l
      where l.id in (select public.league_season_tables(v_season))), '[]'::jsonb));
end;
$$;

-- The season's fixtures (p_team_id: one team's), with their matchday
-- (null: "Not scheduled"), kickoff, status, teams, score and match.
create function public.get_competition_matches(p_season_id uuid, p_team_id uuid default null)
returns table (
  fixture_id uuid,
  table_id uuid,
  table_name text,
  matchday integer,
  kickoff_at timestamptz,
  status text,
  forfeit_result text,
  home_team_id uuid,
  home_team_name text,
  away_team_id uuid,
  away_team_name text,
  home_score integer,
  away_score integer,
  match_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_season public.leagues;
begin
  perform public.competition_require_player();
  select * into v_season from public.leagues where id = public.competition_season(p_season_id);
  return query
  select f.id, l.id, l.name,
         public.competition_matchday(v_season.start_date, f.scheduled_day),
         case when f.scheduled_day is not null
              then (f.scheduled_day + coalesce(f.scheduled_time, time '00:00')) at time zone 'Asia/Nicosia' end,
         f.status, f.forfeit_result,
         f.home_team_id, th.name, f.away_team_id, ta.name,
         f.home_score, f.away_score,
         (select m.id from public.matches m where m.league_fixture_id = f.id)
  from public.league_fixtures f
  join public.leagues l on l.id = f.league_id
  left join public.teams th on th.id = f.home_team_id
  left join public.teams ta on ta.id = f.away_team_id
  where f.league_id in (select public.league_season_tables(v_season.id))
    and (p_team_id is null or p_team_id in (f.home_team_id, f.away_team_id))
  order by f.scheduled_day nulls last, f.scheduled_time nulls last, th.name, ta.name, f.id;
end;
$$;

-- ---- 4. Player stats (Premium) ------------------------------------------------------------

-- Every player of the season (p_team_id: one team's): rating, matches,
-- goals, assists, Man of the match, clean sheets and goals conceded per
-- match. Premium only: the server refuses everyone else (premium_required).
-- Players blocked either way are left out; a minor shows a first name only.
create function public.get_competition_player_stats(p_season_id uuid, p_team_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.competition_require_player();
  v_season uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = v_me and p.is_premium) then
    raise exception 'premium_required';
  end if;
  v_season := public.competition_season(p_season_id);
  return coalesce((
    select jsonb_agg(public.competition_player_json(x.profile_id) || jsonb_build_object(
             'teamId', x.team_id, 'teamName', t.name, 'rating', x.rating, 'matches', x.matches,
             'goals', x.goals, 'assists', x.assists, 'motm', x.motm, 'cleanSheets', x.clean_sheets,
             'goalsConcededPerMatch', x.conceded)
           order by x.rating desc nulls last, x.matches desc, x.profile_id)
    from (
      select r.profile_id,
             (array_agg(r.team_id order by r.kickoff_at desc))[1] as team_id,
             round(avg(r.rating), 2) as rating,
             count(distinct r.match_id)::integer as matches,
             sum(r.goals)::integer as goals,
             sum(r.assists)::integer as assists,
             (count(*) filter (where r.motm))::integer as motm,
             (count(*) filter (where r.goals_against = 0))::integer as clean_sheets,
             round(avg(r.goals_against), 2) as conceded
      from public.competition_player_rows(v_season) r
      where not public.blocked_between(v_me, r.profile_id)
      group by r.profile_id
    ) x
    left join public.teams t on t.id = x.team_id
    where p_team_id is null or x.team_id = p_team_id), '[]'::jsonb);
end;
$$;

-- ---- 5. Stats (free) ---------------------------------------------------------------------

-- The Stats tab: p_tab 'players' (rating, goals, assists, motm,
-- clean_sheets), 'teams' (rating, goals_scored, goals_conceded,
-- clean_sheets) or 'performances' (rating, goals, assists in one match).
-- The top p_limit of each card (3 for the tab, more for "See all" with
-- p_category). Goals conceded ranks the fewest first; every other card the
-- most. A card leaves out zeros.
create function public.get_competition_stats(p_season_id uuid, p_tab text, p_category text default null,
                                             p_limit integer default 3)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.competition_require_player();
  v_season uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 3), 100));
  v_categories text[];
begin
  v_categories := case p_tab
    when 'players' then array['rating', 'goals', 'assists', 'motm', 'clean_sheets']
    when 'teams' then array['rating', 'goals_scored', 'goals_conceded', 'clean_sheets']
    when 'performances' then array['rating', 'goals', 'assists']
  end;
  if v_categories is null then
    raise exception 'invalid_tab';
  end if;
  if p_category is not null then
    if not p_category = any (v_categories) then
      raise exception 'invalid_category';
    end if;
    v_categories := array[p_category];
  end if;
  v_season := public.competition_season(p_season_id);

  if p_tab = 'players' then
    return (
      with rows as (
        select * from public.competition_player_rows(v_season) r
        where not public.blocked_between(v_me, r.profile_id)
      ), agg as (
        select r.profile_id,
               (array_agg(r.team_id order by r.kickoff_at desc))[1] as team_id,
               count(distinct r.match_id) as matches,
               round(avg(r.rating), 2) as rating,
               sum(r.goals) as goals, sum(r.assists) as assists,
               count(*) filter (where r.motm) as motm,
               count(*) filter (where r.goals_against = 0) as clean_sheets
        from rows r group by r.profile_id
      ), vals as (
        select c.category, a.profile_id, a.team_id, a.matches,
               case c.category when 'rating' then a.rating when 'goals' then a.goals when 'assists' then a.assists
                               when 'motm' then a.motm else a.clean_sheets end as value
        from agg a cross join unnest(v_categories) c(category)
      ), ranked as (
        select v.*, row_number() over (partition by v.category
                                       order by v.value desc, v.matches desc, v.profile_id) as n
        from vals v where v.value is not null and v.value > 0
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', c.category,
               'rows', coalesce((select jsonb_agg(public.competition_player_json(r.profile_id) || jsonb_build_object(
                                   'teamId', r.team_id, 'teamName', t.name, 'value', r.value) order by r.n)
                                 from ranked r left join public.teams t on t.id = r.team_id
                                 where r.category = c.category and r.n <= v_limit), '[]'::jsonb))
             order by c.ord), '[]'::jsonb)
      from unnest(v_categories) with ordinality c(category, ord));
  elsif p_tab = 'teams' then
    return (
      with games as (
        -- Confirmed league matches (side a = home), as the player cards
        -- count them, and completed fixtures that have no match (made
        -- before S10).
        select f.id, f.home_team_id, f.away_team_id,
               coalesce(m.side_a_score, f.home_score) as home_score, coalesce(m.side_b_score, f.away_score) as away_score
        from public.league_fixtures f
        left join public.matches m on m.league_fixture_id = f.id
        where f.league_id in (select public.league_season_tables(v_season))
          and f.forfeit_result is null
          and ((m.id is not null and m.status = 'confirmed' and m.forfeit_side is null
                and m.side_a_score is not null and m.side_b_score is not null)
               or (m.id is null and f.status = 'completed' and f.home_score is not null and f.away_score is not null))
      ), fx as (
        select g.id, g.home_team_id as team_id, g.home_score as gf, g.away_score as ga from games g
        union all
        select g.id, g.away_team_id, g.away_score, g.home_score from games g
      ), match_ratings as (
        -- A team's rating in a match: the average of its players' ratings.
        select r.team_id, r.match_id, avg(r.rating) as rating
        from public.competition_player_rows(v_season) r
        where r.rating is not null and r.team_id is not null
        group by r.team_id, r.match_id
      ), agg as (
        select t.id as team_id, t.name,
               (select round(avg(mr.rating), 2) from match_ratings mr where mr.team_id = t.id) as rating,
               (select count(*) from fx where fx.team_id = t.id) as matches,
               (select sum(fx.gf) from fx where fx.team_id = t.id) as goals_scored,
               (select sum(fx.ga) from fx where fx.team_id = t.id) as goals_conceded,
               (select count(*) from fx where fx.team_id = t.id and fx.ga = 0) as clean_sheets
        from public.teams t
        where t.id in (select lt.team_id from public.league_teams lt
                       where lt.league_id in (select public.league_season_tables(v_season)))
      ), vals as (
        select c.category, a.team_id, a.name, a.matches,
               case c.category when 'rating' then a.rating when 'goals_scored' then a.goals_scored
                               when 'goals_conceded' then a.goals_conceded else a.clean_sheets end as value
        from agg a cross join unnest(v_categories) c(category)
      ), ranked as (
        select v.*, row_number() over (partition by v.category
                                       order by case when v.category = 'goals_conceded' then v.value end asc,
                                                case when v.category <> 'goals_conceded' then v.value end desc,
                                                v.matches desc, v.name, v.team_id) as n
        from vals v
        where v.value is not null and (v.value > 0 or v.category = 'goals_conceded') and v.matches > 0
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', c.category,
               'rows', coalesce((select jsonb_agg(jsonb_build_object('teamId', r.team_id, 'teamName', r.name,
                                                                     'value', r.value) order by r.n)
                                 from ranked r where r.category = c.category and r.n <= v_limit), '[]'::jsonb))
             order by c.ord), '[]'::jsonb)
      from unnest(v_categories) with ordinality c(category, ord));
  end if;

  -- Performances: one player in one match.
  return (
    with rows as (
      select * from public.competition_player_rows(v_season) r
      where not public.blocked_between(v_me, r.profile_id)
    ), vals as (
      select c.category, r.profile_id, r.team_id, r.match_id, r.kickoff_at,
             case c.category when 'rating' then r.rating when 'goals' then r.goals else r.assists end as value
      from rows r cross join unnest(v_categories) c(category)
    ), ranked as (
      select v.*, row_number() over (partition by v.category
                                     order by v.value desc, v.kickoff_at, v.profile_id) as n
      from vals v where v.value is not null and v.value > 0
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'category', c.category,
             'rows', coalesce((select jsonb_agg(public.competition_player_json(r.profile_id) || jsonb_build_object(
                                 'teamId', r.team_id, 'value', r.value, 'matchId', r.match_id,
                                 'homeTeamId', f.home_team_id, 'homeTeamName', th.name, 'homeScore', f.home_score,
                                 'awayTeamId', f.away_team_id, 'awayTeamName', ta.name, 'awayScore', f.away_score)
                                 order by r.n)
                               from ranked r
                               join public.matches m on m.id = r.match_id
                               join public.league_fixtures f on f.id = m.league_fixture_id
                               left join public.teams th on th.id = f.home_team_id
                               left join public.teams ta on ta.id = f.away_team_id
                               where r.category = c.category and r.n <= v_limit), '[]'::jsonb))
           order by c.ord), '[]'::jsonb)
    from unnest(v_categories) with ordinality c(category, ord));
end;
$$;

-- ---- 6. Player and Team of the season -------------------------------------------------------

-- The rows that count for Player and Team of the season: rated, and
-- Premium players only when competition_awards_premium_only is on.
create function public.competition_award_rows(p_season_id uuid)
returns table (profile_id uuid, match_id uuid, matchday integer, team_id uuid, kickoff_at timestamptz,
               goals integer, assists integer, rating numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select x.profile_id, x.match_id, x.matchday, x.team_id, x.kickoff_at, x.goals, x.assists, x.rating
  from public.competition_player_rows(p_season_id) x
  join public.profiles p on p.id = x.profile_id
  where x.rating is not null
    and (not (public.app_rules_now()).competition_awards_premium_only or p.is_premium);
$$;

-- Player of the season: the highest average rating with at least
-- competition_player_min_matches (3) matches; ties as Team of the Week
-- (more matches, then the earlier sign-up). Team of the season (or of
-- matchday p_matchday): Team of the Week's selection (the best average
-- ratings, at least 1 match) and placement (team_of_the_week_place) in the
-- league's format; empty slots are the page's "No eligible player".
-- Eligibility: everyone, or Premium only with
-- app_rules.competition_awards_premium_only (waiting on Panos).
create function public.get_competition_awards(p_season_id uuid, p_matchday integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.app_rules := public.app_rules_now();
  v_season uuid;
  v_format text;
  v_shape public.team_of_the_week_shapes;
  v_player jsonb;
  v_picked jsonb;
  v_team jsonb;
begin
  perform public.competition_require_player();
  v_season := public.competition_season(p_season_id);
  select l.format into v_format from public.leagues l where l.id = v_season;
  select * into v_shape from public.team_of_the_week_shapes s where s.format = v_format;


  select public.competition_player_json(a.profile_id) || jsonb_build_object(
           'teamId', a.team_id, 'teamName', t.name, 'rating', a.rating, 'matches', a.games)
  into v_player
  from (
    select w.profile_id, (array_agg(w.team_id order by w.kickoff_at desc))[1] as team_id,
           round(avg(w.rating), 2) as rating, count(distinct w.match_id) as games, p.created_at
    from public.competition_award_rows(v_season) w join public.profiles p on p.id = w.profile_id
    group by w.profile_id, p.created_at
    having count(distinct w.match_id) >= r.competition_player_min_matches
    order by round(avg(w.rating), 2) desc, count(distinct w.match_id) desc, p.created_at, w.profile_id
    limit 1
  ) a
  left join public.teams t on t.id = a.team_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', c.profile_id, 'games', c.games, 'goals', c.goals, 'assists', c.assists,
           'rating', c.rating, 'signed_up_at', c.created_at, 'team_id', c.team_id)), '[]'::jsonb)
  into v_picked
  from (
    select w.profile_id, count(distinct w.match_id)::integer as games, sum(w.goals)::integer as goals,
           sum(w.assists)::integer as assists, round(avg(w.rating), 2) as rating, p.created_at,
           (array_agg(w.team_id order by w.kickoff_at desc))[1] as team_id
    from public.competition_award_rows(v_season) w join public.profiles p on p.id = w.profile_id
    where p_matchday is null or w.matchday = p_matchday
    group by w.profile_id, p.created_at
    order by round(avg(w.rating), 2) desc, count(distinct w.match_id) desc, p.created_at, w.profile_id
    limit coalesce(v_shape.players, 0)
  ) c;

  select coalesce(jsonb_agg(public.competition_player_json(x.profile_id) || jsonb_build_object(
           'slot', x.slot, 'sort', x.sort, 'best', x.player_of_the_week,
           'teamId', (c ->> 'team_id')::uuid, 'teamName', t.name,
           'rating', (c ->> 'rating')::numeric, 'matches', (c ->> 'games')::integer,
           'goals', (c ->> 'goals')::integer, 'assists', (c ->> 'assists')::integer) order by x.sort), '[]'::jsonb)
  into v_team
  from public.team_of_the_week_place(v_format, v_picked) x
  join jsonb_array_elements(v_picked) c on (c ->> 'profile_id')::uuid = x.profile_id
  left join public.teams t on t.id = (c ->> 'team_id')::uuid;

  return jsonb_build_object(
    'premiumOnly', r.competition_awards_premium_only,
    'matchdays', coalesce((select jsonb_agg(distinct w.matchday order by w.matchday) from public.competition_award_rows(v_season) w
                           where w.matchday is not null), '[]'::jsonb),
    'player', v_player,
    'team', jsonb_build_object(
      'format', v_format,
      'matchday', p_matchday,
      'shape', jsonb_build_object('keepers', v_shape.keepers, 'defenders', v_shape.defenders,
                                  'midfielders', v_shape.midfielders, 'strikers', v_shape.strikers),
      'players', v_team));
end;
$$;

-- ---- 7. Power rankings ---------------------------------------------------------------------

-- The season's teams in the order of their app-wide points for the format
-- (S14b; no separate count per competition: a team's points are the same
-- everywhere). position_change: places gained in this list since Monday
-- 00:00 Cyprus time, the start of the current matchday. app_rank: the
-- team's place in Rankings (null until it's listed there: 3 counted
-- games, active in the last 60 days); a team with no counted game shows
-- the start points.
create function public.get_competition_power_ranking(p_season_id uuid)
returns table (
  "position" integer,
  team_id uuid,
  team_name text,
  points numeric,
  matches integer,
  app_rank integer,
  position_change integer,
  last_results text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_season uuid;
  v_format text;
  v_week timestamptz := date_trunc('week', now() at time zone 'Asia/Nicosia') at time zone 'Asia/Nicosia';
  v_start numeric := (public.app_rules_now()).power_ranking_start;
begin
  perform public.competition_require_player();
  v_season := public.competition_season(p_season_id);
  select l.format into v_format from public.leagues l where l.id = v_season;

  return query
  with teams as (
    select distinct lt.team_id, t.name
    from public.league_teams lt join public.teams t on t.id = lt.team_id
    where lt.league_id in (select public.league_season_tables(v_season))
  ), pts as (
    select tm.team_id, tm.name,
           coalesce((select h.points_after from public.power_ranking_history h
                     where h.team_id = tm.team_id and h.format = v_format
                     order by h.kickoff_at desc, h.seq desc limit 1), v_start) as now_points,
           (select count(*) from public.power_ranking_history h
            where h.team_id = tm.team_id and h.format = v_format)::integer as now_matches,
           coalesce((select h.points_after from public.power_ranking_history h
                     where h.team_id = tm.team_id and h.format = v_format and h.kickoff_at < v_week
                     order by h.kickoff_at desc, h.seq desc limit 1), v_start) as then_points,
           (select count(*) from public.power_ranking_history h
            where h.team_id = tm.team_id and h.format = v_format and h.kickoff_at < v_week)::integer as then_matches
    from teams tm
  ), ranked as (
    select p.*,
           (row_number() over (order by p.now_points desc, p.now_matches desc, p.name, p.team_id))::integer as pos_now,
           (row_number() over (order by p.then_points desc, p.then_matches desc, p.name, p.team_id))::integer as pos_then
    from pts p
  )
  select rk.pos_now, rk.team_id, rk.name, rk.now_points, rk.now_matches,
         (select s.rank from public.power_ranking_standing(v_format, now()) s where s.team_id = rk.team_id),
         rk.pos_then - rk.pos_now,
         (select array_agg(x.result order by x.kickoff_at desc, x.seq desc)
          from (select h.result, h.kickoff_at, h.seq from public.power_ranking_history h
                where h.team_id = rk.team_id and h.format = v_format
                order by h.kickoff_at desc, h.seq desc limit 3) x)
  from ranked rk
  order by rk.pos_now;
end;
$$;

-- ---- 8. Grants -------------------------------------------------------------------------------

revoke all on function public.competition_season(uuid) from public, anon, authenticated;
revoke all on function public.competition_matchday(date, date) from public, anon, authenticated;
revoke all on function public.competition_player_rows(uuid) from public, anon, authenticated;
revoke all on function public.competition_player_json(uuid) from public, anon, authenticated;
revoke all on function public.competition_require_player() from public, anon, authenticated;
revoke all on function public.competition_positions(uuid) from public, anon, authenticated;
revoke all on function public.competition_award_rows(uuid) from public, anon, authenticated;
grant execute on function public.competition_award_rows(uuid) to service_role;
grant execute on function public.competition_season(uuid) to service_role;
grant execute on function public.competition_matchday(date, date) to service_role;
grant execute on function public.competition_player_rows(uuid) to service_role;
grant execute on function public.competition_player_json(uuid) to service_role;
grant execute on function public.competition_require_player() to service_role;
grant execute on function public.competition_positions(uuid) to service_role;

revoke all on function public.get_competition(uuid, uuid) from public, anon;
revoke all on function public.get_competition_standings(uuid) from public, anon;
revoke all on function public.get_competition_matches(uuid, uuid) from public, anon;
revoke all on function public.get_competition_player_stats(uuid, uuid) from public, anon;
revoke all on function public.get_competition_stats(uuid, text, text, integer) from public, anon;
revoke all on function public.get_competition_awards(uuid, integer) from public, anon;
revoke all on function public.get_competition_power_ranking(uuid) from public, anon;
grant execute on function public.get_competition(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_competition_standings(uuid) to authenticated, service_role;
grant execute on function public.get_competition_matches(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_competition_player_stats(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_competition_stats(uuid, text, text, integer) to authenticated, service_role;
grant execute on function public.get_competition_awards(uuid, integer) to authenticated, service_role;
grant execute on function public.get_competition_power_ranking(uuid) to authenticated, service_role;
