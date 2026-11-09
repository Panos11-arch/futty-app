-- Pitch prices (docs/specs/13-payments-bookings.md, "Prices and fees",
-- decided 9 November): by default a venue has one price per format, the
-- same at every hour. Peak and weekend prices are optional and apply only
-- when the venue's data provides them. When it has them, a game is priced
-- half hour by half hour. Both worked examples from the spec, exact amounts.
begin;

-- A venue with one price: EUR 50 at any hour, any day -> 500 + 80 = 580 each.
do $$
declare
  v_player uuid := tests.create_user('one-price-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_monday date := tests.next_weekday(1);
  v_saturday date := tests.next_weekday(6);
  v_case record;
  v_booking public.venue_bookings;
  v_share integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  assert (select peak_cents is null and weekend_cents is null from public.price_rules where venue_id = v_venue),
    'no peak or weekend price unless the venue gives one';

  perform tests.act_as(v_player);
  for v_case in
    select * from (values
      (v_monday,   '10:00'::time, '11:00'::time, 'weekday morning'),
      (v_monday,   '18:00',       '19:00',       'weekday evening (no peak price)'),
      (v_monday,   '16:30',       '17:30',       'across 17:00'),
      (v_saturday, '18:00',       '19:00',       'Saturday (no weekend price)')
    ) as c (day, start_at, end_at, label)
  loop
    assert public.slot_price_cents(v_venue, v_case.day, v_case.start_at, v_case.end_at, '5-a-side') = 5000,
      format('%s: one price, 5000', v_case.label);
  end loop;
  assert public.slot_price_cents(v_venue, v_monday, '18:00', '19:30', '5-a-side') = 7500, '90 minutes at the one price';

  v_booking := public.book_slot(v_venue, v_monday, '18:00', '19:00', 1, '5-a-side', 5);
  assert v_booking.amount_cents = 5000, format('one-price booking: got %s', v_booking.amount_cents);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 580, format('spec example, one price: 580 each, got %s', v_share);

  assert (select price_cents from public.venue_free_slots(v_venue, v_saturday, '5-a-side', 60) where start_time = '20:00') = 5000,
    'free slots show the one price';
end $$;

-- The same venue with a EUR 60 peak price (Monday to Friday from 17:00) and
-- a EUR 70 weekend price.
do $$
declare
  v_player uuid := tests.create_user('peak-price-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_monday date := tests.next_weekday(1);
  v_friday date := tests.next_weekday(5);
  v_saturday date := tests.next_weekday(6);
  v_booking public.venue_bookings;
  v_share integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000, p_peak => 6000, p_weekend => 7000);

  perform tests.act_as(v_player);
  -- Spec example: 16:30-17:30 on a weekday = 2500 + 3000 = 5500; 550 + 80 = 630 each.
  v_booking := public.book_slot(v_venue, v_monday, '16:30', '17:30', 1, '5-a-side', 5);
  assert v_booking.amount_cents = 5500, format('crossing into peak: 5500, got %s', v_booking.amount_cents);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 630, format('spec example, crossing into peak: 630 each, got %s', v_share);

  assert public.slot_price_cents(v_venue, v_monday, '16:00', '18:00', '5-a-side') = 11000, '16:00-18:00 = 5000 + 6000';
  assert public.slot_price_cents(v_venue, v_monday, '10:00', '11:00', '5-a-side') = 5000, 'off-peak is the one price';
  assert public.slot_price_cents(v_venue, v_friday, '17:00', '18:00', '5-a-side') = 6000, 'Friday evening is peak';
  assert public.slot_price_cents(v_venue, v_saturday, '10:00', '11:00', '5-a-side') = 7000, 'Saturday is the weekend price';
  assert public.slot_price_cents(v_venue, v_saturday, '18:00', '19:00', '5-a-side') = 7000, 'the weekend has no peak';
end $$;

-- Only one of the two given: the other hours keep the one price.
do $$
declare
  v_player uuid := tests.create_user('half-bands-player@futty.test');
  v_peak_only uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_weekend_only uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_monday date := tests.next_weekday(1);
  v_saturday date := tests.next_weekday(6);
begin
  perform tests.set_price(v_peak_only, '5-a-side', 5000, p_peak => 6000);
  perform tests.set_price(v_weekend_only, '5-a-side', 5000, p_weekend => 7000);

  perform tests.act_as(v_player);
  assert public.slot_price_cents(v_peak_only, v_monday, '18:00', '19:00', '5-a-side') = 6000, 'peak-only: weekday evening is peak';
  assert public.slot_price_cents(v_peak_only, v_saturday, '18:00', '19:00', '5-a-side') = 5000, 'peak-only: Saturday is the one price';
  assert public.slot_price_cents(v_weekend_only, v_saturday, '18:00', '19:00', '5-a-side') = 7000, 'weekend-only: Saturday is weekend';
  assert public.slot_price_cents(v_weekend_only, v_monday, '18:00', '19:00', '5-a-side') = 5000, 'weekend-only: weekday evening is the one price';
end $$;

select 'venue model 12 (one price by default, optional peak and weekend) passed' as result;

rollback;
