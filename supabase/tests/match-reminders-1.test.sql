-- A3b (docs/specs/05-product.md section 2, match-record.md decision 1c):
-- the 15-minute job sends each player match_reminder_24h at exactly 24
-- elapsed hours before kickoff, match_reminder_2h at exactly 2 hours, and
-- match_after_game at the end, each once per player per match however often
-- the job runs, and only if the match existed when the reminder fell due.
-- Including across the clock change on 25 October 2026 (04:00 EEST →
-- 03:00 EET). match_jobs_tick runs it.
begin;

-- A Cyprus wall-clock time as an instant.
create function tests.cy(p_local timestamp)
returns timestamptz
language sql
immutable
as $$
  select p_local at time zone 'Asia/Nicosia';
$$;

-- A scheduled pickup at a venue: two players in, one who left. Made
-- p_made_before kickoff.
create function tests.mr1_match(p_kickoff timestamptz, p_made_before interval, out match_id uuid,
                                out p1 uuid, out p2 uuid, out gone uuid, out venue_name text)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue();
begin
  match_id := tests.form_match(p_kickoff, 'scheduled', p_venue => v_venue);
  update public.matches set created_at = p_kickoff - p_made_before where id = match_id;
  p1 := tests.create_user(format('mr1-p1-%s@futty.test', left(gen_random_uuid()::text, 8)));
  p2 := tests.create_user(format('mr1-p2-%s@futty.test', left(gen_random_uuid()::text, 8)));
  gone := tests.create_user(format('mr1-gone-%s@futty.test', left(gen_random_uuid()::text, 8)));
  perform tests.form_player(match_id, p1, 'a', true, false);
  perform tests.form_player(match_id, p2, null, true, false);
  perform tests.form_player(match_id, gone, 'b', true, false, true);
  venue_name := (select name from public.venues where id = v_venue);
end;
$$;

-- Exactly at 24h and 2h before, never a second earlier; once each; and the
-- after-game message at the end.
do $$
declare
  k timestamptz := tests.cy('2026-11-20 20:00');
  m record := tests.mr1_match(tests.cy('2026-11-20 20:00'), interval '3 days');
  v_n public.notifications;
  v_counts jsonb;
begin
  perform tests.reminders_at(k - interval '24 hours' - interval '1 second');
  assert tests.notified(m.p1, 'match_reminder_24h') = 0, '24h a second early';

  v_counts := tests.reminders_at(k - interval '24 hours');
  assert tests.notified(m.p1, 'match_reminder_24h', m.match_id) = 1
         and tests.notified(m.p2, 'match_reminder_24h', m.match_id) = 1, '24h at exactly 24h';
  assert (v_counts ->> 'reminder_24h')::int = 2, format('counts: %s', v_counts);
  assert tests.notified(m.gone, 'match_reminder_24h') = 0, 'a player who left gets nothing';
  v_n := tests.last_notification(m.p1, 'match_reminder_24h');
  assert v_n.title = 'Game tomorrow' and v_n.body = m.venue_name || ', tomorrow at 20:00. 2 in.',
    format('24h text: %s / %s', v_n.title, v_n.body);
  assert v_n.data ->> 'matchId' = m.match_id::text, '24h data';

  -- The job runs again (and again 15 minutes later): nothing new.
  v_counts := tests.reminders_at(k - interval '24 hours');
  assert (v_counts ->> 'reminder_24h')::int = 0, 'second run sends nothing';
  perform tests.reminders_at(k - interval '23 hours 45 minutes');
  assert tests.notified(m.p1, 'match_reminder_24h') = 1 and tests.notified(m.p2, 'match_reminder_24h') = 1,
    '24h sent once';

  perform tests.reminders_at(k - interval '2 hours' - interval '1 second');
  assert tests.notified(m.p1, 'match_reminder_2h') = 0, '2h a second early';
  perform tests.reminders_at(k - interval '2 hours');
  perform tests.reminders_at(k - interval '2 hours');
  perform tests.reminders_at(k - interval '1 hour 45 minutes');
  assert tests.notified(m.p1, 'match_reminder_2h', m.match_id) = 1
         and tests.notified(m.p2, 'match_reminder_2h', m.match_id) = 1, '2h exactly once';
  assert tests.notified(m.p1, 'match_reminder_24h') = 1, 'the 24h one is not sent again at 2h';
  assert tests.notified(m.gone, 'match_reminder_2h') = 0, 'left: no 2h';
  v_n := tests.last_notification(m.p1, 'match_reminder_2h');
  assert v_n.title = 'Kick-off in 2 hours' and v_n.body = m.venue_name || ' at 20:00. 2 in.',
    format('2h text: %s / %s', v_n.title, v_n.body);

  -- After the game: at the end (one hour long), once.
  perform tests.reminders_at(k + interval '1 hour' - interval '1 second');
  assert tests.notified(m.p1, 'match_after_game') = 0, 'after-game before the end';
  perform tests.reminders_at(k + interval '1 hour');
  perform tests.reminders_at(k + interval '1 hour 15 minutes');
  assert tests.notified(m.p1, 'match_after_game', m.match_id) = 1
         and tests.notified(m.p2, 'match_after_game', m.match_id) = 1, 'after-game once';
  assert tests.notified(m.gone, 'match_after_game') = 0, 'left: no after-game';
  v_n := tests.last_notification(m.p1, 'match_after_game');
  assert v_n.title = 'How did it go?'
         and v_n.body = 'Confirm the score, vote for man of the match and rate the players.',
    format('after text: %s / %s', v_n.title, v_n.body);
end $$;

-- Across the clock change. Kickoff Sunday 25 October 20:00 (EET, UTC+2) is
-- 18:00Z; 24 elapsed hours before is Saturday 18:00Z, which is 21:00 in
-- Cyprus (EEST, UTC+3), not 20:00.
do $$
declare
  k timestamptz := tests.cy('2026-10-25 20:00');
  m record := tests.mr1_match(tests.cy('2026-10-25 20:00'), interval '3 days');
begin
  assert k = timestamptz '2026-10-25T18:00:00Z', 'kickoff instant';
  perform tests.reminders_at(timestamptz '2026-10-24T17:00:00Z');  -- 20:00 Saturday in Cyprus
  assert tests.notified(m.p1, 'match_reminder_24h') = 0, 'not at the same clock time the day before';
  perform tests.reminders_at(timestamptz '2026-10-24T17:59:59Z');
  assert tests.notified(m.p1, 'match_reminder_24h') = 0, '24h a second early (DST)';
  perform tests.reminders_at(timestamptz '2026-10-24T18:00:00Z');  -- 21:00 Saturday in Cyprus
  assert tests.notified(m.p1, 'match_reminder_24h', m.match_id) = 1, '24h at exactly 24 hours (DST)';
  assert (tests.last_notification(m.p1, 'match_reminder_24h')).body like '%, tomorrow at 20:00. 2 in.',
    'kickoff shown in Cyprus time after the change';

  perform tests.reminders_at(timestamptz '2026-10-25T15:59:59Z');
  assert tests.notified(m.p1, 'match_reminder_2h') = 0, '2h a second early (DST)';
  perform tests.reminders_at(timestamptz '2026-10-25T16:00:00Z');
  assert tests.notified(m.p1, 'match_reminder_2h', m.match_id) = 1, '2h at exactly 2 hours (DST)';
end $$;

-- Kickoff 05:00 on the morning of the change (03:00Z): 2 hours before is
-- 01:00Z, the instant the clocks go back (04:00 EEST = 03:00 EET).
do $$
declare
  early timestamptz := tests.cy('2026-10-25 05:00');
  e record := tests.mr1_match(tests.cy('2026-10-25 05:00'), interval '3 days');
begin
  assert early = timestamptz '2026-10-25T03:00:00Z', 'early kickoff instant';
  perform tests.reminders_at(timestamptz '2026-10-24T02:59:59Z');
  assert tests.notified(e.p1, 'match_reminder_24h') = 0, 'early 24h a second early';
  perform tests.reminders_at(timestamptz '2026-10-24T03:00:00Z');
  assert tests.notified(e.p1, 'match_reminder_24h', e.match_id) = 1, 'early 24h';
  perform tests.reminders_at(timestamptz '2026-10-25T00:59:59Z');
  assert tests.notified(e.p1, 'match_reminder_2h') = 0, 'early 2h a second early';
  perform tests.reminders_at(timestamptz '2026-10-25T01:00:00Z');
  assert tests.notified(e.p1, 'match_reminder_2h', e.match_id) = 1, 'early 2h across the change';
  assert (tests.last_notification(e.p1, 'match_reminder_2h')).body like '% at 05:00. 2 in.', 'early 2h text';
end $$;

-- A game booked 5 hours ahead: its 24h reminder fell due before it existed,
-- so it gets the 2h one only. Void games and cancelled ones get nothing.
do $$
declare
  k timestamptz := tests.cy('2026-11-21 20:00');
  late record := tests.mr1_match(tests.cy('2026-11-21 20:00'), interval '5 hours');
  boundary record := tests.mr1_match(tests.cy('2026-11-21 20:00'), interval '24 hours');
  void record := tests.mr1_match(tests.cy('2026-11-21 20:00'), interval '3 days');
begin
  update public.matches set status = 'void' where id = void.match_id;
  perform tests.reminders_at(k - interval '4 hours');
  assert tests.notified(late.p1, 'match_reminder_24h') = 0, 'late booking: no 24h';
  assert tests.notified(boundary.p1, 'match_reminder_24h') = 1, 'made exactly 24h before: gets it';
  perform tests.reminders_at(k - interval '2 hours');
  assert tests.notified(late.p1, 'match_reminder_2h') = 1, 'late booking: 2h';
  perform tests.reminders_at(k + interval '1 hour');
  assert tests.notified(void.p1, 'match_reminder_24h') + tests.notified(void.p1, 'match_reminder_2h')
         + tests.notified(void.p1, 'match_after_game') = 0, 'void match: nothing';
end $$;

-- Who's in and who hasn't paid, as the venue roster counts it (spec 13):
-- card shares are paid in app once held, taken or covered, unpaid while
-- pending; cash shares are paid once the venue ticked them or they paid by
-- card (cash_received_at), otherwise not yet paid.
do $$
declare
  v_booker uuid := tests.create_user('mr1-roster-booker@futty.test');
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 6,
                                                                 tests.next_weekday(3), '12:00', '13:00', 'mr1-roster');
  v_match uuid;
  k timestamptz := tests.cy('2026-11-22 20:00');
  v_n public.notifications;
begin
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id;
  update public.booking_payment_shares set status = 'paid' where id = (tests.player(v_booking.id, 0)).id;
  update public.booking_payment_shares set status = 'authorized' where id = (tests.player(v_booking.id, 1)).id;
  update public.booking_payment_shares set status = 'covered' where id = (tests.player(v_booking.id, 2)).id;
  update public.booking_payment_shares set status = 'pending' where id = (tests.player(v_booking.id, 3)).id;
  -- Cash, not yet paid (the €0.80 fee was paid by card).
  update public.booking_payment_shares set status = 'paid', payment_method = 'cash', cash_received_at = null
  where id = (tests.player(v_booking.id, 4)).id;
  -- Cash, ticked by the venue.
  update public.booking_payment_shares set status = 'paid', payment_method = 'cash', cash_received_at = now()
  where id = (tests.player(v_booking.id, 5)).id;
  -- Cancelled: no longer holds a spot, not counted.
  update public.booking_payment_shares set status = 'cancelled' where id = (tests.player(v_booking.id, 6)).id;

  perform tests.act_as_service_role();
  v_match := public.create_match_for_booking(v_booking.id);
  perform tests.act_as_postgres();
  update public.matches set kickoff_at = k, ends_at = k + interval '1 hour',
                            result_deadline_at = k + interval '25 hours', created_at = k - interval '3 days'
  where id = v_match;

  perform tests.reminders_at(k - interval '24 hours');
  v_n := tests.last_notification(v_booker, 'match_reminder_24h');
  assert v_n.body like '%, tomorrow at 20:00. 6 in, 2 haven''t paid.', format('roster 24h: %s', v_n.body);
  assert v_n.data ->> 'bookingId' = v_booking.id::text and v_n.data ->> 'matchId' = v_match::text, 'booking data';
  assert tests.notified((tests.player(v_booking.id, 6)).profile_id, 'match_reminder_24h') = 0, 'cancelled share';

  -- One unpaid: singular. All paid: said so.
  update public.booking_payment_shares set status = 'authorized' where id = (tests.player(v_booking.id, 3)).id;
  perform tests.reminders_at(k - interval '2 hours');
  v_n := tests.last_notification(v_booker, 'match_reminder_2h');
  assert v_n.body like '% at 20:00. 6 in, 1 hasn''t paid.', format('roster 2h: %s', v_n.body);

  update public.booking_payment_shares set cash_received_at = now() where id = (tests.player(v_booking.id, 4)).id;
  perform tests.act_as_service_role();
  assert public.booking_unpaid_count(v_booking.id) = 0, 'everyone paid';
  perform tests.act_as_postgres();
end $$;

-- match_jobs_tick, the job scheduled every 15 minutes, sends them.
do $$
declare
  m record := tests.mr1_match(date_trunc('second', now()) + interval '2 hours', interval '1 day');
  v_counts jsonb;
begin
  perform tests.act_as_service_role();
  v_counts := public.match_jobs_tick();
  perform tests.act_as_postgres();
  assert tests.notified(m.p1, 'match_reminder_2h', m.match_id) = 1, 'match_jobs_tick sends the 2h reminder';
  assert (v_counts ->> 'reminder_2h')::int >= 2, format('tick counts: %s', v_counts);
  perform tests.act_as_service_role();
  perform public.match_jobs_tick();
  perform tests.act_as_postgres();
  assert tests.notified(m.p1, 'match_reminder_2h', m.match_id) = 1, 'second tick sends nothing';
end $$;

rollback;
