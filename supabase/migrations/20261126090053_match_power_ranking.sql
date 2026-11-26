-- S14b: the team power ranking (match-record.md decision 1m; decided by
-- Panos 22 November, changed 25 November).
--
-- One ranking per format (5, 6, 7, 9 and 11-a-side). Every registered team
-- starts at app_rules.power_ranking_start (1000) in each format. After each
-- counted game: new = old + K × (W − We), We = 1 / (10^(−d/600) + 1), d =
-- the team's points minus the opponent's before the game. W = 1 win, 0.5
-- draw, 0 loss. K: non-league 20 (was "friendly", renamed 25 November),
-- league 40, tournament group 40, tournament knockout 50. Every constant is
-- in app_rules.
--
-- Which games count (power_ranking_games):
--   * matches: confirmed, Competitive (a game switched to Friendly counts
--     for nothing), not a forfeit, two different registered teams
--     (match_sides.team_id), a score, and final at the moment levels move
--     (apply_match_levels): from greatest(confirmed_at + 24 hours,
--     result_deadline_at), with a lone captain's score check accepted or 24
--     hours old. A Rejected score never counts; corrected and final, it does.
--     Category non_league. A match linked to a league fixture
--     (league_fixture_id) is left to the fixture, so a game never counts
--     twice.
--   * league_fixtures: league results still run through league_fixtures and
--     never reach matches. Completed, no forfeit_result (forfeit or void),
--     two different registered teams, a score; the league's format; category
--     league. Kickoff = scheduled_day + scheduled_time in Cyprus time; no
--     time: 00:00 on that day; no day: when the fixture was created.
--   * Tournament group and knockout: K stored, but no game is one until S10A
--     creates the tournament tables.
--   * Penalty shootouts (decided by Panos 25 November): Futty can't record
--     one yet, so only win, draw and loss are built. The shootout W values
--     (0.75 winner, 0.5 loser) are stored with power_ranking_shootouts off;
--     S10A records shootouts and switches them on.
--
-- Games apply in kickoff order, once each (power_ranking_replay). The job
-- (power_ranking_tick, from match_jobs_tick every 15 minutes) applies games
-- that became final, and replays a format from the earliest kickoff that
-- needs it: a game that became final after a later one was applied, or an
-- applied game that changed (a corrected score, a new status, a deleted
-- game or team; queued by triggers in power_ranking_dirty). So the history
-- is always the replay of the games that exist now.
--
-- A deleted team: its games must go first (match_sides and league_fixtures
-- refer to teams), its history rows go with it (both team_id and
-- opponent_team_id cascade), and its opponents are replayed without those
-- games.
--
-- The list (power_ranking_list): a team appears after
-- power_ranking_min_matches (3) counted games in that format and is hidden
-- after power_ranking_inactive_days (60) without one; its points are kept.
-- ▲▼ is the change of rank since Monday 00:00 Cyprus time.
--
-- Computed on the server only; players read the list, the breakdown and the
-- history rows, and write nothing.

-- 1. Rules.
alter table public.app_rules
  add column power_ranking_start numeric(8,2) not null default 1000,
  add column power_ranking_scale numeric(8,2) not null default 600,
  add column power_ranking_k_non_league numeric(6,2) not null default 20,
  add column power_ranking_k_league numeric(6,2) not null default 40,
  add column power_ranking_k_tournament_group numeric(6,2) not null default 40,
  add column power_ranking_k_tournament_knockout numeric(6,2) not null default 50,
  add column power_ranking_w_win numeric(4,2) not null default 1,
  add column power_ranking_w_draw numeric(4,2) not null default 0.5,
  add column power_ranking_w_loss numeric(4,2) not null default 0,
  add column power_ranking_w_shootout_win numeric(4,2) not null default 0.75,
  add column power_ranking_w_shootout_loss numeric(4,2) not null default 0.5,
  add column power_ranking_shootouts boolean not null default false,
  add column power_ranking_min_matches integer not null default 3,
  add column power_ranking_inactive_days integer not null default 60,
  add constraint app_rules_power_ranking check (
    power_ranking_start > 0 and power_ranking_scale > 0
    and power_ranking_k_non_league >= 0 and power_ranking_k_league >= 0
    and power_ranking_k_tournament_group >= 0 and power_ranking_k_tournament_knockout >= 0
    and power_ranking_w_loss between 0 and 1 and power_ranking_w_draw between 0 and 1
    and power_ranking_w_win between 0 and 1
    and power_ranking_w_shootout_loss between 0 and 1 and power_ranking_w_shootout_win between 0 and 1
    and power_ranking_min_matches >= 1 and power_ranking_inactive_days >= 1
  );

-- 2. Tables.
create table public.power_ranking_history (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  format text not null check (format in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')),
  source text not null check (source in ('match', 'league_fixture')),
  game_id uuid not null,
  kickoff_at timestamptz not null,
  team_id uuid not null references public.teams (id) on delete cascade,
  opponent_team_id uuid not null references public.teams (id) on delete cascade,
  category text not null check (category in ('non_league', 'league', 'tournament_group', 'tournament_knockout')),
  goals_for integer not null check (goals_for >= 0),
  goals_against integer not null check (goals_against >= 0),
  result text not null check (result in ('W', 'D', 'L')),
  w numeric not null,
  expected numeric not null,
  k numeric not null,
  points_before numeric not null,
  points_after numeric not null,
  change numeric not null,
  created_at timestamptz not null default now(),
  unique (source, game_id, team_id)
);

create index power_ranking_history_format_kickoff on public.power_ranking_history (format, kickoff_at);
create index power_ranking_history_team on public.power_ranking_history (team_id, format, kickoff_at, seq);
create index power_ranking_history_opponent on public.power_ranking_history (opponent_team_id);

-- Formats to replay from a kickoff; the job drains it.
create table public.power_ranking_dirty (
  id bigint generated always as identity primary key,
  format text not null,
  from_kickoff timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.power_ranking_history enable row level security;
alter table public.power_ranking_dirty enable row level security;

revoke all on table public.power_ranking_history from public, anon, authenticated;
revoke all on table public.power_ranking_dirty from public, anon, authenticated;
grant all on table public.power_ranking_history to service_role;
grant all on table public.power_ranking_dirty to service_role;
grant select on table public.power_ranking_history to authenticated;

create policy "Signed-in players read the power ranking history"
  on public.power_ranking_history for select to authenticated using (true);

-- 3. The formula.

-- We: the chance a team with p_points beats one with p_opponent_points.
create function public.power_ranking_expected(p_points numeric, p_opponent_points numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select 1 / (power(10::numeric, -(p_points - p_opponent_points) / (public.app_rules_now()).power_ranking_scale) + 1);
$$;

-- K × (W − We).
create function public.power_ranking_change(p_points numeric, p_opponent_points numeric, p_w numeric, p_k numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select p_k * (p_w - public.power_ranking_expected(p_points, p_opponent_points));
$$;

-- K by importance.
create function public.power_ranking_k(p_category text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case p_category
           when 'non_league' then r.power_ranking_k_non_league
           when 'league' then r.power_ranking_k_league
           when 'tournament_group' then r.power_ranking_k_tournament_group
           when 'tournament_knockout' then r.power_ranking_k_tournament_knockout
         end
  from public.app_rules_now() r;
$$;

-- A league fixture's kickoff: its day and time in Cyprus time; no time:
-- 00:00 on that day; no day: when it was created.
create function public.power_ranking_fixture_kickoff(p_day date, p_time time, p_created_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((p_day + coalesce(p_time, time '00:00')) at time zone 'Asia/Nicosia', p_created_at);
$$;

-- 4. The games that count in p_format from p_from, as at p_now (see the
-- top of this file).
create function public.power_ranking_games(p_format text, p_from timestamptz, p_now timestamptz)
returns table (
  source text,
  game_id uuid,
  kickoff_at timestamptz,
  team_a uuid,
  team_b uuid,
  score_a integer,
  score_b integer,
  category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'match', m.id, m.kickoff_at, sa.team_id, sb.team_id, m.side_a_score, m.side_b_score, 'non_league'
  from public.matches m
  join public.match_sides sa on sa.match_id = m.id and sa.side = 'a'
  join public.match_sides sb on sb.match_id = m.id and sb.side = 'b'
  where m.format = p_format
    and m.kickoff_at >= p_from
    and m.status = 'confirmed'
    and m.forfeit_side is null
    and m.confirmed_via is distinct from 'forfeit'
    and m.is_competitive
    and m.league_fixture_id is null
    and sa.team_id is not null and sb.team_id is not null and sa.team_id <> sb.team_id
    and m.side_a_score is not null and m.side_b_score is not null
    and p_now >= greatest(m.confirmed_at + interval '24 hours', m.result_deadline_at)
    and (m.score_check is null
         or m.score_check = 'accepted'
         or (m.score_check = 'pending' and p_now >= m.score_check_since + interval '24 hours'))
  union all
  select 'league_fixture', f.id, public.power_ranking_fixture_kickoff(f.scheduled_day, f.scheduled_time, f.created_at),
         f.home_team_id, f.away_team_id, f.home_score, f.away_score, 'league'
  from public.league_fixtures f
  join public.leagues l on l.id = f.league_id
  where l.format = p_format
    and f.status = 'completed'
    and f.forfeit_result is null
    and f.home_team_id is not null and f.away_team_id is not null and f.home_team_id <> f.away_team_id
    and f.home_score is not null and f.away_score is not null
    and public.power_ranking_fixture_kickoff(f.scheduled_day, f.scheduled_time, f.created_at) >= p_from;
$$;

-- p_team's points in p_format from the history so far (the start value
-- before its first game).
create function public.power_ranking_points(p_team_id uuid, p_format text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select h.points_after from public.power_ranking_history h
                   where h.team_id = p_team_id and h.format = p_format
                   order by h.kickoff_at desc, h.seq desc limit 1),
                  (public.app_rules_now()).power_ranking_start);
$$;

-- 5. Replays p_format from p_from: removes its history from that kickoff
-- and applies every counted game again in kickoff order, once each.
-- Returns the number of games applied.
create function public.power_ranking_replay(p_format text, p_from timestamptz, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.app_rules := public.app_rules_now();
  g record;
  v_a numeric;
  v_b numeric;
  v_ea numeric;
  v_eb numeric;
  v_wa numeric;
  v_wb numeric;
  v_k numeric;
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('power_ranking:' || p_format));
  delete from public.power_ranking_history where format = p_format and kickoff_at >= p_from;

  for g in
    select * from public.power_ranking_games(p_format, p_from, p_now) x
    order by x.kickoff_at, x.source, x.game_id
  loop
    v_a := public.power_ranking_points(g.team_a, p_format);
    v_b := public.power_ranking_points(g.team_b, p_format);
    v_ea := public.power_ranking_expected(v_a, v_b);
    v_eb := public.power_ranking_expected(v_b, v_a);
    v_wa := case sign(g.score_a - g.score_b) when 1 then r.power_ranking_w_win when 0 then r.power_ranking_w_draw
                 else r.power_ranking_w_loss end;
    v_wb := case sign(g.score_b - g.score_a) when 1 then r.power_ranking_w_win when 0 then r.power_ranking_w_draw
                 else r.power_ranking_w_loss end;
    v_k := public.power_ranking_k(g.category);

    insert into public.power_ranking_history
      (format, source, game_id, kickoff_at, team_id, opponent_team_id, category, goals_for, goals_against, result,
       w, expected, k, points_before, points_after, change)
    values
      (p_format, g.source, g.game_id, g.kickoff_at, g.team_a, g.team_b, g.category, g.score_a, g.score_b,
       case sign(g.score_a - g.score_b) when 1 then 'W' when 0 then 'D' else 'L' end,
       v_wa, v_ea, v_k, v_a, v_a + v_k * (v_wa - v_ea), v_k * (v_wa - v_ea)),
      (p_format, g.source, g.game_id, g.kickoff_at, g.team_b, g.team_a, g.category, g.score_b, g.score_a,
       case sign(g.score_b - g.score_a) when 1 then 'W' when 0 then 'D' else 'L' end,
       v_wb, v_eb, v_k, v_b, v_b + v_k * (v_wb - v_eb), v_k * (v_wb - v_eb));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 6. The job: replays each format from the earliest kickoff that needs it
-- (queued changes, and counted games not applied yet). Idempotent. Returns
-- the number of formats replayed.
create function public.power_ranking_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_formats text[];
  v_froms timestamptz[];
  i integer;
begin
  with dirty as (
    delete from public.power_ranking_dirty returning format, from_kickoff
  ), fresh as (
    select f.format, g.kickoff_at as from_kickoff
    from unnest(array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side']) f(format)
    cross join lateral public.power_ranking_games(f.format, '-infinity', p_now) g
    where not exists (select 1 from public.power_ranking_history h where h.source = g.source and h.game_id = g.game_id)
  ), todo as (
    select x.format, min(x.from_kickoff) as from_kickoff
    from (select d.format, d.from_kickoff from dirty d union all select fr.format, fr.from_kickoff from fresh fr) x
    group by x.format
  )
  select array_agg(t.format order by t.format), array_agg(t.from_kickoff order by t.format)
  into v_formats, v_froms
  from todo t;

  for i in 1 .. coalesce(array_length(v_formats, 1), 0) loop
    perform public.power_ranking_replay(v_formats[i], v_froms[i], p_now);
  end loop;
  return coalesce(array_length(v_formats, 1), 0);
end;
$$;

-- 7. Changes to an applied game queue a replay of its format from the
-- earlier of its applied kickoff and p_kickoff (its new one).
create function public.power_ranking_queue_game(p_source text, p_game_id uuid, p_kickoff timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.power_ranking_dirty (format, from_kickoff)
  select h.format, least(min(h.kickoff_at), coalesce(p_kickoff, min(h.kickoff_at)))
  from public.power_ranking_history h
  where h.source = p_source and h.game_id = p_game_id
  group by h.format;
$$;

create function public.power_ranking_match_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'match_sides' then
    perform public.power_ranking_queue_game('match', old.match_id, null);
  elsif tg_op = 'UPDATE' then
    perform public.power_ranking_queue_game('match', old.id, new.kickoff_at);
  else
    perform public.power_ranking_queue_game('match', old.id, null);
  end if;
  return null;
end;
$$;

create function public.power_ranking_fixture_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.power_ranking_queue_game('league_fixture', old.id,
    case when tg_op = 'UPDATE'
         then public.power_ranking_fixture_kickoff(new.scheduled_day, new.scheduled_time, new.created_at) end);
  return null;
end;
$$;

create function public.power_ranking_team_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.power_ranking_dirty (format, from_kickoff)
  select h.format, min(h.kickoff_at)
  from public.power_ranking_history h
  where h.team_id = old.id or h.opponent_team_id = old.id
  group by h.format;
  return old;
end;
$$;

create trigger matches_power_ranking
  after update of status, side_a_score, side_b_score, forfeit_side, competitive, score_check, score_check_since,
                  confirmed_at, result_deadline_at, kickoff_at, format, league_fixture_id
     or delete
  on public.matches
  for each row execute function public.power_ranking_match_changed();

create trigger match_sides_power_ranking
  after update of team_id or delete
  on public.match_sides
  for each row execute function public.power_ranking_match_changed();

create trigger league_fixtures_power_ranking
  after update of status, home_score, away_score, forfeit_result, home_team_id, away_team_id, league_id,
                  scheduled_day, scheduled_time
     or delete
  on public.league_fixtures
  for each row execute function public.power_ranking_fixture_changed();

create trigger teams_power_ranking
  before delete on public.teams
  for each row execute function public.power_ranking_team_deleted();

-- 8. The list.

-- The listed teams in p_format as at p_at, ranked: points, then more
-- games, then name.
create function public.power_ranking_standing(p_format text, p_at timestamptz)
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
  join public.teams t on t.id = l.team_id;
$$;

-- The ranking in p_format at p_now: rank, team, points, games, the last 3
-- results (latest first) and the change of rank since Monday 00:00 Cyprus
-- time (null when the team wasn't listed then).
create function public.power_ranking_list(p_format text, p_now timestamptz)
returns table (
  rank integer,
  team_id uuid,
  team_name text,
  points numeric,
  matches integer,
  last_results text[],
  rank_change integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_week timestamptz := date_trunc('week', p_now at time zone 'Asia/Nicosia') at time zone 'Asia/Nicosia';
begin
  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side') then
    raise exception 'invalid_format';
  end if;
  return query
  select n.rank, n.team_id, t.name, n.points, n.matches,
         (select array_agg(x.result order by x.kickoff_at desc, x.seq desc)
          from (select h.result, h.kickoff_at, h.seq from public.power_ranking_history h
                where h.team_id = n.team_id and h.format = p_format and h.kickoff_at < p_now
                order by h.kickoff_at desc, h.seq desc limit 3) x),
         w.rank - n.rank
  from public.power_ranking_standing(p_format, p_now) n
  join public.teams t on t.id = n.team_id
  left join public.power_ranking_standing(p_format, v_week) w on w.team_id = n.team_id
  order by n.rank;
end;
$$;

-- For players: the ranking now.
create function public.get_power_ranking(p_format text)
returns table (
  rank integer,
  team_id uuid,
  team_name text,
  points numeric,
  matches integer,
  last_results text[],
  rank_change integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.power_ranking_list(p_format, now());
$$;

-- For players: a team's breakdown in p_format, latest first (at most 100).
create function public.get_power_ranking_history(p_team_id uuid, p_format text, p_limit integer default 20)
returns table (
  game_id uuid,
  kickoff_at timestamptz,
  opponent_team_id uuid,
  opponent_name text,
  category text,
  goals_for integer,
  goals_against integer,
  result text,
  expected numeric,
  points_before numeric,
  points_after numeric,
  change numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_format is null or p_format not in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side') then
    raise exception 'invalid_format';
  end if;
  return query
  select h.game_id, h.kickoff_at, h.opponent_team_id, t.name, h.category, h.goals_for, h.goals_against, h.result,
         h.expected, h.points_before, h.points_after, h.change
  from public.power_ranking_history h
  join public.teams t on t.id = h.opponent_team_id
  where h.team_id = p_team_id and h.format = p_format
  order by h.kickoff_at desc, h.seq desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

-- 9. match_jobs_tick, from 20261125140100_match_s13b_logging.sql, now also
-- running the power ranking job after the levels.
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
           (select count(distinct (e.side_a_score, e.side_b_score)) from public.match_score_entries e
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

-- 10. Grants: internal functions are service_role only; players call the
-- two readers.
revoke all on function public.power_ranking_expected(numeric, numeric) from public, anon, authenticated;
revoke all on function public.power_ranking_change(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.power_ranking_k(text) from public, anon, authenticated;
revoke all on function public.power_ranking_fixture_kickoff(date, time, timestamptz) from public, anon, authenticated;
revoke all on function public.power_ranking_games(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.power_ranking_points(uuid, text) from public, anon, authenticated;
revoke all on function public.power_ranking_replay(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.power_ranking_tick(timestamptz) from public, anon, authenticated;
revoke all on function public.power_ranking_queue_game(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.power_ranking_match_changed() from public, anon, authenticated;
revoke all on function public.power_ranking_fixture_changed() from public, anon, authenticated;
revoke all on function public.power_ranking_team_deleted() from public, anon, authenticated;
revoke all on function public.power_ranking_standing(text, timestamptz) from public, anon, authenticated;
revoke all on function public.power_ranking_list(text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_power_ranking(text) from public, anon, authenticated;
revoke all on function public.get_power_ranking_history(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;

grant execute on function public.power_ranking_expected(numeric, numeric) to service_role;
grant execute on function public.power_ranking_change(numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.power_ranking_k(text) to service_role;
grant execute on function public.power_ranking_fixture_kickoff(date, time, timestamptz) to service_role;
grant execute on function public.power_ranking_games(text, timestamptz, timestamptz) to service_role;
grant execute on function public.power_ranking_points(uuid, text) to service_role;
grant execute on function public.power_ranking_replay(text, timestamptz, timestamptz) to service_role;
grant execute on function public.power_ranking_tick(timestamptz) to service_role;
grant execute on function public.power_ranking_queue_game(text, uuid, timestamptz) to service_role;
grant execute on function public.power_ranking_match_changed() to service_role;
grant execute on function public.power_ranking_fixture_changed() to service_role;
grant execute on function public.power_ranking_team_deleted() to service_role;
grant execute on function public.power_ranking_standing(text, timestamptz) to service_role;
grant execute on function public.power_ranking_list(text, timestamptz) to service_role;
grant execute on function public.get_power_ranking(text) to authenticated, service_role;
grant execute on function public.get_power_ranking_history(uuid, text, integer) to authenticated, service_role;
grant execute on function public.match_jobs_tick() to service_role;
