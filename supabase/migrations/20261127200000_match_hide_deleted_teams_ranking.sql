-- A deleted team (teams.deleted_at, S20A delete_team) is hidden from every
-- power ranking. Reads only: no points, history or replay change, so the
-- other teams keep their points and their order; the teams below a hidden
-- team move up one place.
--
-- Re-created from their latest definitions (diffs in the PR); same
-- signatures, so create or replace and the grants stay:
--   power_ranking_standing          20261126090053_match_power_ranking.sql.
--                                   The Rankings tab (get_power_ranking, and
--                                   its Monday standing for the change), a
--                                   team's place per format
--                                   (get_team_power_ranking) and app_rank all
--                                   read it.
--   get_competition_power_ranking   20261127130400_match_s10a_tournament_reads.sql.
--                                   A competition's or tournament's Power
--                                   rankings tab.
--
-- get_power_ranking_history is unchanged: a team's breakdown still names a
-- deleted opponent.

create or replace function public.power_ranking_standing(p_format text, p_at timestamptz)
returns table (team_id uuid, points numeric, matches integer, rank integer)
language sql
stable
security definer
set search_path = ''
as $$
  with h as (
    select h.team_id, h.points_after, h.kickoff_at,
           row_number() over (partition by h.team_id order by h.kickoff_at desc, h.seq desc) as rn,
           count(*) over (partition by h.team_id) as n
    from public.power_ranking_history h
    where h.format = p_format and h.kickoff_at < p_at
  ), listed as (
    select h.team_id, h.points_after as points, h.n::integer as matches
    from h cross join public.app_rules_now() r
    where h.rn = 1
      and h.n >= r.power_ranking_min_matches
      and h.kickoff_at > p_at - make_interval(days => r.power_ranking_inactive_days)
  )
  select l.team_id, l.points, l.matches,
         (row_number() over (order by l.points desc, l.matches desc, t.name, l.team_id))::integer
  from listed l
  join public.teams t on t.id = l.team_id
  where t.deleted_at is null;
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
      and t.deleted_at is null
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
