-- S10A, part 4 of 4: what the tournament page reads (match-record.md
-- decision 1o; image 13, and image 17 for "Coming soon"). For signed-in
-- players only; reads only.
--
--   list_tournaments         every tournament, for the Leagues screen and
--                            the events list: a tournament before sign-up
--                            is comingSoon, and one without dates shows
--                            "Coming soon" instead of a date
--   get_tournament           header, stage progress, teams, featured
--                            match, my teams with their squads (a player
--                            sees his own team's squad only); "Coming
--                            soon": the header only
--   get_tournament_standings the four group tables, the qualifying places,
--                            needsDraw and the Rules line
--   get_tournament_matches   every fixture (or one team's): stage, group,
--                            slot, score and shootout ("AP")
--   get_tournament_knockout  QF1–QF4, SF1, SF2 and the final with their
--                            sources ("A1", "Winner QF1") until the teams
--                            are known
--
-- The competition page's other tabs read a tournament as they read a
-- season: get_competition_player_stats (Premium only), get_competition_stats,
-- get_competition_awards (Player and Team of the tournament) and
-- get_competition_power_ranking take the tournament's id.
--
-- Re-created from their latest definitions (20261126230200_match_s10_competition.sql;
-- diffs in the PR): competition_season (a tournament is its own season),
-- competition_player_rows (adds the tournament's confirmed matches),
-- get_competition_stats (a tournament's teams and games), and
-- get_competition_awards and get_competition_power_ranking (the format and
-- teams through the two new helpers). Same signatures, so create or replace.

-- ---- 1. Helpers ------------------------------------------------------------------------

-- The format of a season (league row) or tournament.
create function public.competition_format(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select l.format from public.leagues l where l.id = p_id),
                  (select t.format from public.tournaments t where t.id = p_id));
$$;

-- The teams of a season (its tables' sign-ups) or tournament.
create function public.competition_team_ids(p_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct lt.team_id from public.league_teams lt
  where lt.league_id in (select public.league_season_tables(p_id))
    and exists (select 1 from public.leagues l where l.id = p_id)
  union
  select tt.team_id from public.tournament_teams tt where tt.tournament_id = p_id;
$$;

-- One fixture as the page shows it.
create function public.tournament_fixture_json(p_fixture_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'fixtureId', f.id,
    'stage', f.stage,
    'group', f.group_letter,
    'slot', f.slot,
    'kickoffAt', f.kickoff_at,
    'status', f.status,
    'homeTeamId', f.home_team_id,
    'homeTeamName', th.name,
    'homeKitColour', kh.kit_colour,
    'awayTeamId', f.away_team_id,
    'awayTeamName', ta.name,
    'awayKitColour', ka.kit_colour,
    'homeScore', f.home_score,
    'awayScore', f.away_score,
    'homePens', f.home_pens,
    'awayPens', f.away_pens,
    'decidedBy', f.decided_by,
    'winnerTeamId', public.tournament_winner(f.id),
    'matchId', m.id)
  from public.tournament_fixtures f
  left join public.teams th on th.id = f.home_team_id
  left join public.teams ta on ta.id = f.away_team_id
  left join public.tournament_teams kh on kh.tournament_id = f.tournament_id and kh.team_id = f.home_team_id
  left join public.tournament_teams ka on ka.tournament_id = f.tournament_id and ka.team_id = f.away_team_id
  left join public.matches m on m.tournament_fixture_id = f.id
  where f.id = p_fixture_id;
$$;

-- The header every read shows.
create function public.tournament_header_json(p_tournament public.tournaments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_tournament.id,
    'name', p_tournament.name,
    'area', p_tournament.area,
    'country', p_tournament.country,
    'format', p_tournament.format,
    'status', p_tournament.status,
    'comingSoon', p_tournament.status = 'coming_soon',
    'startDate', p_tournament.start_date,
    'endDate', p_tournament.end_date,
    'venueId', p_tournament.venue_id,
    'venueName', (select v.name from public.venues v where v.id = p_tournament.venue_id),
    'maxTeams', p_tournament.max_teams,
    'teamsCount', (select count(*) from public.tournament_teams tt where tt.tournament_id = p_tournament.id),
    'entryFeeCents', p_tournament.entry_fee_cents,
    'championTeamId', p_tournament.champion_team_id);
$$;

-- ---- 2. The page --------------------------------------------------------------------------

create function public.list_tournaments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.competition_require_player();
  return coalesce((
    select jsonb_agg(public.tournament_header_json(t)
           order by (t.status = 'finished'), t.start_date nulls last, t.name, t.id)
    from public.tournaments t), '[]'::jsonb);
end;
$$;

create function public.get_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.competition_require_player();
  v public.tournaments;
  v_stage text[];
  v_featured uuid;
begin
  select * into v from public.tournaments where id = p_tournament_id;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v.status = 'coming_soon' then
    return public.tournament_header_json(v);
  end if;
  v_stage := case v.status when 'groups' then array['group'] else array['qf', 'sf', 'final'] end;

  -- Featured: the next fixture with both teams and a time; else the latest result.
  select f.id into v_featured from public.tournament_fixtures f
  where f.tournament_id = v.id and f.status = 'scheduled' and f.kickoff_at >= now()
    and f.home_team_id is not null and f.away_team_id is not null
  order by f.kickoff_at, f.slot limit 1;
  if v_featured is null then
    select f.id into v_featured from public.tournament_fixtures f
    where f.tournament_id = v.id and f.status = 'completed'
    order by f.completed_at desc, f.kickoff_at desc nulls last, f.slot limit 1;
  end if;

  return public.tournament_header_json(v) || jsonb_build_object(
    'registrationDeadline', v.registration_deadline,
    'matchMinutes', v.match_minutes,
    'squadMin', public.tournament_starters(v.format),
    'squadMax', public.tournament_starters(v.format) + v.squad_subs,
    'progress', jsonb_build_object(
      'played', (select count(*) from public.tournament_fixtures f
                 where f.tournament_id = v.id and f.stage = any (v_stage) and f.status = 'completed'),
      'total', (select count(*) from public.tournament_fixtures f where f.tournament_id = v.id and f.stage = any (v_stage))),
    'featured', case when v_featured is not null then public.tournament_fixture_json(v_featured) end,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('teamId', tt.team_id, 'teamName', t.name, 'kitColour', tt.kit_colour,
                                          'group', tt.group_letter, 'groupPos', tt.group_pos)
                       order by tt.group_letter nulls last, tt.group_pos, t.name, tt.team_id)
      from public.tournament_teams tt join public.teams t on t.id = tt.team_id
      where tt.tournament_id = v.id), '[]'::jsonb),
    'myTeams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'teamId', tt.team_id, 'teamName', t.name, 'kitColour', tt.kit_colour,
               'isCaptain', exists (select 1 from public.team_members c
                                    where c.team_id = tt.team_id and c.profile_id = v_me and c.role = 'captain'),
               'canEditSquad', exists (select 1 from public.team_members c
                                       where c.team_id = tt.team_id and c.profile_id = v_me and c.role = 'captain')
                               and v.status = 'registration'
                               and (v.registration_deadline is null or now() < v.registration_deadline),
               'squad', coalesce((select jsonb_agg(public.competition_player_json(s.profile_id) order by s.added_at, s.profile_id)
                                  from public.tournament_squads s
                                  where s.tournament_id = v.id and s.team_id = tt.team_id), '[]'::jsonb))
             order by t.name, tt.team_id)
      from public.tournament_teams tt join public.teams t on t.id = tt.team_id
      where tt.tournament_id = v.id
        and exists (select 1 from public.team_members m where m.team_id = tt.team_id and m.profile_id = v_me)), '[]'::jsonb));
end;
$$;

create function public.get_tournament_standings(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.competition_require_player();
  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'tournament_not_found';
  end if;
  return jsonb_build_object(
    'rules', 'Teams level on points: goal difference, then goals scored, then head-to-head, then the organiser''s draw.',
    'groups', (
      select jsonb_agg(jsonb_build_object(
               'group', g.letter,
               'needsDraw', coalesce((select bool_or(s.needs_draw)
                                      from public.tournament_group_standings(p_tournament_id, g.letter) s), false),
               'rows', coalesce((select jsonb_agg(jsonb_build_object(
                                          'pos', s.pos, 'teamId', s.team_id, 'teamName', s.team_name,
                                          'kitColour', s.kit_colour, 'played', s.played, 'won', s.won,
                                          'drawn', s.drawn, 'lost', s.lost, 'goalsFor', s.goals_for,
                                          'goalsAgainst', s.goals_against, 'goalDiff', s.goal_diff,
                                          'points', s.points, 'qualifies', s.pos <= 2) order by s.pos)
                                 from public.tournament_group_standings(p_tournament_id, g.letter) s), '[]'::jsonb))
             order by g.letter)
      from unnest(array['A', 'B', 'C', 'D']) g(letter)));
end;
$$;

create function public.get_tournament_matches(p_tournament_id uuid, p_team_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.competition_require_player();
  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'tournament_not_found';
  end if;
  return coalesce((
    select jsonb_agg(public.tournament_fixture_json(f.id)
           order by f.kickoff_at nulls last,
                    array_position(array['group', 'qf', 'sf', 'final'], f.stage), f.slot)
    from public.tournament_fixtures f
    where f.tournament_id = p_tournament_id
      and (p_team_id is null or p_team_id in (f.home_team_id, f.away_team_id))), '[]'::jsonb);
end;
$$;

create function public.get_tournament_knockout(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.competition_require_player();
  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'tournament_not_found';
  end if;
  return (
    select jsonb_agg(coalesce(public.tournament_fixture_json(f.id),
                              jsonb_build_object('stage', b.stage, 'slot', b.slot))
                     || jsonb_build_object('homeSource', b.home_source, 'awaySource', b.away_source)
           order by b.ord)
    from public.tournament_bracket() b
    left join public.tournament_fixtures f on f.tournament_id = p_tournament_id and f.slot = b.slot);
end;
$$;

-- ---- 3. Re-created: the competition page's tabs read a tournament ------------------------------

create or replace function public.competition_season(p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.leagues;
begin
  if exists (select 1 from public.tournaments t where t.id = p_id) then
    return p_id;
  end if;
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

create or replace function public.competition_player_rows(p_season_id uuid)
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
    and s.competitive
  union all
  select s.profile_id, s.match_id, s.player_id, s.kickoff_at,
         public.competition_matchday(t.start_date, (m.kickoff_at at time zone 'Asia/Nicosia')::date),
         s.team_id, s.goals, s.assists, s.motm, s.rating, s.team_goals_for, s.team_goals_against
  from public.match_stat_players s
  join public.matches m on m.id = s.match_id
  join public.tournament_fixtures f on f.id = m.tournament_fixture_id
  join public.tournaments t on t.id = f.tournament_id
  where t.id = p_season_id
    and m.status = 'confirmed'
    and not s.is_forfeit
    and s.competitive;
$$;

create or replace function public.get_competition_stats(p_season_id uuid, p_tab text, p_category text default null,
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
        union all
        -- A tournament's (S10A): its confirmed matches, and completed
        -- fixtures without one (the organiser's results).
        select f.id, f.home_team_id, f.away_team_id,
               coalesce(m.side_a_score, f.home_score), coalesce(m.side_b_score, f.away_score)
        from public.tournament_fixtures f
        left join public.matches m on m.tournament_fixture_id = f.id
        where f.tournament_id = v_season
          and ((m.id is not null and m.status = 'confirmed' and m.forfeit_side is null
                and m.side_a_score is not null and m.side_b_score is not null)
               or ((m.id is null or m.status <> 'confirmed') and f.status = 'completed'))
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
        where t.id in (select public.competition_team_ids(v_season))
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
                                 'homeTeamId', coalesce(f.home_team_id, tf.home_team_id), 'homeTeamName', th.name,
                                 'homeScore', case when f.id is not null then f.home_score
                                                   else coalesce(tf.home_score, m.side_a_score) end,
                                 'awayTeamId', coalesce(f.away_team_id, tf.away_team_id), 'awayTeamName', ta.name,
                                 'awayScore', case when f.id is not null then f.away_score
                                                   else coalesce(tf.away_score, m.side_b_score) end)
                                 order by r.n)
                               from ranked r
                               join public.matches m on m.id = r.match_id
                               left join public.league_fixtures f on f.id = m.league_fixture_id
                               left join public.tournament_fixtures tf on tf.id = m.tournament_fixture_id
                               left join public.teams th on th.id = coalesce(f.home_team_id, tf.home_team_id)
                               left join public.teams ta on ta.id = coalesce(f.away_team_id, tf.away_team_id)
                               where r.category = c.category and r.n <= v_limit), '[]'::jsonb))
           order by c.ord), '[]'::jsonb)
    from unnest(v_categories) with ordinality c(category, ord));
end;
$$;

create or replace function public.get_competition_awards(p_season_id uuid, p_matchday integer default null)
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
  v_format := public.competition_format(v_season);
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

create or replace function public.get_competition_power_ranking(p_season_id uuid)
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
  v_format := public.competition_format(v_season);

  return query
  with teams as (
    select t.id as team_id, t.name
    from public.teams t
    where t.id in (select public.competition_team_ids(v_season))
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

-- ---- 4. Grants ------------------------------------------------------------------------------

revoke all on function public.competition_format(uuid) from public, anon, authenticated;
revoke all on function public.competition_team_ids(uuid) from public, anon, authenticated;
revoke all on function public.tournament_fixture_json(uuid) from public, anon, authenticated;
revoke all on function public.tournament_header_json(public.tournaments) from public, anon, authenticated;
grant execute on function public.competition_format(uuid) to service_role;
grant execute on function public.competition_team_ids(uuid) to service_role;
grant execute on function public.tournament_fixture_json(uuid) to service_role;
grant execute on function public.tournament_header_json(public.tournaments) to service_role;

revoke all on function public.list_tournaments() from public, anon;
revoke all on function public.get_tournament(uuid) from public, anon;
revoke all on function public.get_tournament_standings(uuid) from public, anon;
revoke all on function public.get_tournament_matches(uuid, uuid) from public, anon;
revoke all on function public.get_tournament_knockout(uuid) from public, anon;
grant execute on function public.list_tournaments() to authenticated, service_role;
grant execute on function public.get_tournament(uuid) to authenticated, service_role;
grant execute on function public.get_tournament_standings(uuid) to authenticated, service_role;
grant execute on function public.get_tournament_matches(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_tournament_knockout(uuid) to authenticated, service_role;
