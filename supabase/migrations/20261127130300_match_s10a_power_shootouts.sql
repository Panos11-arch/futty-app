-- S10A, part 3 of 4: tournament games in the power ranking, and
-- shootouts switched on (match-record.md decision 1m items 3 and 4, 1o).
--
-- 1. Tournament fixtures count from the moment they complete (a final
--    match's result, or the organiser's), in the tournament's format, with
--    S14b's stored K: group 40 (tournament_group), knockout 50
--    (tournament_knockout). Kickoff: the fixture's kick-off time; a result
--    entered without one counts at the moment it was completed. A
--    tournament match is left to its fixture, so a game never counts twice.
-- 2. Shootouts (decided by Panos, 25 November): with
--    app_rules.power_ranking_shootouts on, a drawn game decided on
--    penalties scores W = power_ranking_w_shootout_win (0.75) for the
--    winner and power_ranking_w_shootout_loss (0.5) for the loser. Between
--    equal teams in a knockout (K 50): +12.5 and 0.
--
-- Re-created from their latest definitions (20261126090053_match_power_ranking.sql;
-- diffs in the PR): power_ranking_games (its result gains pens_a and
-- pens_b, so it is dropped and created, with its grants) and
-- power_ranking_replay. power_ranking_tick reads power_ranking_games by
-- name and is unchanged.

-- ---- 1. Rules and history -----------------------------------------------------------------

alter table public.app_rules alter column power_ranking_shootouts set default true;
update public.app_rules set power_ranking_shootouts = true;

alter table public.power_ranking_history drop constraint power_ranking_history_source_check;
alter table public.power_ranking_history add constraint power_ranking_history_source_check
  check (source in ('match', 'league_fixture', 'tournament_fixture'));

-- ---- 2. The games that count ----------------------------------------------------------------

drop function public.power_ranking_games(text, timestamptz, timestamptz);

create function public.power_ranking_games(p_format text, p_from timestamptz, p_now timestamptz)
returns table (
  source text,
  game_id uuid,
  kickoff_at timestamptz,
  team_a uuid,
  team_b uuid,
  score_a integer,
  score_b integer,
  category text,
  pens_a integer,
  pens_b integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'match', m.id, m.kickoff_at, sa.team_id, sb.team_id, m.side_a_score, m.side_b_score, 'non_league',
         null::integer, null::integer
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
    and m.tournament_fixture_id is null
    and sa.team_id is not null and sb.team_id is not null and sa.team_id <> sb.team_id
    and m.side_a_score is not null and m.side_b_score is not null
    and p_now >= greatest(m.confirmed_at + interval '24 hours', m.result_deadline_at)
    and (m.score_check is null
         or m.score_check = 'accepted'
         or (m.score_check = 'pending' and p_now >= m.score_check_since + interval '24 hours'))
  union all
  select 'league_fixture', f.id, public.power_ranking_fixture_kickoff(f.scheduled_day, f.scheduled_time, f.created_at),
         f.home_team_id, f.away_team_id, f.home_score, f.away_score, 'league', null::integer, null::integer
  from public.league_fixtures f
  join public.leagues l on l.id = f.league_id
  where l.format = p_format
    and f.status = 'completed'
    and f.forfeit_result is null
    and f.home_team_id is not null and f.away_team_id is not null and f.home_team_id <> f.away_team_id
    and f.home_score is not null and f.away_score is not null
    and public.power_ranking_fixture_kickoff(f.scheduled_day, f.scheduled_time, f.created_at) >= p_from
  union all
  select 'tournament_fixture', f.id, coalesce(f.kickoff_at, f.completed_at, f.created_at),
         f.home_team_id, f.away_team_id, f.home_score, f.away_score,
         case f.stage when 'group' then 'tournament_group' else 'tournament_knockout' end,
         f.home_pens, f.away_pens
  from public.tournament_fixtures f
  join public.tournaments t on t.id = f.tournament_id
  where t.format = p_format
    and f.status = 'completed'
    and f.home_team_id is not null and f.away_team_id is not null and f.home_team_id <> f.away_team_id
    and f.home_score is not null and f.away_score is not null
    and coalesce(f.kickoff_at, f.completed_at, f.created_at) >= p_from;
$$;

-- ---- 3. The replay --------------------------------------------------------------------------

-- Change: a drawn game decided on penalties scores the shootout W values
-- while power_ranking_shootouts is on.
create or replace function public.power_ranking_replay(p_format text, p_from timestamptz, p_now timestamptz default now())
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
    if r.power_ranking_shootouts and g.score_a = g.score_b and g.pens_a is not null and g.pens_b is not null
       and g.pens_a <> g.pens_b then
      v_wa := case when g.pens_a > g.pens_b then r.power_ranking_w_shootout_win else r.power_ranking_w_shootout_loss end;
      v_wb := case when g.pens_b > g.pens_a then r.power_ranking_w_shootout_win else r.power_ranking_w_shootout_loss end;
    else
      v_wa := case sign(g.score_a - g.score_b) when 1 then r.power_ranking_w_win when 0 then r.power_ranking_w_draw
                   else r.power_ranking_w_loss end;
      v_wb := case sign(g.score_b - g.score_a) when 1 then r.power_ranking_w_win when 0 then r.power_ranking_w_draw
                   else r.power_ranking_w_loss end;
    end if;
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

-- ---- 4. Changes queue a replay ----------------------------------------------------------------

create function public.power_ranking_tournament_fixture_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.power_ranking_queue_game('tournament_fixture', old.id,
    case when tg_op = 'UPDATE' then coalesce(new.kickoff_at, new.completed_at, new.created_at) end);
  return null;
end;
$$;

create trigger tournament_fixtures_power_ranking
  after update of status, home_score, away_score, home_pens, away_pens, home_team_id, away_team_id, kickoff_at,
                  completed_at
     or delete
  on public.tournament_fixtures
  for each row execute function public.power_ranking_tournament_fixture_changed();

-- ---- 5. Grants ------------------------------------------------------------------------------

revoke all on function public.power_ranking_games(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.power_ranking_games(text, timestamptz, timestamptz) to service_role;
revoke all on function public.power_ranking_tournament_fixture_changed() from public, anon, authenticated;
