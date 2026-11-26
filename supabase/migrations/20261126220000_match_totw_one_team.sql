-- S14 follow-up (decided by Panos, 26 November; docs/specs/match-record.md
-- decision 1k item 8): within the general teams of one format, a player is
-- in at most one team a week. Teams are picked All Cyprus → city → venue; a
-- player already in a higher team is passed over and the next best eligible
-- player fills his place. Being passed over is not a skip: no Premium nudge.
-- League teams and other formats are separate. Notifications stay one per
-- week in total (items 6 and 7).
--
-- Re-created from its latest definition,
-- 20261125222247_match_s14_totw_once_a_week.sql (#214), with only these
-- changes:
--   * a temporary totw_used (format, profile_id) of this week's general picks;
--   * in the candidate loop, a general team passes over anyone in totw_used
--     before the Premium check (so it uses no slot and writes no skip);
--   * each general team's picks are added to totw_used;
--   * the scope order keeps league, All Cyprus, city, venue, and orders two
--     teams at the same level by more matches that week, then the area name
--     (was: area_key, i.e. the city key or venue id). Assumption, flagged
--     for Panos on the PR.

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

  -- Players already in a general team of a format this week (Panos, 26
  -- November): a player is in at most one of them. League picks never go
  -- here, so league teams and other formats stay separate.
  create temporary table totw_used (
    format text not null,
    profile_id uuid not null,
    primary key (format, profile_id)
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
           (select count(distinct r.match_id) from totw_rows r
            where r.format = f.format
              and case sc.area
                    when 'league' then r.league_id = sc.league_id
                    when 'all' then r.league_id is null
                    when 'city' then r.league_id is null and r.city_key = sc.area_key
                    else r.league_id is null and r.venue_id = sc.venue_id
                  end) as team_matches,
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
    -- League teams, then All Cyprus, then cities, then venues: a general
    -- team is picked before the lower ones. Two teams at the same level
    -- (two cities, two venues) go by more matches that week first, then
    -- the area name (an assumption, flagged for Panos on the PR).
    order by sc.ord, team_matches desc, area_name, sc.area_key, f.players
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
      -- Already in a higher general team of this format: passed over, and
      -- the next best eligible player takes the place. Not a skip, so no
      -- Premium nudge for it.
      if v_scope.kind = 'general'
         and exists (select 1 from totw_used u where u.format = v_scope.format and u.profile_id = v_cand.profile_id) then
        continue;
      end if;
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

    if v_scope.kind = 'general' then
      insert into totw_used (format, profile_id)
      select v_scope.format, (p ->> 'profile_id')::uuid from jsonb_array_elements(v_picked) p
      on conflict do nothing;
    end if;
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

  drop table totw_used;
  drop table totw_told;
  drop table totw_rows;
  update public.team_of_the_week_runs set teams = v_teams where week_start = v_week;
  return v_teams;
end;
$$;

revoke all on function public.team_of_the_week_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.team_of_the_week_tick(timestamptz) to service_role;
