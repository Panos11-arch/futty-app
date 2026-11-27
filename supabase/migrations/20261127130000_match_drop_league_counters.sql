-- Drops the old league_teams counters (played, won, drawn, lost, goals_for,
-- goals_against). S10 follow-up, OK'd by Panos on 27 November.
--
-- Standings are computed from fixtures (league_standings, S10), and the
-- competition page reads them. The counters were derived copies kept in step
-- by league_refresh_counters and the old +1 updates, so nothing is lost.
-- pts_adjustment stays: league_standings adds it to points, and
-- check_fixture_score_match still takes 6 points on a team's third dispute.
--
-- Re-created from their newest definitions (every migration searched), with
-- only the counter lines removed:
--   check_fixture_score_match    20261108230317_baseline.sql (no later definition)
--   resolve_unscheduled_fixture  20261108230317_baseline.sql (no later definition)
--   apply_fixture_forfeit_stats  20261108230317_baseline.sql (no later definition)
--   league_fixture_sync_match    20261126230100_match_s10_league_matches.sql
--   register_team_for_league     20261126230000_match_s10_league_seasons.sql
--   end_season_to_divisions      20261126230000_match_s10_league_seasons.sql
--   apply_promotion_relegation   20261126230000_match_s10_league_seasons.sql
-- Dropped: league_refresh_counters (20261126230100_match_s10_league_matches.sql).

-- ---- 1. Old score path ------------------------------------------------------------

-- Change: no longer updates the league_teams counters.
create or replace function public.apply_fixture_forfeit_stats(p_league_id uuid, p_home_team_id uuid,
                                                              p_away_team_id uuid, p_result text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home_result text;
  v_away_result text;
begin
  if p_result = 'home_forfeited' then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'won'; v_away_result := 'lost';
  end if;

  perform public.apply_personal_match_stats(p_home_team_id, v_home_result, 0);
  perform public.apply_personal_match_stats(p_away_team_id, v_away_result, 0);
end;
$$;

-- Change: no longer updates the league_teams counters.
create or replace function public.check_fixture_score_match(p_fixture_id uuid)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_home_changed boolean;
  v_away_changed boolean;
  v_home_last public.fixture_score_submissions;
  v_away_last public.fixture_score_submissions;
  v_home_result text;
  v_away_result text;
  v_home_dispute_count integer;
  v_away_dispute_count integer;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  select * into v_home_last from public.fixture_score_submissions
  where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id
  order by submitted_at desc limit 1;

  select * into v_away_last from public.fixture_score_submissions
  where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id
  order by submitted_at desc limit 1;

  if v_home_last.id is not null and v_away_last.id is not null
     and v_home_last.home_score = v_away_last.home_score
     and v_home_last.away_score = v_away_last.away_score then

    if v_home_last.home_score > v_home_last.away_score then
      v_home_result := 'won'; v_away_result := 'lost';
    elsif v_home_last.away_score > v_home_last.home_score then
      v_home_result := 'lost'; v_away_result := 'won';
    else
      v_home_result := 'drawn'; v_away_result := 'drawn';
    end if;

    update public.league_fixtures set status = 'completed' where id = p_fixture_id;

    perform public.apply_personal_match_stats(v_fixture.home_team_id, v_home_result, v_home_last.home_score);
    perform public.apply_personal_match_stats(v_fixture.away_team_id, v_away_result, v_home_last.away_score);

  elsif v_fixture.score_attempts >= 3 then
    update public.league_fixtures set score_locked = true where id = p_fixture_id;

    select count(distinct (home_score, away_score)) > 1 into v_home_changed
    from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id;

    select count(distinct (home_score, away_score)) > 1 into v_away_changed
    from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id;

    if v_home_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1
      where id = v_fixture.home_team_id
      returning dispute_count into v_home_dispute_count;

      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.home_team_id and role = 'captain'
      );

      if v_home_dispute_count > 2 then
        update public.league_teams set pts_adjustment = pts_adjustment - 6
        where league_id = v_fixture.league_id and team_id = v_fixture.home_team_id;
      end if;
    end if;
    if v_away_changed then
      update public.teams set xp = xp - 20, dispute_count = dispute_count + 1
      where id = v_fixture.away_team_id
      returning dispute_count into v_away_dispute_count;

      update public.profiles set xp = xp - 20
      where id in (
        select profile_id from public.team_members
        where team_id = v_fixture.away_team_id and role = 'captain'
      );

      if v_away_dispute_count > 2 then
        update public.league_teams set pts_adjustment = pts_adjustment - 6
        where league_id = v_fixture.league_id and team_id = v_fixture.away_team_id;
      end if;
    end if;

    if v_home_changed and not v_away_changed then
      update public.league_fixtures set forfeit_result = 'home_forfeited' where id = p_fixture_id;
      perform public.apply_fixture_forfeit_stats(
        v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'home_forfeited'
      );
    elsif v_away_changed and not v_home_changed then
      update public.league_fixtures set forfeit_result = 'away_forfeited' where id = p_fixture_id;
      perform public.apply_fixture_forfeit_stats(
        v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'away_forfeited'
      );
    else
      update public.league_fixtures set forfeit_result = 'void' where id = p_fixture_id;
    end if;
  end if;

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;

-- Change: no longer updates the league_teams counters.
create or replace function public.resolve_unscheduled_fixture(p_fixture_id uuid)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_home_proposed boolean;
  v_away_proposed boolean;
  v_home_result text;
  v_away_result text;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;

  if public.captain_team_for_fixture(v_fixture) is null then
    raise exception 'not_captain';
  end if;

  if v_fixture.status in ('agreed', 'completed') then
    raise exception 'already_scheduled';
  end if;

  if now() < v_fixture.created_at + interval '7 days' then
    raise exception 'window_not_elapsed';
  end if;

  select exists (
    select 1 from public.fixture_schedule_proposals
    where fixture_id = p_fixture_id and proposed_by_team_id = v_fixture.home_team_id
  ) into v_home_proposed;

  select exists (
    select 1 from public.fixture_schedule_proposals
    where fixture_id = p_fixture_id and proposed_by_team_id = v_fixture.away_team_id
  ) into v_away_proposed;

  if v_home_proposed and not v_away_proposed then
    v_home_result := 'won'; v_away_result := 'lost';
  elsif v_away_proposed and not v_home_proposed then
    v_home_result := 'lost'; v_away_result := 'won';
  else
    v_home_result := 'drawn'; v_away_result := 'drawn';
  end if;

  update public.league_fixtures set status = 'completed' where id = p_fixture_id;

  perform public.apply_personal_match_stats(v_fixture.home_team_id, v_home_result, 0);
  perform public.apply_personal_match_stats(v_fixture.away_team_id, v_away_result, 0);

  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  return v_fixture;
end;
$$;

-- ---- 2. League matches ---------------------------------------------------------------

-- Change: no longer refreshes the counters (league_refresh_counters is gone).
create or replace function public.league_fixture_sync_match(p_fixture_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_league public.leagues;
  v_match public.matches;
  v_kickoff timestamptz;
  v_length interval;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id;
  if not found or not v_fixture.match_flow then
    return null;
  end if;
  select * into v_match from public.matches where league_fixture_id = p_fixture_id for update;

  -- Void or forfeit: no stats, ratings or levels; the table follows.
  if v_fixture.forfeit_result is not null then
    if v_match.id is not null and v_match.status <> 'void' then
      update public.matches set status = 'void' where id = v_match.id;
    end if;
    return v_match.id;
  end if;

  if v_fixture.status = 'completed' then
    return v_match.id;
  end if;

  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or v_fixture.home_team_id is null or v_fixture.away_team_id is null then
    return v_match.id;
  end if;
  v_kickoff := (v_fixture.scheduled_day + v_fixture.scheduled_time) at time zone 'Asia/Nicosia';

  if v_match.id is null then
    select * into v_league from public.leagues where id = v_fixture.league_id;
    v_length := make_interval(mins => (public.app_rules_now()).league_match_minutes);
    insert into public.matches (venue_id, league_fixture_id, kind, format, players_per_side,
                                kickoff_at, ends_at, result_deadline_at, competitive)
    values (v_fixture.venue_id, p_fixture_id, 'named', v_league.format,
            greatest(coalesce(nullif(split_part(v_league.format, '-', 1), '')::integer, 5), 1),
            v_kickoff, v_kickoff + v_length, v_kickoff + v_length + interval '24 hours', true)
    returning * into v_match;

    insert into public.match_sides (match_id, side, team_id, label, captain_profile_id)
    select v_match.id, s.side, s.team_id, coalesce(t.name, case s.side when 'a' then 'Home' else 'Away' end),
           (select tm.profile_id from public.team_members tm
            where tm.team_id = s.team_id and tm.role = 'captain'
            order by tm.joined_at, tm.id limit 1)
    from (values ('a', v_fixture.home_team_id), ('b', v_fixture.away_team_id)) s(side, team_id)
    left join public.teams t on t.id = s.team_id;

    insert into public.match_check_in_codes (match_id, code)
    values (v_match.id, encode(extensions.gen_random_bytes(16), 'hex'));
    perform public.league_match_sync_players(v_match.id, true);
    return v_match.id;
  elsif v_match.kickoff_at is distinct from v_kickoff or v_match.venue_id is distinct from v_fixture.venue_id then
    -- Rescheduled: the match keeps its length. One nobody has logged goes
    -- back to scheduled (it may have passed its old deadline unplayed).
    if v_match.status = 'scheduled'
       or (v_match.status in ('played', 'no_result')
           and not exists (select 1 from public.match_score_entries e where e.match_id = v_match.id)) then
      v_length := v_match.ends_at - v_match.kickoff_at;
      update public.matches
      set kickoff_at = v_kickoff, ends_at = v_kickoff + v_length,
          result_deadline_at = v_kickoff + v_length + interval '24 hours',
          venue_id = v_fixture.venue_id, status = 'scheduled', levels_applied_at = null,
          ratings_final_at = null
      where id = v_match.id;
    end if;
  end if;

  perform public.league_match_sync_players(v_match.id);
  return v_match.id;
end;
$$;

-- ---- 3. Seasons ------------------------------------------------------------------------

-- Change: the new row names only pts_adjustment (the counters are gone).
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
    insert into public.league_teams (league_id, team_id, pts_adjustment)
    values (p_league_id, p_team_id, 0)
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

-- Change: the new rows name only pts_adjustment (the counters are gone).
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

  insert into public.league_teams (league_id, team_id, pts_adjustment)
  select case when r.pos <= 10 then v_div1.id else v_div2.id end, r.team_id, 0
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

-- Change: the new rows name only pts_adjustment (the counters are gone).
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

    insert into public.league_teams (league_id, team_id, pts_adjustment)
    select v_new.id, t.team_id, 0
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

-- ---- 4. Drop -----------------------------------------------------------------------------

drop function public.league_refresh_counters(uuid);

alter table public.league_teams
  drop column played,
  drop column won,
  drop column drawn,
  drop column lost,
  drop column goals_for,
  drop column goals_against;

-- ---- 5. Grants ---------------------------------------------------------------------------

-- create or replace keeps grants; stated again so this file reads on its own.
revoke all on function public.apply_fixture_forfeit_stats(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_fixture_forfeit_stats(uuid, uuid, uuid, text) to service_role;
revoke all on function public.check_fixture_score_match(uuid) from public, anon, authenticated;
grant execute on function public.check_fixture_score_match(uuid) to service_role;
revoke all on function public.resolve_unscheduled_fixture(uuid) from public, anon;
grant execute on function public.resolve_unscheduled_fixture(uuid) to authenticated, service_role;
revoke all on function public.league_fixture_sync_match(uuid) from public, anon, authenticated;
grant execute on function public.league_fixture_sync_match(uuid) to service_role;
revoke all on function public.register_team_for_league(uuid, uuid) from public, anon;
grant execute on function public.register_team_for_league(uuid, uuid) to authenticated, service_role;
revoke all on function public.end_season_to_divisions(uuid) from public, anon;
grant execute on function public.end_season_to_divisions(uuid) to authenticated, service_role;
revoke all on function public.apply_promotion_relegation(uuid) from public, anon;
grant execute on function public.apply_promotion_relegation(uuid) to authenticated, service_role;
