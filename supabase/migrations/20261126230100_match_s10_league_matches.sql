-- S10, part 2 of 3: league fixtures create matches (decided by Panos, 26
-- November; match-record.md decision 1n and 1m item 4).
--
-- 1. When a fixture gets its day and time, it gets exactly one match: kind
--    'named', side a = the home team, side b = the away team, each side's
--    captain = that team's captain, league_fixture_id set, booking_id null
--    (no booking is linked to a fixture yet), always Competitive. A match
--    with no booking lasts app_rules.league_match_minutes (60 by default,
--    spec 13's game length); a new value applies only to matches created
--    after it changes. The result deadline is the end + 24 hours, as for
--    every match.
-- 2. Each side's players are that team's members, synced until kickoff and
--    frozen after it (a player who leaves before kickoff leaves the match).
-- 3. The score comes from the match flow with the named-game rule (both
--    captains agree; Home → "Log the score"). When the match is final, at
--    the moment levels move (apply_match_levels sets levels_applied_at), its
--    score is copied to the fixture (side a = home) and the fixture is
--    completed, so the power ranking counts league and non-league games at
--    the same moment. A match forfeit becomes the fixture's forfeit. A
--    disputed or no-result match leaves the fixture open (the organiser
--    decides; flagged for Panos).
-- 4. League games are always Competitive: set_match_competitive refuses
--    Friendly on one (league_always_competitive).
-- 5. Rescheduled: the match follows (kickoff, end, deadline), keeping its
--    length; a match nobody has logged yet goes back to scheduled. Void or
--    forfeit on the fixture: the match is void, with no stats, ratings or
--    levels; a result that had already counted leaves the power ranking
--    (the fixture's change queues a replay, as in S14b).
-- 6. Fixtures made before this keep the old score_attempts path
--    (match_flow false); the old path refuses the others (use_match_flow).
--    No backfill (pre-launch test data).
--
-- Re-created from their latest definitions: set_match_competitive
-- (20261125140200_match_levels_ten.sql), submit_fixture_score,
-- fixtures_needing_resolution and resolve_stale_fixture
-- (20261108230317_baseline.sql).

-- ---- 1. Rules and columns ---------------------------------------------------------

alter table public.app_rules
  add column league_match_minutes integer not null default 60
    constraint app_rules_league_match_minutes check (league_match_minutes between 15 and 300);

alter table public.league_fixtures
  add column match_flow boolean not null default true;

-- Fixtures made before this keep the old path.
update public.league_fixtures set match_flow = false;

comment on column public.league_fixtures.match_flow is
  'S10: true when the fixture''s result comes from its match (Log the score); false for fixtures made before S10 (old score_attempts path).';

-- Exactly one match per fixture.
create unique index matches_league_fixture_key on public.matches (league_fixture_id)
  where league_fixture_id is not null;

-- ---- 2. Players ----------------------------------------------------------------------

-- A league match's sides follow the two teams until kickoff: captains,
-- labels and players (every member; a member of both teams plays for the
-- home side). Frozen from kickoff, or once the match isn't scheduled;
-- p_force fills a match made after its kickoff (a fixture agreed late).
create function public.league_match_sync_players(p_match_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_team_a uuid;
  v_team_b uuid;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.league_fixture_id is null
     or (not p_force and (v_match.status <> 'scheduled' or now() >= v_match.kickoff_at)) then
    return;
  end if;
  select team_id into v_team_a from public.match_sides where match_id = p_match_id and side = 'a';
  select team_id into v_team_b from public.match_sides where match_id = p_match_id and side = 'b';

  update public.match_sides ms
  set captain_profile_id = (select tm.profile_id from public.team_members tm
                            where tm.team_id = ms.team_id and tm.role = 'captain'
                            order by tm.joined_at, tm.id limit 1),
      label = coalesce((select t.name from public.teams t where t.id = ms.team_id), ms.label)
  where ms.match_id = p_match_id;

  insert into public.match_players (match_id, profile_id, side)
  select p_match_id, x.profile_id, x.side
  from (
    select distinct on (tm.profile_id) tm.profile_id,
           case when tm.team_id = v_team_a then 'a' else 'b' end as side
    from public.team_members tm
    where tm.team_id in (v_team_a, v_team_b) and tm.profile_id is not null
    order by tm.profile_id, (tm.team_id = v_team_a) desc
  ) x
  on conflict (match_id, profile_id) where profile_id is not null
  do update set side = excluded.side, left_at = null;

  update public.match_players mp
  set left_at = now()
  where mp.match_id = p_match_id
    and mp.profile_id is not null
    and mp.left_at is null
    and not exists (select 1 from public.team_members tm
                    where tm.team_id in (v_team_a, v_team_b) and tm.profile_id = mp.profile_id);
end;
$$;

-- ---- 3. Counters -----------------------------------------------------------------------

-- The old league_teams counters (P, W, D, L, GF, GA) from the computed
-- standings, for the screens that still read them. pts_adjustment stays.
-- Only for leagues whose results come from matches.
create function public.league_refresh_counters(p_league_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.league_teams lt
  set played = s.played, won = s.won, drawn = s.drawn, lost = s.lost,
      goals_for = s.goals_for, goals_against = s.goals_against
  from public.league_standings(p_league_id) s
  where lt.league_id = p_league_id and lt.team_id = s.team_id;
$$;

-- ---- 4. The fixture's match --------------------------------------------------------------

-- Creates, moves or voids a fixture's match (see the top of this file).
create function public.league_fixture_sync_match(p_fixture_id uuid)
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
    perform public.league_refresh_counters(v_fixture.league_id);
    return v_match.id;
  end if;

  if v_fixture.status = 'completed' then
    perform public.league_refresh_counters(v_fixture.league_id);
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

create function public.league_fixtures_sync_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.league_fixture_sync_match(new.id);
  return null;
end;
$$;

create trigger league_fixtures_sync_match
  after insert or update of scheduled_day, scheduled_time, venue_id, status, forfeit_result, home_team_id, away_team_id,
                            home_score, away_score
  on public.league_fixtures
  for each row execute function public.league_fixtures_sync_match();

-- A team's members change: its league matches before kickoff follow.
create function public.league_matches_on_team_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match uuid;
  v_old uuid;
  v_new uuid;
begin
  if tg_op <> 'INSERT' then
    v_old := old.team_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new := new.team_id;
  end if;
  for v_match in
    select distinct m.id
    from public.matches m
    join public.match_sides ms on ms.match_id = m.id
    where m.league_fixture_id is not null
      and m.status = 'scheduled'
      and now() < m.kickoff_at
      and ms.team_id in (v_old, v_new)
  loop
    perform public.league_match_sync_players(v_match);
  end loop;
  return null;
end;
$$;

create trigger team_members_league_matches
  after insert or delete or update of team_id, profile_id, role
  on public.team_members
  for each row execute function public.league_matches_on_team_member();

-- ---- 5. The final result ---------------------------------------------------------------

-- Copies a final league match to its fixture (see the top of this file).
create function public.league_fixture_finalize(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_fixture public.league_fixtures;
  v_home text;
  v_away text;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found or v_match.league_fixture_id is null or v_match.status <> 'confirmed' then
    return;
  end if;
  select * into v_fixture from public.league_fixtures where id = v_match.league_fixture_id for update;
  if not found or not v_fixture.match_flow or v_fixture.status = 'completed' or v_fixture.forfeit_result is not null then
    return;
  end if;

  if v_match.forfeit_side is not null then
    update public.league_fixtures
    set forfeit_result = case v_match.forfeit_side when 'a' then 'home_forfeited' else 'away_forfeited' end,
        status = 'completed', score_locked = true
    where id = v_fixture.id;
    perform public.apply_personal_match_stats(v_fixture.home_team_id,
              case v_match.forfeit_side when 'a' then 'lost' else 'won' end, 0);
    perform public.apply_personal_match_stats(v_fixture.away_team_id,
              case v_match.forfeit_side when 'b' then 'lost' else 'won' end, 0);
    return;
  end if;

  if v_match.side_a_score is null or v_match.side_b_score is null
     or v_match.score_check is not distinct from 'rejected' then
    return;
  end if;

  update public.league_fixtures
  set home_score = v_match.side_a_score, away_score = v_match.side_b_score, status = 'completed', score_locked = true
  where id = v_fixture.id;

  v_home := case sign(v_match.side_a_score - v_match.side_b_score) when 1 then 'won' when 0 then 'drawn' else 'lost' end;
  v_away := case v_home when 'won' then 'lost' when 'lost' then 'won' else 'drawn' end;
  perform public.apply_personal_match_stats(v_fixture.home_team_id, v_home, v_match.side_a_score);
  perform public.apply_personal_match_stats(v_fixture.away_team_id, v_away, v_match.side_b_score);
end;
$$;

create function public.matches_league_fixture_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.league_fixture_finalize(new.id);
  return null;
end;
$$;

-- apply_match_levels (match_levels_tick, before power_ranking_tick in
-- match_jobs_tick) marks the moment a match is final.
create trigger matches_league_fixture_final
  after update of levels_applied_at on public.matches
  for each row
  when (new.league_fixture_id is not null and old.levels_applied_at is null and new.levels_applied_at is not null)
  execute function public.matches_league_fixture_final();

-- ---- 6. Re-created functions -----------------------------------------------------------

-- Change: a league match is always Competitive (league_always_competitive).
create or replace function public.set_match_competitive(p_match_id uuid, p_competitive boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if public.match_captain_side(p_match_id, auth.uid()) is null then
    raise exception 'not_captain';
  end if;
  if p_competitive is null then
    raise exception 'invalid_answer';
  end if;
  if v_match.league_fixture_id is not null and not p_competitive then
    raise exception 'league_always_competitive';
  end if;
  if v_match.status <> 'scheduled' or now() >= v_match.kickoff_at then
    raise exception 'competitive_locked';
  end if;
  update public.matches set competitive = p_competitive where id = p_match_id;
end;
$$;

-- Change: a fixture whose result comes from its match is refused
-- (use_match_flow): its captains log the score on Home → "Log the score".
create or replace function public.submit_fixture_score(p_fixture_id uuid, p_home_score integer, p_away_score integer)
returns public.league_fixtures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_my_team uuid;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null then
    raise exception 'fixture_not_found';
  end if;
  if v_fixture.match_flow then
    raise exception 'use_match_flow';
  end if;
  if v_fixture.status = 'completed' then
    raise exception 'already_completed';
  end if;
  if v_fixture.score_locked then
    raise exception 'score_locked';
  end if;
  if v_fixture.status <> 'agreed' then
    raise exception 'schedule_not_agreed';
  end if;

  v_my_team := public.captain_team_for_fixture(v_fixture);
  if v_my_team is null then
    raise exception 'not_captain';
  end if;

  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or now() < ((v_fixture.scheduled_day + v_fixture.scheduled_time) at time zone 'Asia/Nicosia') + interval '2 hours' then
    raise exception 'too_early';
  end if;

  insert into public.fixture_score_submissions (fixture_id, submitted_by_team_id, home_score, away_score)
  values (p_fixture_id, v_my_team, p_home_score, p_away_score);

  update public.league_fixtures
  set score_attempts = score_attempts + 1
  where id = p_fixture_id;

  return public.check_fixture_score_match(p_fixture_id);
end;
$$;

-- Change: only old-path fixtures (match_flow false); a match decides the
-- others.
create or replace function public.fixtures_needing_resolution()
returns table (fixture_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id
  from public.league_fixtures f
  where f.status = 'agreed'
    and not f.match_flow
    and not f.score_locked
    and f.scheduled_day is not null
    and f.scheduled_time is not null
    and now() > ((f.scheduled_day + f.scheduled_time) at time zone 'Asia/Nicosia') + interval '24 hours';
$$;

-- Change: leaves fixtures whose result comes from a match alone.
create or replace function public.resolve_stale_fixture(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.league_fixtures;
  v_home_submitted boolean;
  v_away_submitted boolean;
begin
  select * into v_fixture from public.league_fixtures where id = p_fixture_id for update;
  if v_fixture.id is null or v_fixture.status <> 'agreed' or v_fixture.score_locked or v_fixture.match_flow then
    return;
  end if;

  if v_fixture.scheduled_day is null or v_fixture.scheduled_time is null
     or now() <= ((v_fixture.scheduled_day + v_fixture.scheduled_time) at time zone 'Asia/Nicosia') + interval '24 hours' then
    return;
  end if;

  select exists (
    select 1 from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.home_team_id
  ) into v_home_submitted;

  select exists (
    select 1 from public.fixture_score_submissions
    where fixture_id = p_fixture_id and submitted_by_team_id = v_fixture.away_team_id
  ) into v_away_submitted;

  update public.league_fixtures set score_locked = true where id = p_fixture_id;

  if v_home_submitted and not v_away_submitted then
    update public.league_fixtures set forfeit_result = 'away_forfeited' where id = p_fixture_id;
    perform public.apply_fixture_forfeit_stats(
      v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'away_forfeited'
    );
  elsif v_away_submitted and not v_home_submitted then
    update public.league_fixtures set forfeit_result = 'home_forfeited' where id = p_fixture_id;
    perform public.apply_fixture_forfeit_stats(
      v_fixture.league_id, v_fixture.home_team_id, v_fixture.away_team_id, 'home_forfeited'
    );
  else
    update public.league_fixtures set forfeit_result = 'void' where id = p_fixture_id;
  end if;
end;
$$;

-- ---- 7. Grants -------------------------------------------------------------------------

revoke all on function public.league_match_sync_players(uuid, boolean) from public, anon, authenticated;
revoke all on function public.league_refresh_counters(uuid) from public, anon, authenticated;
revoke all on function public.league_fixture_sync_match(uuid) from public, anon, authenticated;
revoke all on function public.league_fixtures_sync_match() from public, anon, authenticated;
revoke all on function public.league_matches_on_team_member() from public, anon, authenticated;
revoke all on function public.league_fixture_finalize(uuid) from public, anon, authenticated;
revoke all on function public.matches_league_fixture_final() from public, anon, authenticated;
grant execute on function public.league_match_sync_players(uuid, boolean) to service_role;
grant execute on function public.league_refresh_counters(uuid) to service_role;
grant execute on function public.league_fixture_sync_match(uuid) to service_role;
grant execute on function public.league_fixture_finalize(uuid) to service_role;

revoke all on function public.set_match_competitive(uuid, boolean) from public, anon;
grant execute on function public.set_match_competitive(uuid, boolean) to authenticated, service_role;
revoke all on function public.submit_fixture_score(uuid, integer, integer) from public, anon;
grant execute on function public.submit_fixture_score(uuid, integer, integer) to authenticated, service_role;
revoke all on function public.fixtures_needing_resolution() from public, anon, authenticated;
grant execute on function public.fixtures_needing_resolution() to service_role;
revoke all on function public.resolve_stale_fixture(uuid) from public, anon, authenticated;
grant execute on function public.resolve_stale_fixture(uuid) to service_role;
