-- S10A, part 2 of 4: running a tournament (match-record.md decision 1o).
--
-- Admins (is_app_admin, part 1) create a tournament, open registration,
-- set or draw the groups, set kick-off times, enter or correct results,
-- enter the organiser's draw, change a squad after the deadline and close
-- it. Captains register their team with a squad and change the squad until
-- the registration deadline.
--
-- The Nuevo Campo structure, the only one built: 16 teams, 4 groups of 4
-- (A–D); each team plays the other three once; 3 points a win, 1 a draw.
-- Group ties: points, goal difference, goals scored, head-to-head points
-- between the teams still level, then the organiser's draw (draw_rank).
-- The top 2 of each group go through to FIXED quarter-finals (never
-- random): QF1 = A1 v D2, QF2 = A2 v B1, QF3 = B2 v C1, QF4 = C2 v D1.
-- Semi-finals (changed by Anghelo and Panos, 24 November, so a group's two
-- teams can only meet in the final): SF1 = winner QF1 v winner QF3, SF2 =
-- winner QF2 v winner QF4. Then the final. A drawn knockout match goes to a
-- penalty shootout (3 each, then sudden death), entered with the score.
--
-- Matches: a fixture with a kick-off time and both teams gets one named
-- match (no booking: Futty books the pitches by phone): side a = home,
-- side b = away, each team's captain, always Competitive, the tournament's
-- match_minutes long, the result deadline its end + 24 hours. Its players
-- are the two squads (not every member), kept in step until kickoff. Each
-- captain logs the score, his side's scorers and assisters (S13B), plus
-- the shootout in a drawn knockout game; both must match on the score and
-- the shootout. A mismatch the captains can't settle (disputed), or no
-- result, leaves the fixture open for the organiser (admin_set_result).
-- When the match is final (levels_applied_at, as for league fixtures) its
-- result completes the fixture, and the next round fills.
--
-- A correction that would change a team already in a next-round match that
-- has a result, or a score logged, is refused (next_round_played).
--
-- Re-created from their latest definitions (diffs in the PR):
--   log_match_result     20261125140100_match_s13b_logging.sql; its
--                        argument list changes, so the old signature is
--                        dropped first (no overload) and its grants
--                        re-applied
--   match_confirm_result 20261125140100_match_s13b_logging.sql
--   set_match_competitive 20261126230100_match_s10_league_matches.sql
--   match_jobs_tick      20261126090053_match_power_ranking.sql

-- ---- 1. Helpers -------------------------------------------------------------------------

-- Starters per side in a format ('5-a-side' → 5).
create function public.tournament_starters(p_format text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select split_part(p_format, '-', 1)::integer;
$$;

-- A team's captain (the first by joining).
create function public.tournament_team_captain(p_team_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id from public.team_members tm
  where tm.team_id = p_team_id and tm.role = 'captain'
  order by tm.joined_at, tm.id limit 1;
$$;

-- The fixed knockout: each slot and where its teams come from.
create function public.tournament_bracket()
returns table (slot text, stage text, ord integer, home_source text, away_source text)
language sql
immutable
set search_path = ''
as $$
  values ('QF1', 'qf', 1, 'A1', 'D2'),
         ('QF2', 'qf', 2, 'A2', 'B1'),
         ('QF3', 'qf', 3, 'B2', 'C1'),
         ('QF4', 'qf', 4, 'C2', 'D1'),
         ('SF1', 'sf', 5, 'Winner QF1', 'Winner QF3'),
         ('SF2', 'sf', 6, 'Winner QF2', 'Winner QF4'),
         ('F', 'final', 7, 'Winner SF1', 'Winner SF2');
$$;

-- A shootout that can happen: 3 each, then sudden death. Someone wins; a
-- side above 3 means sudden death, which ends one apart.
create function public.tournament_valid_shootout(p_a integer, p_b integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_a is not null and p_b is not null and p_a >= 0 and p_b >= 0 and p_a <> p_b
         and (greatest(p_a, p_b) <= 3 or abs(p_a - p_b) = 1);
$$;

-- Checks a score and its shootout for a fixture's stage; raises
-- invalid_score, invalid_shootout, shootout_not_allowed or shootout_required.
create function public.tournament_check_result(p_knockout boolean, p_a integer, p_b integer, p_pa integer, p_pb integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_a is null or p_b is null or p_a < 0 or p_b < 0 then
    raise exception 'invalid_score';
  end if;
  if (p_pa is null) <> (p_pb is null) then
    raise exception 'invalid_shootout';
  end if;
  if p_pa is not null then
    if not p_knockout or p_a <> p_b then
      raise exception 'shootout_not_allowed';
    end if;
    if not public.tournament_valid_shootout(p_pa, p_pb) then
      raise exception 'invalid_shootout';
    end if;
  elsif p_knockout and p_a = p_b then
    raise exception 'shootout_required';
  end if;
end;
$$;

-- A completed fixture's winner (on penalties when level), else null.
create function public.tournament_winner(p_fixture_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when f.status <> 'completed' then null
              when f.home_score > f.away_score then f.home_team_id
              when f.away_score > f.home_score then f.away_team_id
              when f.home_pens > f.away_pens then f.home_team_id
              when f.away_pens > f.home_pens then f.away_team_id
         end
  from public.tournament_fixtures f where f.id = p_fixture_id;
$$;

-- ---- 2. Group tables --------------------------------------------------------------------

-- Group p_group's table: 3 points a win, 1 a draw; ordered by points, goal
-- difference, goals scored, head-to-head points between the teams still
-- level (on points, goal difference and goals scored), then the
-- organiser's draw. needs_draw: the team is in a tie for 1st or 2nd that
-- only the draw can break and the draw isn't entered.
create function public.tournament_group_standings(p_tournament_id uuid, p_group text)
returns table (
  pos integer,
  team_id uuid,
  team_name text,
  kit_colour text,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  goals_for integer,
  goals_against integer,
  goal_diff integer,
  points integer,
  h2h_points integer,
  draw_rank integer,
  needs_draw boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select tt.team_id, t.name, tt.kit_colour, tt.draw_rank, tt.group_pos
    from public.tournament_teams tt
    join public.teams t on t.id = tt.team_id
    where tt.tournament_id = p_tournament_id and tt.group_letter = p_group
  ), results as (
    select f.home_team_id as team_id, f.away_team_id as opp, f.home_score as gf, f.away_score as ga
    from public.tournament_fixtures f
    where f.tournament_id = p_tournament_id and f.stage = 'group' and f.group_letter = p_group and f.status = 'completed'
    union all
    select f.away_team_id, f.home_team_id, f.away_score, f.home_score
    from public.tournament_fixtures f
    where f.tournament_id = p_tournament_id and f.stage = 'group' and f.group_letter = p_group and f.status = 'completed'
  ), agg as (
    select m.team_id, m.name, m.kit_colour, m.draw_rank, m.group_pos,
           count(r.team_id)::integer as played,
           (count(*) filter (where r.gf > r.ga))::integer as won,
           (count(*) filter (where r.gf = r.ga))::integer as drawn,
           (count(*) filter (where r.gf < r.ga))::integer as lost,
           coalesce(sum(r.gf), 0)::integer as gf,
           coalesce(sum(r.ga), 0)::integer as ga
    from members m
    left join results r on r.team_id = m.team_id
    group by m.team_id, m.name, m.kit_colour, m.draw_rank, m.group_pos
  ), pts as (
    select a.*, a.gf - a.ga as gd, 3 * a.won + a.drawn as points from agg a
  ), h2h as (
    select p.team_id,
           coalesce(sum(case when r.gf > r.ga then 3 when r.gf = r.ga then 1 else 0 end), 0)::integer as h2h
    from pts p
    left join results r on r.team_id = p.team_id
      and r.opp in (select q.team_id from pts q
                    where q.team_id <> p.team_id and (q.points, q.gd, q.gf) = (p.points, p.gd, p.gf))
    group by p.team_id
  ), keyed as (
    select p.*, h.h2h,
           rank() over (order by p.points desc, p.gd desc, p.gf desc, h.h2h desc)::integer as tie_rank
    from pts p join h2h h on h.team_id = p.team_id
  ), ties as (
    select k.points, k.gd, k.gf, k.h2h, count(*) as size, min(k.tie_rank) as tie_rank,
           count(k.draw_rank) = count(*) and count(distinct k.draw_rank) = count(*) as drawn_order
    from keyed k
    group by k.points, k.gd, k.gf, k.h2h
  )
  select (row_number() over (order by k.points desc, k.gd desc, k.gf desc, k.h2h desc, k.draw_rank nulls last,
                                      k.group_pos, k.team_id))::integer,
         k.team_id, k.name, k.kit_colour, k.played, k.won, k.drawn, k.lost, k.gf, k.ga, k.gd, k.points, k.h2h,
         k.draw_rank::integer,
         (t.size > 1 and t.tie_rank <= 2 and not t.drawn_order)
  from keyed k
  join ties t on (t.points, t.gd, t.gf, t.h2h) = (k.points, k.gd, k.gf, k.h2h)
  order by 1;
$$;

-- ---- 3. Matches ---------------------------------------------------------------------------

-- A tournament match's sides follow the two teams' squads until kickoff:
-- captains, labels and players. Frozen from kickoff, or once the match
-- isn't scheduled; p_force fills a match whatever its time (made late, or
-- its teams just set).
create function public.tournament_match_sync_players(p_match_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_tournament uuid;
  v_team_a uuid;
  v_team_b uuid;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.tournament_fixture_id is null
     or (not p_force and (v_match.status <> 'scheduled' or now() >= v_match.kickoff_at)) then
    return;
  end if;
  select f.tournament_id into v_tournament from public.tournament_fixtures f where f.id = v_match.tournament_fixture_id;
  select team_id into v_team_a from public.match_sides where match_id = p_match_id and side = 'a';
  select team_id into v_team_b from public.match_sides where match_id = p_match_id and side = 'b';

  update public.match_sides ms
  set captain_profile_id = public.tournament_team_captain(ms.team_id),
      label = coalesce((select t.name from public.teams t where t.id = ms.team_id), ms.label)
  where ms.match_id = p_match_id;

  insert into public.match_players (match_id, profile_id, side)
  select p_match_id, s.profile_id, case when s.team_id = v_team_a then 'a' else 'b' end
  from public.tournament_squads s
  where s.tournament_id = v_tournament and s.team_id in (v_team_a, v_team_b)
  on conflict (match_id, profile_id) where profile_id is not null
  do update set side = excluded.side, left_at = null;

  update public.match_players mp
  set left_at = now()
  where mp.match_id = p_match_id
    and mp.profile_id is not null
    and mp.left_at is null
    and not exists (select 1 from public.tournament_squads s
                    where s.tournament_id = v_tournament and s.team_id in (v_team_a, v_team_b)
                      and s.profile_id = mp.profile_id);
end;
$$;

-- True when nobody has started on p_match's result: no result and no
-- score logged (a captain can log from kickoff, before the job marks the
-- match played).
create function public.tournament_match_untouched(p_match public.matches)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_match.status in ('scheduled', 'played', 'no_result')
         and not exists (select 1 from public.match_score_entries e where e.match_id = p_match.id);
$$;

-- Creates or moves a fixture's match (see the top of this file). A team
-- change on a match that has a result or a logged score is refused
-- (next_round_played).
create function public.tournament_fixture_sync_match(p_fixture_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.tournament_fixtures;
  v_tournament public.tournaments;
  v_match public.matches;
  v_length interval;
  v_team_a uuid;
  v_team_b uuid;
begin
  select * into v_fixture from public.tournament_fixtures where id = p_fixture_id;
  if not found then
    return null;
  end if;
  select * into v_match from public.matches where tournament_fixture_id = p_fixture_id for update;
  if v_fixture.status = 'completed' or v_fixture.kickoff_at is null
     or v_fixture.home_team_id is null or v_fixture.away_team_id is null then
    return v_match.id;
  end if;
  select * into v_tournament from public.tournaments where id = v_fixture.tournament_id;

  if v_match.id is null then
    v_length := make_interval(mins => v_tournament.match_minutes);
    insert into public.matches (venue_id, tournament_fixture_id, kind, format, players_per_side,
                                kickoff_at, ends_at, result_deadline_at, competitive)
    values (v_tournament.venue_id, p_fixture_id, 'named', v_tournament.format,
            public.tournament_starters(v_tournament.format),
            v_fixture.kickoff_at, v_fixture.kickoff_at + v_length, v_fixture.kickoff_at + v_length + interval '24 hours', true)
    returning * into v_match;

    insert into public.match_sides (match_id, side, team_id, label, captain_profile_id)
    select v_match.id, s.side, s.team_id, coalesce(t.name, case s.side when 'a' then 'Home' else 'Away' end),
           public.tournament_team_captain(s.team_id)
    from (values ('a', v_fixture.home_team_id), ('b', v_fixture.away_team_id)) s(side, team_id)
    left join public.teams t on t.id = s.team_id;

    insert into public.match_check_in_codes (match_id, code)
    values (v_match.id, encode(extensions.gen_random_bytes(16), 'hex'));
    perform public.tournament_match_sync_players(v_match.id, true);
    return v_match.id;
  end if;

  select team_id into v_team_a from public.match_sides where match_id = v_match.id and side = 'a';
  select team_id into v_team_b from public.match_sides where match_id = v_match.id and side = 'b';
  if (v_team_a, v_team_b) is distinct from (v_fixture.home_team_id, v_fixture.away_team_id) then
    -- The next round's teams changed after a correction.
    if not public.tournament_match_untouched(v_match) then
      raise exception 'next_round_played';
    end if;
    update public.match_sides ms
    set team_id = case ms.side when 'a' then v_fixture.home_team_id else v_fixture.away_team_id end
    where ms.match_id = v_match.id;
    perform public.tournament_match_sync_players(v_match.id, true);
  end if;

  if v_match.kickoff_at is distinct from v_fixture.kickoff_at and public.tournament_match_untouched(v_match) then
    -- Rescheduled: the match keeps its length.
    v_length := v_match.ends_at - v_match.kickoff_at;
    update public.matches
    set kickoff_at = v_fixture.kickoff_at, ends_at = v_fixture.kickoff_at + v_length,
        result_deadline_at = v_fixture.kickoff_at + v_length + interval '24 hours',
        venue_id = v_tournament.venue_id, status = 'scheduled', levels_applied_at = null, ratings_final_at = null
    where id = v_match.id;
  end if;

  perform public.tournament_match_sync_players(v_match.id);
  return v_match.id;
end;
$$;

create function public.tournament_fixtures_sync_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.tournament_fixture_sync_match(new.id);
  return null;
end;
$$;

create trigger tournament_fixtures_sync_match
  after insert or update of kickoff_at, home_team_id, away_team_id
  on public.tournament_fixtures
  for each row execute function public.tournament_fixtures_sync_match();

-- A squad changes: that team's tournament matches before kickoff follow.
create function public.tournament_matches_on_squad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_match uuid;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  for v_match in
    select m.id
    from public.matches m
    join public.tournament_fixtures f on f.id = m.tournament_fixture_id
    join public.match_sides ms on ms.match_id = m.id
    where f.tournament_id = v_row.tournament_id and ms.team_id = v_row.team_id
      and m.status = 'scheduled' and now() < m.kickoff_at
  loop
    perform public.tournament_match_sync_players(v_match);
  end loop;
  return null;
end;
$$;

create trigger tournament_squads_matches
  after insert or delete on public.tournament_squads
  for each row execute function public.tournament_matches_on_squad();

-- A team's captain changes: its tournament matches before kickoff follow.
create function public.tournament_matches_on_team_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match uuid;
begin
  for v_match in
    select distinct m.id
    from public.matches m
    join public.match_sides ms on ms.match_id = m.id
    where m.tournament_fixture_id is not null
      and m.status = 'scheduled'
      and now() < m.kickoff_at
      and ms.team_id in (case when tg_op <> 'INSERT' then old.team_id end, case when tg_op <> 'DELETE' then new.team_id end)
  loop
    perform public.tournament_match_sync_players(v_match);
  end loop;
  return null;
end;
$$;

create trigger team_members_tournament_matches
  after insert or delete or update of team_id, profile_id, role
  on public.team_members
  for each row execute function public.tournament_matches_on_team_member();

-- ---- 4. The knockout ------------------------------------------------------------------------

-- Puts p_home and p_away in p_slot. Refused when they change and the slot
-- already has a result or a logged score (next_round_played).
create function public.tournament_fill_slot(p_tournament_id uuid, p_slot text, p_home uuid, p_away uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.tournament_fixtures;
  v_match public.matches;
begin
  select * into v_fixture from public.tournament_fixtures
  where tournament_id = p_tournament_id and slot = p_slot for update;
  if (v_fixture.home_team_id, v_fixture.away_team_id) is not distinct from (p_home, p_away) then
    return;
  end if;
  select * into v_match from public.matches where tournament_fixture_id = v_fixture.id;
  if v_fixture.status = 'completed' or (v_match.id is not null and not public.tournament_match_untouched(v_match)) then
    raise exception 'next_round_played';
  end if;
  update public.tournament_fixtures
  set home_team_id = p_home, away_team_id = p_away, updated_at = now()
  where id = v_fixture.id;
end;
$$;

-- The team a bracket source names: 'A1' (group A's 1st), 'Winner QF1'.
create function public.tournament_source_team(p_tournament_id uuid, p_source text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_source like 'Winner %' then
      public.tournament_winner((select f.id from public.tournament_fixtures f
                                where f.tournament_id = p_tournament_id and f.slot = substr(p_source, 8)))
    else
      (select s.team_id from public.tournament_group_standings(p_tournament_id, left(p_source, 1)) s
       where s.pos = substr(p_source, 2)::integer)
  end;
$$;

-- After any result: when every group fixture is complete and no tie for
-- 1st or 2nd still needs the organiser's draw, the quarter-finals fill
-- (status knockout); each semi-final and the final fill from the winners
-- known so far. A correction refills them while they're unplayed.
create function public.tournament_advance(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments;
  v_groups_done boolean;
  v_needs_draw boolean;
  b record;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found or v_tournament.status not in ('groups', 'knockout') then
    return;
  end if;
  v_groups_done := not exists (select 1 from public.tournament_fixtures f
                               where f.tournament_id = p_tournament_id and f.stage = 'group' and f.status <> 'completed');
  v_needs_draw := exists (select 1 from unnest(array['A', 'B', 'C', 'D']) g(letter)
                          cross join lateral public.tournament_group_standings(p_tournament_id, g.letter) s
                          where s.needs_draw);

  if not v_groups_done or v_needs_draw then
    if v_tournament.status = 'knockout' then
      -- A correction reopened the group order: the draw must be entered first.
      raise exception 'draw_needed';
    end if;
    return;
  end if;

  for b in select * from public.tournament_bracket() x order by x.ord loop
    perform public.tournament_fill_slot(p_tournament_id, b.slot,
                                        public.tournament_source_team(p_tournament_id, b.home_source),
                                        public.tournament_source_team(p_tournament_id, b.away_source));
  end loop;
  if v_tournament.status = 'groups' then
    update public.tournaments set status = 'knockout', updated_at = now() where id = p_tournament_id;
  end if;
end;
$$;

-- Copies a final tournament match to its fixture (see the top of this
-- file); a fixture the organiser already decided keeps his result.
create function public.tournament_fixture_finalize(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_fixture public.tournament_fixtures;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found or v_match.tournament_fixture_id is null or v_match.status <> 'confirmed'
     or v_match.forfeit_side is not null
     or v_match.side_a_score is null or v_match.side_b_score is null
     or v_match.score_check is not distinct from 'rejected' then
    return;
  end if;
  select * into v_fixture from public.tournament_fixtures where id = v_match.tournament_fixture_id for update;
  if not found or v_fixture.status = 'completed' then
    return;
  end if;
  if v_fixture.stage <> 'group' and v_match.side_a_score = v_match.side_b_score and v_match.side_a_pens is null then
    return;
  end if;
  update public.tournament_fixtures
  set home_score = v_match.side_a_score, away_score = v_match.side_b_score,
      home_pens = case when v_fixture.stage <> 'group' and v_match.side_a_score = v_match.side_b_score
                       then v_match.side_a_pens end,
      away_pens = case when v_fixture.stage <> 'group' and v_match.side_a_score = v_match.side_b_score
                       then v_match.side_b_pens end,
      status = 'completed', decided_by = 'match', completed_at = now(), updated_at = now()
  where id = v_fixture.id;
  perform public.tournament_advance(v_fixture.tournament_id);
end;
$$;

create function public.matches_tournament_fixture_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.tournament_fixture_finalize(new.id);
  return null;
end;
$$;

create trigger matches_tournament_fixture_final
  after update of levels_applied_at on public.matches
  for each row
  when (new.tournament_fixture_id is not null and old.levels_applied_at is null and new.levels_applied_at is not null)
  execute function public.matches_tournament_fixture_final();

-- ---- 5. Squads ----------------------------------------------------------------------------

-- Sets p_team_id's squad in p_tournament_id to p_squad (the format's
-- starters plus up to squad_subs subs, the team's members, nobody in
-- another squad of the tournament) and logs every change.
create function public.tournament_set_squad(p_tournament_id uuid, p_team_id uuid, p_squad uuid[], p_by uuid,
                                            p_by_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments;
  v_squad uuid[];
  v_min integer;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id;
  v_squad := array(select distinct x from unnest(coalesce(p_squad, '{}')) x where x is not null);
  v_min := public.tournament_starters(v_tournament.format);
  if cardinality(v_squad) < v_min or cardinality(v_squad) > v_min + v_tournament.squad_subs then
    raise exception 'squad_size';
  end if;
  if exists (select 1 from unnest(v_squad) x
             where not exists (select 1 from public.team_members tm where tm.team_id = p_team_id and tm.profile_id = x)) then
    raise exception 'not_team_member';
  end if;
  if exists (select 1 from public.tournament_squads s
             where s.tournament_id = p_tournament_id and s.team_id <> p_team_id and s.profile_id = any (v_squad)) then
    raise exception 'player_in_other_squad';
  end if;

  with gone as (
    delete from public.tournament_squads s
    where s.tournament_id = p_tournament_id and s.team_id = p_team_id and not (s.profile_id = any (v_squad))
    returning s.profile_id
  )
  insert into public.tournament_squad_changes (tournament_id, team_id, profile_id, change, changed_by, by_admin)
  select p_tournament_id, p_team_id, g.profile_id, 'removed', p_by, p_by_admin from gone g;

  with added as (
    insert into public.tournament_squads (tournament_id, team_id, profile_id)
    select p_tournament_id, p_team_id, x from unnest(v_squad) x
    on conflict (tournament_id, profile_id) do nothing
    returning profile_id
  )
  insert into public.tournament_squad_changes (tournament_id, team_id, profile_id, change, changed_by, by_admin)
  select p_tournament_id, p_team_id, a.profile_id, 'added', p_by, p_by_admin from added a;
end;
$$;

-- The caller captains p_team_id, else not_captain.
create function public.tournament_require_captain(p_team_id uuid)
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
  if not exists (select 1 from public.team_members tm
                 where tm.team_id = p_team_id and tm.profile_id = auth.uid() and tm.role = 'captain') then
    raise exception 'not_captain';
  end if;
  return auth.uid();
end;
$$;

-- A captain registers his team: while registration is open and before the
-- deadline, the tournament not full, with a kit colour and a squad.
create function public.register_team_for_tournament(p_tournament_id uuid, p_team_id uuid, p_kit_colour text,
                                                    p_squad uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.tournament_require_captain(p_team_id);
  v_tournament public.tournaments;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_tournament.status <> 'registration' then
    raise exception 'registration_closed';
  end if;
  if v_tournament.registration_deadline is not null and now() >= v_tournament.registration_deadline then
    raise exception 'deadline_passed';
  end if;
  if exists (select 1 from public.tournament_teams where tournament_id = p_tournament_id and team_id = p_team_id) then
    raise exception 'already_registered';
  end if;
  if (select count(*) from public.tournament_teams where tournament_id = p_tournament_id) >= v_tournament.max_teams then
    raise exception 'tournament_full';
  end if;
  if p_kit_colour is null
     or p_kit_colour not in ('kitRed', 'kitBlue', 'kitSky', 'kitGreen', 'kitYellow', 'kitOrange', 'kitBlack', 'kitWhite') then
    raise exception 'invalid_kit_colour';
  end if;
  insert into public.tournament_teams (tournament_id, team_id, kit_colour, registered_by)
  values (p_tournament_id, p_team_id, p_kit_colour, v_uid);
  perform public.tournament_set_squad(p_tournament_id, p_team_id, p_squad, v_uid, false);
end;
$$;

-- A captain changes his squad until the registration deadline (and while
-- registration is open).
create function public.set_tournament_squad(p_tournament_id uuid, p_team_id uuid, p_squad uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.tournament_require_captain(p_team_id);
  v_tournament public.tournaments;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if not exists (select 1 from public.tournament_teams where tournament_id = p_tournament_id and team_id = p_team_id) then
    raise exception 'not_registered';
  end if;
  if v_tournament.status <> 'registration'
     or (v_tournament.registration_deadline is not null and now() >= v_tournament.registration_deadline) then
    raise exception 'deadline_passed';
  end if;
  perform public.tournament_set_squad(p_tournament_id, p_team_id, p_squad, v_uid, false);
end;
$$;

-- ---- 6. Admin -------------------------------------------------------------------------------

-- p_row with the fields in p (the admin screen's names) applied and checked.
create function public.tournament_merge(p_row public.tournaments, p jsonb)
returns public.tournaments
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.tournaments := p_row;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'invalid_tournament';
  end if;
  begin
    if p ? 'name' then r.name := nullif(btrim(p ->> 'name'), ''); end if;
    if p ? 'area' then r.area := nullif(btrim(p ->> 'area'), ''); end if;
    if p ? 'country' then r.country := upper(btrim(p ->> 'country')); end if;
    if p ? 'format' then r.format := p ->> 'format'; end if;
    if p ? 'venueId' then r.venue_id := nullif(p ->> 'venueId', '')::uuid; end if;
    if p ? 'maxTeams' then r.max_teams := (p ->> 'maxTeams')::integer; end if;
    if p ? 'squadSubs' then r.squad_subs := (p ->> 'squadSubs')::integer; end if;
    if p ? 'registrationDeadline' then r.registration_deadline := (p ->> 'registrationDeadline')::timestamptz; end if;
  exception when others then
    raise exception 'invalid_tournament';
  end;
  begin
    if p ? 'entryFeeCents' then r.entry_fee_cents := (p ->> 'entryFeeCents')::integer; end if;
  exception when others then
    raise exception 'invalid_entry_fee';
  end;
  begin
    if p ? 'matchMinutes' then r.match_minutes := (p ->> 'matchMinutes')::integer; end if;
  exception when others then
    raise exception 'invalid_match_minutes';
  end;
  begin
    if p ? 'startDate' then r.start_date := (p ->> 'startDate')::date; end if;
    if p ? 'endDate' then r.end_date := (p ->> 'endDate')::date; end if;
  exception when others then
    raise exception 'invalid_dates';
  end;

  if r.name is null or r.area is null or r.country is null or r.country !~ '^[A-Z]{2}$'
     or r.format is null or r.format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')
     or r.squad_subs is null or r.squad_subs not between 0 and 2 then
    raise exception 'invalid_tournament';
  end if;
  if r.max_teams is distinct from 16 then
    raise exception 'unsupported_structure';
  end if;
  if r.entry_fee_cents is null or r.entry_fee_cents < 0 then
    raise exception 'invalid_entry_fee';
  end if;
  if r.match_minutes is null or r.match_minutes not between 15 and 300 then
    raise exception 'invalid_match_minutes';
  end if;
  if r.start_date is not null and r.end_date is not null and r.end_date < r.start_date then
    raise exception 'invalid_dates';
  end if;
  if r.venue_id is not null and not exists (select 1 from public.venues v where v.id = r.venue_id) then
    raise exception 'invalid_venue';
  end if;
  return r;
end;
$$;

-- Creates a tournament (Coming soon until registration opens). Fields:
-- name, area, format, maxTeams (16), entryFeeCents, matchMinutes, and
-- optionally venueId, country ('CY'), startDate, endDate,
-- registrationDeadline, squadSubs (2).
create function public.admin_create_tournament(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  r public.tournaments;
begin
  r.country := 'CY';
  r.max_teams := 16;
  r.squad_subs := 2;
  r := public.tournament_merge(r, p);
  insert into public.tournaments (name, venue_id, area, country, format, start_date, end_date, registration_deadline,
                                  max_teams, squad_subs, entry_fee_cents, match_minutes, created_by)
  values (r.name, r.venue_id, r.area, r.country, r.format, r.start_date, r.end_date, r.registration_deadline,
          r.max_teams, r.squad_subs, r.entry_fee_cents, r.match_minutes, v_admin)
  returning id into r.id;
  return r.id;
end;
$$;

-- Changes the fields given (as admin_create_tournament). The format is
-- fixed once a team has registered (format_locked). A new match length
-- applies to matches created after it.
create function public.admin_update_tournament(p_tournament_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_old public.tournaments;
  r public.tournaments;
begin
  select * into v_old from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  r := public.tournament_merge(v_old, p);
  if (r.format <> v_old.format or r.squad_subs <> v_old.squad_subs)
     and exists (select 1 from public.tournament_teams where tournament_id = p_tournament_id) then
    raise exception 'format_locked';
  end if;
  update public.tournaments
  set name = r.name, venue_id = r.venue_id, area = r.area, country = r.country, format = r.format,
      start_date = r.start_date, end_date = r.end_date, registration_deadline = r.registration_deadline,
      squad_subs = r.squad_subs, entry_fee_cents = r.entry_fee_cents, match_minutes = r.match_minutes,
      updated_at = now()
  where id = p_tournament_id;
end;
$$;

-- Opens sign-up (Coming soon → registration).
create function public.admin_open_registration(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_status text;
begin
  select status into v_status from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status <> 'coming_soon' then
    raise exception 'invalid_status';
  end if;
  update public.tournaments set status = 'registration', updated_at = now() where id = p_tournament_id;
end;
$$;

-- Places the 16 teams: p_groups = {"A": [4 team ids], "B": …, "C": …, "D": …},
-- each list in placing order (it sets the fixtures' home and away).
-- Creates the 24 group fixtures (each team plays the other three once) and
-- the knockout slots, and starts the group stage. Returns p_groups.
create function public.admin_set_groups(p_tournament_id uuid, p_groups jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_tournament public.tournaments;
  v_letter text;
  v_ids uuid[];
  v_all uuid[] := '{}';
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_tournament.status <> 'registration' then
    raise exception 'invalid_status';
  end if;
  if (select count(*) from public.tournament_teams where tournament_id = p_tournament_id) <> v_tournament.max_teams then
    raise exception 'teams_missing';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_groups) k) is distinct from array['A', 'B', 'C', 'D'] then
    raise exception 'invalid_groups';
  end if;
  foreach v_letter in array array['A', 'B', 'C', 'D'] loop
    begin
      v_ids := array(select x::uuid from jsonb_array_elements_text(p_groups -> v_letter) x);
    exception when others then
      raise exception 'invalid_groups';
    end;
    if cardinality(v_ids) <> 4 then
      raise exception 'invalid_groups';
    end if;
    v_all := v_all || v_ids;
  end loop;
  if (select count(distinct x) from unnest(v_all) x) <> 16
     or exists (select 1 from unnest(v_all) x
                where not exists (select 1 from public.tournament_teams tt
                                  where tt.tournament_id = p_tournament_id and tt.team_id = x)) then
    raise exception 'invalid_groups';
  end if;

  update public.tournament_teams tt
  set group_letter = g.letter, group_pos = g.pos
  from (
    select l.letter, x.team_id::uuid as team_id, x.pos::smallint as pos
    from unnest(array['A', 'B', 'C', 'D']) l(letter)
    cross join lateral jsonb_array_elements_text(p_groups -> l.letter) with ordinality x(team_id, pos)
  ) g
  where tt.tournament_id = p_tournament_id and tt.team_id = g.team_id;

  -- Each group: 1 v 2 and 3 v 4, 1 v 3 and 2 v 4, 1 v 4 and 2 v 3.
  insert into public.tournament_fixtures (tournament_id, stage, group_letter, slot, home_team_id, away_team_id)
  select p_tournament_id, 'group', l.letter, l.letter || '-' || p.n,
         (select tt.team_id from public.tournament_teams tt
          where tt.tournament_id = p_tournament_id and tt.group_letter = l.letter and tt.group_pos = p.home),
         (select tt.team_id from public.tournament_teams tt
          where tt.tournament_id = p_tournament_id and tt.group_letter = l.letter and tt.group_pos = p.away)
  from unnest(array['A', 'B', 'C', 'D']) l(letter)
  cross join (values (1, 1, 2), (2, 3, 4), (3, 1, 3), (4, 2, 4), (5, 1, 4), (6, 2, 3)) p(n, home, away);

  insert into public.tournament_fixtures (tournament_id, stage, slot)
  select p_tournament_id, b.stage, b.slot from public.tournament_bracket() b;

  update public.tournaments set status = 'groups', updated_at = now() where id = p_tournament_id;
  return p_groups;
end;
$$;

-- Draws the groups at random; returns them as admin_set_groups takes them.
create function public.admin_draw_groups(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_teams uuid[];
begin
  select array_agg(tt.team_id order by random()) into v_teams
  from public.tournament_teams tt where tt.tournament_id = p_tournament_id;
  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'tournament_not_found';
  end if;
  if coalesce(cardinality(v_teams), 0) <> 16 then
    if (select status from public.tournaments where id = p_tournament_id) <> 'registration' then
      raise exception 'invalid_status';
    end if;
    raise exception 'teams_missing';
  end if;
  return public.admin_set_groups(p_tournament_id, jsonb_build_object(
    'A', to_jsonb(v_teams[1:4]), 'B', to_jsonb(v_teams[5:8]), 'C', to_jsonb(v_teams[9:12]), 'D', to_jsonb(v_teams[13:16])));
end;
$$;

-- Sets (or moves) a fixture's kick-off; its match follows. Returns the
-- match, or null while the teams aren't known.
create function public.admin_set_fixture_time(p_fixture_id uuid, p_kickoff_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_fixture public.tournament_fixtures;
begin
  select * into v_fixture from public.tournament_fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'fixture_not_found';
  end if;
  if (select status from public.tournaments where id = v_fixture.tournament_id) not in ('groups', 'knockout') then
    raise exception 'invalid_status';
  end if;
  if v_fixture.status = 'completed' then
    raise exception 'fixture_completed';
  end if;
  if p_kickoff_at is null then
    raise exception 'invalid_kickoff';
  end if;
  update public.tournament_fixtures set kickoff_at = p_kickoff_at, updated_at = now() where id = p_fixture_id;
  return (select id from public.matches where tournament_fixture_id = p_fixture_id);
end;
$$;

-- Enters or corrects a fixture's result (and the shootout of a drawn
-- knockout game): the organiser decides a mismatch or a missing result.
-- Its match, if any, is confirmed (via 'organiser') or corrected; the next
-- rounds fill or refill, unless a team already through would change
-- (next_round_played).
create function public.admin_set_result(p_fixture_id uuid, p_home integer, p_away integer,
                                        p_home_pens integer, p_away_pens integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_fixture public.tournament_fixtures;
  v_match public.matches;
  v_level boolean := p_home = p_away;
begin
  select * into v_fixture from public.tournament_fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'fixture_not_found';
  end if;
  if (select status from public.tournaments where id = v_fixture.tournament_id) not in ('groups', 'knockout') then
    raise exception 'invalid_status';
  end if;
  if v_fixture.home_team_id is null or v_fixture.away_team_id is null then
    raise exception 'teams_not_set';
  end if;
  perform public.tournament_check_result(v_fixture.stage <> 'group', p_home, p_away, p_home_pens, p_away_pens);

  update public.tournament_fixtures
  set home_score = p_home, away_score = p_away, home_pens = p_home_pens, away_pens = p_away_pens,
      status = 'completed', decided_by = 'organiser', completed_at = coalesce(completed_at, now()), updated_at = now()
  where id = p_fixture_id;

  select * into v_match from public.matches where tournament_fixture_id = p_fixture_id for update;
  if v_match.id is not null and v_match.status <> 'void' then
    if v_match.status = 'confirmed' then
      update public.matches
      set side_a_score = p_home, side_b_score = p_away, forfeit_side = null, forfeit_reason = null,
          confirmed_via = 'organiser'
      where id = v_match.id;
    else
      perform public.match_confirm_result(v_match.id, p_home, p_away, 'organiser', now(), v_admin);
    end if;
    update public.matches
    set side_a_pens = case when v_level then p_home_pens end, side_b_pens = case when v_level then p_away_pens end
    where id = v_match.id;
  end if;

  perform public.tournament_advance(v_fixture.tournament_id);
end;
$$;

-- The organiser's draw for group p_group: p_team_ids, highest first (the
-- teams still level, or all four). It orders only teams level on
-- everything else.
create function public.admin_set_draw_order(p_tournament_id uuid, p_group text, p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_status text;
begin
  select status into v_status from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status not in ('groups', 'knockout') then
    raise exception 'invalid_status';
  end if;
  if p_group is null or p_group not in ('A', 'B', 'C', 'D')
     or coalesce(cardinality(p_team_ids), 0) not between 2 and 4
     or (select count(distinct x) from unnest(p_team_ids) x) <> cardinality(p_team_ids)
     or exists (select 1 from unnest(p_team_ids) x
                where not exists (select 1 from public.tournament_teams tt
                                  where tt.tournament_id = p_tournament_id and tt.group_letter = p_group
                                    and tt.team_id = x)) then
    raise exception 'invalid_groups';
  end if;
  update public.tournament_teams set draw_rank = null where tournament_id = p_tournament_id and group_letter = p_group;
  update public.tournament_teams tt
  set draw_rank = x.n
  from unnest(p_team_ids) with ordinality x(team_id, n)
  where tt.tournament_id = p_tournament_id and tt.team_id = x.team_id;
  perform public.tournament_advance(p_tournament_id);
end;
$$;

-- An admin changes a squad at any time before the tournament ends (after
-- the deadline too, e.g. an injury); logged as by_admin.
create function public.admin_set_squad(p_tournament_id uuid, p_team_id uuid, p_squad uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_status text;
begin
  select status into v_status from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status = 'finished' then
    raise exception 'invalid_status';
  end if;
  if not exists (select 1 from public.tournament_teams where tournament_id = p_tournament_id and team_id = p_team_id) then
    raise exception 'not_registered';
  end if;
  perform public.tournament_set_squad(p_tournament_id, p_team_id, p_squad, v_admin, true);
end;
$$;

-- Ends the tournament once the final has a result; records the champion.
create function public.admin_close_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_app_admin();
  v_champion uuid;
begin
  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'tournament_not_found';
  end if;
  v_champion := public.tournament_winner((select id from public.tournament_fixtures
                                          where tournament_id = p_tournament_id and slot = 'F'));
  if v_champion is null then
    raise exception 'final_not_played';
  end if;
  update public.tournaments set status = 'finished', champion_team_id = v_champion, updated_at = now()
  where id = p_tournament_id;
end;
$$;

-- ---- 7. Re-created functions ------------------------------------------------------------

-- Change: a tournament match is always Competitive (tournament_always_competitive).
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
  if v_match.tournament_fixture_id is not null and not p_competitive then
    raise exception 'tournament_always_competitive';
  end if;
  if v_match.status <> 'scheduled' or now() >= v_match.kickoff_at then
    raise exception 'competitive_locked';
  end if;
  update public.matches set competitive = p_competitive where id = p_match_id;
end;
$$;

-- Change: the match keeps the agreed shootout of a drawn score (from the
-- score entries that logged it), else none.
create or replace function public.match_confirm_result(p_match_id uuid, p_a integer, p_b integer, p_via text,
                                                       p_at timestamptz, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pa integer;
  v_pb integer;
begin
  if p_a = p_b then
    select e.side_a_pens, e.side_b_pens into v_pa, v_pb
    from public.match_score_entries e
    where e.match_id = p_match_id and e.side_a_score = p_a and e.side_b_score = p_b
    order by e.entered_at limit 1;
  end if;
  update public.matches
  set status = 'confirmed', side_a_score = p_a, side_b_score = p_b, confirmed_via = p_via, confirmed_at = p_at,
      side_a_pens = v_pa, side_b_pens = v_pb
  where id = p_match_id;
  update public.match_result_submissions
  set response = 'accepted', responded_by = coalesce(responded_by, p_by), responded_at = coalesce(responded_at, p_at)
  where match_id = p_match_id and response is null;
  perform public.match_notify(p_match_id, 'match_result_confirmed', 'Result confirmed',
    public.match_score_line(p_match_id, p_a, p_b), array['a', 'b'], true, p_by);
  perform public.match_compute_ratings(p_match_id, p_at);
end;
$$;

-- Change: the argument list gains p_side_a_pens and p_side_b_pens (default
-- null, so every existing call works unchanged), for a drawn tournament
-- knockout match: required there (shootout_required), refused anywhere
-- else (shootout_not_allowed), and a shootout that can happen
-- (invalid_shootout). Two captains must match on the score and the
-- shootout. The old signature is dropped first: create or replace would
-- add a second overload and make the app's calls ambiguous.
drop function public.log_match_result(uuid, integer, integer, jsonb);

create function public.log_match_result(p_match_id uuid, p_side_a_score integer, p_side_b_score integer,
                                        p_stats jsonb, p_side_a_pens integer default null,
                                        p_side_b_pens integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_sides text[];
  v_side text;
  v_other text;
  v_mine public.match_score_entries;
  v_theirs public.match_score_entries;
  v_own_score integer;
  v_own_changed boolean;
  v_numbers_changed boolean;
  v_max integer := (public.app_rules_now()).match_score_tries;
  v_knockout boolean;
  s text;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  v_sides := public.match_side_writer(p_match_id, v_uid);
  if v_sides is null then
    if public.match_is_member(p_match_id, v_uid) then
      raise exception 'not_captain';
    end if;
    raise exception 'not_in_match';
  end if;
  if v_match.status not in ('scheduled', 'played') or now() < v_match.kickoff_at or now() >= v_match.result_deadline_at then
    raise exception 'result_window_closed';
  end if;
  v_knockout := exists (select 1 from public.tournament_fixtures f
                        where f.id = v_match.tournament_fixture_id and f.stage <> 'group');
  perform public.tournament_check_result(v_knockout, p_side_a_score, p_side_b_score, p_side_a_pens, p_side_b_pens);
  if p_stats is null or jsonb_typeof(p_stats) <> 'object' then
    raise exception 'invalid_stats';
  end if;
  -- Stats for a side he doesn't write: those players aren't his.
  for s in select k from jsonb_object_keys(p_stats) k loop
    if s not in ('a', 'b') then
      raise exception 'invalid_stats';
    end if;
    if not s = any (v_sides) then
      raise exception 'not_your_player';
    end if;
  end loop;

  -- One captain writes both sides: his score is the result.
  if cardinality(v_sides) = 2 then
    if not (p_stats ? 'a' and p_stats ? 'b') then
      raise exception 'stats_required';
    end if;
    perform public.match_write_side_stats(p_match_id, 'a', p_stats -> 'a', p_side_a_score, v_uid);
    perform public.match_write_side_stats(p_match_id, 'b', p_stats -> 'b', p_side_b_score, v_uid);
    perform public.match_write_side_attendance(p_match_id, 'a', p_stats -> 'a', v_uid);
    perform public.match_write_side_attendance(p_match_id, 'b', p_stats -> 'b', v_uid);
    insert into public.match_score_entries (match_id, side, entered_by, side_a_score, side_b_score, side_a_pens, side_b_pens)
    values (p_match_id, 'a', v_uid, p_side_a_score, p_side_b_score, p_side_a_pens, p_side_b_pens)
    on conflict (match_id, side) do update
    set entered_by = excluded.entered_by, side_a_score = excluded.side_a_score, side_b_score = excluded.side_b_score,
        side_a_pens = excluded.side_a_pens, side_b_pens = excluded.side_b_pens, entered_at = now();
    insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by)
    values (p_match_id, 'a', p_side_a_score, p_side_b_score, v_uid)
    on conflict (match_id) do nothing;
    update public.matches set score_tries = score_tries + 1 where id = p_match_id;
    perform public.match_confirm_result(p_match_id, p_side_a_score, p_side_b_score, 'agreed', now(), v_uid);
    -- The players who played check it for levels (decision 1l item 11).
    perform public.match_open_score_check(p_match_id);
    return jsonb_build_object('status', 'confirmed', 'tries', v_match.score_tries + 1, 'maxTries', v_max);
  end if;

  -- Two captains: each logs both scores and his own side's stats.
  v_side := v_sides[1];
  v_other := case v_side when 'a' then 'b' else 'a' end;
  v_own_score := case v_side when 'a' then p_side_a_score else p_side_b_score end;
  select * into v_mine from public.match_score_entries where match_id = p_match_id and side = v_side;
  v_own_changed := v_mine.match_id is null
                   or v_own_score <> case v_side when 'a' then v_mine.side_a_score else v_mine.side_b_score end;
  v_numbers_changed := v_mine.match_id is null
                       or (v_mine.side_a_score, v_mine.side_b_score, v_mine.side_a_pens, v_mine.side_b_pens)
                          is distinct from (p_side_a_score, p_side_b_score, p_side_a_pens, p_side_b_pens);

  if p_stats ? v_side then
    perform public.match_write_side_stats(p_match_id, v_side, p_stats -> v_side, v_own_score, v_uid);
    perform public.match_write_side_attendance(p_match_id, v_side, p_stats -> v_side, v_uid);
  elsif v_own_changed or public.match_side_goal_count(p_match_id, v_side) <> v_own_score then
    raise exception 'stats_required';
  end if;

  insert into public.match_score_entries (match_id, side, entered_by, side_a_score, side_b_score, side_a_pens, side_b_pens)
  values (p_match_id, v_side, v_uid, p_side_a_score, p_side_b_score, p_side_a_pens, p_side_b_pens)
  on conflict (match_id, side) do update
  set entered_by = excluded.entered_by, side_a_score = excluded.side_a_score, side_b_score = excluded.side_b_score,
      side_a_pens = excluded.side_a_pens, side_b_pens = excluded.side_b_pens, entered_at = now();
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by)
  values (p_match_id, v_side, p_side_a_score, p_side_b_score, v_uid)
  on conflict (match_id) do nothing;

  select * into v_theirs from public.match_score_entries where match_id = p_match_id and side = v_other;
  if v_theirs.match_id is null then
    -- The other captain logs his.
    if v_mine.match_id is null then
      perform public.match_notify(p_match_id, 'match_result_submitted', 'Log the score',
        'The other captain logged the score. Add yours.', array[v_other], false, v_uid);
    end if;
    return jsonb_build_object('status', 'waiting', 'tries', v_match.score_tries, 'maxTries', v_max);
  end if;
  if not v_numbers_changed then
    -- Only his stats changed: no new try.
    return jsonb_build_object('status', 'mismatch', 'tries', v_match.score_tries, 'maxTries', v_max);
  end if;

  update public.matches set score_tries = score_tries + 1 where id = p_match_id
  returning * into v_match;
  if (v_theirs.side_a_score, v_theirs.side_b_score, v_theirs.side_a_pens, v_theirs.side_b_pens)
     is not distinct from (p_side_a_score, p_side_b_score, p_side_a_pens, p_side_b_pens) then
    perform public.match_confirm_result(p_match_id, p_side_a_score, p_side_b_score, 'agreed', now(), v_uid);
    return jsonb_build_object('status', 'confirmed', 'tries', v_match.score_tries, 'maxTries', v_max);
  end if;
  if v_match.score_tries >= v_max then
    perform public.match_dispute_result(p_match_id, now());
    return jsonb_build_object('status', 'disputed', 'tries', v_match.score_tries, 'maxTries', v_max);
  end if;
  perform public.send_notification(c.captain, 'match_score_mismatch', jsonb_build_object(
    'title', 'Scores don''t match',
    'body', format('Check the score with the other captain. %s of %s tries left.', v_max - v_match.score_tries, v_max),
    'matchId', p_match_id))
  from (select distinct coalesce(e.entered_by, ms.captain_profile_id) as captain
        from public.match_sides ms
        left join public.match_score_entries e on e.match_id = ms.match_id and e.side = ms.side
        where ms.match_id = p_match_id) c
  where c.captain is not null;
  return jsonb_build_object('status', 'mismatch', 'tries', v_match.score_tries, 'maxTries', v_max);
end;
$$;

-- Change: at the deadline two captains' entries that differ only in the
-- shootout are different scores (disputed), as the score itself is.
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
  v_disputed integer := 0;
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
    select m.id, m.result_deadline_at,
           (select count(*) from public.match_score_entries e where e.match_id = m.id) as entries,
           (select count(distinct (e.side_a_score, e.side_b_score, e.side_a_pens, e.side_b_pens))
            from public.match_score_entries e
            where e.match_id = m.id) as scores
    from public.matches m
    where m.status in ('scheduled', 'played') and m.result_deadline_at <= now()
      and exists (select 1 from public.match_score_entries e where e.match_id = m.id)
    order by m.result_deadline_at, m.id
    for update of m
  loop
    if v_row.scores > 1 then
      perform public.match_dispute_result(v_row.id, v_row.result_deadline_at);
      v_disputed := v_disputed + 1;
    else
      perform public.match_confirm_result(v_row.id, e.side_a_score, e.side_b_score, 'deadline', v_row.result_deadline_at, null)
      from public.match_score_entries e where e.match_id = v_row.id
      order by e.entered_at limit 1;
      v_confirmed := v_confirmed + 1;
    end if;
  end loop;

  update public.matches m
  set status = 'no_result'
  where m.status in ('scheduled', 'played') and m.result_deadline_at <= now()
    and not exists (select 1 from public.match_score_entries e where e.match_id = m.id);
  get diagnostics v_no_result = row_count;

  return jsonb_build_object('played', v_played, 'confirmed', v_confirmed, 'disputed', v_disputed,
                            'no_result', v_no_result, 'voided', v_voided)
         || public.match_reminders_tick(now())
         || jsonb_build_object('ratings', public.match_ratings_tick(now()))
         || jsonb_build_object('levels', public.match_levels_tick(now()))
         || jsonb_build_object('power_ranking', public.power_ranking_tick(now()))
         || jsonb_build_object('team_of_the_week', public.team_of_the_week_tick(now()))
         || jsonb_build_object('streak_badges', public.streak_badges_tick(now()));
end;
$$;

-- ---- 8. Grants ------------------------------------------------------------------------------

-- Internal: service_role only.
revoke all on function public.tournament_starters(text) from public, anon, authenticated;
revoke all on function public.tournament_team_captain(uuid) from public, anon, authenticated;
revoke all on function public.tournament_bracket() from public, anon, authenticated;
revoke all on function public.tournament_valid_shootout(integer, integer) from public, anon, authenticated;
revoke all on function public.tournament_check_result(boolean, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.tournament_winner(uuid) from public, anon, authenticated;
revoke all on function public.tournament_group_standings(uuid, text) from public, anon, authenticated;
revoke all on function public.tournament_match_sync_players(uuid, boolean) from public, anon, authenticated;
revoke all on function public.tournament_match_untouched(public.matches) from public, anon, authenticated;
revoke all on function public.tournament_fixture_sync_match(uuid) from public, anon, authenticated;
revoke all on function public.tournament_fixtures_sync_match() from public, anon, authenticated;
revoke all on function public.tournament_matches_on_squad() from public, anon, authenticated;
revoke all on function public.tournament_matches_on_team_member() from public, anon, authenticated;
revoke all on function public.tournament_fill_slot(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.tournament_source_team(uuid, text) from public, anon, authenticated;
revoke all on function public.tournament_advance(uuid) from public, anon, authenticated;
revoke all on function public.tournament_fixture_finalize(uuid) from public, anon, authenticated;
revoke all on function public.matches_tournament_fixture_final() from public, anon, authenticated;
revoke all on function public.tournament_set_squad(uuid, uuid, uuid[], uuid, boolean) from public, anon, authenticated;
revoke all on function public.tournament_require_captain(uuid) from public, anon, authenticated;
revoke all on function public.tournament_merge(public.tournaments, jsonb) from public, anon, authenticated;
grant execute on function public.tournament_starters(text) to service_role;
grant execute on function public.tournament_team_captain(uuid) to service_role;
grant execute on function public.tournament_bracket() to service_role;
grant execute on function public.tournament_valid_shootout(integer, integer) to service_role;
grant execute on function public.tournament_check_result(boolean, integer, integer, integer, integer) to service_role;
grant execute on function public.tournament_winner(uuid) to service_role;
grant execute on function public.tournament_group_standings(uuid, text) to service_role;
grant execute on function public.tournament_match_sync_players(uuid, boolean) to service_role;
grant execute on function public.tournament_match_untouched(public.matches) to service_role;
grant execute on function public.tournament_fixture_sync_match(uuid) to service_role;
grant execute on function public.tournament_fill_slot(uuid, text, uuid, uuid) to service_role;
grant execute on function public.tournament_source_team(uuid, text) to service_role;
grant execute on function public.tournament_advance(uuid) to service_role;
grant execute on function public.tournament_fixture_finalize(uuid) to service_role;
grant execute on function public.tournament_set_squad(uuid, uuid, uuid[], uuid, boolean) to service_role;
grant execute on function public.tournament_require_captain(uuid) to service_role;
grant execute on function public.tournament_merge(public.tournaments, jsonb) to service_role;

-- Captains and admins: signed in (each checks the caller).
revoke all on function public.register_team_for_tournament(uuid, uuid, text, uuid[]) from public, anon;
revoke all on function public.set_tournament_squad(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.admin_create_tournament(jsonb) from public, anon;
revoke all on function public.admin_update_tournament(uuid, jsonb) from public, anon;
revoke all on function public.admin_open_registration(uuid) from public, anon;
revoke all on function public.admin_set_groups(uuid, jsonb) from public, anon;
revoke all on function public.admin_draw_groups(uuid) from public, anon;
revoke all on function public.admin_set_fixture_time(uuid, timestamptz) from public, anon;
revoke all on function public.admin_set_result(uuid, integer, integer, integer, integer) from public, anon;
revoke all on function public.admin_set_draw_order(uuid, text, uuid[]) from public, anon;
revoke all on function public.admin_set_squad(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.admin_close_tournament(uuid) from public, anon;
grant execute on function public.register_team_for_tournament(uuid, uuid, text, uuid[]) to authenticated, service_role;
grant execute on function public.set_tournament_squad(uuid, uuid, uuid[]) to authenticated, service_role;
grant execute on function public.admin_create_tournament(jsonb) to authenticated, service_role;
grant execute on function public.admin_update_tournament(uuid, jsonb) to authenticated, service_role;
grant execute on function public.admin_open_registration(uuid) to authenticated, service_role;
grant execute on function public.admin_set_groups(uuid, jsonb) to authenticated, service_role;
grant execute on function public.admin_draw_groups(uuid) to authenticated, service_role;
grant execute on function public.admin_set_fixture_time(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.admin_set_result(uuid, integer, integer, integer, integer) to authenticated, service_role;
grant execute on function public.admin_set_draw_order(uuid, text, uuid[]) to authenticated, service_role;
grant execute on function public.admin_set_squad(uuid, uuid, uuid[]) to authenticated, service_role;
grant execute on function public.admin_close_tournament(uuid) to authenticated, service_role;

-- Re-created: the same grants as before.
revoke all on function public.set_match_competitive(uuid, boolean) from public, anon;
grant execute on function public.set_match_competitive(uuid, boolean) to authenticated, service_role;
revoke all on function public.log_match_result(uuid, integer, integer, jsonb, integer, integer) from public, anon;
grant execute on function public.log_match_result(uuid, integer, integer, jsonb, integer, integer) to authenticated, service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
