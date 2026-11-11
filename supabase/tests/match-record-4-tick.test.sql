-- A2 (docs/specs/match-record.md section 3): match_jobs_tick runs every
-- 15 minutes. scheduled → played after the end; the deadline confirms an
-- unanswered submission or ends a match with none as no_result; a match
-- whose booking was cancelled before the end is voided. Running it twice
-- changes nothing the second time.
begin;

create function tests.mr_booking(p_others integer, p_kickoff timestamptz, p_label text default 'mr')
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booker uuid := tests.create_user(format('%s-booker-%s@futty.test', p_label, left(gen_random_uuid()::text, 8)));
  v_venue uuid := tests.create_venue();
  v_booking public.venue_bookings;
begin
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', p_others, tests.next_weekday(3),
                                          '12:00', '13:00', p_label);
  perform tests.act_as_postgres();
  perform tests.set_kickoff(v_booking.id, p_kickoff);
  update public.venue_bookings set status = 'confirmed' where id = v_booking.id returning * into v_booking;
  return v_booking;
end;
$$;

create function tests.mr_create(p_booking uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform tests.act_as_service_role();
  v_id := public.create_match_for_booking(p_booking);
  perform tests.act_as_postgres();
  return v_id;
end;
$$;

create function tests.mr_tick()
returns jsonb
language plpgsql
as $$
declare
  v_counts jsonb;
begin
  perform tests.act_as_service_role();
  v_counts := public.match_jobs_tick();
  perform tests.act_as_postgres();
  return v_counts;
end;
$$;

do $$
declare
  -- Ends exactly now (now counts as past it), and one second from now.
  v_ended public.venue_bookings := tests.mr_booking(1, now() - interval '30 minutes', 'mr4a');
  v_ended_match uuid := tests.mr_create(v_ended.id);
  v_running public.venue_bookings := tests.mr_booking(1, now() - interval '30 minutes' + interval '1 second', 'mr4b');
  v_running_match uuid := tests.mr_create(v_running.id);
  -- Past the deadline: one with an unanswered submission, one without.
  v_silent public.venue_bookings := tests.mr_booking(1, now() - interval '30 hours', 'mr4c');
  v_silent_match uuid := tests.mr_create(v_silent.id);
  v_empty public.venue_bookings := tests.mr_booking(1, now() - interval '30 hours', 'mr4d');
  v_empty_match uuid := tests.mr_create(v_empty.id);
  -- Cancelled before the end (the payment code hasn't re-synced it yet).
  v_cancelled public.venue_bookings := tests.mr_booking(1, date_trunc('minute', now()) + interval '1 day', 'mr4e');
  v_cancelled_match uuid := tests.mr_create(v_cancelled.id);
  -- Cancelled after it ended: left alone.
  v_late public.venue_bookings := tests.mr_booking(1, now() - interval '3 hours', 'mr4f');
  v_late_match uuid := tests.mr_create(v_late.id);
  v_first jsonb;
  v_second jsonb;
  v_snapshot text;
begin
  insert into public.match_result_submissions (match_id, side, side_a_score, side_b_score, submitted_by, submitted_at)
  values (v_silent_match, 'a', 3, 2, v_silent.created_by, now() - interval '28 hours');
  -- The payment code's trigger (pay_match_sync) voids a cancelled booking's
  -- match at once. Off here, so the tick's own void path is tested.
  alter table public.venue_bookings disable trigger booking_match_on_booking;
  update public.venue_bookings set status = 'cancelled' where id in (v_cancelled.id, v_late.id);
  alter table public.venue_bookings enable trigger booking_match_on_booking;
  insert into public.booking_cancellations (booking_id, scope, cancelled_by, cancelled_at, quote, plan)
  values (v_late.id, 'whole_team', v_late.created_by, now() - interval '1 hour', 'test', '{}');

  v_first := tests.mr_tick();
  assert (select status from public.matches where id = v_ended_match) = 'played', 'ended exactly now: played';
  assert (select status from public.matches where id = v_running_match) = 'scheduled', 'one second to go: scheduled';
  assert (select status from public.matches where id = v_silent_match) = 'confirmed', 'silence: confirmed';
  assert (select confirmed_via from public.matches where id = v_silent_match) = 'deadline', 'via deadline';
  assert (select status from public.matches where id = v_empty_match) = 'no_result', 'no submission: no_result';
  assert (select status from public.matches where id = v_cancelled_match) = 'void', 'cancelled before the end: void';
  assert (select status from public.matches where id = v_late_match) = 'played', 'cancelled after the end: not voided';
  assert (v_first ->> 'played')::integer >= 2 and (v_first ->> 'confirmed')::integer >= 1
     and (v_first ->> 'no_result')::integer >= 1 and (v_first ->> 'voided')::integer >= 1,
    format('counts: %s', v_first);

  -- Idempotent: the second run changes nothing and sends nothing.
  select string_agg(id || status || coalesce(confirmed_at::text, '') || updated_at, ',' order by id) into v_snapshot
  from public.matches;
  select count(*)::text || v_snapshot into v_snapshot from public.notifications;
  v_second := tests.mr_tick();
  assert v_second = jsonb_build_object('played', 0, 'confirmed', 0, 'no_result', 0, 'voided', 0),
    format('nothing to do the second time, got %s', v_second);
  assert (select count(*)::text || string_agg(id || status || coalesce(confirmed_at::text, '') || updated_at, ',' order by id)
          from public.matches) is not null;
  assert v_snapshot = (select count(*)::text from public.notifications)
    || (select string_agg(id || status || coalesce(confirmed_at::text, '') || updated_at, ',' order by id) from public.matches),
    'the second run changed nothing';
end $$;

-- With the payment code's trigger on, cancelling voids the match at once:
-- the tick has nothing left to void.
do $$
declare
  v_booking public.venue_bookings := tests.mr_booking(1, date_trunc('minute', now()) + interval '1 day', 'mr4g');
  v_match uuid := tests.mr_create(v_booking.id);
begin
  update public.venue_bookings set status = 'cancelled' where id = v_booking.id;
  assert (select status from public.matches where id = v_match) = 'void', 'cancelled: void at once';
  assert (tests.mr_tick() ->> 'voided')::integer = 0, 'nothing left for the tick to void';
end $$;

select 'match record 4 (match_jobs_tick) passed' as result;

rollback;
