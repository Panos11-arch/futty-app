-- A11 streaks and streak badges (docs/specs/match-record.md, decision 1i).
--
-- A streak is Cyprus weeks (Monday to Sunday) in a row in which the player
-- counted in at least one confirmed match (match_form_players: 1b.2, 1b.3).
-- It is worked out from the match record whenever it is read; nothing is
-- stored but the badges.
--
-- Each week is one of:
--   played    the player counted in a confirmed match that week. It beats
--             anything else in the same week.
--   broken    no counted match, and the player cancelled their own spot
--             (my_spot) or, as the booker, the whole booking (whole_team)
--             of a game that week. Ends the streak. For the booking's other
--             players a whole_team cancellation is an ordinary missed week.
--   forgiven  no counted match, and the venue cancelled the player's game
--             (scope venue: any reason, weather and blocks included), or a
--             Gipedo Pano game was cancelled for want of an opponent
--             (gipedo_choice cancel or auto_cancel). Skipped: neither
--             played nor missed.
--   missed    anything else. One missed week is allowed; two in a row end
--             the streak.
-- The count is played weeks only. The week in progress counts as soon as
-- the player has a counted match in it and is never held against them.
-- A cancelled game's week is its booking_day's (a Cyprus date).
--
-- Badges: Bronze 2 weeks, Silver 4, Gold 8, Platinum 12, Diamond 20,
-- Champion 30, each awarded once to every player who reaches it, Premium or
-- not, by match_jobs_tick's weekly step (Monday from 09:00 Cyprus time, as
-- team of the week), from the player's best streak through last Sunday.
-- The player is told (streak_badge, can be turned off). Badges are shown in
-- colour only while the player is Premium (profiles.is_premium); the app
-- greys them otherwise, and they stay earned when Premium ends.

insert into public.notification_types (type, always_sent) values ('streak_badge', false)
on conflict (type) do nothing;

create table public.streak_badge_levels (
  badge text primary key,
  label text not null,
  weeks integer not null unique check (weeks > 0),
  sort integer not null unique
);

insert into public.streak_badge_levels (badge, label, weeks, sort) values
  ('bronze', 'Bronze', 2, 1),
  ('silver', 'Silver', 4, 2),
  ('gold', 'Gold', 8, 3),
  ('platinum', 'Platinum', 12, 4),
  ('diamond', 'Diamond', 20, 5),
  ('champion', 'Champion', 30, 6);

create table public.streak_badges (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  badge text not null references public.streak_badge_levels (badge),
  awarded_at timestamptz not null default now(),
  primary key (profile_id, badge)
);

-- One row per week the badge step has run (idempotency, as
-- team_of_the_week_runs).
create table public.streak_badge_runs (
  week_start date primary key check (extract(isodow from week_start) = 1),
  awarded integer not null default 0,
  ran_at timestamptz not null default now()
);

alter table public.streak_badge_levels enable row level security;
alter table public.streak_badges enable row level security;
alter table public.streak_badge_runs enable row level security;

create policy "Signed-in users read the streak badge levels" on public.streak_badge_levels
  for select to authenticated using (true);
-- Badges are shown on profiles, so everyone signed in reads them.
create policy "Signed-in users read streak badges" on public.streak_badges
  for select to authenticated using (true);

revoke all on public.streak_badge_levels, public.streak_badges, public.streak_badge_runs
  from public, anon, authenticated;
grant select on public.streak_badge_levels, public.streak_badges to authenticated;
grant all on public.streak_badge_levels, public.streak_badges, public.streak_badge_runs to service_role;

-- Internal: p_profile_id's played, broken and forgiven weeks (Mondays) as
-- they stand at p_now, up to and including the week of p_now, oldest
-- first. Only matches that kicked off by p_now count. Missed weeks are the
-- ones not listed.
create or replace function public.player_streak_weeks(p_profile_id uuid, p_now timestamptz)
returns table (week_start date, state text)
language sql
stable
security definer
set search_path = ''
as $$
  with events as (
    select date_trunc('week', fp.kickoff_at at time zone 'Asia/Nicosia')::date as w, 1 as rank
    from public.match_form_players fp
    where fp.profile_id = p_profile_id and fp.kickoff_at <= p_now
    union all
    select date_trunc('week', b.booking_day::timestamp)::date, 2
    from public.booking_cancellations c
    join public.venue_bookings b on b.id = c.booking_id
    where c.scope in ('my_spot', 'whole_team') and c.cancelled_by = p_profile_id
    union all
    select date_trunc('week', b.booking_day::timestamp)::date, 3
    from public.booking_cancellation_lines l
    join public.booking_cancellations c on c.id = l.cancellation_id
    join public.venue_bookings b on b.id = c.booking_id
    where c.scope = 'venue' and l.profile_id = p_profile_id
    union all
    select date_trunc('week', b.booking_day::timestamp)::date, 3
    from public.venue_bookings b
    where b.status = 'cancelled' and b.gipedo_choice in ('cancel', 'auto_cancel')
      and exists (select 1 from public.booking_payment_shares s where s.booking_id = b.id and s.profile_id = p_profile_id)
  )
  select w, (array['played', 'broken', 'forgiven'])[min(rank)]
  from events
  where w <= date_trunc('week', p_now at time zone 'Asia/Nicosia')::date
  group by w
  order by w;
$$;

-- Internal: p_profile_id's current and best streak at p_now.
create or replace function public.player_streak(p_profile_id uuid, p_now timestamptz default now())
returns table (current_weeks integer, best_weeks integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_this_week date := date_trunc('week', p_now at time zone 'Asia/Nicosia')::date;
  v_weeks jsonb;
  v_first date;
  v_state text;
  v_week date;
  v_misses integer := 0;
begin
  current_weeks := 0;
  best_weeks := 0;
  select jsonb_object_agg(w.week_start::text, w.state), min(w.week_start) filter (where w.state = 'played')
  into v_weeks, v_first
  from public.player_streak_weeks(p_profile_id, p_now) w;
  if v_first is null then
    return next;
    return;
  end if;

  v_week := v_first;
  while v_week <= v_this_week loop
    v_state := v_weeks ->> v_week::text;
    if v_state = 'played' then
      current_weeks := current_weeks + 1;
      v_misses := 0;
    elsif v_week = v_this_week then
      null;  -- in progress: not judged until it ends
    elsif v_state = 'broken' then
      current_weeks := 0;
      v_misses := 0;
    elsif v_state = 'forgiven' then
      null;  -- skipped: neither played nor missed
    else
      v_misses := v_misses + 1;
      if v_misses >= 2 then
        current_weeks := 0;
        v_misses := 0;
      end if;
    end if;
    best_weeks := greatest(best_weeks, current_weeks);
    v_week := v_week + 7;
  end loop;
  return next;
end;
$$;

-- The caller's own streak and all six badge levels, earned or not.
-- isPremium decides whether the app shows earned badges in colour.
create or replace function public.get_my_streak()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current integer;
  v_best integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select s.current_weeks, s.best_weeks into v_current, v_best from public.player_streak(v_uid, now()) s;
  return jsonb_build_object(
    'current', v_current,
    'best', v_best,
    'isPremium', coalesce((select p.is_premium from public.profiles p where p.id = v_uid), false),
    'badges', (
      select jsonb_agg(jsonb_build_object('badge', l.badge, 'label', l.label, 'weeks', l.weeks,
                                          'earned', b.badge is not null, 'awardedAt', b.awarded_at) order by l.sort)
      from public.streak_badge_levels l
      left join public.streak_badges b on b.badge = l.badge and b.profile_id = v_uid));
end;
$$;

-- Another player's earned badges, and whether they show in colour (only
-- while that player is Premium).
create or replace function public.get_player_streak_badges(p_profile_id uuid)
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
  return jsonb_build_object(
    'inColour', coalesce((select p.is_premium from public.profiles p where p.id = p_profile_id), false),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object('badge', l.badge, 'label', l.label, 'weeks', l.weeks,
                                          'awardedAt', b.awarded_at) order by l.sort)
      from public.streak_badges b
      join public.streak_badge_levels l on l.badge = b.badge
      where b.profile_id = p_profile_id), '[]'::jsonb));
end;
$$;

-- The weekly badge step, once, from Monday 09:00 Cyprus time, for the week
-- that ended last Sunday. Returns how many badges it awarded (0 before
-- 09:00 on a Monday, or when the week has already run).
create or replace function public.streak_badges_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Nicosia';
  v_monday date := date_trunc('week', v_local)::date;
  v_week date := v_monday - 7;
  -- The last instant of last Sunday, Cyprus time.
  v_end timestamptz := (v_monday::timestamp at time zone 'Asia/Nicosia') - interval '1 microsecond';
  v_awarded integer := 0;
  v_profile uuid;
  v_best integer;
  v_premium boolean;
  v_new record;
begin
  if v_local < v_monday + time '09:00' then
    return 0;
  end if;
  insert into public.streak_badge_runs (week_start) values (v_week) on conflict (week_start) do nothing;
  if not found then
    return 0;
  end if;

  for v_profile in
    select distinct fp.profile_id from public.match_form_players fp where fp.kickoff_at <= v_end
  loop
    select s.best_weeks into v_best from public.player_streak(v_profile, v_end) s;
    continue when v_best < 2;
    v_premium := coalesce((select p.is_premium from public.profiles p where p.id = v_profile), false);
    for v_new in
      insert into public.streak_badges (profile_id, badge, awarded_at)
      select v_profile, l.badge, p_now from public.streak_badge_levels l where l.weeks <= v_best
      on conflict (profile_id, badge) do nothing
      returning badge
    loop
      perform public.send_notification(v_profile, 'streak_badge', (
        select jsonb_build_object(
          'title', 'Streak badge',
          'body', case when v_premium then format('You''ve earned the %s streak badge', l.label)
                       else format('You''ve earned the %s streak badge. Go Premium to unlock it.', l.label) end,
          'badge', l.badge,
          'weeks', l.weeks)
        from public.streak_badge_levels l where l.badge = v_new.badge));
      v_awarded := v_awarded + 1;
    end loop;
  end loop;

  update public.streak_badge_runs set awarded = v_awarded where week_start = v_week;
  return v_awarded;
end;
$$;

-- match_jobs_tick, from 20261118140000_match_stats_decisions.sql, now also
-- runs the streak badge step ("streak_badges" in the counts).
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
         || jsonb_build_object('team_of_the_week', public.team_of_the_week_tick(now()))
         || jsonb_build_object('streak_badges', public.streak_badges_tick(now()));
end;
$$;

revoke all on function public.player_streak_weeks(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.player_streak_weeks(uuid, timestamptz) to service_role;
revoke all on function public.player_streak(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.player_streak(uuid, timestamptz) to service_role;
revoke all on function public.streak_badges_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.streak_badges_tick(timestamptz) to service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
grant execute on function public.match_jobs_tick() to service_role;
revoke all on function public.get_my_streak() from public, anon;
grant execute on function public.get_my_streak() to authenticated, service_role;
revoke all on function public.get_player_streak_badges(uuid) from public, anon;
grant execute on function public.get_player_streak_badges(uuid) to authenticated, service_role;
