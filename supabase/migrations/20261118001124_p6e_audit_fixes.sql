-- P6e audit fixes (the read-only audit of everything P6e added, 18 November).
-- Each function is re-created from its latest definition on master; the only
-- changes are marked "-- P6e audit".
--
--   1. switch_refusal (20261116124400_pay_switching, Panos's P12): the "too
--      many players" check counts booking_spots_taken (app players and
--      accepted venue players), so 6 v 6 -> 5 v 5 can't squeeze out a venue
--      player the booker accepted. An open offer takes no spot, as before.
--   2. venue_booking_roster (20261117180513_match_no_shows): can_unmark_arrived
--      is false once the player has voted for man of the match or rated a
--      player, the rule venue_unmark_arrived has had since
--      20261117192228_match_ratings_unmark.
--   3. Staff-facing counts include accepted venue players (decided 18
--      November, Dimitris; spec 13 "Venue notifications"):
--        venue_daily_summary_content  joined = app players + accepted venue
--                                     players, with venuePlayers per game and
--                                     appVenuePlayers in total; short only
--                                     when that total is below capacity;
--        venue_daily_summary_body     "10 of 10 players in (1 venue player)";
--        venue_notifications_tick     no venue_short_game when venue players
--                                     fill the gap; otherwise counted with
--                                     them ("Short game: 8 of 10 (1 venue
--                                     player)").
--      Player-facing amounts, the players' 6-hour warning
--      (send_short_game_warnings) and collection_amounts are untouched: for
--      money a venue player is an empty spot (spec 13 "Short games").
--   4. venue_notifications_tick: venue_booking_cancelled goes only to staff
--      who were sent venue_new_booking for that booking, so a booking
--      confirmed and cancelled between two runs tells nobody.
--
-- create or replace keeps every grant; they are restated below as their
-- migrations had them.

-- switch_refusal, from 20261116124400_pay_switching.sql
create or replace function public.switch_refusal(
  p_booking public.venue_bookings,
  p_uid uuid,
  p_players_per_side integer
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  if p_uid is null then
    return 'not_authenticated';
  end if;
  if p_players_per_side is null or p_players_per_side not in (5, 6) then
    return 'invalid_players_per_side';
  end if;
  if p_booking.id is null then
    return 'booking_not_found';
  end if;
  if p_booking.created_by is distinct from p_uid then
    return 'not_booker';
  end if;
  if p_booking.booking_type = 'counter' or p_booking.payment_mode is null or p_booking.payment_mode = 'gipedo_pano'
     or p_booking.format <> '5-a-side' then
    return 'not_switchable';
  end if;
  if p_booking.status = 'cancelled' then
    return 'booking_cancelled';
  end if;
  if p_booking.status <> 'confirmed' then
    return 'booking_not_confirmed';
  end if;
  if p_booking.switched_at is not null then
    return 'already_switched';
  end if;
  if p_booking.capacity = p_players_per_side * 2 then
    return 'already_that_format';
  end if;
  if now() > public.booking_kickoff_at(p_booking.booking_day, p_booking.start_time) - public.rule_refund_cutoff() then
    return 'switch_closed';
  end if;
  if p_players_per_side * 2 > p_booking.capacity then
    select * into v_venue from public.venues where id = p_booking.venue_id;
    if not v_venue.allows_6v6_on_5s or exists (
         select 1 from public.booking_pitches bp join public.pitches p on p.id = bp.pitch_id
         where bp.booking_id = p_booking.id and p.size <> '5-a-side') then
      return 'six_a_side_not_allowed';
    end if;
  end if;
  -- P6e audit: every spot taken, app players and accepted venue players
  -- (booking_spots_taken), not only shares. For a booking that can switch it
  -- counts the same shares as before ('expired' is Gipedo only, refused above).
  if public.booking_spots_taken(p_booking.id) > p_players_per_side * 2 then
    return 'too_many_players';
  end if;
  return null;
end;
$$;

-- venue_booking_roster, from 20261117180513_match_no_shows.sql
create or replace function public.venue_booking_roster(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_match_id uuid;
  v_match public.matches;
  v_started boolean;
  v_ended boolean;
  v_base jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_venue_staff(v_booking.venue_id) then
    raise exception 'not_venue_staff';
  end if;

  v_base := jsonb_build_object(
    'booking_id', v_booking.id,
    'kind', case v_booking.booking_type when 'user_booking' then 'app' else v_booking.booking_type end,
    'status', v_booking.status,
    'booking_day', v_booking.booking_day,
    'start_time', v_booking.start_time,
    'end_time', v_booking.end_time,
    'format', v_booking.format,
    'capacity', v_booking.capacity,
    'note', v_booking.note);

  if v_booking.booking_type = 'counter' then
    return v_base || (
      select jsonb_build_object(
               'source', c.source,
               'contact', jsonb_build_object('id', ct.id, 'name', ct.name, 'phone', ct.phone),
               'venue_price_cents', c.venue_price_cents,
               'charged_cents', c.charged_cents,
               'paid_method', c.paid_method,
               'paid_at', c.paid_at,
               'cancelled_at', c.cancelled_at,
               'players', '[]'::jsonb)
      from public.venue_counter_bookings c
      join public.venue_contacts ct on ct.id = c.contact_id
      where c.booking_id = v_booking.id);
  end if;

  if v_booking.booking_type <> 'user_booking' then
    return v_base || jsonb_build_object('players', '[]'::jsonb);
  end if;

  select id into v_match_id from public.matches where booking_id = v_booking.id;
  -- P6e no-shows: the match, for each player's attendance below.
  select * into v_match from public.matches where id = v_match_id;
  v_started := exists (select 1 from public.booking_collections c where c.booking_id = v_booking.id);
  v_ended := v_booking.booking_day + v_booking.end_time <= (now() at time zone 'Asia/Nicosia');

  return v_base || jsonb_build_object(
    'payment_mode', v_booking.payment_mode,
    'booker_name', public.profile_display_name(v_booking.created_by),
    'match_id', v_match_id,
    'collection_started', v_started,
    'can_run_collection', v_booking.status = 'confirmed' and not v_started and v_ended
                          and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot'),
    -- P6e: the players the venue offered, and whether staff can offer one now
    -- (offer_venue_player's own checks).
    'venue_players', public.booking_venue_players_json(v_booking.id, auth.uid(), true),
    'can_offer_player', v_booking.status = 'confirmed'
                        and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot')
                        and now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)
                        and public.booking_spots_taken(v_booking.id)
                            + (select count(*) from public.booking_venue_players vp
                               where vp.booking_id = v_booking.id and vp.status = 'offered')
                            < public.booking_total_shares_needed(v_booking.id),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'profile_id', s.profile_id,
               'name', public.profile_display_name(s.profile_id),
               'is_booker', s.is_booker,
               'payment_method', s.payment_method,
               'state', case
                          when s.status = 'covered' then 'covered'
                          when s.status = 'pending' then 'unpaid'
                          when s.payment_method = 'cash' and s.cash_received_at is not null then 'cash_paid'
                          when s.payment_method = 'cash' then 'cash'
                          else 'in_app' end,
               'amount_cents', s.amount_cents,
               'pitch_cents', s.pitch_cents,
               'fee_cents', s.fee_cents,
               'cash_cents', s.cash_cents,
               'checked_in', a.profile_id is not null,
               -- P6e no-shows: attendance (checked_in, not_yet, missing,
               -- no_show; null with no match yet), how they checked in, what
               -- staff can do now, and their final no-shows at this venue.
               'attendance', public.match_attendance_state(v_match_id, s.profile_id),
               'check_in_method', a.method,
               'can_mark_arrived', v_match.id is not null and a.profile_id is null
                                   and public.match_spot_holder(v_match_id, s.profile_id)
                                   and public.venue_attendance_open(v_match),
               'can_unmark_arrived', v_match.id is not null and a.method is not distinct from 'venue'
                                     and public.venue_attendance_open(v_match)
                                     and not exists (select 1 from public.motm_votes mv
                                                     where mv.match_id = v_match_id and mv.voter_profile_id = s.profile_id)
                                     -- P6e audit: as venue_unmark_arrived since
                                     -- 20261117192228: a rating uses the check-in too.
                                     and not exists (select 1 from public.match_ratings r
                                                     where r.match_id = v_match_id and r.rater_profile_id = s.profile_id),
               'no_show_count', public.venue_no_show_count(v_booking.venue_id, s.profile_id))
             order by s.is_booker desc, s.created_at, s.id)
      from public.booking_payment_shares s
      -- P6e no-shows: the player's check-in, if any (was an exists in checked_in).
      left join public.match_attendance a on a.match_id = v_match_id and a.profile_id = s.profile_id
      -- Still in, as cancellation_plan counts them: not a player who left
      -- with credit, by forfeit or for a refund.
      where s.booking_id = v_booking.id and s.status in ('pending', 'authorized', 'paid', 'covered')), '[]'::jsonb));
end;
$$;

-- venue_daily_summary_content, from 20261117141044_pay_venue_notifications.sql
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
            where s.booking_id = b.id and s.status in ('pending', 'authorized', 'paid', 'covered'))::integer
           -- P6e audit: accepted venue players count as joined for staff.
           + (select count(*) from public.booking_venue_players vp
              where vp.booking_id = b.id and vp.status = 'accepted')::integer as joined,
           -- P6e audit: how many of them are venue players.
           (select count(*) from public.booking_venue_players vp
            where vp.booking_id = b.id and vp.status = 'accepted')::integer as venue_players,
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
                                          'short', g.joined < g.capacity, 'cashCents', g.cash_cents,
                                          'venuePlayers', g.venue_players)  -- P6e audit
                end as item
    from game g
  )
  select
    jsonb_build_object(
      'gameCount', count(*),
      'appJoined', coalesce(sum(d.joined) filter (where d.booking_type = 'user_booking'), 0),
      'appPlayers', coalesce(sum(d.capacity) filter (where d.booking_type = 'user_booking'), 0),
      -- P6e audit: of appJoined, how many are accepted venue players.
      'appVenuePlayers', coalesce(sum(d.venue_players) filter (where d.booking_type = 'user_booking'), 0),
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

-- venue_daily_summary_body, from 20261117141044_pay_venue_notifications.sql
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
  v_venue_players integer := coalesce((p_content ->> 'appVenuePlayers')::integer, 0);  -- P6e audit
  v_body text;
  v_extras text[] := '{}';
begin
  v_body := public.venue_notice_day((p_content ->> 'day')::date) || ': '
    || case v_games when 0 then 'No games' when 1 then '1 game' else v_games || ' games' end
    || case when v_app_games > 0
            then format(', %s of %s players in', p_content ->> 'appJoined', p_content ->> 'appPlayers')
                 -- P6e audit: "10 of 10 players in (1 venue player)".
                 || case v_venue_players when 0 then '' when 1 then ' (1 venue player)'
                         else format(' (%s venue players)', v_venue_players) end
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

-- venue_notifications_tick, from 20261117141044_pay_venue_notifications.sql
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

  return jsonb_build_object('new_booking', v_new, 'booking_cancelled', v_cancelled, 'short_game', v_short,
                            'daily_summary', v_summaries);
end;
$$;

-- Grants, as their migrations had them.
revoke all on function public.switch_refusal(public.venue_bookings, uuid, integer) from public, anon, authenticated;
grant execute on function public.switch_refusal(public.venue_bookings, uuid, integer) to service_role;
revoke all on function public.venue_booking_roster(uuid) from public, anon;
grant execute on function public.venue_booking_roster(uuid) to authenticated, service_role;
revoke all on function public.venue_daily_summary_content(uuid, date) from public, anon, authenticated;
grant execute on function public.venue_daily_summary_content(uuid, date) to service_role;
revoke all on function public.venue_daily_summary_body(jsonb) from public, anon, authenticated;
grant execute on function public.venue_daily_summary_body(jsonb) to service_role;
revoke all on function public.venue_notifications_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.venue_notifications_tick(timestamptz) to service_role;
