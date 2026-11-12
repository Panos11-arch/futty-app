-- A3b-1: match reminders and "X play Y tonight" (docs/specs/05-product.md
-- section 2, match-record.md section 6.3 and decision 1c), run by
-- match_jobs_tick every 15 minutes, all through send_notification.
--
--   match_reminder_24h   24 elapsed hours before kickoff (kickoff_at -
--                        interval '24 hours', like result_deadline_at), to
--                        each player: venue, Cyprus day and time, who's in
--                        and who hasn't paid;
--   match_reminder_2h    2 hours before kickoff, the same;
--   followed_team_match  with the 2h reminder, to followers of a named
--                        team who aren't in the match: "X play Y tonight";
--   match_after_game     at the end: confirm the score, vote, rate.
--
-- A reminder is due from its time until the next one (24h until 2h before,
-- 2h until kickoff, after-game until result_deadline_at), and only if the
-- match existed when it fell due: a game booked 5 hours ahead gets no 24h
-- reminder. Each is sent once per player per match, however often the job
-- runs (match_notification_log). Only scheduled matches get reminders;
-- void matches get nothing.

-- What was sent, so nothing is sent twice. service_role only.
create table public.match_notification_log (
  match_id uuid not null references public.matches (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null references public.notification_types (type),
  sent_at timestamptz not null default now(),
  primary key (match_id, profile_id, type)
);
alter table public.match_notification_log enable row level security;
revoke all on public.match_notification_log from public, anon, authenticated;
grant all on public.match_notification_log to service_role;

-- Spots in a booking that haven't been paid, as the venue roster counts
-- them (13 Payments & Bookings, "Cash at the venue"; decision 1c), over the
-- shares that hold a spot:
--   card: paid in app once held, taken or covered (authorized, paid,
--         covered); unpaid while pending;
--   cash: paid once cash_received_at is set (the venue ticked it, or the
--         player paid it by card afterwards); otherwise not yet paid.
create or replace function public.booking_unpaid_count(p_booking_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id
    and s.status in ('pending', 'authorized', 'paid', 'covered')
    and case s.payment_method
          when 'cash' then s.cash_received_at is null
          else s.status = 'pending'
        end;
$$;

-- "6 in, 2 haven't paid." Who's in: players holding a spot (or a guest)
-- who haven't left; a named game's side b squad members without a spot
-- aren't counted. No booking: who's in only.
create or replace function public.match_roster_line(p_match_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_in integer;
  v_booking uuid;
  v_unpaid integer;
begin
  select count(*) into v_in from public.match_players mp
  where mp.match_id = p_match_id and mp.left_at is null and (mp.share_id is not null or mp.guest_name is not null);
  select m.booking_id into v_booking from public.matches m where m.id = p_match_id;
  if v_booking is not null then
    v_unpaid := public.booking_unpaid_count(v_booking);
  end if;
  return format('%s in', v_in)
    || case
         when v_unpaid is null then ''
         when v_unpaid = 0 then ', all paid'
         when v_unpaid = 1 then ', 1 hasn''t paid'
         else format(', %s haven''t paid', v_unpaid)
       end
    || '.';
end;
$$;

-- "today", "tomorrow" or the weekday of p_at, seen from p_now, in Cyprus.
create or replace function public.match_day_word(p_at timestamptz, p_now timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case ((p_at at time zone 'Asia/Nicosia')::date - (p_now at time zone 'Asia/Nicosia')::date)
           when 0 then 'today'
           when 1 then 'tomorrow'
           else to_char(p_at at time zone 'Asia/Nicosia', 'FMDay')
         end;
$$;

-- Is p_profile in the match: a player who hasn't left, or a side's captain.
create or replace function public.match_is_member(p_match_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.match_players mp
                 where mp.match_id = p_match_id and mp.profile_id = p_profile_id and mp.left_at is null)
      or exists (select 1 from public.match_sides s
                 where s.match_id = p_match_id and s.captain_profile_id = p_profile_id);
$$;

-- Logs (p_match_id, p_profile_id, p_type) and sends it, unless it was
-- already sent. True if it sent.
create or replace function public.match_notify_once(p_match_id uuid, p_profile_id uuid, p_type text, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_logged integer;
begin
  insert into public.match_notification_log (match_id, profile_id, type)
  values (p_match_id, p_profile_id, p_type)
  on conflict do nothing;
  get diagnostics v_logged = row_count;
  if v_logged = 0 then
    return false;
  end if;
  perform public.send_notification(p_profile_id, p_type, p_data);
  return true;
end;
$$;

-- The reminders due at p_now. match_jobs_tick passes now(); tests pass
-- any instant (e.g. the night the clocks go back).
create or replace function public.match_reminders_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_24h integer := 0;
  v_2h integer := 0;
  v_followed integer := 0;
  v_after integer := 0;
  v_time text;
  v_day text;
begin
  -- 24 hours before.
  for v_row in
    select m.id, m.booking_id, m.kickoff_at, mp.profile_id, v.name as venue_name
    from public.matches m
    join public.match_players mp on mp.match_id = m.id
    left join public.venues v on v.id = m.venue_id
    where m.status = 'scheduled'
      and mp.profile_id is not null and mp.left_at is null
      and m.kickoff_at - interval '24 hours' <= p_now and p_now < m.kickoff_at - interval '2 hours'
      and m.created_at <= m.kickoff_at - interval '24 hours'
    order by m.kickoff_at, m.id, mp.profile_id
  loop
    v_day := public.match_day_word(v_row.kickoff_at, p_now);
    v_time := to_char(v_row.kickoff_at at time zone 'Asia/Nicosia', 'HH24:MI');
    if public.match_notify_once(v_row.id, v_row.profile_id, 'match_reminder_24h', jsonb_build_object(
         'title', 'Game ' || v_day,
         'body', case when v_row.venue_name is null then initcap(left(v_day, 1)) || substr(v_day, 2)
                      else v_row.venue_name || ', ' || v_day end
                 || ' at ' || v_time || '. ' || public.match_roster_line(v_row.id),
         'matchId', v_row.id, 'bookingId', v_row.booking_id)) then
      v_24h := v_24h + 1;
    end if;
  end loop;

  -- 2 hours before.
  for v_row in
    select m.id, m.booking_id, m.kickoff_at, mp.profile_id, v.name as venue_name
    from public.matches m
    join public.match_players mp on mp.match_id = m.id
    left join public.venues v on v.id = m.venue_id
    where m.status = 'scheduled'
      and mp.profile_id is not null and mp.left_at is null
      and m.kickoff_at - interval '2 hours' <= p_now and p_now < m.kickoff_at
      and m.created_at <= m.kickoff_at - interval '2 hours'
    order by m.kickoff_at, m.id, mp.profile_id
  loop
    v_time := to_char(v_row.kickoff_at at time zone 'Asia/Nicosia', 'HH24:MI');
    if public.match_notify_once(v_row.id, v_row.profile_id, 'match_reminder_2h', jsonb_build_object(
         'title', 'Kick-off in 2 hours',
         'body', coalesce(v_row.venue_name || ' at ', 'At ') || v_time || '. ' || public.match_roster_line(v_row.id),
         'matchId', v_row.id, 'bookingId', v_row.booking_id)) then
      v_2h := v_2h + 1;
    end if;
  end loop;

  -- "X play Y tonight": followers of a named team who aren't in the match,
  -- once each (a follower of both teams hears about side a).
  for v_row in
    select distinct on (m.id, f.follower_id)
           m.id, m.kickoff_at, f.follower_id, s.team_id, s.label, o.label as opponent_label, v.name as venue_name
    from public.matches m
    join public.match_sides s on s.match_id = m.id and s.team_id is not null
    join public.match_sides o on o.match_id = m.id and o.side <> s.side
    join public.user_follows f on f.target_type = 'team' and f.target_id = s.team_id
    left join public.venues v on v.id = m.venue_id
    where m.status = 'scheduled' and m.kind = 'named'
      and m.kickoff_at - interval '2 hours' <= p_now and p_now < m.kickoff_at
      and m.created_at <= m.kickoff_at - interval '2 hours'
      and not public.match_is_member(m.id, f.follower_id)
    order by m.id, f.follower_id, s.side
  loop
    v_time := to_char(v_row.kickoff_at at time zone 'Asia/Nicosia', 'HH24:MI');
    if public.match_notify_once(v_row.id, v_row.follower_id, 'followed_team_match', jsonb_build_object(
         'title', v_row.label,
         'body', format('%s play %s %s at %s%s.', v_row.label, v_row.opponent_label,
                        case when (v_row.kickoff_at at time zone 'Asia/Nicosia')::time >= time '18:00'
                             then 'tonight' else 'today' end,
                        v_time, coalesce(', ' || v_row.venue_name, '')),
         'matchId', v_row.id, 'teamId', v_row.team_id)) then
      v_followed := v_followed + 1;
    end if;
  end loop;

  -- After the game: from the end until the result deadline.
  for v_row in
    select m.id, m.booking_id, mp.profile_id
    from public.matches m
    join public.match_players mp on mp.match_id = m.id
    where m.status <> 'void'
      and mp.profile_id is not null and mp.left_at is null
      and m.ends_at <= p_now and p_now < m.result_deadline_at
    order by m.ends_at, m.id, mp.profile_id
  loop
    if public.match_notify_once(v_row.id, v_row.profile_id, 'match_after_game', jsonb_build_object(
         'title', 'How did it go?',
         'body', 'Confirm the score, vote for man of the match and rate the players.',
         'matchId', v_row.id, 'bookingId', v_row.booking_id)) then
      v_after := v_after + 1;
    end if;
  end loop;

  return jsonb_build_object('reminder_24h', v_24h, 'reminder_2h', v_2h,
                            'followed_team_match', v_followed, 'after_game', v_after);
end;
$$;

-- match_jobs_tick (A2, 20261110200003_match_record_result.sql) unchanged,
-- then the reminders, so they see this run's status changes (a void match
-- gets nothing). The counts of both are returned together.
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
         || public.match_reminders_tick(now());
end;
$$;

revoke all on function public.booking_unpaid_count(uuid) from public, anon, authenticated;
grant execute on function public.booking_unpaid_count(uuid) to service_role;
revoke all on function public.match_roster_line(uuid) from public, anon, authenticated;
grant execute on function public.match_roster_line(uuid) to service_role;
revoke all on function public.match_day_word(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.match_day_word(timestamptz, timestamptz) to service_role;
revoke all on function public.match_is_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_is_member(uuid, uuid) to service_role;
revoke all on function public.match_notify_once(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.match_notify_once(uuid, uuid, text, jsonb) to service_role;
revoke all on function public.match_reminders_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.match_reminders_tick(timestamptz) to service_role;
revoke all on function public.match_jobs_tick() from public, anon, authenticated;
grant execute on function public.match_jobs_tick() to service_role;
