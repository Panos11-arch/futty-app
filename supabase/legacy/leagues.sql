-- Leagues: standard (uncapped, always open) and Open Leagues (capacity-limited
-- signup -> season -> divisions -> promotion/relegation pyramid), reusing the
-- same `leagues`/`league_teams` tables for both — distinguished by
-- `capacity` (0 = standard/uncapped; leagues.capacity is NOT NULL in the
-- table you built, so 0 is the sentinel rather than null) and `stage`.
--
-- Run AFTER supabase/legacy/teams.sql. Run in the Supabase dashboard: SQL Editor >
-- New query > Run. Safe to re-run.
--
-- Also run supabase/legacy/league-fixtures.sql (after this file) — several
-- functions here call public.sync_league_fixtures(), defined there, to keep
-- each league's round-robin fixture list in sync whenever its team list
-- changes.
--
-- Season progression (start season / split into divisions / promote-relegate /
-- form a new division) is manual, triggered by any captain with a team in the
-- league — there is no scheduled job deciding when a season "really" starts.
-- The app labels these actions "demo" for the same reason Premium's toggle is
-- labeled a demo: no real automation sits behind them yet.
--
-- KNOWN LIMITATION: divisions beyond the first two are matched by exact name
-- ("Division 1", "Division 2", ...), which only sorts correctly up to 9
-- divisions. Fine at the DIVISION_CAP=10-teams-per-division scale this targets;
-- would need a real ordinal column if the pyramid grows past that.

alter table public.leagues add column if not exists parent_league_id uuid references public.leagues (id);

alter table public.leagues enable row level security;
alter table public.league_teams enable row level security;

drop policy if exists "Authenticated users can read leagues" on public.leagues;
create policy "Authenticated users can read leagues"
  on public.leagues for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read league teams" on public.league_teams;
create policy "Authenticated users can read league teams"
  on public.league_teams for select
  to authenticated
  using (true);

-- No direct write policies on either table — capacity checks and stage
-- transitions all need to happen atomically, so every write goes through one
-- of the functions below.

create unique index if not exists league_teams_unique_membership
  on public.league_teams (league_id, team_id);

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

  -- Team Premium (supabase/legacy/team-premium.sql) gates 9-a-side/11-a-side only,
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

  -- Item 4 (payment-auth batch) — an Open League filling up used to require
  -- a manual "Start season" trigger with no real production equivalent, so a
  -- full league could sit in 'signup' forever. Standard leagues (capacity =
  -- 0) are excluded — they have no fixed roster of teams to close signup on.
  if v_league.stage = 'signup' and v_league.capacity > 0 then
    select count(*) into v_count from public.league_teams where league_id = p_league_id;
    if v_count >= v_league.capacity then
      update public.leagues
      set stage = 'season', start_date = coalesce(start_date, current_date)
      where id = p_league_id;
    end if;
  end if;

  -- supabase/legacy/league-fixtures.sql — fills in this team's pairing against
  -- every other team already in the league. Must run after leagues.sql for
  -- this call to succeed at invocation time (fine either way at CREATE time),
  -- and after the stage flip above so a capacity-filling registration
  -- generates the whole round-robin the moment the season actually starts.
  perform public.sync_league_fixtures(p_league_id);

  return v_row;
end;
$$;

grant execute on function public.register_team_for_league(uuid, uuid) to authenticated;

-- True for any captain with a team currently in this league or one of its
-- child divisions — the "some involved captain decided to progress things"
-- permission model these demo actions use.
create or replace function public.is_captain_in_league_tree(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id
    where tm.profile_id = auth.uid()
      and tm.role = 'captain'
      and (
        lt.league_id = p_league_id
        or lt.league_id in (select id from public.leagues where parent_league_id = p_league_id)
      )
  );
$$;

create or replace function public.start_league_season(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_captain_in_league_tree(p_league_id) then
    raise exception 'not_a_participant';
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

grant execute on function public.start_league_season(uuid) to authenticated;

create or replace function public.end_season_to_divisions(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_div1 public.leagues;
  v_div2 public.leagues;
  v_weeks integer;
begin
  if not public.is_captain_in_league_tree(p_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if v_league.id is null then
    raise exception 'league_not_found';
  end if;
  if v_league.capacity = 0 then
    raise exception 'not_an_open_league';
  end if;
  if v_league.stage <> 'season' then
    raise exception 'not_in_season';
  end if;

  with ranked as (
    select team_id,
      row_number() over (
        order by won * 3 + drawn + coalesce(pts_adjustment, 0) desc,
                 goals_for - goals_against desc
      ) as rank
    from public.league_teams
    where league_id = p_league_id
  )
  select count(*) into v_weeks from ranked where rank <= 10;
  v_weeks := greatest(2 * (v_weeks - 1), 1);

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity)
  values ('Division 1', v_league.format, v_league.scope, 'season', v_league.id, current_date, v_weeks, 0)
  returning * into v_div1;

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity)
  values ('Division 2', v_league.format, v_league.scope, 'season', v_league.id, current_date, v_weeks, 0)
  returning * into v_div2;

  with ranked as (
    select team_id,
      row_number() over (
        order by won * 3 + drawn + coalesce(pts_adjustment, 0) desc,
                 goals_for - goals_against desc
      ) as rank
    from public.league_teams
    where league_id = p_league_id
  )
  insert into public.league_teams
    (league_id, team_id, played, won, drawn, lost, goals_for, goals_against, pts_adjustment)
  select case when rank <= 10 then v_div1.id else v_div2.id end, team_id, 0, 0, 0, 0, 0, 0, 0
  from ranked
  where rank <= 20;

  delete from public.league_teams where league_id = p_league_id;

  update public.leagues set stage = 'divisions' where id = p_league_id;

  perform public.sync_league_fixtures(v_div1.id);
  perform public.sync_league_fixtures(v_div2.id);
end;
$$;

grant execute on function public.end_season_to_divisions(uuid) to authenticated;

create or replace function public.form_new_division(p_hub_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hub public.leagues;
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

  select count(*) into v_division_number from public.leagues where parent_league_id = p_hub_league_id;
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

  insert into public.leagues (name, format, scope, stage, parent_league_id, start_date, season_weeks, capacity)
  values (
    'Division ' || v_division_number, v_hub.format, v_hub.scope, 'season',
    v_hub.id, current_date, v_weeks, 0
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

grant execute on function public.form_new_division(uuid) to authenticated;

create or replace function public.apply_promotion_relegation(p_hub_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hub public.leagues;
  v_div1 public.leagues;
  v_div2 public.leagues;
  v_promoted uuid[];
  v_relegated uuid[];
  v_weeks integer;
begin
  if not public.is_captain_in_league_tree(p_hub_league_id) then
    raise exception 'not_a_participant';
  end if;

  select * into v_hub from public.leagues where id = p_hub_league_id;
  if v_hub.id is null or v_hub.stage <> 'divisions' then
    raise exception 'not_an_open_league_pyramid';
  end if;

  select * into v_div1 from public.leagues where parent_league_id = p_hub_league_id and name = 'Division 1';
  select * into v_div2 from public.leagues where parent_league_id = p_hub_league_id and name = 'Division 2';
  if v_div1.id is null or v_div2.id is null then
    raise exception 'divisions_not_found';
  end if;

  -- Bottom 2 of Division 1 go down.
  select array_agg(team_id) into v_relegated from (
    select team_id from public.league_teams where league_id = v_div1.id
    order by won * 3 + drawn + coalesce(pts_adjustment, 0) asc, goals_for - goals_against asc
    limit 2
  ) t;

  -- Top 2 of Division 2 go up.
  select array_agg(team_id) into v_promoted from (
    select team_id from public.league_teams where league_id = v_div2.id
    order by won * 3 + drawn + coalesce(pts_adjustment, 0) desc, goals_for - goals_against desc
    limit 2
  ) t;

  -- Division 3+ (if any) are left completely untouched, matching the
  -- prototype: only the top two divisions cycle each promotion round.

  select count(*) into v_weeks from public.league_teams where league_id = v_div1.id;
  v_weeks := greatest(2 * (v_weeks - 1), 1);

  -- Move the swapped teams, then reset every Division 1/2 team's season stats
  -- — matches the prototype resetting p/w/d/l/gf/ga to 0 for the new season.
  update public.league_teams
  set league_id = v_div1.id
  where league_id = v_div2.id and team_id = any (v_promoted);

  update public.league_teams
  set league_id = v_div2.id
  where league_id = v_div1.id and team_id = any (v_relegated);

  update public.league_teams
  set played = 0, won = 0, drawn = 0, lost = 0,
      goals_for = 0, goals_against = 0, pts_adjustment = 0
  where league_id in (v_div1.id, v_div2.id);

  update public.leagues
  set start_date = current_date, season_weeks = v_weeks
  where id in (v_div1.id, v_div2.id);

  -- Fresh season, fresh fixture list — last season's pairings no longer
  -- match who's actually in each division after the swap above.
  delete from public.league_fixtures where league_id in (v_div1.id, v_div2.id);
  perform public.sync_league_fixtures(v_div1.id);
  perform public.sync_league_fixtures(v_div2.id);
end;
$$;

grant execute on function public.apply_promotion_relegation(uuid) to authenticated;
