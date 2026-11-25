-- S14 follow-up (PR #214, approved by Panos on 25 November): at most one
-- Team of the Week notification and one Premium nudge per player per week
-- (docs/specs/match-record.md decision 1k, items 6 and 7).
--   * The tick collects every pick and skip while it makes the teams, then
--     tells each player once, naming his best team: by scope All Cyprus →
--     league → city → venue, then the format he played most that week,
--     then his higher rating in that team, then the smaller format (the
--     last two are an S14 assumption, flagged on the PR), then the area name.
--   * Pick: "You're in the <area> <format> Team of the Week.", opening that
--     team (teamOfTheWeekId). Sent once per week: a re-run sends nothing new.
--   * Nudge: "You'd have made the <area> <format> Team of the Week
--     (<rating>). Get Futty Premium to be eligible.", with that team's
--     rating; one per week (team_of_the_week_skip_scope now returns '').
--
-- Re-created from 20261125213559_match_s14_totw_rules.sql with only these
-- changes: team_of_the_week_skip_scope returns ''; team_of_the_week_tick
-- sends its notifications after the loop, one of each per player.

create or replace function public.team_of_the_week_skip_scope(p_kind text, p_area text, p_area_key text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  -- One nudge per week in total (Panos, 25 November); returning
  -- p_kind || ':' || p_area || ':' || p_area_key would make it one per scope.
  select ''::text;
$$;

create or replace function public.team_of_the_week_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Nicosia';
  v_monday date := date_trunc('week', v_local)::date;
  v_week date := v_monday - 7;
  v_from timestamptz := v_week::timestamp at time zone 'Asia/Nicosia';
  v_to timestamptz := v_monday::timestamp at time zone 'Asia/Nicosia';
  v_scope record;
  v_cand record;
  v_shape public.team_of_the_week_shapes;
  v_team_id uuid;
  v_teams integer := 0;
  v_picked jsonb;
  v_count integer;
  v_scope_rank integer;
  v_area_name text;
  v_told record;
begin
  if v_local < v_monday + time '09:00' then
    return 0;
  end if;
  insert into public.team_of_the_week_runs (week_start, teams) values (v_week, 0)
  on conflict (week_start) do nothing;
  if not found then
    return 0;
  end if;

  -- The counted games of the week, one row per player per game.
  create temporary table totw_rows on commit drop as
  select s.profile_id, s.match_id, m.format, s.league_id, s.venue_id, s.city_key, s.goals, s.assists,
         (s.team_goals_against = 0) as clean_sheet, s.rating
  from public.match_stat_players s
  join public.matches m on m.id = s.match_id
  where s.kickoff_at >= v_from and s.kickoff_at < v_to
    and s.competitive and not s.is_forfeit and s.rating is not null;

  -- Every pick and skip of the week; each player is told once, after all
  -- teams are made (Panos, 25 November).
  create temporary table totw_told (
    picked boolean not null,
    profile_id uuid not null,
    team_id uuid not null,
    scope_rank integer not null,
    games integer not null,
    rating numeric not null,
    players integer not null,
    area_name text not null,
    format text not null
  ) on commit drop;

  for v_scope in
    with scopes as (
      select distinct 'league' as kind, 'league' as area, r.league_id::text as area_key, r.league_id, null::uuid as venue_id,
             1 as ord
      from totw_rows r where r.league_id is not null
      union all
      select distinct 'general', 'all', '', null::uuid, null::uuid, 2
      from totw_rows r where r.league_id is null
      union all
      select distinct 'general', 'city', r.city_key, null::uuid, null::uuid, 3
      from totw_rows r where r.league_id is null and r.city_key is not null
      union all
      select distinct 'general', 'venue', r.venue_id::text, null::uuid, r.venue_id, 4
      from totw_rows r
      where r.league_id is null and r.venue_id is not null
        and (select count(*) from public.matches m
             left join public.league_fixtures lf on lf.id = m.league_fixture_id
             where m.venue_id = r.venue_id and m.status = 'confirmed' and m.competitive and lf.league_id is null
               and m.kickoff_at >= v_from and m.kickoff_at < v_to) >= 4
    )
    select sc.*, f.format, f.players,
           case sc.area
             when 'league' then coalesce((select l.name from public.leagues l where l.id = sc.league_id), 'League')
             when 'all' then 'All Cyprus'
             when 'city' then (select min(btrim(v.city)) from public.venues v where lower(btrim(v.city)) = sc.area_key)
             else (select v.name from public.venues v where v.id = sc.venue_id)
           end as area_name
    from scopes sc
    cross join public.team_of_the_week_shapes f
    where exists (
      select 1 from totw_rows r
      where r.format = f.format
        and case sc.area
              when 'league' then r.league_id = sc.league_id
              when 'all' then r.league_id is null
              when 'city' then r.league_id is null and r.city_key = sc.area_key
              else r.league_id is null and r.venue_id = sc.venue_id
            end)
    order by sc.ord, sc.area_key, f.players
  loop
    select * into v_shape from public.team_of_the_week_shapes s where s.format = v_scope.format;
    v_scope_rank := case v_scope.area when 'all' then 1 when 'league' then 2 when 'city' then 3 else 4 end;
    v_area_name := coalesce(v_scope.area_name, v_scope.area_key);

    insert into public.team_of_the_week (week_start, kind, area, area_key, area_name, league_id, venue_id, format, matches)
    values (v_week, v_scope.kind, v_scope.area, v_scope.area_key, v_area_name,
            v_scope.league_id, v_scope.venue_id, v_scope.format,
            (select count(distinct r.match_id) from totw_rows r
             where r.format = v_scope.format
               and case v_scope.area
                     when 'league' then r.league_id = v_scope.league_id
                     when 'all' then r.league_id is null
                     when 'city' then r.league_id is null and r.city_key = v_scope.area_key
                     else r.league_id is null and r.venue_id = v_scope.venue_id
                   end))
    returning id into v_team_id;
    v_teams := v_teams + 1;

    -- Walk the ranking: Premium players are picked until the shape is
    -- full; a non-Premium player above the last pick is skipped.
    v_picked := '[]'::jsonb;
    v_count := 0;
    for v_cand in
      select r.profile_id,
             count(distinct r.match_id)::integer as games,
             sum(r.goals)::integer as goals,
             sum(r.assists)::integer as assists,
             count(*) filter (where r.clean_sheet)::integer as clean_sheets,
             round(avg(r.rating), 2) as rating,
             pr.created_at as signed_up_at,
             pr.is_premium
      from totw_rows r
      join public.profiles pr on pr.id = r.profile_id
      where r.format = v_scope.format
        and case v_scope.area
              when 'league' then r.league_id = v_scope.league_id
              when 'all' then r.league_id is null
              when 'city' then r.league_id is null and r.city_key = v_scope.area_key
              else r.league_id is null and r.venue_id = v_scope.venue_id
            end
      group by r.profile_id, pr.created_at, pr.is_premium
      order by round(avg(r.rating), 2) desc, count(distinct r.match_id) desc, pr.created_at, r.profile_id
    loop
      exit when v_count >= v_shape.players;
      if v_cand.is_premium then
        v_count := v_count + 1;
        v_picked := v_picked || jsonb_build_array(jsonb_build_object(
          'profile_id', v_cand.profile_id, 'games', v_cand.games, 'goals', v_cand.goals, 'assists', v_cand.assists,
          'clean_sheets', v_cand.clean_sheets, 'rating', v_cand.rating, 'signed_up_at', v_cand.signed_up_at));
      else
        insert into totw_told values (false, v_cand.profile_id, v_team_id, v_scope_rank, v_cand.games, v_cand.rating,
                                      v_shape.players, v_area_name, v_scope.format);
      end if;
    end loop;

    insert into public.team_of_the_week_players (team_of_the_week_id, profile_id, slot, sort, games, goals, assists,
                                                 clean_sheets, average_rating, player_of_the_week)
    select v_team_id, x.profile_id, x.slot, x.sort, (p ->> 'games')::integer, (p ->> 'goals')::integer,
           (p ->> 'assists')::integer, (p ->> 'clean_sheets')::integer, (p ->> 'rating')::numeric, x.player_of_the_week
    from public.team_of_the_week_place(v_scope.format, v_picked) x
    join jsonb_array_elements(v_picked) p on (p ->> 'profile_id')::uuid = x.profile_id;

    insert into totw_told
    select true, (p ->> 'profile_id')::uuid, v_team_id, v_scope_rank, (p ->> 'games')::integer, (p ->> 'rating')::numeric,
           v_shape.players, v_area_name, v_scope.format
    from jsonb_array_elements(v_picked) p;
  end loop;

  -- One of each per player: the best team by scope (All Cyprus, league,
  -- city, venue), then the format he played most, then his higher rating
  -- there, then the smaller format (then the area name, to be certain).
  for v_told in
    select distinct on (t.picked, t.profile_id) t.*
    from totw_told t
    order by t.picked, t.profile_id, t.scope_rank, t.games desc, t.rating desc, t.players, t.area_name, t.team_id
  loop
    if v_told.picked then
      if not exists (select 1 from public.notifications n
                     where n.profile_id = v_told.profile_id and n.type = 'team_of_the_week'
                       and n.data ->> 'weekStart' = v_week::text) then
        perform public.send_notification(v_told.profile_id, 'team_of_the_week', jsonb_build_object(
          'title', 'Team of the Week',
          'body', format('You''re in the %s %s Team of the Week.', v_told.area_name, v_told.format),
          'teamOfTheWeekId', v_told.team_id,
          'weekStart', v_week));
      end if;
    else
      insert into public.team_of_the_week_skips (week_start, scope_key, profile_id, rating)
      values (v_week, public.team_of_the_week_skip_scope('general', 'all', ''), v_told.profile_id, v_told.rating)
      on conflict do nothing;
      if found then
        perform public.send_notification(v_told.profile_id, 'premium_offers', jsonb_build_object(
          'title', 'Team of the Week',
          'body', format('You''d have made the %s %s Team of the Week (%s). Get Futty Premium to be eligible.',
                         v_told.area_name, v_told.format, to_char(round(v_told.rating, 1), 'FM990.0')),
          'kind', 'team_of_the_week_skipped',
          'teamOfTheWeekId', v_told.team_id,
          'weekStart', v_week));
      end if;
    end if;
  end loop;

  drop table totw_told;
  drop table totw_rows;
  update public.team_of_the_week_runs set teams = v_teams where week_start = v_week;
  return v_teams;
end;
$$;

revoke all on function public.team_of_the_week_skip_scope(text, text, text) from public, anon, authenticated;
grant execute on function public.team_of_the_week_skip_scope(text, text, text) to service_role;
revoke all on function public.team_of_the_week_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.team_of_the_week_tick(timestamptz) to service_role;
