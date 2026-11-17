-- P6e: venue notifications and the daily summary (docs/specs/05-product.md
-- section 12 item 11; docs/specs/13-payments-bookings.md "Venue
-- notifications", decided 17 November, Dimitris; for Panos to confirm).
--
-- A venue's staff are told:
--   venue_new_booking        an app booking is confirmed. Walk-ins, phone
--                            bookings and owner blocks never, because staff
--                            added them;
--   venue_booking_cancelled  the booker cancels the whole booking. A player
--                            leaving, or the venue's own cancel, tells nobody;
--   venue_short_game         the 6-hour check (send_short_game_warnings) found
--                            the game short, so the venue can offer a player;
--   venue_daily_summary      at 20:00 Cyprus time: tomorrow's games per pitch,
--                            players joined vs needed, cash expected, blocks
--                            and condition flags. Nothing is sent on a day with
--                            no game, block or flag.
--
-- venue_notifications_tick(p_now) finds these in the tables that already
-- record them, so no booking, cancellation or collection function changes.
-- It sends through send_notification as is, so staff can turn each kind off
-- (none is always sent) and quiet hours apply. Each is sent once per staff
-- member (venue_staff_notification_log), however often the job runs. Nothing
-- that happened before this migration is sent (venue_staff_notify_since).
--
-- Every time and date in the text is Cyprus time: a booking's day and start
-- time are already Cyprus wall-clock values, and p_now is converted with
-- at time zone 'Asia/Nicosia'. The job runs every 5 minutes in UTC and
-- decides by Cyprus wall-clock time, so a daylight-saving change needs
-- nothing more: the summary goes at 17:00 UTC in summer and 18:00 UTC in
-- winter.
--
-- DEPLOYMENT (Panos): schedule it every 5 minutes with pg_cron:
--   select cron.schedule('venue-notifications', '*/5 * * * *',
--     $$ select public.venue_notifications_tick() $$);

insert into public.notification_types (type, always_sent) values
  ('venue_new_booking', false),
  ('venue_booking_cancelled', false),
  ('venue_short_game', false),
  ('venue_daily_summary', false)
on conflict (type) do nothing;

-- When venue notifications started: earlier events are never sent.
create table public.venue_staff_notify_since (
  id boolean primary key default true check (id),
  since timestamptz not null default now()
);
insert into public.venue_staff_notify_since default values;

-- What was sent, so nothing is sent twice. event_key is the booking id for
-- an event, and the Cyprus date for a summary.
create table public.venue_staff_notification_log (
  venue_id uuid not null references public.venues (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null references public.notification_types (type),
  event_key text not null,
  sent_at timestamptz not null default now(),
  primary key (venue_id, profile_id, type, event_key)
);

alter table public.venue_staff_notify_since enable row level security;
alter table public.venue_staff_notification_log enable row level security;
revoke all on public.venue_staff_notify_since, public.venue_staff_notification_log from public, anon, authenticated;
grant all on public.venue_staff_notify_since, public.venue_staff_notification_log to service_role;

-- Who a venue's staff are: its owner today, as is_venue_staff. When staff
-- accounts arrive, only this changes.
create or replace function public.venue_staff_profiles(p_venue_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.owner_profile_id from public.venues v
  where v.id = p_venue_id and v.owner_profile_id is not null;
$$;

-- Logs (venue, profile, type, key) and sends it, unless it was already
-- sent. True if it sent.
create or replace function public.venue_staff_notify_once(
  p_venue_id uuid,
  p_profile_id uuid,
  p_type text,
  p_event_key text,
  p_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_logged integer;
begin
  insert into public.venue_staff_notification_log (venue_id, profile_id, type, event_key)
  values (p_venue_id, p_profile_id, p_type, p_event_key)
  on conflict do nothing;
  get diagnostics v_logged = row_count;
  if v_logged = 0 then
    return false;
  end if;
  perform public.send_notification(p_profile_id, p_type, p_data || jsonb_build_object('venueId', p_venue_id));
  return true;
end;
$$;

-- "Wednesday 18 November", as every venue notice says it (Cyprus date).
create or replace function public.venue_notice_day(p_day date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_day, 'FMDay FMDD FMMonth');
$$;

-- "Pitch 1 + Pitch 2": the pitches a booking holds, or null.
create or replace function public.venue_notice_pitches(p_booking_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(p.name, ' + ' order by p.sort_order, p.name)
  from public.booking_pitches bp
  join public.pitches p on p.id = bp.pitch_id
  where bp.booking_id = p_booking_id;
$$;

-- Tomorrow's day at a venue, for the summary. Every count and amount is the
-- server's, in cents:
--   games       confirmed app, walk-in and phone bookings, per pitch, in time
--               order (a combined game is under each of its pitches);
--   joined      shares still in (pending, authorized, paid, covered), as the
--               dashboard counts them; short when fewer than the booking is for;
--   appCashCents        cash still to tick: cash_cents of cash shares in the
--                       statuses mark_cash_received accepts, not yet ticked;
--   counterUnpaidCents  walk-in and phone bookings not yet marked paid;
--   blocks      venue blocks and owner blocks; flags: condition flags not cleared.
create or replace function public.venue_daily_summary_content(p_venue_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_games jsonb;
  v_pitches jsonb;
  v_blocks jsonb;
  v_flags jsonb;
begin
  with game as (
    select b.id, b.start_time, b.end_time, b.format, b.capacity, b.booking_type, c.source, c.charged_cents,
           c.paid_at, ct.name as contact_name,
           (select count(*) from public.booking_payment_shares s
            where s.booking_id = b.id and s.status in ('pending', 'authorized', 'paid', 'covered'))::integer as joined,
           (select coalesce(sum(s.cash_cents), 0) from public.booking_payment_shares s
            where s.booking_id = b.id and s.payment_method = 'cash' and s.cash_received_at is null
              and s.status in ('pending', 'authorized', 'paid'))::integer as cash_cents
    from public.venue_bookings b
    left join public.venue_counter_bookings c on c.booking_id = b.id
    left join public.venue_contacts ct on ct.id = c.contact_id
    where b.venue_id = p_venue_id and b.booking_day = p_day and b.status = 'confirmed'
      and (b.booking_type = 'counter' and c.cancelled_at is null
           or b.booking_type = 'user_booking' and b.payment_mode is not null)
  ), described as (
    select g.*, case when g.booking_type = 'counter'
                  then jsonb_build_object('bookingId', g.id, 'start', to_char(g.start_time, 'HH24:MI'),
                                          'end', to_char(g.end_time, 'HH24:MI'), 'format', g.format,
                                          'kind', g.source, 'contactName', g.contact_name,
                                          'chargedCents', g.charged_cents, 'paid', g.paid_at is not null)
                  else jsonb_build_object('bookingId', g.id, 'start', to_char(g.start_time, 'HH24:MI'),
                                          'end', to_char(g.end_time, 'HH24:MI'), 'format', g.format,
                                          'kind', 'app', 'joined', g.joined, 'players', g.capacity,
                                          'short', g.joined < g.capacity, 'cashCents', g.cash_cents)
                end as item
    from game g
  )
  select
    jsonb_build_object(
      'gameCount', count(*),
      'appJoined', coalesce(sum(d.joined) filter (where d.booking_type = 'user_booking'), 0),
      'appPlayers', coalesce(sum(d.capacity) filter (where d.booking_type = 'user_booking'), 0),
      'appGameCount', count(*) filter (where d.booking_type = 'user_booking'),
      'appCashCents', coalesce(sum(d.cash_cents) filter (where d.booking_type = 'user_booking'), 0),
      'counterUnpaidCents', coalesce(sum(d.charged_cents) filter (where d.booking_type = 'counter' and d.paid_at is null), 0)),
    coalesce((
      select jsonb_agg(jsonb_build_object('pitchId', x.pitch_id, 'name', x.name, 'games', x.games)
                       order by x.sort_order nulls last, x.name)
      from (
        select p.id as pitch_id, p.name, p.sort_order,
               jsonb_agg(d2.item order by d2.start_time, d2.id) as games
        from described d2
        left join public.booking_pitches bp on bp.booking_id = d2.id
        left join public.pitches p on p.id = bp.pitch_id
        group by p.id, p.name, p.sort_order
      ) x), '[]'::jsonb)
  into v_games, v_pitches
  from described d;

  select coalesce(jsonb_agg(x.item order by x.starts_at nulls first, x.created_at), '[]'::jsonb) into v_blocks
  from (
    select vb.starts_at, vb.created_at,
           jsonb_build_object('pitchId', vb.pitch_id, 'start', to_char(vb.starts_at, 'HH24:MI'),
                              'end', to_char(vb.ends_at, 'HH24:MI'), 'reason', vb.reason) as item
    from public.venue_blocks vb
    where vb.venue_id = p_venue_id and vb.block_day = p_day
    union all
    select b.start_time, b.created_at,
           jsonb_build_object('bookingId', b.id, 'start', to_char(b.start_time, 'HH24:MI'),
                              'end', to_char(b.end_time, 'HH24:MI'), 'reason', b.note)
    from public.venue_bookings b
    where b.venue_id = p_venue_id and b.booking_day = p_day and b.booking_type = 'owner_block'
      and b.status = 'confirmed'
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('pitchId', f.pitch_id, 'start', to_char(f.starts_at, 'HH24:MI'),
                                               'end', to_char(f.ends_at, 'HH24:MI'), 'note', f.note)
                            order by f.starts_at nulls first, f.created_at), '[]'::jsonb)
  into v_flags
  from public.venue_condition_flags f
  where f.venue_id = p_venue_id and f.flag_day = p_day and f.cleared_at is null;

  return v_games || jsonb_build_object(
    'venueId', p_venue_id,
    'day', p_day,
    'pitches', v_pitches,
    'blocks', v_blocks,
    'blockCount', jsonb_array_length(v_blocks),
    'flags', v_flags,
    'flagCount', jsonb_array_length(v_flags));
end;
$$;

-- "Wednesday 18 November: 4 games, 6 of 20 players in. Cash expected:
-- €12.00 from app players, €60.00 at the counter. 1 block, 1 conditions flag."
create or replace function public.venue_daily_summary_body(p_content jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_games integer := (p_content ->> 'gameCount')::integer;
  v_app_games integer := (p_content ->> 'appGameCount')::integer;
  v_app_cash integer := (p_content ->> 'appCashCents')::integer;
  v_counter integer := (p_content ->> 'counterUnpaidCents')::integer;
  v_blocks integer := (p_content ->> 'blockCount')::integer;
  v_flags integer := (p_content ->> 'flagCount')::integer;
  v_body text;
  v_extras text[] := '{}';
begin
  v_body := public.venue_notice_day((p_content ->> 'day')::date) || ': '
    || case v_games when 0 then 'No games' when 1 then '1 game' else v_games || ' games' end
    || case when v_app_games > 0
            then format(', %s of %s players in', p_content ->> 'appJoined', p_content ->> 'appPlayers')
            else '' end
    || '.';
  if v_app_cash > 0 or v_counter > 0 then
    v_body := v_body || format(' Cash expected: %s from app players, %s at the counter.',
                               public.money_format_euros(v_app_cash), public.money_format_euros(v_counter));
  end if;
  if v_blocks > 0 then
    v_extras := v_extras || (v_blocks || case when v_blocks = 1 then ' block' else ' blocks' end);
  end if;
  if v_flags > 0 then
    v_extras := v_extras || (v_flags || case when v_flags = 1 then ' conditions flag' else ' conditions flags' end);
  end if;
  if cardinality(v_extras) > 0 then
    v_body := v_body || ' ' || array_to_string(v_extras, ', ') || '.';
  end if;
  return v_body;
end;
$$;

-- The job: events since the last run, then (from 20:00 Cyprus time until
-- midnight) tomorrow's summary. p_now is for tests (any instant, e.g. the
-- night the clocks change); the schedule passes now(). Returns how many it sent.
create or replace function public.venue_notifications_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_local timestamp := p_now at time zone 'Asia/Nicosia';
  v_day date;
  v_row record;
  v_staff uuid;
  v_joined integer;
  v_extra integer;
  v_pitches text;
  v_content jsonb;
  v_new integer := 0;
  v_cancelled integer := 0;
  v_short integer := 0;
  v_summaries integer := 0;
begin
  select s.since into v_since from public.venue_staff_notify_since s;

  -- New app bookings, confirmed, not yet kicked off.
  for v_row in
    select b.id, b.venue_id, b.booking_day, b.start_time, b.format, b.created_by
    from public.venue_bookings b
    where b.booking_type = 'user_booking' and b.payment_mode is not null and b.status = 'confirmed'
      and b.created_at >= v_since
      and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' > p_now
    order by b.created_at, b.id
  loop
    v_pitches := public.venue_notice_pitches(v_row.id);
    for v_staff in select public.venue_staff_profiles(v_row.venue_id) loop
      if public.venue_staff_notify_once(v_row.venue_id, v_staff, 'venue_new_booking', v_row.id::text,
           jsonb_build_object(
             'title', 'New booking',
             'body', format('%s at %s%s: %s, booked by %s.',
                            public.venue_notice_day(v_row.booking_day), to_char(v_row.start_time, 'HH24:MI'),
                            coalesce(', ' || v_pitches, ''), v_row.format,
                            public.profile_display_name(v_row.created_by)),
             'bookingId', v_row.id)) then
        v_new := v_new + 1;
      end if;
    end loop;
  end loop;

  -- The booker cancelled the whole booking. (A player leaving is my_spot;
  -- the venue's own cancel is venue.)
  for v_row in
    select b.id, b.venue_id, b.booking_day, b.start_time, b.format, c.cancelled_by
    from public.booking_cancellations c
    join public.venue_bookings b on b.id = c.booking_id
    where c.scope = 'whole_team' and c.cancelled_at >= v_since
      and b.booking_type = 'user_booking' and b.payment_mode is not null
    order by c.cancelled_at, c.id
  loop
    for v_staff in select public.venue_staff_profiles(v_row.venue_id) loop
      if public.venue_staff_notify_once(v_row.venue_id, v_staff, 'venue_booking_cancelled', v_row.id::text,
           jsonb_build_object(
             'title', 'Booking cancelled',
             'body', format('%s cancelled %s at %s (%s). The slot is free again.',
                            public.profile_display_name(v_row.cancelled_by),
                            public.venue_notice_day(v_row.booking_day), to_char(v_row.start_time, 'HH24:MI'),
                            v_row.format),
             'bookingId', v_row.id)) then
        v_cancelled := v_cancelled + 1;
      end if;
    end loop;
  end loop;

  -- Short games: checked 6 hours before kickoff, counted as the players'
  -- warning counts them (send_short_game_warnings), before kickoff.
  for v_row in
    select b.id, b.venue_id, b.booking_day, b.start_time, b.capacity
    from public.venue_bookings b
    where b.booking_type = 'user_booking' and b.status = 'confirmed'
      and b.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
      and b.short_game_warned_at is not null and b.short_game_warned_at >= v_since
      and (b.booking_day + b.start_time) at time zone 'Asia/Nicosia' > p_now
      and exists (select 1 from public.venue_staff_profiles(b.venue_id) s(profile_id)
                  where not exists (select 1 from public.venue_staff_notification_log l
                                    where l.venue_id = b.venue_id and l.profile_id = s.profile_id
                                      and l.type = 'venue_short_game' and l.event_key = b.id::text))
    order by b.booking_day, b.start_time, b.id
  loop
    select count(*), coalesce(min(a.due_pitch_cents - a.normal_pitch_cents) filter (where not a.is_booker),
                              max(a.due_pitch_cents - a.normal_pitch_cents))
    into v_joined, v_extra
    from public.collection_amounts(v_row.id) a;
    if v_joined = 0 or v_joined >= v_row.capacity or v_extra <= 0 then
      continue;
    end if;
    v_pitches := public.venue_notice_pitches(v_row.id);
    for v_staff in select public.venue_staff_profiles(v_row.venue_id) loop
      if public.venue_staff_notify_once(v_row.venue_id, v_staff, 'venue_short_game', v_row.id::text,
           jsonb_build_object(
             'title', format('Short game: %s of %s', v_joined, v_row.capacity),
             'body', format('%s at %s%s. You can offer a player.',
                            public.venue_notice_day(v_row.booking_day), to_char(v_row.start_time, 'HH24:MI'),
                            coalesce(', ' || v_pitches, '')),
             'bookingId', v_row.id,
             'joined', v_joined,
             'players', v_row.capacity)) then
        v_short := v_short + 1;
      end if;
    end loop;
  end loop;

  -- Tomorrow's summary, from 20:00 Cyprus time until midnight.
  if v_local::time >= time '20:00' then
    v_day := v_local::date + 1;
    for v_row in
      select v.id, v.name from public.venues v
      where exists (select 1 from public.venue_staff_profiles(v.id) s(profile_id)
                    where not exists (select 1 from public.venue_staff_notification_log l
                                      where l.venue_id = v.id and l.profile_id = s.profile_id
                                        and l.type = 'venue_daily_summary' and l.event_key = v_day::text))
      order by v.id
    loop
      v_content := public.venue_daily_summary_content(v_row.id, v_day);
      if (v_content ->> 'gameCount')::integer = 0 and (v_content ->> 'blockCount')::integer = 0
         and (v_content ->> 'flagCount')::integer = 0 then
        continue;
      end if;
      for v_staff in select public.venue_staff_profiles(v_row.id) loop
        if public.venue_staff_notify_once(v_row.id, v_staff, 'venue_daily_summary', v_day::text,
             v_content || jsonb_build_object(
               'title', 'Tomorrow at ' || coalesce(v_row.name, 'your venue'),
               'body', public.venue_daily_summary_body(v_content))) then
          v_summaries := v_summaries + 1;
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object('new_booking', v_new, 'booking_cancelled', v_cancelled, 'short_game', v_short,
                            'daily_summary', v_summaries);
end;
$$;

revoke all on function public.venue_staff_profiles(uuid) from public, anon, authenticated;
grant execute on function public.venue_staff_profiles(uuid) to service_role;
revoke all on function public.venue_staff_notify_once(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.venue_staff_notify_once(uuid, uuid, text, text, jsonb) to service_role;
revoke all on function public.venue_notice_day(date) from public, anon, authenticated;
grant execute on function public.venue_notice_day(date) to service_role;
revoke all on function public.venue_notice_pitches(uuid) from public, anon, authenticated;
grant execute on function public.venue_notice_pitches(uuid) to service_role;
revoke all on function public.venue_daily_summary_content(uuid, date) from public, anon, authenticated;
grant execute on function public.venue_daily_summary_content(uuid, date) to service_role;
revoke all on function public.venue_daily_summary_body(jsonb) from public, anon, authenticated;
grant execute on function public.venue_daily_summary_body(jsonb) to service_role;
revoke all on function public.venue_notifications_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.venue_notifications_tick(timestamptz) to service_role;
