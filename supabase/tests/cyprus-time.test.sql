-- Tests for supabase/legacy/cyprus-time.sql, run against the migrated schema
-- in a NEW connection (the database time zone set in
-- 20261108230318_outside_public_schema.sql only applies to connections opened
-- after it). Any failed check raises an error, which fails CI. Everything runs
-- in one transaction that is rolled back, so the test leaves no rows behind.

begin;

-- 1. A new connection runs on Cyprus time.
do $$
begin
  assert current_setting('timezone') = 'Asia/Nicosia',
    format('expected the database time zone to be Asia/Nicosia, got %s', current_setting('timezone'));
  assert current_date = (now() at time zone 'Asia/Nicosia')::date,
    'current_date should be today''s date in Cyprus';
end $$;

-- 2. book_slot uses Cyprus time even on a connection still on UTC
--    (connections opened before the setting changed), and on a Cyprus one.
create temporary table tz_cases (tz text);
insert into tz_cases values ('UTC'), ('Asia/Nicosia');

do $$
declare
  v_tz text;
  v_booker uuid := tests.create_user('cyprus-time-test@futty.test');
  v_venue uuid;
  v_local timestamp;
  v_day date;
  v_start time;
  v_end time;
  v_booking public.venue_bookings;
  v_share integer;
begin
  insert into public.venues (name, base_pitches, open_time, close_time, price_per_pitch_hour)
  values ('Cyprus time test venue', 4, '00:00', '23:59', 60) returning id into v_venue;
  perform set_config('request.jwt.claim.sub', v_booker::text, false);

  for v_tz in select tz from tz_cases loop
    perform set_config('timezone', v_tz, false);

    -- A slot that started 1 hour ago in Cyprus must be refused. Before the
    -- fix, a UTC connection saw it as 1-2 hours in the future and took it.
    v_local := now() at time zone 'Asia/Nicosia' - interval '1 hour';
    v_day := v_local::date;
    v_start := date_trunc('minute', v_local)::time;
    v_end := case when v_start >= time '23:00' then time '23:59' else v_start + interval '1 hour' end;
    begin
      perform public.book_slot(v_venue, v_day, v_start, v_end, 1, 10, '5-a-side');
      raise exception 'book_slot accepted a slot that started an hour ago in Cyprus (session time zone %)', v_tz;
    exception when others then
      if sqlerrm <> 'slot_in_past' then
        raise;
      end if;
    end;

    -- A slot that started 1 minute ago is refused too.
    v_local := now() at time zone 'Asia/Nicosia' - interval '1 minute';
    v_start := date_trunc('minute', v_local)::time;
    v_end := case when v_start >= time '23:00' then time '23:59' else v_start + interval '1 hour' end;
    begin
      perform public.book_slot(v_venue, v_local::date, v_start, v_end, 1, 10, '5-a-side');
      raise exception 'book_slot accepted a slot that started a minute ago in Cyprus (session time zone %)', v_tz;
    exception when others then
      if sqlerrm <> 'slot_in_past' then
        raise;
      end if;
    end;

    -- Tomorrow is accepted, and the booker's share is unchanged:
    -- a EUR 60 5-a-side = 6000 / 10 = 600 + 80 fee = 680 cents.
    v_day := (now() at time zone 'Asia/Nicosia')::date + 1;
    v_booking := public.book_slot(
      v_venue, v_day,
      case when v_tz = 'UTC' then time '10:00' else time '12:00' end,
      case when v_tz = 'UTC' then time '11:00' else time '13:00' end,
      1, 10, '5-a-side');
    assert v_booking.status = 'pending_payment', 'a paid slot should start as pending_payment';
    assert v_booking.amount_cents = 6000, format('expected 6000 cents, got %s', v_booking.amount_cents);
    select amount_cents into v_share
    from public.booking_payment_shares
    where booking_id = v_booking.id and is_booker;
    assert v_share = 680, format('expected the booker''s share to be 680 cents, got %s', v_share);
  end loop;
end $$;

select 'cyprus-time tests passed' as result;

rollback;
