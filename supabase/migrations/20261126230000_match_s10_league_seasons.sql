-- S10, part 1 of 3: league seasons and computed standings (match-record.md
-- decision 1n; seasons decided 26 November, needs Panos's OK because it
-- changes his league functions).
--
-- Seasons are child rows. A city league (the hub, a top-level leagues row)
-- keeps sign-up. Each season is a child of the hub (kind 'season', "Season
-- N"), and a season's divisions are children of that season (kind
-- 'division'). A new season never deletes anything: the old season's rows,
-- fixtures, matches and standings stay as they are, so Season ▾ and Titles
-- can show them.
--
--   * start_league_season (and a full sign-up) creates "Season N" under the
--     hub and moves the hub's sign-up rows into it, so the next sign-up
--     starts empty and the same teams can register again. The hub stays in
--     sign-up; while a season is unfinished a full sign-up doesn't start
--     another one.
--   * end_season_to_divisions records Season N's champion and creates Season
--     N+1 with Division 1 (top 10) and Division 2 (11th to 20th), as before.
--     The hub moves to 'divisions' and its sign-up rows become the waiting
--     pool; a team that was just placed in a division leaves the pool.
--   * apply_promotion_relegation records Division 1's winner as the
--     season's champion and creates Season N+1 with the same divisions:
--     the bottom 2 of Division 1 and the top 2 of Division 2 swap; Division
--     3 and below carry over unchanged (before, they kept playing; a new
--     season now starts their fixtures again).
--   * form_new_division adds the next division to the current season from
--     the pool, as before.
--   * Standard leagues (capacity 0, always open) have no seasons: the league
--     row is its own season, as before.
--
-- Standings are computed from fixtures (league_standings), not from the
-- league_teams counters. Order (decided 26 November; S10A uses the same):
-- points (3 a win, 1 a draw, plus pts_adjustment), goal difference, goals
-- for, head-to-head points between the teams still level, then team name
-- (a stand-in for the organiser's draw, which leagues don't have yet). The
-- counters keep being updated for the old screens until the page PR
-- switches over (a test checks they always agree).
--
-- Re-created from their latest definitions (all in
-- 20261108230317_baseline.sql): is_captain_in_league_tree,
-- register_team_for_league, start_league_season, end_season_to_divisions,
-- apply_promotion_relegation, form_new_division.

-- ---- 1. Seasons on leagues ------------------------------------------------------

alter table public.leagues
  add column kind text not null default 'league'
    constraint leagues_kind_check check (kind in ('league', 'season', 'division')),
  add column season_number integer constraint leagues_season_number_check check (season_number > 0),
  add column champion_team_id uuid references public.teams (id) on delete set null,
  add column ended_at timestamptz,
  add constraint leagues_season_number_kind check ((kind = 'season') = (season_number is not null));

-- Every existing child row is a division (no league is in a season in
-- production: Panos moved them back to sign-up on 26 November).
update public.leagues set kind = 'division' where parent_league_id is not null;

create unique index leagues_season_number_key on public.leagues (parent_league_id, season_number)
  where kind = 'season';

comment on column public.leagues.kind is
  'S10: league (a top-level competition, the hub), season (Season N, a child of the hub) or division (a child of a season).';
comment on column public.leagues.champion_team_id is 'S10: the finished season''s winner (Titles).';

-- ---- 2. Tree helpers --------------------------------------------------------------

-- The top-level league above any row (itself when it is one).
create function public.league_hub(p_league_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select l.id, l.parent_league_id, 0 as depth from public.leagues l where l.id = p_league_id
    union all
    select p.id, p.parent_league_id, up.depth + 1
    from public.leagues p join up on p.id = up.parent_league_id
    where up.depth < 5
  )
  select up.id from up where up.parent_league_id is null limit 1;
$$;

-- The hub's unfinished season (the latest), or null.
create function public.league_current_season(p_hub_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id from public.leagues l
  where l.parent_league_id = p_hub_id and l.kind = 'season' and l.ended_at is null
  order by l.season_number desc
  limit 1;
$$;

-- The rows that hold a season's teams and fixtures: its divisions, or the
-- season itself (also a standard league, or a division asked for directly).
create function public.league_season_tables(p_season_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.leagues d
  where d.parent_league_id = p_season_id and d.kind = 'division'
    and exists (select 1 from public.leagues s where s.id = p_season_id and s.kind = 'season')
  union all
  select l.id from public.leagues l
  where l.id = p_season_id
    and not (l.kind = 'season' and exists (select 1 from public.leagues d
                                          where d.parent_league_id = l.id and d.kind = 'division'));
$$;

-- Was: the league itself or its direct children. Now every row below it
-- (a hub's seasons and their divisions).
create or replace function public.is_captain_in_league_tree(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select l.id, 0 as depth from public.leagues l where l.id = p_league_id
    union all
    select c.id, tree.depth + 1 from public.leagues c join tree on c.parent_league_id = tree.id
    where tree.depth < 5
  )
  select exists (
    select 1
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id
    where tm.profile_id = auth.uid()
      and tm.role = 'captain'
      and lt.league_id in (select tree.id from tree)
  );
$$;

-- ---- 3. Standings ------------------------------------------------------------------

-- One team's result in one fixture. Counted: completed fixtures that aren't
-- void, and forfeits (an old-path forfeit leaves the fixture 'agreed'). A
-- forfeit is a win for the other team with no goals. An old-path fixture
-- keeps its agreed score in fixture_score_submissions; one completed with
-- no score at all (resolve_unscheduled_fixture) is decided by who proposed
-- a date. All as apply_fixture_forfeit_stats, check_fixture_score_match and
-- resolve_unscheduled_fixture count them.
create function public.league_fixture_results(p_league_id uuid)
returns table (fixture_id uuid, kickoff_at timestamptz, team_id uuid, opponent_id uuid, result text,
               goals_for integer, goals_against integer)
language sql
stable
security definer
set search_path = ''
as $$
  with fx as (
    select f.id, f.home_team_id, f.away_team_id, f.forfeit_result,
           -- The old path agreed the score in fixture_score_submissions and
           -- never wrote it on the fixture.
           coalesce(f.home_score, (select s.home_score from public.fixture_score_submissions s
                                   where s.fixture_id = f.id and s.submitted_by_team_id = f.home_team_id
                                   order by s.submitted_at desc limit 1)) as home_score,
           coalesce(f.away_score, (select s.away_score from public.fixture_score_submissions s
                                   where s.fixture_id = f.id and s.submitted_by_team_id = f.home_team_id
                                   order by s.submitted_at desc limit 1)) as away_score,
           public.power_ranking_fixture_kickoff(f.scheduled_day, f.scheduled_time, f.created_at) as kickoff,
           exists (select 1 from public.fixture_schedule_proposals p
                   where p.fixture_id = f.id and p.proposed_by_team_id = f.home_team_id) as home_proposed,
           exists (select 1 from public.fixture_schedule_proposals p
                   where p.fixture_id = f.id and p.proposed_by_team_id = f.away_team_id) as away_proposed
    from public.league_fixtures f
    where f.league_id = p_league_id
      and f.home_team_id is not null and f.away_team_id is not null
      and (f.forfeit_result in ('home_forfeited', 'away_forfeited')
           or (f.status = 'completed' and f.forfeit_result is null))
  ), home as (
    select fx.id, fx.kickoff, fx.home_team_id as team_id, fx.away_team_id as opponent_id,
           case
             when fx.forfeit_result = 'home_forfeited' then 'L'
             when fx.forfeit_result = 'away_forfeited' then 'W'
             when fx.home_score is not null and fx.away_score is not null
               then case sign(fx.home_score - fx.away_score) when 1 then 'W' when 0 then 'D' else 'L' end
             when fx.home_proposed and not fx.away_proposed then 'W'
             when fx.away_proposed and not fx.home_proposed then 'L'
             else 'D'
           end as result,
           case when fx.forfeit_result is null then coalesce(fx.home_score, 0) else 0 end as gf,
           case when fx.forfeit_result is null then coalesce(fx.away_score, 0) else 0 end as ga
    from fx
  )
  select h.id, h.kickoff, h.team_id, h.opponent_id, h.result, h.gf, h.ga from home h
  union all
  select h.id, h.kickoff, h.opponent_id, h.team_id,
         case h.result when 'W' then 'L' when 'L' then 'W' else 'D' end, h.ga, h.gf
  from home h;
$$;

-- The standings of one row that holds teams (a season, a division or a
-- standard league), in the order at the top of this file. zone marks the
-- places the existing rules act on: Season 1's top 10 ('division_1') and
-- 11th to 20th ('division_2') when an open league splits, Division 1's
-- bottom 2 ('relegation') and Division 2's top 2 ('promotion').
create function public.league_standings(p_league_id uuid)
returns table (
  pos integer,
  team_id uuid,
  team_name text,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  goals_for integer,
  goals_against integer,
  goal_diff integer,
  points integer,
  h2h_points integer,
  form text[],
  zone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_league public.leagues;
  v_split boolean := false;
  v_division text;
begin
  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    return;
  end if;
  -- An open league's season without divisions splits into Division 1 and 2.
  v_split := v_league.kind = 'season'
             and exists (select 1 from public.leagues h where h.id = v_league.parent_league_id and h.capacity > 0);
  v_division := case when v_league.kind = 'division'
                      and exists (select 1 from public.leagues s
                                  where s.parent_league_id = v_league.parent_league_id and s.kind = 'division'
                                    and s.name = case v_league.name when 'Division 1' then 'Division 2'
                                                                    else 'Division 1' end)
                     then v_league.name end;

  return query
  with res as (
    select * from public.league_fixture_results(p_league_id)
  ), teams as (
    select lt.team_id, t.name, coalesce(lt.pts_adjustment, 0) as adj
    from public.league_teams lt
    join public.teams t on t.id = lt.team_id
    where lt.league_id = p_league_id
  ), base as (
    select tm.team_id, tm.name,
           count(r.result)::integer as p,
           (count(*) filter (where r.result = 'W'))::integer as w,
           (count(*) filter (where r.result = 'D'))::integer as d,
           (count(*) filter (where r.result = 'L'))::integer as l,
           coalesce(sum(r.goals_for), 0)::integer as gf,
           coalesce(sum(r.goals_against), 0)::integer as ga,
           ((count(*) filter (where r.result = 'W')) * 3 + count(*) filter (where r.result = 'D') + tm.adj)::integer
             as pts
    from teams tm
    left join res r on r.team_id = tm.team_id and r.opponent_id in (select x.team_id from teams x)
    group by tm.team_id, tm.name, tm.adj
  ), h2h as (
    select a.team_id,
           coalesce(sum(case r.result when 'W' then 3 when 'D' then 1 else 0 end), 0)::integer as pts
    from base a
    left join res r on r.team_id = a.team_id
      and r.opponent_id in (select b.team_id from base b
                            where b.team_id <> a.team_id and b.pts = a.pts
                              and b.gf - b.ga = a.gf - a.ga and b.gf = a.gf)
    group by a.team_id
  ), ranked as (
    select b.*, h.pts as hp,
           (row_number() over (order by b.pts desc, b.gf - b.ga desc, b.gf desc, h.pts desc, b.name, b.team_id))::integer
             as n,
           count(*) over () as total
    from base b join h2h h on h.team_id = b.team_id
  )
  select rk.n, rk.team_id, rk.name, rk.p, rk.w, rk.d, rk.l, rk.gf, rk.ga, rk.gf - rk.ga, rk.pts, rk.hp,
         coalesce((select array_agg(x.result order by x.kickoff_at desc, x.fixture_id desc)
                   from (select r.result, r.kickoff_at, r.fixture_id from res r
                         where r.team_id = rk.team_id
                         order by r.kickoff_at desc, r.fixture_id desc limit 5) x), '{}'),
         case
           when v_split and rk.n <= 10 then 'division_1'
           when v_split and rk.n <= 20 then 'division_2'
           when v_division = 'Division 1' and rk.n > rk.total - 2 then 'relegation'
           when v_division = 'Division 2' and rk.n <= 2 then 'promotion'
         end
  from ranked rk
  order by rk.n;
end;
$$;

-- ---- 4. Starting a season ------------------------------------------------------------

-- Creates the hub's next season and moves its sign-up rows into it (the
-- hub's sign-up starts empty again). Internal: start_league_season and a
-- full sign-up call it. Returns the season's id.
create function public.league_start_season(p_hub_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hub public.leagues;
  v_season public.leagues;
  v_number integer;
begin
  select * into v_hub from public.leagues where id = p_hub_id for update;
  if v_hub.id is null or v_hub.parent_league_id is not null then
    raise exception 'league_not_found';
  end if;
  if v_hub.stage <> 'signup' then
    raise exception 'not_in_signup';
  end if;
  if public.league_current_season(p_hub_id) is not null then
    raise exception 'season_in_progress';
  end if;

  select coalesce(max(l.season_number), 0) + 1 into v_number
  from public.leagues l where l.parent_league_id = p_hub_id and l.kind = 'season';

  insert into public.leagues (name, format, scope, stage, capacity, start_date, season_weeks, parent_league_id,
                              kind, season_number)
  values ('Season ' || v_number, v_hub.format, v_hub.scope, 'season', 0,
          coalesce(v_hub.start_date, (now() at time zone 'Asia/Nicosia')::date), v_hub.season_weeks, p_hub_id,
          'season', v_number)
  returning * into v_season;

  -- Moved, not copied: the rows (and their history) belong to the season
  -- now, and the next sign-up starts empty.
  update public.league_teams set league_id = v_season.id where league_id = p_hub_id;
  update public.leagues set start_date = null where id = p_hub_id;

  perform public.sync_league_fixtures(v_season.id);
  return v_season.id;
end;
$$;

-- Was: the hub itself moved to 'season'. Now an open league's season is a
-- child row (league_start_season); a standard league (capacity 0) works as
-- before.
create or replace function public.start_league_season(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
begin
  if not public.is_captain_in_league_tree(p_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if v_league.id is not null and v_league.kind = 'league' and v_league.capacity > 0 then
    perform public.league_start_season(p_league_id);
    return;
  end if;

  update public.leagues
  set stage = 'season', start_date = coalesce(start_date, current_date)
  where id = p_league_id and stage = 'signup';

  if not found then
    raise exception 'not_in_signup';
  end if;

  -- This function only backs the dev-only "Start season" trigger now (see
  -- app/(tabs)/leagues.tsx), but a real production league can still reach
  -- 'season' via this path with 2+ teams already registered if a captain
  -- uses it before capacity fills — this call was missing here (unlike
  -- register_team_for_league's auto-start), which is exactly how the
  -- Nicosia 5-a-side Open League ended up in 'season' with zero fixtures.
  perform public.sync_league_fixtures(p_league_id);
end;
$$;

-- Changes: only a top-level league takes registrations (a season or
-- division row never does); a full open league's sign-up starts its next
-- season as a child row (league_start_season), unless a season is still
-- unfinished, when sign-up simply stays full; sign-up rows are moved into
-- the season, so the same team can register again for the next one.
create or replace function public.register_team_for_league(p_league_id uuid, p_team_id uuid)
returns public.league_teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_count integer;
  v_row public.league_teams;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  -- Enforced here too, not just in the app's registration UI — a team must
  -- have its full main roster (roster_size, captain included) before it can
  -- take a league slot, so a match always has enough players to actually
  -- play. Substitutes aren't counted toward this — they're optional.
  if (
    select count(*) from public.team_members
    where team_id = p_team_id and role in ('captain', 'player')
  ) < (select roster_size from public.teams where id = p_team_id) then
    raise exception 'roster_incomplete';
  end if;

  -- A captain can't register a second team of theirs into a league they
  -- already have a team in — one captain, one team per league.
  if exists (
    select 1
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id
    where lt.league_id = p_league_id
      and tm.profile_id = auth.uid()
      and tm.role = 'captain'
      and lt.team_id <> p_team_id
  ) then
    raise exception 'already_have_team_in_league';
  end if;

  select * into v_league from public.leagues where id = p_league_id for update;
  if v_league.id is null then
    raise exception 'league_not_found';
  end if;
  -- S10: seasons and divisions are filled by the hub, never directly.
  if v_league.kind <> 'league' then
    raise exception 'league_not_open';
  end if;

  -- Team Premium (supabase/team-premium.sql) gates 9-a-side/11-a-side only,
  -- and applies at every entry point into this format's leagues — the initial
  -- signup, a standard league's always-open join, and the post-split pool —
  -- since format is copied down through hubs, divisions and pool rows alike.
  if v_league.format in ('9-a-side', '11-a-side') then
    if not exists (
      select 1 from public.teams
      where id = p_team_id
        and (
          (v_league.format = '9-a-side' and premium_9aside)
          or (v_league.format = '11-a-side' and premium_11aside)
        )
    ) then
      raise exception 'team_premium_required';
    end if;
  end if;

  if v_league.stage = 'signup' then
    select count(*) into v_count from public.league_teams where league_id = p_league_id;
    if v_count >= v_league.capacity then
      raise exception 'league_full';
    end if;
  elsif v_league.stage = 'season' then
    -- Once an Open League's season has started, signup is closed — new teams
    -- join via the post-split pool instead. Standard leagues (capacity = 0)
    -- have no such cutoff and stay open indefinitely.
    if v_league.capacity > 0 then
      raise exception 'season_in_progress';
    end if;
  elsif v_league.stage <> 'divisions' then
    raise exception 'league_not_open';
  end if;
  -- stage = 'divisions': joining registers the team in the waiting pool
  -- (a league_teams row directly against this hub league), no capacity limit.

  begin
    insert into public.league_teams
      (league_id, team_id, played, won, drawn, lost, goals_for, goals_against, pts_adjustment)
    values (p_league_id, p_team_id, 0, 0, 0, 0, 0, 0, 0)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'already_joined';
  end;

  -- A full open league starts its season (S10: as a child row, once no
  -- season is unfinished). Standard leagues (capacity = 0) are excluded —
  -- they have no fixed roster of teams to close signup on.
  if v_league.stage = 'signup' and v_league.capacity > 0 then
    select count(*) into v_count from public.league_teams where league_id = p_league_id;
    if v_count >= v_league.capacity and public.league_current_season(p_league_id) is null then
      perform public.league_start_season(p_league_id);
    end if;
    return v_row;
  end if;

  -- A standard league or the pool: fills in this team's pairings (the pool
  -- has none until a division forms).
  perform public.sync_league_fixtures(p_league_id);

  return v_row;
end;
$$;

-- ---- 5. Ending a season ---------------------------------------------------------------

-- Was: the hub itself held the season and got Division 1 and 2 as
-- children. Now Season N (p_league_id: the season, or its hub) gets its
-- champion, and Season N+1 is created with Division 1 (top 10) and
-- Division 2 (11th to 20th) as its children. Nothing is deleted. The hub
-- moves to 'divisions' and its sign-up rows become the pool.
create or replace function public.end_season_to_divisions(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_hub public.leagues;
  v_season public.leagues;
  v_next public.leagues;
  v_div1 public.leagues;
  v_div2 public.leagues;
  v_weeks integer;
  v_ranked uuid[];
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
begin
  if not public.is_captain_in_league_tree(p_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if v_league.id is null then
    raise exception 'league_not_found';
  end if;
  select * into v_hub from public.leagues where id = public.league_hub(p_league_id) for update;
  if v_hub.capacity = 0 then
    raise exception 'not_an_open_league';
  end if;
  if v_league.kind = 'season' then
    v_season := v_league;
  else
    select * into v_season from public.leagues where id = public.league_current_season(v_hub.id);
  end if;
  if v_season.id is null or v_season.kind <> 'season' or v_season.ended_at is not null
     or v_season.stage <> 'season' then
    raise exception 'not_in_season';
  end if;

  select array_agg(s.team_id order by s.pos) into v_ranked from public.league_standings(v_season.id) s;
  v_ranked := coalesce(v_ranked, '{}');

  v_weeks := least(cardinality(v_ranked), 10);
  v_weeks := greatest(2 * (v_weeks - 1), 1);

  update public.leagues
  set champion_team_id = v_ranked[1], ended_at = now(), stage = 'finished'
  where id = v_season.id;

  insert into public.leagues (name, format, scope, stage, capacity, start_date, season_weeks, parent_league_id,
                              kind, season_number)
  values ('Season ' || (v_season.season_number + 1), v_hub.format, v_hub.scope, 'divisions', 0, v_today, v_weeks,
          v_hub.id, 'season', v_season.season_number + 1)
  returning * into v_next;

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity, kind)
  values ('Division 1', v_hub.format, v_hub.scope, 'season', v_next.id, v_today, v_weeks, 0, 'division')
  returning * into v_div1;

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity, kind)
  values ('Division 2', v_hub.format, v_hub.scope, 'season', v_next.id, v_today, v_weeks, 0, 'division')
  returning * into v_div2;

  insert into public.league_teams
    (league_id, team_id, played, won, drawn, lost, goals_for, goals_against, pts_adjustment)
  select case when r.pos <= 10 then v_div1.id else v_div2.id end, r.team_id, 0, 0, 0, 0, 0, 0, 0
  from unnest(v_ranked) with ordinality r(team_id, pos)
  where r.pos <= 20;

  -- A team placed in a division no longer waits in the pool (its sign-up
  -- for the next season is used up by its place).
  delete from public.league_teams
  where league_id = v_hub.id and team_id = any (v_ranked[1:20]);

  update public.leagues set stage = 'divisions' where id = v_hub.id;

  perform public.sync_league_fixtures(v_div1.id);
  perform public.sync_league_fixtures(v_div2.id);
end;
$$;

-- Was: swapped teams between the hub's Division 1 and 2, reset their
-- counters and deleted their fixtures. Now the current season gets its
-- champion (Division 1's winner) and Season N+1 is created with the same
-- divisions: the bottom 2 of Division 1 go down, the top 2 of Division 2 go
-- up, Division 3 and below carry over with the same teams. Nothing is
-- deleted.
create or replace function public.apply_promotion_relegation(p_hub_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hub public.leagues;
  v_season public.leagues;
  v_next public.leagues;
  v_div1 public.leagues;
  v_div2 public.leagues;
  v_div public.leagues;
  v_new public.leagues;
  v_promoted uuid[];
  v_relegated uuid[];
  v_weeks integer;
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
begin
  if not public.is_captain_in_league_tree(p_hub_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_hub from public.leagues where id = p_hub_league_id for update;
  if v_hub.id is null or v_hub.stage <> 'divisions' then
    raise exception 'not_an_open_league_pyramid';
  end if;

  select * into v_season from public.leagues where id = public.league_current_season(p_hub_league_id);
  select * into v_div1 from public.leagues where parent_league_id = v_season.id and name = 'Division 1';
  select * into v_div2 from public.leagues where parent_league_id = v_season.id and name = 'Division 2';
  if v_season.id is null or v_div1.id is null or v_div2.id is null then
    raise exception 'divisions_not_found';
  end if;

  -- Bottom 2 of Division 1 go down.
  select array_agg(s.team_id) into v_relegated from (
    select x.team_id from public.league_standings(v_div1.id) x order by x.pos desc limit 2
  ) s;

  -- Top 2 of Division 2 go up.
  select array_agg(s.team_id) into v_promoted from (
    select x.team_id from public.league_standings(v_div2.id) x order by x.pos limit 2
  ) s;

  select count(*) into v_weeks from public.league_teams where league_id = v_div1.id;
  v_weeks := greatest(2 * (v_weeks - 1), 1);

  update public.leagues
  set champion_team_id = (select x.team_id from public.league_standings(v_div1.id) x where x.pos = 1),
      ended_at = now(), stage = 'finished'
  where id = v_season.id;

  insert into public.leagues (name, format, scope, stage, capacity, start_date, season_weeks, parent_league_id,
                              kind, season_number)
  values ('Season ' || (v_season.season_number + 1), v_hub.format, v_hub.scope, 'divisions', 0, v_today, v_weeks,
          v_hub.id, 'season', v_season.season_number + 1)
  returning * into v_next;

  for v_div in
    select * from public.leagues where parent_league_id = v_season.id and kind = 'division' order by name
  loop
    insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity, kind)
    values (v_div.name, v_hub.format, v_hub.scope, 'season', v_next.id, v_today,
            case when v_div.id in (v_div1.id, v_div2.id) then v_weeks else v_div.season_weeks end, 0, 'division')
    returning * into v_new;

    insert into public.league_teams
      (league_id, team_id, played, won, drawn, lost, goals_for, goals_against, pts_adjustment)
    select v_new.id, t.team_id, 0, 0, 0, 0, 0, 0, 0
    from (
      select lt.team_id from public.league_teams lt
      where lt.league_id = v_div.id
        and not (v_div.id = v_div1.id and lt.team_id = any (coalesce(v_relegated, '{}')))
        and not (v_div.id = v_div2.id and lt.team_id = any (coalesce(v_promoted, '{}')))
      union
      select u from unnest(case when v_div.id = v_div1.id then v_promoted
                                when v_div.id = v_div2.id then v_relegated end) u
    ) t;

    perform public.sync_league_fixtures(v_new.id);
  end loop;
end;
$$;

-- Was: a new division under the hub. Now under the current season; the
-- pool (the hub's rows) is moved into it, as before.
create or replace function public.form_new_division(p_hub_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hub public.leagues;
  v_season uuid;
  v_new_division public.leagues;
  v_division_number integer;
  v_weeks integer;
begin
  if not public.is_captain_in_league_tree(p_hub_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_hub from public.leagues where id = p_hub_league_id;
  if v_hub.id is null or v_hub.stage <> 'divisions' then
    raise exception 'not_open_for_new_division';
  end if;
  v_season := public.league_current_season(p_hub_league_id);
  if v_season is null then
    raise exception 'not_open_for_new_division';
  end if;

  select count(*) into v_division_number from public.leagues where parent_league_id = v_season and kind = 'division';
  v_division_number := v_division_number + 1;

  with pooled as (
    select lt.team_id, t.xp,
      -- Mirrors lib/premium.ts-style tier thresholds ported from the
      -- prototype's LEVEL_TIERS (Bronze 0 / Silver 100 / Gold 250 / Platinum 500).
      case
        when t.xp >= 500 then 3
        when t.xp >= 250 then 2
        when t.xp >= 100 then 1
        else 0
      end as tier_rank
    from public.league_teams lt
    join public.teams t on t.id = lt.team_id
    where lt.league_id = p_hub_league_id
    order by tier_rank desc, t.xp desc
    limit 10
  )
  select count(*) into v_weeks from pooled;

  if v_weeks = 0 then
    raise exception 'pool_empty';
  end if;
  if v_weeks < 4 then
    raise exception 'pool_too_small';
  end if;
  v_weeks := greatest(2 * (v_weeks - 1), 1);

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity, kind)
  values (
    'Division ' || v_division_number, v_hub.format, v_hub.scope, 'season',
    v_season, (now() at time zone 'Asia/Nicosia')::date, v_weeks, 0, 'division'
  )
  returning * into v_new_division;

  with pooled as (
    select lt.team_id, t.xp,
      case
        when t.xp >= 500 then 3
        when t.xp >= 250 then 2
        when t.xp >= 100 then 1
        else 0
      end as tier_rank
    from public.league_teams lt
    join public.teams t on t.id = lt.team_id
    where lt.league_id = p_hub_league_id
    order by tier_rank desc, t.xp desc
    limit 10
  )
  update public.league_teams
  set league_id = v_new_division.id
  where (league_id, team_id) in (select p_hub_league_id, team_id from pooled);

  perform public.sync_league_fixtures(v_new_division.id);
end;
$$;

-- ---- 6. Grants ---------------------------------------------------------------------------

revoke all on function public.league_hub(uuid) from public, anon, authenticated;
revoke all on function public.league_current_season(uuid) from public, anon, authenticated;
revoke all on function public.league_season_tables(uuid) from public, anon, authenticated;
revoke all on function public.league_fixture_results(uuid) from public, anon, authenticated;
revoke all on function public.league_standings(uuid) from public, anon, authenticated;
revoke all on function public.league_start_season(uuid) from public, anon, authenticated;
grant execute on function public.league_hub(uuid) to service_role;
grant execute on function public.league_current_season(uuid) to service_role;
grant execute on function public.league_season_tables(uuid) to service_role;
grant execute on function public.league_fixture_results(uuid) to service_role;
grant execute on function public.league_standings(uuid) to service_role;
grant execute on function public.league_start_season(uuid) to service_role;

-- The re-created functions keep their grants (create or replace keeps
-- them); stated again so this file reads on its own.
revoke all on function public.is_captain_in_league_tree(uuid) from public, anon;
revoke all on function public.register_team_for_league(uuid, uuid) from public, anon;
revoke all on function public.start_league_season(uuid) from public, anon;
revoke all on function public.end_season_to_divisions(uuid) from public, anon;
revoke all on function public.apply_promotion_relegation(uuid) from public, anon;
revoke all on function public.form_new_division(uuid) from public, anon;
