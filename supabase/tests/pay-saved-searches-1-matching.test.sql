-- Saved searches (decided 18 November; spec 13 "Saved searches"): a player
-- saves a search (a date or a weekday, a time window, a game length, a
-- format, a city or area) and gets one saved_search_match when a matching
-- slot frees up (a booking cancelled, a block removed) or a game inside it
-- asks for players (a squad post). The triggers only queue the event;
-- saved_searches_tick, called from venue_notifications_tick, matches it.
begin;

-- Events earlier test files left in the queue are matched first, so only
-- this file's own events count below.
select public.saved_searches_tick();

-- tests.save_search(...): saves a search as p_profile, the way the app does.
create or replace function tests.save_search(
  p_profile uuid,
  p_day date,
  p_weekday integer,
  p_from time,
  p_to time,
  p_minutes integer default 60,
  p_format text default null,
  p_city text default null,
  p_area text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.act_as(p_profile);
  insert into public.saved_searches (day, weekday, from_local, to_local, minutes, format, city, area)
  values (p_day, p_weekday, p_from, p_to, p_minutes, p_format, p_city, p_area)
  returning id into v_id;
  perform tests.act_as_postgres();
  return v_id;
end;
$$;

-- tests.matches(profile): how many saved_search_match the player got.
create or replace function tests.matches(p_profile uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.notifications where profile_id = p_profile and type = 'saved_search_match';
$$;

-- 1. A cancelled booking frees its slot: date, weekday, time window, game
-- length, format, area and city decide who hears; the canceller doesn't.
do $$
declare
  v_owner uuid := tests.create_user('ss-owner@futty.test');
  v_booker uuid := tests.create_user('ss-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_engomi_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 2;
  v_dated uuid := tests.create_user('ss-dated@futty.test');
  v_weekly uuid := tests.create_user('ss-weekly@futty.test');
  v_later uuid := tests.create_user('ss-later@futty.test');
  v_longer uuid := tests.create_user('ss-longer@futty.test');
  v_sevens uuid := tests.create_user('ss-sevens@futty.test');
  v_limassol uuid := tests.create_user('ss-limassol@futty.test');
  v_area uuid := tests.create_user('ss-area@futty.test');
  v_next_day uuid := tests.create_user('ss-next-day@futty.test');
  v_s uuid;
  v_b public.venue_bookings;
  v_n public.notifications;
  v_sent jsonb;
begin
  update public.venues set city = 'Nicosia (Strovolos)', name = 'Nuevo Campo' where id = v_venue;
  update public.venues set city = 'Limassol' where id = v_other_venue;
  update public.venues set city = 'Nicosia (Engomi)' where id = v_engomi_venue;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_other_venue, '5-a-side', 6000);
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '19:00', '20:00', 'ss-1');
  perform tests.pay_ago((tests.player(v_b.id, 0)).id, 'pi_ss_1');
  assert (select status from public.venue_bookings where id = v_b.id) = 'confirmed', 'booked';

  v_s := tests.save_search(v_dated, v_day, null, '18:00', '23:00', 60, '5-a-side', null, 'Nicosia (Strovolos)');
  perform tests.save_search(v_weekly, null, extract(isodow from v_day)::integer, '19:00', '20:00', 60, null, 'Nicosia');
  perform tests.save_search(v_later, v_day, null, '20:00', '22:00', 60, '5-a-side');
  perform tests.save_search(v_longer, v_day, null, '18:00', '22:00', 90, '5-a-side');
  perform tests.save_search(v_sevens, v_day, null, '18:00', '22:00', 60, '7-a-side');
  perform tests.save_search(v_limassol, v_day, null, '18:00', '22:00', 60, null, 'Limassol');
  perform tests.save_search(v_area, v_day, null, '18:00', '22:00', 60, null, null, 'Nicosia (Engomi)');
  perform tests.save_search(v_next_day, v_day + 1, null, '18:00', '22:00', 60);
  -- The booker's own search matches too, but they freed it.
  perform tests.save_search(v_booker, v_day, null, '18:00', '22:00', 60);

  -- Nothing until the slot frees up.
  v_sent := public.venue_notifications_tick();
  assert (v_sent ->> 'saved_search_match')::integer = 0, format('nothing yet, got %s', v_sent);

  perform tests.cancel(v_b.id, 'whole_team', v_booker);
  assert exists (select 1 from public.saved_search_events where booking_id = v_b.id and processed_at is null),
    'the cancellation only queued an event';
  assert tests.matches(v_dated) = 0, 'nothing sent from inside the cancellation';

  v_sent := public.venue_notifications_tick();
  assert (v_sent ->> 'saved_search_match')::integer = 2, format('two searches match, got %s', v_sent);
  assert tests.matches(v_dated) = 1, 'a dated search, inside its window, its area';
  assert tests.matches(v_weekly) = 1, 'a weekday search, its whole city';
  assert tests.matches(v_later) = 0, 'the freed hour is outside the window';
  assert tests.matches(v_longer) = 0, 'a 90-minute game doesn''t fit in the freed hour';
  assert tests.matches(v_sevens) = 0, 'another format';
  assert tests.matches(v_limassol) = 0, 'another city';
  assert tests.matches(v_area) = 0, 'another area of the same city';
  assert tests.matches(v_next_day) = 0, 'another day';
  assert tests.matches(v_booker) = 0, 'never the player who cancelled';
  assert (select processed_at from public.saved_search_events where booking_id = v_b.id) is not null, 'processed';

  select * into v_n from public.notifications where profile_id = v_dated and type = 'saved_search_match';
  assert v_n.title = 'A pitch you were looking for is free', format('title, got %s', v_n.title);
  assert v_n.body = format('Nuevo Campo, %s at 19:00: 5-a-side for 60 minutes.', to_char(v_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', v_n.body);
  assert v_n.data ->> 'kind' = 'slot' and v_n.data ->> 'venueId' = v_venue::text
         and v_n.data ->> 'day' = v_day::text and v_n.data ->> 'start' = '19:00'
         and (v_n.data ->> 'minutes')::integer = 60 and v_n.data ->> 'format' = '5-a-side'
         and v_n.data ->> 'savedSearchId' = v_s::text,
    format('data, got %s', v_n.data);

  -- Running again sends nothing more.
  v_sent := public.venue_notifications_tick();
  assert (v_sent ->> 'saved_search_match')::integer = 0 and tests.matches(v_dated) = 1, 'each event once';
end $$;

-- 2. At most one notification per saved search per Cyprus day.
do $$
declare
  v_owner uuid := tests.create_user('ss-day-owner@futty.test');
  v_booker uuid := tests.create_user('ss-day-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  v_player uuid := tests.create_user('ss-day-player@futty.test');
  v_late uuid := tests.create_user('ss-day-late@futty.test');
  v_b1 public.venue_bookings;
  v_b2 public.venue_bookings;
begin
  update public.venues set city = 'Larnaca' where id = v_venue;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_b1 := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '10:00', '11:00', 'ss-d1');
  v_b2 := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '15:00', '16:00', 'ss-d2');
  perform tests.pay_ago((tests.player(v_b1.id, 0)).id, 'pi_ss_d1');
  perform tests.pay_ago((tests.player(v_b2.id, 0)).id, 'pi_ss_d2');
  perform tests.save_search(v_player, v_day, null, '08:00', '18:00', 60, null, 'Larnaca');

  perform tests.cancel(v_b1.id, 'whole_team', v_booker);
  perform public.venue_notifications_tick();
  assert tests.matches(v_player) = 1, 'the first freed slot';

  -- A second slot frees up the same day: the same search stays quiet, a
  -- search saved since then still hears.
  perform tests.save_search(v_late, v_day, null, '14:00', '17:00', 60);
  perform tests.cancel(v_b2.id, 'whole_team', v_booker);
  perform public.venue_notifications_tick();
  assert tests.matches(v_player) = 1, 'one per search per Cyprus day';
  assert tests.matches(v_late) = 1, 'another search hears';
end $$;

-- 3. A removed block frees its range: only when a free slot of the search's
-- length and format fits in both the range and the window. The staff
-- member who removed it isn't told.
do $$
declare
  v_owner uuid := tests.create_user('ss-block-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 2;
  v_any uuid := tests.create_user('ss-block-any@futty.test');
  v_ninety uuid := tests.create_user('ss-block-ninety@futty.test');
  v_whole uuid := tests.create_user('ss-block-whole@futty.test');
  v_short_block uuid;
  v_day_block uuid;
begin
  update public.venues set city = 'Paphos' where id = v_venue;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  insert into public.venue_blocks (venue_id, block_day, starts_at, ends_at, created_by)
  values (v_venue, v_day, '10:00', '11:00', v_owner) returning id into v_short_block;
  insert into public.venue_blocks (venue_id, block_day, created_by)
  values (v_venue, v_day + 1, v_owner) returning id into v_day_block;

  perform tests.save_search(v_any, v_day, null, '09:00', '12:00', 60, null, 'Paphos');
  perform tests.save_search(v_ninety, v_day, null, '09:00', '12:00', 90, '5-a-side');
  perform tests.save_search(v_whole, v_day + 1, null, '17:00', '19:00', 90, '5-a-side');
  perform tests.save_search(v_owner, v_day, null, '09:00', '12:00', 60);

  perform tests.act_as(v_owner);
  delete from public.venue_blocks where id in (v_short_block, v_day_block);
  perform tests.act_as_postgres();
  perform public.venue_notifications_tick();

  assert tests.matches(v_any) = 1, 'the freed hour fits a 60-minute game of any format';
  assert tests.matches(v_ninety) = 0, 'a 90-minute game doesn''t fit in the freed hour';
  assert tests.matches(v_whole) = 1, 'a whole-day block frees the whole day';
  assert tests.matches(v_owner) = 0, 'never the person who removed the block';
  assert (select data ->> 'format' from public.notifications where profile_id = v_any and type = 'saved_search_match') = '5-a-side',
    'the format that fits';
end $$;

-- 4. A squad post asking for players: a game inside the search. Not the
-- poster; not an opposition post; not a closed post.
do $$
declare
  v_owner uuid := tests.create_user('ss-post-owner@futty.test');
  v_poster uuid := tests.create_user('ss-post-poster@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 4;
  v_player uuid := tests.create_user('ss-post-player@futty.test');
  v_outside uuid := tests.create_user('ss-post-outside@futty.test');
  v_post uuid;
  v_n public.notifications;
begin
  update public.venues set city = 'Nicosia (Lakatamia)', name = 'Lakatamia Five' where id = v_venue;
  perform tests.save_search(v_player, v_day, null, '18:00', '22:00', 60, '5-a-side', 'Nicosia');
  perform tests.save_search(v_outside, v_day, null, '08:00', '12:00', 60, '5-a-side', 'Nicosia');
  perform tests.save_search(v_poster, v_day, null, '18:00', '22:00', 60, '5-a-side', 'Nicosia');

  insert into public.squad_posts (type, venue_id, scheduled_at, format, posted_by, status, players_needed, total)
  values ('players', v_venue, (v_day + time '20:00') at time zone 'Asia/Nicosia', '5-a-side', v_poster, 'open', 3, 10)
  returning id into v_post;
  insert into public.squad_posts (type, venue_id, scheduled_at, format, posted_by, status)
  values ('opposition', v_venue, (v_day + time '19:00') at time zone 'Asia/Nicosia', '5-a-side', v_poster, 'open');

  perform public.venue_notifications_tick();
  assert tests.matches(v_player) = 1, 'a game inside the search asks for players';
  assert tests.matches(v_outside) = 0, 'outside the time window';
  assert tests.matches(v_poster) = 0, 'never the poster';
  select * into v_n from public.notifications where profile_id = v_player and type = 'saved_search_match';
  assert v_n.title = 'A game you were looking for needs players', format('title, got %s', v_n.title);
  assert v_n.body = format('Lakatamia Five, %s at 20:00: 5-a-side.', to_char(v_day, 'FMDay FMDD FMMonth')),
    format('body, got %s', v_n.body);
  assert v_n.data ->> 'kind' = 'squad_post' and v_n.data ->> 'postId' = v_post::text, format('data, got %s', v_n.data);

  -- A post closed before the tick runs tells nobody.
  insert into public.squad_posts (type, venue_id, scheduled_at, format, posted_by, status, players_needed, total)
  values ('players', v_venue, (v_day + 1 + time '20:00') at time zone 'Asia/Nicosia', '5-a-side', v_poster, 'open', 2, 10)
  returning id into v_post;
  perform tests.save_search(v_outside, v_day + 1, null, '18:00', '22:00', 60);
  update public.squad_posts set status = 'closed' where id = v_post;
  perform public.venue_notifications_tick();
  assert tests.matches(v_outside) = 0, 'a closed post';
end $$;

-- 5. A cancelled booking in the past never matches; an unpaid booking
-- cancelled when its payment window closes (by the job, with no session and
-- no cancellation row) frees its slot like any other, and its booker isn't
-- told.
do $$
declare
  v_owner uuid := tests.create_user('ss-past-owner@futty.test');
  v_booker uuid := tests.create_user('ss-past-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_weekday uuid := tests.create_user('ss-past-weekday@futty.test');
  v_unpaid uuid := tests.create_user('ss-past-unpaid@futty.test');
  v_day date := tests.cyprus_today() + 5;  -- never the weekday of today or yesterday
  v_past public.venue_bookings;
  v_open public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_past := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 1, '12:00', '13:00', 'ss-p');
  perform tests.pay_ago((tests.player(v_past.id, 0)).id, 'pi_ss_past');
  perform tests.set_kickoff(v_past.id, now() - interval '3 hours');
  -- Every day of that weekday, all day, any format, 30 minutes.
  perform tests.save_search(v_weekday, null,
                            extract(isodow from (select booking_day from public.venue_bookings where id = v_past.id))::integer,
                            '00:00', '24:00', 30);
  update public.venue_bookings set status = 'cancelled' where id = v_past.id;

  v_open := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '12:00', '13:00', 'ss-u');
  assert (select status from public.venue_bookings where id = v_open.id) <> 'confirmed', 'never paid';
  perform tests.save_search(v_unpaid, v_day, null, '11:00', '14:00', 60);
  perform tests.save_search(v_booker, v_day, null, '11:00', '14:00', 60);
  update public.venue_bookings set status = 'cancelled' where id = v_open.id;

  perform public.venue_notifications_tick();
  assert tests.matches(v_weekday) = 0, 'a slot in the past never matches';
  assert tests.matches(v_unpaid) = 1, 'an unpaid booking cancelled by its payment window frees its slot';
  assert tests.matches(v_booker) = 0, 'its booker isn''t told';
end $$;

-- 6. Quiet hours hold the push (send_notification); turning the type off
-- writes the bell row only; a deleted search hears nothing.
do $$
declare
  v_owner uuid := tests.create_user('ss-quiet-owner@futty.test');
  v_booker uuid := tests.create_user('ss-quiet-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 5;
  v_quiet uuid := tests.create_user('ss-quiet@futty.test');
  v_off uuid := tests.create_user('ss-off@futty.test');
  v_gone uuid := tests.create_user('ss-gone@futty.test');
  v_local time := (now() at time zone 'Asia/Nicosia')::time;
  v_gone_search uuid;
  v_b public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '19:00', '20:00', 'ss-q');
  perform tests.pay_ago((tests.player(v_b.id, 0)).id, 'pi_ss_q');
  insert into public.push_tokens (profile_id, token, platform)
  values (v_quiet, 'ExponentPushToken[ss-quiet]', 'ios'), (v_off, 'ExponentPushToken[ss-off]', 'ios');
  perform tests.act_as(v_quiet);
  insert into public.notification_quiet_hours (profile_id, starts_local, ends_local)
  values (v_quiet, v_local - interval '1 hour', v_local + interval '1 hour');
  perform tests.act_as(v_off);
  insert into public.notification_settings (profile_id, type, enabled) values (v_off, 'saved_search_match', false);
  perform tests.act_as_postgres();
  assert not (select always_sent from public.notification_types where type = 'saved_search_match'), 'can be turned off';

  perform tests.save_search(v_quiet, v_day, null, '18:00', '21:00');
  perform tests.save_search(v_off, v_day, null, '18:00', '21:00');
  v_gone_search := tests.save_search(v_gone, v_day, null, '18:00', '21:00');
  perform tests.act_as(v_gone);
  delete from public.saved_searches where id = v_gone_search;
  perform tests.act_as_postgres();

  perform tests.cancel(v_b.id, 'whole_team', v_booker);
  perform public.venue_notifications_tick();

  assert tests.matches(v_quiet) = 1, 'in the bell';
  assert (select d.status from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
          where n.profile_id = v_quiet and n.type = 'saved_search_match') = 'held_quiet_hours',
    'the push waits for the end of quiet hours';
  assert tests.matches(v_off) = 1 and not exists (
           select 1 from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.profile_id = v_off and n.type = 'saved_search_match'),
    'turned off: the bell row, no push';
  assert tests.matches(v_gone) = 0, 'a deleted search hears nothing';
end $$;

rollback;
