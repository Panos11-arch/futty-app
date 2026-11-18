-- Saved searches and their alerts (decided 18 November; spec 13 "Saved
-- searches"). Free for every player.
--
-- A player saves a search from the booking search: a date or a weekday, a
-- time window, a game length, a format (or any) and a city or area (or
-- anywhere). When a matching bookable slot frees up (a booking cancelled, a
-- block removed) or a game inside it asks for players (a squad post), the
-- player gets one saved_search_match.
--
--   - At most app_rules.saved_searches_max (5) searches per player.
--   - A dated search is at most the player's own booking window ahead
--     (rule_window_days); it is removed once its day has passed.
--   - At most one notification per saved search per Cyprus day.
--   - Never about a slot or game the player caused: their own cancellation,
--     block removal or squad post.
--   - saved_search_match can be turned off; quiet hours are send_notification's.
--
-- No booking, cancellation or block function is re-created. AFTER triggers
-- on venue_bookings (status to cancelled), venue_blocks (delete) and
-- squad_posts (insert) only write to a queue, so cancelling stays fast.
-- saved_searches_tick matches the queue every 5 minutes; it is a new step of
-- venue_notifications_tick (already scheduled), which is re-created here
-- from its latest definition (20261118001124_p6e_audit_fixes.sql) with only
-- that call and its count added.

-- 1. The rule, with the others (spec 13 "Rules in one place").
alter table public.app_rules
  add column saved_searches_max integer not null default 5 check (saved_searches_max between 1 and 50);

-- 2. The notification type: it can be turned off.
insert into public.notification_types (type, always_sent) values ('saved_search_match', false);

-- 3. The searches.
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- A date (Cyprus) or an ISO weekday (1 = Monday ... 7 = Sunday).
  day date,
  weekday smallint check (weekday between 1 and 7),
  -- Cyprus wall-clock times; to_local may be 24:00.
  from_local time not null,
  to_local time not null,
  -- The game length, as on the booking search.
  minutes integer not null,
  -- Null = any format.
  format text check (format in ('5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side')),
  -- A whole city (every area in it), or one exact area (a venue's city
  -- value, e.g. 'Nicosia (Strovolos)'), or neither = anywhere.
  city text,
  area text,
  created_at timestamptz not null default now(),
  constraint saved_searches_one_day check ((day is null) <> (weekday is null)),
  constraint saved_searches_minutes check (minutes >= 30 and minutes % 30 = 0),
  constraint saved_searches_fits check (
    to_local > from_local and extract(epoch from to_local - from_local) >= minutes * 60),
  constraint saved_searches_one_place check (city is null or area is null)
);
create index saved_searches_profile_idx on public.saved_searches (profile_id);
create index saved_searches_day_idx on public.saved_searches (day) where day is not null;
create index saved_searches_weekday_idx on public.saved_searches (weekday) where weekday is not null;

alter table public.saved_searches enable row level security;
create policy "Players see their own saved searches" on public.saved_searches
  for select to authenticated using (profile_id = auth.uid());
create policy "Players save their own searches" on public.saved_searches
  for insert to authenticated with check (profile_id = auth.uid());
create policy "Players delete their own saved searches" on public.saved_searches
  for delete to authenticated using (profile_id = auth.uid());
revoke all on public.saved_searches from public, anon, authenticated;
grant select, insert, delete on public.saved_searches to authenticated;

-- The city part of a venue's city value: 'Nicosia (Strovolos)' -> 'Nicosia'.
create or replace function public.venue_city_part(p_city text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(split_part(coalesce(p_city, ''), '(', 1)), '');
$$;

-- The checks on saving: the limit, the date, the place.
create or replace function public.saved_searches_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
  v_premium boolean;
begin
  -- One at a time per player, so two saves can't both pass the limit.
  select coalesce(p.is_premium, false) into v_premium from public.profiles p where p.id = new.profile_id for update;
  if (select count(*) from public.saved_searches s where s.profile_id = new.profile_id)
     >= (select r.saved_searches_max from public.app_rules r where r.id) then
    raise exception 'saved_search_limit';
  end if;
  if new.day is not null then
    if new.day < v_today then
      raise exception 'saved_search_in_past';
    end if;
    if new.day > v_today + public.rule_window_days(v_premium) then
      raise exception 'saved_search_too_far';
    end if;
  end if;
  if new.city is not null and not exists (
       select 1 from public.venues v where v.is_live and public.venue_city_part(v.city) = new.city) then
    raise exception 'saved_search_unknown_place';
  end if;
  if new.area is not null and not exists (
       select 1 from public.venues v where v.is_live and v.city = new.area) then
    raise exception 'saved_search_unknown_place';
  end if;
  return new;
end;
$$;
create trigger saved_searches_check
  before insert on public.saved_searches
  for each row execute function public.saved_searches_check();

-- The places a search can name: each city of a live venue with its areas
-- (venue city values that name an area, 'City (Area)').
create or replace function public.saved_search_places()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('city', c.city, 'areas', c.areas) order by c.city), '[]'::jsonb)
  from (
    select public.venue_city_part(v.city) as city,
           coalesce(jsonb_agg(distinct v.city) filter (where v.city <> public.venue_city_part(v.city)), '[]'::jsonb) as areas
    from public.venues v
    where v.is_live and public.venue_city_part(v.city) is not null
    group by 1
  ) c;
$$;

-- 4. The queue. Triggers write it; only saved_searches_tick reads it.
create table public.saved_search_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('booking_cancelled', 'block_removed', 'squad_post')),
  venue_id uuid not null,
  day date not null,
  -- The freed range (a block with neither = the whole day), or a post's
  -- game (ends_at null when the post has no booking).
  starts_at time,
  ends_at time,
  -- Null = any format (a block).
  format text,
  booking_id uuid,
  post_id uuid,
  -- Whoever was signed in when it happened (null for a job).
  caused_by uuid,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index saved_search_events_pending_idx on public.saved_search_events (id) where processed_at is null;

-- One notification per search per Cyprus day.
create table public.saved_search_sends (
  saved_search_id uuid not null references public.saved_searches (id) on delete cascade,
  cyprus_day date not null,
  event_id bigint not null references public.saved_search_events (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (saved_search_id, cyprus_day)
);

alter table public.saved_search_events enable row level security;
alter table public.saved_search_sends enable row level security;
revoke all on public.saved_search_events, public.saved_search_sends from public, anon, authenticated;

-- 5. The triggers: queue only.
create or replace function public.saved_search_queue_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.saved_search_events (kind, venue_id, day, starts_at, ends_at, format, booking_id, caused_by)
    values ('booking_cancelled', new.venue_id, new.booking_day, new.start_time, new.end_time, new.format, new.id,
            auth.uid());
  end if;
  return null;
end;
$$;
create trigger saved_search_queue_booking
  after update of status on public.venue_bookings
  for each row execute function public.saved_search_queue_booking();

create or replace function public.saved_search_queue_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.saved_search_events (kind, venue_id, day, starts_at, ends_at, caused_by)
  values ('block_removed', old.venue_id, old.block_day, old.starts_at, old.ends_at,
          coalesce(auth.uid(), old.created_by));
  return null;
end;
$$;
create trigger saved_search_queue_block
  after delete on public.venue_blocks
  for each row execute function public.saved_search_queue_block();

create or replace function public.saved_search_queue_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := new.scheduled_at at time zone 'Asia/Nicosia';
begin
  if new.type = 'players' and new.venue_id is not null and new.scheduled_at is not null then
    insert into public.saved_search_events (kind, venue_id, day, starts_at, ends_at, format, post_id, caused_by)
    values ('squad_post', new.venue_id, v_local::date, v_local::time,
            (select b.end_time from public.venue_bookings b where b.id = new.venue_booking_id),
            new.format, new.id, coalesce(new.posted_by, auth.uid()));
  end if;
  return null;
end;
$$;
create trigger saved_search_queue_post
  after insert on public.squad_posts
  for each row execute function public.saved_search_queue_post();

-- 6. Matching. Returns how many notifications it sent.
create or replace function public.saved_searches_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Asia/Nicosia')::date;
  v_event public.saved_search_events;
  v_search record;
  v_venue public.venues;
  v_exclude uuid[];
  v_lo time;
  v_hi time;
  v_format text;
  v_start time;
  v_found boolean;
  v_sent integer := 0;
begin
  -- Dated searches whose day has passed.
  delete from public.saved_searches where day < v_today;

  for v_event in
    select * from public.saved_search_events where processed_at is null order by id for update skip locked
  loop
    select * into v_venue from public.venues where id = v_event.venue_id;

    -- Who caused it: whoever was signed in, whoever cancelled (a cancel
    -- runs in an Edge Function with no session), else the booker (an unpaid
    -- booking cancelled when its payment window closes).
    v_exclude := array_remove(array[v_event.caused_by], null);
    if v_event.kind = 'booking_cancelled' then
      v_exclude := v_exclude || coalesce((select array_agg(c.cancelled_by) from public.booking_cancellations c
                                          where c.booking_id = v_event.booking_id and c.scope <> 'my_spot'), '{}');
      if cardinality(v_exclude) = 0 then
        v_exclude := array_remove(array[(select b.created_by from public.venue_bookings b where b.id = v_event.booking_id)], null);
      end if;
    end if;

    -- A squad post: still open, still to come.
    if v_event.kind = 'squad_post' and not exists (
         select 1 from public.squad_posts p
         where p.id = v_event.post_id and p.status = 'open' and p.scheduled_at > p_now) then
      update public.saved_search_events set processed_at = p_now where id = v_event.id;
      continue;
    end if;

    for v_search in
      select s.*, coalesce(pr.is_premium, false) as is_premium
      from public.saved_searches s
      join public.profiles pr on pr.id = s.profile_id
      where (s.day = v_event.day or (s.day is null and s.weekday = extract(isodow from v_event.day)))
        and not (s.profile_id = any (v_exclude))
        and (s.format is null or v_event.format is null or s.format = v_event.format)
        and (s.city is null or s.city = public.venue_city_part(v_venue.city))
        and (s.area is null or s.area = v_venue.city)
        and not exists (select 1 from public.saved_search_sends x
                        where x.saved_search_id = s.id and x.cyprus_day = v_today)
      order by s.created_at, s.id
    loop
      v_found := false;
      if v_event.kind = 'squad_post' then
        -- The game inside the window.
        v_start := v_event.starts_at;
        v_format := v_event.format;
        v_found := v_start >= v_search.from_local
                   and coalesce(v_event.ends_at, v_start) <= v_search.to_local
                   and v_start < v_search.to_local;
      elsif v_event.day <= v_today + public.rule_window_days(v_search.is_premium) then
        -- A slot the player can book: a free slot of the search's length and
        -- format inside both the freed range and the window. venue_free_slots
        -- leaves out the past, closed venues and pitches still taken.
        v_lo := greatest(coalesce(v_event.starts_at, time '00:00'), v_search.from_local);
        v_hi := least(coalesce(v_event.ends_at, time '24:00'), v_search.to_local);
        if v_hi > v_lo and extract(epoch from v_hi - v_lo) >= v_search.minutes * 60 then
          for v_format in
            select f from unnest(case when coalesce(v_search.format, v_event.format) is not null
                                      then array[coalesce(v_search.format, v_event.format)]
                                      else array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'] end)
                          with ordinality as u(f, n)
            order by n
          loop
            select fs.start_time into v_start
            from public.venue_free_slots(v_event.venue_id, v_event.day, v_format, v_search.minutes) fs
            where fs.start_time >= v_lo and fs.end_time <= v_hi
            order by fs.start_time
            limit 1;
            if found then
              v_found := true;
              exit;
            end if;
          end loop;
        end if;
      end if;
      continue when not v_found;

      insert into public.saved_search_sends (saved_search_id, cyprus_day, event_id)
      values (v_search.id, v_today, v_event.id)
      on conflict do nothing;
      continue when not found;

      perform public.send_notification(v_search.profile_id, 'saved_search_match',
        case when v_event.kind = 'squad_post' then
          jsonb_build_object(
            'title', 'A game you were looking for needs players',
            'body', format('%s, %s at %s: %s.', v_venue.name, public.venue_notice_day(v_event.day),
                           to_char(v_start, 'HH24:MI'), v_format),
            'kind', 'squad_post', 'postId', v_event.post_id, 'venueId', v_event.venue_id,
            'day', v_event.day, 'start', to_char(v_start, 'HH24:MI'), 'format', v_format,
            'savedSearchId', v_search.id)
        else
          jsonb_build_object(
            'title', 'A pitch you were looking for is free',
            'body', format('%s, %s at %s: %s for %s minutes.', v_venue.name, public.venue_notice_day(v_event.day),
                           to_char(v_start, 'HH24:MI'), v_format, v_search.minutes),
            'kind', 'slot', 'venueId', v_event.venue_id, 'day', v_event.day, 'start', to_char(v_start, 'HH24:MI'),
            'minutes', v_search.minutes, 'format', v_format, 'savedSearchId', v_search.id)
        end);
      v_sent := v_sent + 1;
    end loop;

    update public.saved_search_events set processed_at = p_now where id = v_event.id;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.venue_city_part(text) from public, anon, authenticated;
revoke all on function public.saved_searches_check() from public, anon, authenticated;
revoke all on function public.saved_search_queue_booking() from public, anon, authenticated;
revoke all on function public.saved_search_queue_block() from public, anon, authenticated;
revoke all on function public.saved_search_queue_post() from public, anon, authenticated;
revoke all on function public.saved_searches_tick(timestamptz) from public, anon, authenticated;
revoke all on function public.saved_search_places() from public, anon;
grant execute on function public.venue_city_part(text) to service_role;
grant execute on function public.saved_searches_tick(timestamptz) to service_role;
grant execute on function public.saved_search_places() to authenticated, service_role;

-- 7. venue_notifications_tick, from 20261118001124_p6e_audit_fixes.sql, with
-- the saved-search step and its count added. Nothing else changes.
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
  v_venue_players integer;  -- P6e audit
  v_pitches text;
  v_content jsonb;
  v_new integer := 0;
  v_cancelled integer := 0;
  v_short integer := 0;
  v_summaries integer := 0;
  v_saved integer := 0;
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
      -- P6e audit: only staff who were told about the booking hear it was
      -- cancelled (one confirmed and cancelled between runs tells nobody).
      if not exists (select 1 from public.venue_staff_notification_log l
                     where l.venue_id = v_row.venue_id and l.profile_id = v_staff
                       and l.type = 'venue_new_booking' and l.event_key = v_row.id::text) then
        continue;
      end if;
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
    -- P6e audit: staff count accepted venue players as joined; when they fill
    -- the gap, staff aren't told. (The players' warning and their amounts
    -- still count him as an empty spot.)
    v_venue_players := (select count(*) from public.booking_venue_players vp
                        where vp.booking_id = v_row.id and vp.status = 'accepted');
    v_joined := v_joined + v_venue_players;
    if v_joined >= v_row.capacity then
      continue;
    end if;
    v_pitches := public.venue_notice_pitches(v_row.id);
    for v_staff in select public.venue_staff_profiles(v_row.venue_id) loop
      if public.venue_staff_notify_once(v_row.venue_id, v_staff, 'venue_short_game', v_row.id::text,
           jsonb_build_object(
             'title', format('Short game: %s of %s', v_joined, v_row.capacity)
                      -- P6e audit: "Short game: 8 of 10 (1 venue player)".
                      || case v_venue_players when 0 then '' when 1 then ' (1 venue player)'
                              else format(' (%s venue players)', v_venue_players) end,
             'body', format('%s at %s%s. You can offer a player.',
                            public.venue_notice_day(v_row.booking_day), to_char(v_row.start_time, 'HH24:MI'),
                            coalesce(', ' || v_pitches, '')),
             'bookingId', v_row.id,
             'joined', v_joined,
             'venuePlayers', v_venue_players,  -- P6e audit
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

  -- Saved searches (pay_saved_searches): match the queued events.
  v_saved := public.saved_searches_tick(p_now);

  return jsonb_build_object('new_booking', v_new, 'booking_cancelled', v_cancelled, 'short_game', v_short,
                            'daily_summary', v_summaries, 'saved_search_match', v_saved);
end;
$$;

revoke all on function public.venue_notifications_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.venue_notifications_tick(timestamptz) to service_role;
