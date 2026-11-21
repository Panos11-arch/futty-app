-- One price per format (docs/specs/13-payments-bookings.md, "Pitch prices",
-- decided 19 November, Panos): a venue has one price per format, the same on
-- every day and at every hour. There are no peak, off-peak or weekend prices,
-- and none can be set.
begin;

-- The same format costs the same at 10:00 on a Tuesday, 18:00 on a Thursday
-- and 12:00 on a Saturday: a EUR 60 5-a-side, 6000 / 10 = 600 + 80 = 680 each.
do $$
declare
  v_owner uuid := tests.create_user('one-price-owner@futty.test');
  v_player uuid := tests.create_user('one-price-every-hour@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_tuesday date := tests.next_weekday(2);
  v_thursday date := tests.next_weekday(4);
  v_saturday date := tests.next_weekday(6);
  v_case record;
  q jsonb;
begin
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 6000);

  perform tests.act_as(v_player);
  for v_case in
    select * from (values
      (v_tuesday,  '10:00'::time, '11:00'::time, 'Tuesday 10:00'),
      (v_thursday, '18:00',       '19:00',       'Thursday 18:00'),
      (v_saturday, '12:00',       '13:00',       'Saturday 12:00')
    ) as c (day, start_at, end_at, label)
  loop
    q := public.booking_quote(v_venue, v_case.day, v_case.start_at, v_case.end_at, '5-a-side', 5);
    assert (q ->> 'pitch_cents')::int = 6000, format('%s: pitch 6000, got %s', v_case.label, q ->> 'pitch_cents');
    assert (q -> 'each_pays' ->> 'player_cents')::int = 680, format('%s: 680 each, got %s', v_case.label, q -> 'each_pays');
    perform tests.check_player_price(v_venue, v_case.day, v_case.start_at, v_case.end_at, '5-a-side', 5,
                                     6000, 600, 680, v_case.label);
  end loop;
  perform tests.act_as_postgres();
end $$;

-- Setting a peak or weekend price is refused: there is nowhere to put one.
do $$
declare
  v_owner uuid := tests.create_user('one-price-refused-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_setup jsonb;
  v_page jsonb;
begin
  -- The old call with peak and weekend prices and hours no longer exists.
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 5000, 6000, 7000, null::smallint[], null::time, null::time, null::smallint[])$q$,
    v_venue)) is not null, 'set_price_rule with a peak and weekend price is refused';
  perform tests.act_as_postgres();

  -- Nor can the table hold one.
  assert tests.error_of(format(
    $q$update public.price_rules set peak_cents = 6000 where venue_id = %L$q$, v_venue)) is not null,
    'a peak price can''t be written';
  assert tests.error_of(format(
    $q$update public.price_rules set weekend_cents = 7000 where venue_id = %L$q$, v_venue)) is not null,
    'a weekend price can''t be written';
  assert tests.error_of(format(
    $q$insert into public.price_rules (venue_id, format, price_cents, peak_cents) values (%L, '7-a-side', 5000, 6000)$q$,
    v_venue)) is not null, 'a rule with a peak price can''t be inserted';
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'price_rules'
      and column_name in ('peak_cents', 'weekend_cents', 'peak_weekdays', 'peak_starts', 'peak_ends', 'weekend_weekdays')
  ), 'price_rules has no peak or weekend columns';

  -- What the app reads has the one price only.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 6000);
  v_setup := public.venue_setup(v_venue);
  v_page := public.venue_page(v_venue);
  perform tests.act_as_postgres();
  assert (select bool_and(p = jsonb_build_object('format', p ->> 'format', 'price_cents', (p ->> 'price_cents')::int))
          from jsonb_array_elements(v_setup -> 'prices') p), format('venue_setup: one price only, got %s', v_setup -> 'prices');
  assert (select bool_and(p = jsonb_build_object('format', p ->> 'format', 'hour_cents', (p ->> 'hour_cents')::int))
          from jsonb_array_elements(v_page -> 'prices') p), format('venue_page: one price only, got %s', v_page -> 'prices');
  assert exists (select 1 from jsonb_array_elements(v_page -> 'prices') p
                 where p ->> 'format' = '5-a-side' and (p ->> 'hour_cents')::int = 6000), 'venue_page shows EUR 60';
end $$;

select 'one price per format passed' as result;

rollback;
