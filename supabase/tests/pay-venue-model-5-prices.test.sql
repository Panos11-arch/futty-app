-- P3: price rules per format pick the right price: peak on weekdays inside
-- the venue's peak window (17:00 to closing by default), off-peak on weekdays
-- outside it, weekend all day Saturday and Sunday. A game that crosses into
-- peak pays each half hour at its own band. Prices come from the server only.
begin;

do $$
declare
  v_player uuid := tests.create_user('prices-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_weekday date := (select min(d) from generate_series(1, 5) as dow, tests.next_weekday(dow) as d);
  v_saturday date := tests.next_weekday(6);
  v_sunday date := tests.next_weekday(7);
  v_booking public.venue_bookings;
  v_share integer;
  v_case record;
  v_price integer;
begin
  -- 5-a-side: peak EUR 60, off-peak EUR 50, weekend EUR 70.
  perform tests.set_price(v_venue, '5-a-side', 6000, 5000, 7000);

  perform tests.act_as(v_player);
  for v_case in
    select * from (values
      (v_weekday,  '18:00'::time, '19:00'::time, 6000, 'weekday evening is peak'),
      (v_weekday,  '17:00',       '18:00',       6000, 'peak starts at 17:00'),
      (v_weekday,  '23:00',       '24:00',       6000, 'peak runs to closing'),
      (v_weekday,  '10:00',       '11:00',       5000, 'weekday morning is off-peak'),
      (v_weekday,  '16:00',       '17:00',       5000, 'the hour before peak is off-peak'),
      (v_weekday,  '16:30',       '17:30',       5500, 'half off-peak, half peak'),
      (v_weekday,  '12:00',       '13:30',       7500, '90 minutes off-peak'),
      (v_saturday, '10:00',       '11:00',       7000, 'Saturday morning is weekend'),
      (v_saturday, '18:00',       '19:00',       7000, 'Saturday evening is weekend, not peak'),
      (v_sunday,   '18:00',       '19:00',       7000, 'Sunday is weekend')
    ) as c (day, start_at, end_at, cents, label)
  loop
    v_price := public.slot_price_cents(v_venue, v_case.day, v_case.start_at, v_case.end_at, '5-a-side');
    assert v_price = v_case.cents, format('%s: expected %s, got %s', v_case.label, v_case.cents, v_price);
  end loop;

  -- book_slot charges that price: weekday peak EUR 60 -> 600 + 80 = 680.
  v_booking := public.book_slot(v_venue, v_weekday, '18:00', '19:00', 1, '5-a-side', 5);
  assert v_booking.amount_cents = 6000, format('peak booking: expected 6000, got %s', v_booking.amount_cents);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 680, format('peak share: expected 680, got %s', v_share);

  -- Off-peak EUR 50 -> 500 + 80 = 580.
  v_booking := public.book_slot(v_venue, v_weekday, '10:00', '11:00', 1, '5-a-side', 5);
  assert v_booking.amount_cents = 5000, format('off-peak booking: expected 5000, got %s', v_booking.amount_cents);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 580, format('off-peak share: expected 580, got %s', v_share);

  -- Weekend EUR 70 -> 700 + 80 = 780.
  v_booking := public.book_slot(v_venue, v_saturday, '18:00', '19:00', 1, '5-a-side', 5);
  assert v_booking.amount_cents = 7000, format('weekend booking: expected 7000, got %s', v_booking.amount_cents);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 780, format('weekend share: expected 780, got %s', v_share);

  -- A venue-specific peak window: 18:00-22:00 only.
  perform tests.act_as_postgres();
  update public.venues set peak_starts = '18:00', peak_ends = '22:00' where id = v_venue;
  perform tests.act_as(v_player);
  assert public.slot_price_cents(v_venue, v_weekday, '17:00', '18:00', '5-a-side') = 5000, '17:00 is off-peak with an 18:00 peak start';
  assert public.slot_price_cents(v_venue, v_weekday, '21:00', '22:00', '5-a-side') = 6000, '21:00 is still peak';
  assert public.slot_price_cents(v_venue, v_weekday, '22:00', '23:00', '5-a-side') = 5000, '22:00 is off-peak again';

  -- The venue's free slots carry the same price.
  select price_cents into v_price from public.venue_free_slots(v_venue, v_weekday, '5-a-side', 60) where start_time = '20:00';
  assert v_price = 6000, format('free slot at 20:00: expected 6000, got %s', v_price);
end $$;

-- A format with a pitch but no price is refused rather than booked for free.
do $$
declare
  v_player uuid := tests.create_user('prices-unset@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v_error text;
begin
  perform tests.create_pitch(v_venue, 'Pitch 1');
  perform tests.act_as(v_player);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:00'', ''13:00'', 1, ''5-a-side'', 5)', v_venue, tests.cyprus_today() + 1));
  assert v_error = 'price_not_set', format('no price rule: got %s', coalesce(v_error, 'success'));
end $$;

select 'venue model 5 (price rules) passed' as result;

rollback;
