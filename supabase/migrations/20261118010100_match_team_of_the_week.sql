-- A7a: team of the week (docs/specs/match-record.md section 7, decision 1g.4,
-- agreed 18 November).
--
-- One team of the week for all of Futty, picked every Monday from 09:00
-- Cyprus time by match_jobs_tick, once per week (team_of_the_week_runs),
-- from every confirmed match of the week that ended on Sunday (Monday 00:00
-- to Monday 00:00, Cyprus time).
--
-- Players score points in each match they count in (checked in, or holding
-- a spot in a forfeit; 1b.2, 1b.3), by their position in that match's
-- lineup (none counts as a midfielder):
--   forward      3 per goal, 2 per assist
--   midfielder   3 per assist, 2 per goal, 1 if their side scored 3 or more
--   defender     4 for a clean sheet, 2 per goal, 1 per assist, 1 if their
--                side conceded 1 or fewer
--   keeper       5 for a clean sheet, 2 if their side conceded 1 or fewer
--   everyone     1 for a win, 3 for man of the match (once voting has closed)
-- A forfeit counts as 3-0 (1g.3): the winners get the win, the clean sheet
-- and "scored 3 or more", no one gets a goal; the side that forfeited gets
-- nothing.
-- A player's score is their average points per game that week. Their
-- position is the one from their latest match that week.
-- The team: the best keeper, defender, midfielder and forward (each only if
-- there is one), then the best other player who isn't a keeper. Ties go to
-- more men of the match, then the higher average match rating, then more
-- goals. Each player picked gets a team_of_the_week notification.

insert into public.notification_types (type, always_sent) values ('team_of_the_week', false)
on conflict (type) do nothing;

create table public.team_of_the_week (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check (extract(isodow from week_start) = 1),
  matches integer not null,
  created_at timestamptz not null default now()
);

create table public.team_of_the_week_players (
  team_of_the_week_id uuid not null references public.team_of_the_week (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  position_group text not null check (position_group in ('gk', 'def', 'mid', 'fwd')),
  sort integer not null check (sort between 1 and 5),
  average_points numeric(5, 2) not null,
  games integer not null,
  goals integer not null,
  assists integer not null,
  clean_sheets integer not null,
  motm integer not null,
  average_rating numeric(4, 2),
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

-- Internal: one row per player per counted match, with their position for
-- the team of the week and their points (the rules above).
create view public.team_of_the_week_points as
select
  s.profile_id,
  s.match_id,
  s.kickoff_at,
  g.position_group,
  s.goals,
  s.assists,
  s.motm,
  s.rating,
  (s.team_goals_against = 0) as clean_sheet,
  case
    when s.result = 'L_forfeit' then 0
    else
      case g.position_group
        when 'fwd' then 3 * s.goals + 2 * s.assists
        when 'mid' then 3 * s.assists + 2 * s.goals + case when s.team_goals_for >= 3 then 1 else 0 end
        when 'def' then case when s.team_goals_against = 0 then 4 else 0 end + 2 * s.goals + s.assists
                        + case when s.team_goals_against <= 1 then 1 else 0 end
        else case when s.team_goals_against = 0 then 5 else 0 end
             + case when s.team_goals_against <= 1 then 2 else 0 end
      end
      + case when s.result = 'W' then 1 else 0 end
      + case when s.motm then 3 else 0 end
  end as points
from public.match_stat_players s
cross join lateral (select case when s.position_group = 'outfield' then 'mid' else s.position_group end as position_group) g;

revoke all on public.team_of_the_week_points from public, anon, authenticated;
grant select on public.team_of_the_week_points to service_role;

-- The pick for the week that ended last Sunday, once, from Monday 09:00
-- Cyprus time. Returns 1 when it made a team, 0 otherwise (before 09:00 on
-- a Monday, already picked, or no confirmed match that week).
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
  v_id uuid;
  v_matches integer;
  v_row record;
  v_sort integer := 0;
begin
  if v_local < v_monday + time '09:00' then
    return 0;
  end if;
  insert into public.team_of_the_week_runs (week_start, teams) values (v_week, 0)
  on conflict (week_start) do nothing;
  if not found then
    return 0;
  end if;

  select count(*) into v_matches from public.matches m
  where m.status = 'confirmed' and m.kickoff_at >= v_from and m.kickoff_at < v_to;
  if v_matches = 0 then
    return 0;
  end if;

  insert into public.team_of_the_week (week_start, matches) values (v_week, v_matches) returning id into v_id;

  for v_row in
    with week as (
      select * from public.team_of_the_week_points p where p.kickoff_at >= v_from and p.kickoff_at < v_to
    ),
    candidates as (
      select w.profile_id,
             round(avg(w.points), 2) as average_points,
             count(*)::integer as games,
             sum(w.goals)::integer as goals,
             sum(w.assists)::integer as assists,
             count(*) filter (where w.clean_sheet)::integer as clean_sheets,
             count(*) filter (where w.motm)::integer as motm,
             round(avg(w.rating), 2) as average_rating,
             (array_agg(w.position_group order by w.kickoff_at desc, w.match_id desc))[1] as position_group
      from week w
      group by w.profile_id
    ),
    ranked as (
      select c.*,
             row_number() over (partition by c.position_group
                                order by c.average_points desc, c.motm desc, c.average_rating desc nulls last,
                                         c.goals desc, c.profile_id) as group_rank,
             row_number() over (order by c.average_points desc, c.motm desc, c.average_rating desc nulls last,
                                         c.goals desc, c.profile_id) as overall_rank
      from candidates c
    ),
    firsts as (
      select r.*, case r.position_group when 'gk' then 1 when 'def' then 2 when 'mid' then 3 else 4 end as slot
      from ranked r
      where r.group_rank = 1
    ),
    rest as (
      select r.*, 5 as slot
      from ranked r
      where r.position_group <> 'gk' and r.profile_id not in (select f.profile_id from firsts f)
      order by r.overall_rank
      limit 1
    )
    select * from firsts
    union all
    select * from rest
    order by slot
  loop
    v_sort := v_sort + 1;
    insert into public.team_of_the_week_players (team_of_the_week_id, profile_id, position_group, sort, average_points,
                                                 games, goals, assists, clean_sheets, motm, average_rating)
    values (v_id, v_row.profile_id, v_row.position_group, v_sort, v_row.average_points, v_row.games, v_row.goals,
            v_row.assists, v_row.clean_sheets, v_row.motm, v_row.average_rating);
    perform public.send_notification(v_row.profile_id, 'team_of_the_week', jsonb_build_object(
      'title', 'Team of the week',
      'body', 'You''re in Futty''s team of the week.',
      'teamOfTheWeekId', v_id,
      'weekStart', v_week));
  end loop;

  update public.team_of_the_week_runs set teams = 1 where week_start = v_week;
  return 1;
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

revoke all on function public.team_of_the_week_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.team_of_the_week_tick(timestamptz) to service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
grant execute on function public.match_jobs_tick() to service_role;
