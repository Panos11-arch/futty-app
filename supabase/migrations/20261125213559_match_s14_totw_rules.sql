-- S14: Team of the Week rules (docs/specs/match-record.md decision 1k,
-- decided by Panos on 19, 22 and 24 November) and Friendly games out of
-- public rankings (decided by Panos and Anghelo on 25 November).
--
-- Team of the Week (replaces decision 1g.4; the old tables held picks made
-- under the old rules only, so they are dropped and made again in the new
-- shape: the old picks are deleted).
--   * Kinds: a league team (that league's games only) and a general team
--     (non-league competitive games only), each week and per format. The
--     general team is made for All Cyprus, for each city and for each busy
--     venue: one with 4 or more matches that week that feed the general
--     team (confirmed, non-league, competitive, any format).
--   * Friendly, forfeit, disputed and no-result games never count.
--   * One team per format (5, 6, 7, 9, 11-a-side), from games in that
--     format only, in the shape of team_of_the_week_shapes.
--   * Selection: the best average match rating over the week (at least 1
--     game); ties to more games, then the earlier sign-up. Only players who
--     are Premium (profiles.is_premium) at that moment are picked: a
--     non-Premium player is skipped and the next best eligible player picked.
--   * Placement (team_of_the_week_place): no positions; per-game figures.
--   * Player of the week: the highest rating in the team.
--   * Too few eligible players: the team is made with the filled slots.
--   * Picked: team_of_the_week, as before. Skipped: one premium_offers
--     notification per week and scope (team_of_the_week_skip_scope), a push
--     only if "Premium and offers" is on (off by default, Apple 4.5.4).
--   * When: as before, Monday from 09:00 Cyprus time, the week before, once.
--
-- Friendly games (matches.competitive false) also leave the venue
-- leaderboards (stats_leaderboards) and the venue page's top players
-- (venue_highlights). Personal stats, streaks and streak badges keep them.
--
-- Re-created from their latest definitions, with only these changes:
--   * match_stat_players (20261125140100_match_s13b_logging.sql): adds
--     competitive as its last column;
--   * stats_leaderboards (20261118140000_match_stats_decisions.sql): only
--     competitive games;
--   * venue_highlights (20261124200100_match_venue_highlights.sql): top
--     players from competitive games only;
--   * send_notification (20261118120000_match_whatsapp.sql): a type with no
--     setting row follows notification_types.default_enabled;
--   * team_of_the_week_tick (20261118140000_match_stats_decisions.sql):
--     the rules above. match_jobs_tick calls it as before, unchanged.

-- ---------------------------------------------------------------------------
-- Friendly games out of public rankings
-- ---------------------------------------------------------------------------

-- As 20261125140100, with competitive as the last column.
create or replace view public.match_stat_players as
select
  p.profile_id,
  p.match_id,
  mp.id as player_id,
  p.kickoff_at,
  extract(year from p.kickoff_at at time zone 'Asia/Nicosia')::integer as season_year,
  lf.league_id,
  p.venue_id,
  nullif(lower(btrim(v.city)), '') as city_key,
  p.side,
  p.team_id,
  p.result,
  p.forfeit_side is not null as is_forfeit,
  public.stats_side_goals(p.goals_for, p.forfeit_side, p.side, true) as team_goals_for,
  public.stats_side_goals(p.goals_against, p.forfeit_side, p.side, false) as team_goals_against,
  case
    when mp.position = 'gk' then 'gk'
    when mp.position like 'd%' then 'def'
    when mp.position like 'm%' then 'mid'
    when mp.position like 'f%' then 'fwd'
    else 'outfield'
  end as position_group,
  (select count(*) from public.match_goals g where g.match_id = p.match_id and g.scorer_player_id = mp.id)::integer as goals,
  ((select count(*) from public.match_goals g where g.match_id = p.match_id and g.assist_player_id = mp.id)
   + coalesce((select x.assists from public.match_assists x where x.match_id = p.match_id and x.player_id = mp.id), 0))::integer
    as assists,
  (m.forfeit_side is null and now() >= m.confirmed_at + interval '24 hours'
   and exists (
     with tally as (
       select x.nominee_player_id, count(*) as votes
       from public.motm_votes x where x.match_id = p.match_id
       group by x.nominee_player_id
     )
     select 1 from tally t
     where t.nominee_player_id = mp.id and t.votes = (select max(votes) from tally))) as motm,
  public.match_rating_shown(p.match_id, mp.id) as rating,
  m.competitive
from public.match_form_players p
join public.matches m on m.id = p.match_id
join public.match_players mp on mp.match_id = p.match_id and mp.profile_id = p.profile_id
left join public.venues v on v.id = p.venue_id
left join public.league_fixtures lf on lf.id = m.league_fixture_id;

-- As 20261118140000, from competitive games only.
create or replace view public.stats_leaderboards as
with rows as (
  select k.scope, k.scope_key, s.*
  from public.match_stat_players s
  cross join lateral (values ('venue', s.venue_id::text), ('city', s.city_key)) as k(scope, scope_key)
  where k.scope_key is not null and s.competitive
),
agg as (
  select
    r.scope,
    r.scope_key,
    r.season_year,
    r.profile_id,
    count(*)::integer as appearances,
    sum(r.goals)::integer as goals,
    count(*) filter (where r.motm)::integer as motm,
    count(*) filter (where r.result = 'W')::integer as won,
    round(100.0 * count(*) filter (where r.result = 'W') / count(*))::integer as win_pct
  from rows r
  group by r.scope, r.scope_key, r.season_year, r.profile_id
  having count(*) >= public.stats_min_appearances()
)
select
  a.scope,
  a.scope_key,
  case when a.scope = 'venue' then (select v.name from public.venues v where v.id::text = a.scope_key)
       else (select min(btrim(v.city)) from public.venues v where lower(btrim(v.city)) = a.scope_key) end as scope_name,
  a.season_year,
  a.profile_id,
  a.appearances,
  a.goals,
  a.motm,
  a.won,
  a.win_pct,
  public.stats_min_appearances() as min_appearances,
  rank() over (partition by a.scope, a.scope_key, a.season_year order by a.goals desc)::integer as goals_rank,
  rank() over (partition by a.scope, a.scope_key, a.season_year order by a.motm desc)::integer as motm_rank,
  rank() over (partition by a.scope, a.scope_key, a.season_year order by a.win_pct desc, a.appearances desc)::integer
    as win_rate_rank
from agg a;

-- As 20261124200100, with top players from competitive games only.
create or replace function public.venue_highlights(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.venue_visible(p_venue_id) then
    raise exception 'venue_not_found';
  end if;

  return jsonb_build_object(
    'top_players', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', t.profile_id, 'rating', t.rating, 'matches', t.matches)
                       order by t.rating desc, t.matches desc, t.profile_id)
      from (
        select s.profile_id, round(avg(s.rating), 2) as rating, count(*)::integer as matches
        from (
          select mp.profile_id, public.match_rating_shown(m.id, mp.id) as rating
          from public.matches m
          join public.match_players mp on mp.match_id = m.id and mp.profile_id is not null and mp.left_at is null
          where m.venue_id = p_venue_id
            and m.status = 'confirmed'
            and m.forfeit_side is null
            and m.competitive
            and m.kickoff_at >= now() - interval '30 days'
        ) s
        where s.rating is not null
        group by s.profile_id
        having count(*) >= 3
        order by round(avg(s.rating), 2) desc, count(*) desc, s.profile_id
        limit 5
      ) t), '[]'::jsonb),
    'recent_results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'match_id', r.id,
               'kickoff_at', r.kickoff_at,
               'sides', (select jsonb_agg(jsonb_build_object(
                                  'side', ms.side, 'label', ms.label, 'team_id', ms.team_id,
                                  'score', case ms.side when 'a' then r.side_a_score else r.side_b_score end)
                                order by ms.side)
                         from public.match_sides ms where ms.match_id = r.id))
             order by r.kickoff_at desc, r.id)
      from (
        select m.id, m.kickoff_at, m.side_a_score, m.side_b_score
        from public.matches m
        where m.venue_id = p_venue_id
          and m.status = 'confirmed'
          and m.forfeit_side is null
          and m.side_a_score is not null
          and m.side_b_score is not null
        order by m.kickoff_at desc, m.id
        limit 5
      ) r), '[]'::jsonb));
end;
$$;

revoke all on function public.venue_highlights(uuid) from public, anon;
grant execute on function public.venue_highlights(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- "Premium and offers": a notification type that is off by default
-- ---------------------------------------------------------------------------

alter table public.notification_types add column default_enabled boolean not null default true;

insert into public.notification_types (type, always_sent, default_enabled) values ('premium_offers', false, false)
on conflict (type) do nothing;

-- As 20261118120000, with a type's default when the player has no row.
create or replace function public.send_notification(p_profile_id uuid, p_type text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_always_sent boolean;
  v_default_enabled boolean;
  v_notification_id uuid;
  v_quiet public.notification_quiet_hours;
  v_local timestamp := now() at time zone 'Asia/Nicosia';
  v_now_local time := (now() at time zone 'Asia/Nicosia')::time;
  v_quiet_ends timestamp;
  v_send_after timestamptz;
  v_channel text := 'push';
  v_phone text;
begin
  select t.always_sent, t.default_enabled into v_always_sent, v_default_enabled
  from public.notification_types t where t.type = p_type;
  if not found then
    raise exception 'unknown_notification_type';
  end if;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    p_profile_id, p_type,
    coalesce(p_data ->> 'title', initcap(replace(p_type, '_', ' '))),
    coalesce(p_data ->> 'body', ''),
    coalesce(p_data, '{}'::jsonb) - 'title' - 'body'
  )
  returning id into v_notification_id;

  if not v_always_sent and not coalesce(
    (select s.enabled from public.notification_settings s where s.profile_id = p_profile_id and s.type = p_type),
    v_default_enabled
  ) then
    return;
  end if;

  -- Quiet hours, in Cyprus wall-clock time; they may wrap past midnight
  -- (22:00-07:00). Inside them, a delivery is due when they end.
  select * into v_quiet from public.notification_quiet_hours q where q.profile_id = p_profile_id;
  if found then
    if v_quiet.starts_local < v_quiet.ends_local then
      if v_now_local >= v_quiet.starts_local and v_now_local < v_quiet.ends_local then
        v_quiet_ends := v_local::date + v_quiet.ends_local;
      end if;
    elsif v_now_local >= v_quiet.starts_local then
      v_quiet_ends := (v_local::date + 1) + v_quiet.ends_local;
    elsif v_now_local < v_quiet.ends_local then
      v_quiet_ends := v_local::date + v_quiet.ends_local;
    end if;
    if v_quiet_ends is not null then
      v_send_after := v_quiet_ends at time zone 'Asia/Nicosia';
    end if;
  end if;

  -- The chosen channel, for a WhatsApp-capable type with an active number.
  select c.channel, w.phone_e164 into v_channel, v_phone
  from public.notification_channels c
  join public.whatsapp_contacts w on w.profile_id = c.profile_id and w.opted_out_at is null
  where c.profile_id = p_profile_id and c.type = p_type
    and exists (select 1 from public.whatsapp_notification_types t where t.type = p_type)
    and public.whatsapp_enabled();
  if not found then
    v_channel := 'push';
  end if;

  if v_channel in ('push', 'both') then
    insert into public.notification_deliveries (notification_id, push_token_id, channel, status, send_after)
    select v_notification_id, t.id, 'push',
           case when v_send_after is null then 'queued' else 'held_quiet_hours' end,
           v_send_after
    from public.push_tokens t
    where t.profile_id = p_profile_id;
  end if;

  if v_channel in ('whatsapp', 'both') then
    insert into public.notification_deliveries (notification_id, channel, phone_e164, status, send_after)
    values (v_notification_id, 'whatsapp', v_phone,
            case when v_send_after is null then 'queued' else 'held_quiet_hours' end,
            v_send_after);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Team of the Week tables
-- ---------------------------------------------------------------------------

drop view if exists public.team_of_the_week_points;
drop table if exists public.team_of_the_week_players;
drop table if exists public.team_of_the_week;

-- Decision 1k item 3: how many keepers, defenders, midfielders and strikers.
create table public.team_of_the_week_shapes (
  format text primary key check (format in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')),
  keepers integer not null check (keepers >= 0),
  defenders integer not null check (defenders >= 0),
  midfielders integer not null check (midfielders >= 0),
  strikers integer not null check (strikers >= 0),
  players integer generated always as (keepers + defenders + midfielders + strikers) stored
);

insert into public.team_of_the_week_shapes (format, keepers, defenders, midfielders, strikers) values
  ('5-a-side', 1, 1, 2, 1),
  ('6-a-side', 1, 2, 2, 1),
  ('7-a-side', 1, 2, 3, 1),
  ('9-a-side', 1, 3, 3, 2),
  ('11-a-side', 1, 4, 3, 3);

-- One team per week, kind, area and format. area_key is '' for All Cyprus,
-- the city key (lower-case, trimmed) for a city, the venue id for a venue
-- and the league id for a league.
create table public.team_of_the_week (
  id uuid primary key default gen_random_uuid(),
  week_start date not null check (extract(isodow from week_start) = 1),
  kind text not null check (kind in ('general', 'league')),
  area text not null check (area in ('all', 'city', 'venue', 'league')),
  area_key text not null,
  area_name text not null,
  league_id uuid references public.leagues (id) on delete cascade,
  venue_id uuid references public.venues (id) on delete cascade,
  format text not null references public.team_of_the_week_shapes (format),
  matches integer not null,
  created_at timestamptz not null default now(),
  unique (week_start, kind, area, area_key, format),
  check ((kind = 'league') = (area = 'league')),
  check ((area = 'league') = (league_id is not null)),
  check ((area = 'venue') = (venue_id is not null))
);
create index team_of_the_week_week_idx on public.team_of_the_week (week_start desc);

create table public.team_of_the_week_players (
  team_of_the_week_id uuid not null references public.team_of_the_week (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  slot text not null check (slot in ('gk', 'def', 'mid', 'fwd')),
  sort integer not null check (sort between 1 and 11),
  games integer not null,
  goals integer not null,
  assists integer not null,
  clean_sheets integer not null,
  average_rating numeric(4, 2) not null,
  player_of_the_week boolean not null default false,
  primary key (team_of_the_week_id, profile_id),
  unique (team_of_the_week_id, sort)
);
create unique index team_of_the_week_players_potw on public.team_of_the_week_players (team_of_the_week_id)
  where player_of_the_week;

-- Decision 1k item 7: a skipped player is told once per week and scope
-- (team_of_the_week_skip_scope). Internal.
create table public.team_of_the_week_skips (
  week_start date not null,
  scope_key text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  rating numeric(4, 2) not null,
  notified_at timestamptz not null default now(),
  primary key (week_start, scope_key, profile_id)
);

alter table public.team_of_the_week_shapes enable row level security;
alter table public.team_of_the_week enable row level security;
alter table public.team_of_the_week_players enable row level security;
alter table public.team_of_the_week_skips enable row level security;

create policy "Signed-in users read the team of the week shapes" on public.team_of_the_week_shapes
  for select to authenticated using (true);
create policy "Signed-in users read teams of the week" on public.team_of_the_week
  for select to authenticated using (true);
create policy "Signed-in users read team of the week players" on public.team_of_the_week_players
  for select to authenticated using (true);

revoke all on public.team_of_the_week_shapes, public.team_of_the_week, public.team_of_the_week_players,
  public.team_of_the_week_skips from public, anon, authenticated;
grant select on public.team_of_the_week_shapes, public.team_of_the_week, public.team_of_the_week_players to authenticated;
grant all on public.team_of_the_week_shapes, public.team_of_the_week, public.team_of_the_week_players,
  public.team_of_the_week_skips to service_role;

-- ---------------------------------------------------------------------------
-- Team of the Week functions
-- ---------------------------------------------------------------------------

-- The scope a skip is limited by: one nudge per week for each team kind and
-- area, whatever the format. Returning '' instead would make it one nudge
-- per week in total.
create or replace function public.team_of_the_week_skip_scope(p_kind text, p_area text, p_area_key text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select p_kind || ':' || p_area || ':' || p_area_key;
$$;

-- Decision 1k item 4: places the picked players (p_players: [{profile_id,
-- games, goals, assists, rating, signed_up_at}], at most the shape's size)
-- in p_format's shape, with no positions, from per-game figures:
--   * strikers: the most goals per game;
--   * the rest by goals + assists per game: midfield first, then the
--     lowest in goal, then defence (so with fewer players than slots,
--     defence is left empty first, then the keeper);
--   * ties at every step: more games, then the higher rating, then the
--     earlier sign-up (the tie's loser is the "lowest" for the keeper);
--   * player of the week: the highest rating, then more games, then the
--     earlier sign-up.
-- sort: the keeper first, then defence, midfield and strikers.
create or replace function public.team_of_the_week_place(p_format text, p_players jsonb)
returns table (profile_id uuid, slot text, sort integer, player_of_the_week boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_shape public.team_of_the_week_shapes;
begin
  select * into v_shape from public.team_of_the_week_shapes s where s.format = p_format;
  if not found then
    raise exception 'unknown_format';
  end if;

  return query
  with players as (
    select (x ->> 'profile_id')::uuid as profile_id,
           (x ->> 'games')::integer as games,
           (x ->> 'goals')::numeric / (x ->> 'games')::integer as goals_pg,
           ((x ->> 'goals')::numeric + (x ->> 'assists')::numeric) / (x ->> 'games')::integer as ga_pg,
           (x ->> 'rating')::numeric as rating,
           (x ->> 'signed_up_at')::timestamptz as signed_up_at
    from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) x
  ),
  strikers as (
    select p.profile_id
    from players p
    order by p.goals_pg desc, p.games desc, p.rating desc, p.signed_up_at, p.profile_id
    limit v_shape.strikers
  ),
  rest as (
    select p.*, row_number() over (order by p.ga_pg desc, p.games desc, p.rating desc, p.signed_up_at, p.profile_id) as n,
           count(*) over () as total
    from players p
    where p.profile_id not in (select s.profile_id from strikers s)
  ),
  placed as (
    select s.profile_id, 'fwd' as slot, 4 as line,
           row_number() over (order by p.goals_pg desc, p.games desc, p.rating desc, p.signed_up_at, p.profile_id) as n
    from strikers s join players p on p.profile_id = s.profile_id
    union all
    select r.profile_id,
           case when r.n <= v_shape.midfielders then 'mid'
                when r.n = r.total and v_shape.keepers > 0 then 'gk'
                else 'def' end,
           case when r.n <= v_shape.midfielders then 3 when r.n = r.total and v_shape.keepers > 0 then 1 else 2 end,
           r.n
    from rest r
  ),
  best as (
    select p.profile_id
    from players p
    order by p.rating desc, p.games desc, p.signed_up_at, p.profile_id
    limit 1
  )
  select pl.profile_id, pl.slot, (row_number() over (order by pl.line, pl.n))::integer,
         pl.profile_id = (select b.profile_id from best b)
  from placed pl
  order by pl.line, pl.n;
end;
$$;

-- The picks for the week that ended last Sunday, once, from Monday 09:00
-- Cyprus time (the rules at the top). Returns the number of teams made: 0
-- before 09:00 on a Monday, when already picked, or with no counted game.
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
  v_scope_key text;
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
    v_scope_key := public.team_of_the_week_skip_scope(v_scope.kind, v_scope.area, v_scope.area_key);

    insert into public.team_of_the_week (week_start, kind, area, area_key, area_name, league_id, venue_id, format, matches)
    values (v_week, v_scope.kind, v_scope.area, v_scope.area_key, coalesce(v_scope.area_name, v_scope.area_key),
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
        insert into public.team_of_the_week_skips (week_start, scope_key, profile_id, rating)
        values (v_week, v_scope_key, v_cand.profile_id, v_cand.rating)
        on conflict do nothing;
        if found then
          perform public.send_notification(v_cand.profile_id, 'premium_offers', jsonb_build_object(
            'title', 'Team of the Week',
            'body', format('You''d have made Team of the Week (%s). Get Futty Premium to be eligible.',
                           to_char(round(v_cand.rating, 1), 'FM990.0')),
            'kind', 'team_of_the_week_skipped',
            'teamOfTheWeekId', v_team_id,
            'weekStart', v_week));
        end if;
      end if;
    end loop;

    insert into public.team_of_the_week_players (team_of_the_week_id, profile_id, slot, sort, games, goals, assists,
                                                 clean_sheets, average_rating, player_of_the_week)
    select v_team_id, x.profile_id, x.slot, x.sort, (p ->> 'games')::integer, (p ->> 'goals')::integer,
           (p ->> 'assists')::integer, (p ->> 'clean_sheets')::integer, (p ->> 'rating')::numeric, x.player_of_the_week
    from public.team_of_the_week_place(v_scope.format, v_picked) x
    join jsonb_array_elements(v_picked) p on (p ->> 'profile_id')::uuid = x.profile_id;

    for v_cand in select (p ->> 'profile_id')::uuid as profile_id from jsonb_array_elements(v_picked) p loop
      perform public.send_notification(v_cand.profile_id, 'team_of_the_week', jsonb_build_object(
        'title', 'Team of the week',
        'body', 'You''re in Futty''s team of the week.',
        'teamOfTheWeekId', v_team_id,
        'weekStart', v_week));
    end loop;
  end loop;

  drop table totw_rows;
  update public.team_of_the_week_runs set teams = v_teams where week_start = v_week;
  return v_teams;
end;
$$;

revoke all on function public.team_of_the_week_skip_scope(text, text, text) from public, anon, authenticated;
grant execute on function public.team_of_the_week_skip_scope(text, text, text) to service_role;
revoke all on function public.team_of_the_week_place(text, jsonb) from public, anon, authenticated;
grant execute on function public.team_of_the_week_place(text, jsonb) to service_role;
revoke all on function public.team_of_the_week_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.team_of_the_week_tick(timestamptz) to service_role;
