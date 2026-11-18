-- A7a: team of the week (docs/specs/match-record.md section 7, decision 1g.4).
--
-- Every Monday from 09:00 Cyprus time, match_jobs_tick picks the teams of
-- the week that ended on Sunday (Monday 00:00 to Monday 00:00, Cyprus
-- time), once per week (team_of_the_week_runs):
--   - one per venue with 4 or more confirmed matches that week;
--   - one per city for the other venues' matches (venues.city, compared
--     without case or spaces; a venue with no city is left out);
--   - one per league with matches that week.
-- Candidates are players with a match rating that week (3 or more ratings,
-- the ratings window closed by the time of the pick; decision 1f.4). Their
-- score is the average of those match ratings; ties go to more men of the
-- match, then more goals. Each player's group is the position of their
-- latest rated match that week: gk, def (d1...), mid (m1...), fwd (f1...),
-- or outfield when they had none.
-- The team is five players: the best keeper, the best defender, the best
-- midfielder and the best forward (each only if there is one), then the
-- best of everyone else who isn't a keeper until there are five.
-- Each selected player gets a team_of_the_week notification.

insert into public.notification_types (type, always_sent) values ('team_of_the_week', false)
on conflict (type) do nothing;

create table public.team_of_the_week (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  scope text not null check (scope in ('venue', 'city', 'league')),
  venue_id uuid references public.venues (id) on delete cascade,
  city_key text,
  league_id uuid references public.leagues (id) on delete cascade,
  name text not null,
  matches integer not null,
  created_at timestamptz not null default now(),
  check (extract(isodow from week_start) = 1),
  check ((scope = 'venue') = (venue_id is not null)),
  check ((scope = 'city') = (city_key is not null)),
  check ((scope = 'league') = (league_id is not null))
);

create unique index team_of_the_week_scope_key
  on public.team_of_the_week (week_start, scope, coalesce(venue_id::text, city_key, league_id::text));

create table public.team_of_the_week_players (
  team_of_the_week_id uuid not null references public.team_of_the_week (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  position_group text not null check (position_group in ('gk', 'def', 'mid', 'fwd', 'outfield')),
  sort integer not null,
  average_rating numeric(4, 2) not null,
  rated_matches integer not null,
  motm integer not null,
  goals integer not null,
  primary key (team_of_the_week_id, profile_id),
  unique (team_of_the_week_id, sort)
);

create table public.team_of_the_week_runs (
  week_start date primary key,
  teams integer not null,
  ran_at timestamptz not null default now()
);

alter table public.team_of_the_week enable row level security;
alter table public.team_of_the_week_players enable row level security;
alter table public.team_of_the_week_runs enable row level security;

create policy "Signed-in users read teams of the week" on public.team_of_the_week
  for select to authenticated using (true);
create policy "Signed-in users read team of the week players" on public.team_of_the_week_players
  for select to authenticated using (true);

revoke all on public.team_of_the_week, public.team_of_the_week_players, public.team_of_the_week_runs
  from public, anon, authenticated;
grant select on public.team_of_the_week, public.team_of_the_week_players to authenticated;
grant all on public.team_of_the_week, public.team_of_the_week_players, public.team_of_the_week_runs to service_role;

-- Picks the five players for one scope and week, writes them and notifies
-- them. p_matches are the scope's confirmed matches that week. Returns 1
-- for a team made, 0 when nobody in the scope has a match rating.
create or replace function public.team_of_the_week_save(
  p_week_start date,
  p_scope text,
  p_venue_id uuid,
  p_city_key text,
  p_league_id uuid,
  p_name text,
  p_matches uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_row record;
  v_count integer := 0;
begin
  insert into public.team_of_the_week (week_start, scope, venue_id, city_key, league_id, name, matches)
  values (p_week_start, p_scope, p_venue_id, p_city_key, p_league_id, p_name, coalesce(array_length(p_matches, 1), 0))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return 0;
  end if;

  for v_row in
    with rated as (
      select s.* from public.match_stat_players s
      where s.match_id = any(p_matches) and s.rating is not null
    ),
    candidates as (
      select r.profile_id,
             round(avg(r.rating), 2) as average_rating,
             count(*)::integer as rated_matches,
             (select count(*) from public.match_stat_players x
              where x.profile_id = r.profile_id and x.match_id = any(p_matches) and x.motm)::integer as motm,
             (select coalesce(sum(x.goals), 0) from public.match_stat_players x
              where x.profile_id = r.profile_id and x.match_id = any(p_matches))::integer as goals,
             (array_agg(r.position_group order by r.kickoff_at desc, r.match_id desc))[1] as position_group
      from rated r
      group by r.profile_id
    ),
    ranked as (
      select c.*,
             row_number() over (partition by c.position_group
                                order by c.average_rating desc, c.motm desc, c.goals desc, c.profile_id) as group_rank,
             row_number() over (order by c.average_rating desc, c.motm desc, c.goals desc, c.profile_id) as overall_rank
      from candidates c
    ),
    firsts as (
      select r.*, case r.position_group when 'gk' then 1 when 'def' then 2 when 'mid' then 3 else 4 end as sort
      from ranked r
      where r.group_rank = 1 and r.position_group in ('gk', 'def', 'mid', 'fwd')
    ),
    rest as (
      select r.*, 4 + row_number() over (order by r.overall_rank) as sort
      from ranked r
      where r.position_group <> 'gk' and r.profile_id not in (select f.profile_id from firsts f)
      order by r.overall_rank
      limit greatest(0, 5 - (select count(*) from firsts))
    )
    select * from firsts
    union all
    select * from rest
    order by sort
  loop
    v_count := v_count + 1;
    insert into public.team_of_the_week_players (team_of_the_week_id, profile_id, position_group, sort, average_rating,
                                                 rated_matches, motm, goals)
    values (v_id, v_row.profile_id, v_row.position_group, v_count, v_row.average_rating, v_row.rated_matches,
            v_row.motm, v_row.goals);
    perform public.send_notification(v_row.profile_id, 'team_of_the_week', jsonb_build_object(
      'title', 'Team of the week',
      'body', format('You''re in the team of the week: %s.', p_name),
      'teamOfTheWeekId', v_id,
      'weekStart', p_week_start));
  end loop;
  -- Nobody in the scope has a match rating yet: no team for it.
  if v_count = 0 then
    delete from public.team_of_the_week where id = v_id;
    return 0;
  end if;
  return 1;
end;
$$;

-- The pick for the week that ended last Sunday, once, from Monday 09:00
-- Cyprus time. Returns how many teams it made (0 before 09:00 on a Monday,
-- or when the week was already picked).
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
  v_teams integer := 0;
  v_row record;
begin
  if v_local < v_monday + time '09:00' then
    return 0;
  end if;
  insert into public.team_of_the_week_runs (week_start, teams) values (v_week, 0)
  on conflict (week_start) do nothing;
  if not found then
    return 0;
  end if;

  -- Venues with 4 or more confirmed matches; the rest pooled by city.
  for v_row in
    with week as (
      select m.id, m.venue_id, nullif(lower(btrim(v.city)), '') as city_key, btrim(v.city) as city, v.name as venue_name
      from public.matches m
      left join public.venues v on v.id = m.venue_id
      where m.status = 'confirmed' and m.kickoff_at >= v_from and m.kickoff_at < v_to
    ),
    busy as (
      select venue_id from week where venue_id is not null group by venue_id having count(*) >= 4
    )
    select 'venue' as scope, w.venue_id, null::text as city_key, min(w.venue_name) as name, array_agg(w.id) as ids
    from week w where w.venue_id in (select venue_id from busy)
    group by w.venue_id
    union all
    select 'city', null, w.city_key, min(w.city), array_agg(w.id)
    from week w
    where w.city_key is not null and (w.venue_id is null or w.venue_id not in (select venue_id from busy))
    group by w.city_key
  loop
    v_teams := v_teams + public.team_of_the_week_save(v_week, v_row.scope, v_row.venue_id, v_row.city_key, null,
                                                      v_row.name, v_row.ids);
  end loop;

  -- Leagues.
  for v_row in
    select lf.league_id, coalesce(min(l.name), 'Your league') as name, array_agg(m.id) as ids
    from public.matches m
    join public.league_fixtures lf on lf.id = m.league_fixture_id
    left join public.leagues l on l.id = lf.league_id
    where m.status = 'confirmed' and m.kickoff_at >= v_from and m.kickoff_at < v_to and lf.league_id is not null
    group by lf.league_id
  loop
    v_teams := v_teams + public.team_of_the_week_save(v_week, 'league', null, null, v_row.league_id, v_row.name,
                                                      v_row.ids);
  end loop;

  update public.team_of_the_week_runs set teams = v_teams where week_start = v_week;
  return v_teams;
end;
$$;

-- match_jobs_tick, from 20261117192224_match_levels_functions.sql, now also
-- runs the team of the week pick ("team_of_the_week" in the counts).
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
    select m.id, m.result_deadline_at, s.side_a_score, s.side_b_score
    from public.matches m
    join public.match_result_submissions s on s.match_id = m.id
    where m.status in ('scheduled', 'played') and m.result_deadline_at <= now() and s.response is null
    order by m.result_deadline_at, m.id
    for update of m
  loop
    update public.matches
    set status = 'confirmed', side_a_score = v_row.side_a_score, side_b_score = v_row.side_b_score,
        confirmed_via = 'deadline', confirmed_at = v_row.result_deadline_at
    where id = v_row.id;
    perform public.match_notify(v_row.id, 'match_result_confirmed', 'Result confirmed',
      public.match_score_line(v_row.id, v_row.side_a_score, v_row.side_b_score), array['a', 'b'], true, null);
    v_confirmed := v_confirmed + 1;
  end loop;

  update public.matches m
  set status = 'no_result'
  where m.status in ('scheduled', 'played') and m.result_deadline_at <= now()
    and not exists (select 1 from public.match_result_submissions s where s.match_id = m.id);
  get diagnostics v_no_result = row_count;

  return jsonb_build_object('played', v_played, 'confirmed', v_confirmed, 'no_result', v_no_result, 'voided', v_voided)
         || public.match_reminders_tick(now())
         || jsonb_build_object('levels', public.match_levels_tick(now()))
         || jsonb_build_object('team_of_the_week', public.team_of_the_week_tick(now()));
end;
$$;

revoke all on function public.team_of_the_week_save(date, text, uuid, text, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.team_of_the_week_save(date, text, uuid, text, uuid, text, uuid[]) to service_role;
revoke all on function public.team_of_the_week_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.team_of_the_week_tick(timestamptz) to service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
grant execute on function public.match_jobs_tick() to service_role;
