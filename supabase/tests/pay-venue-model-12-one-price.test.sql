-- Pitch prices (docs/specs/13-payments-bookings.md, "Prices and fees",
-- decided 9 November): by default a venue has one price per format, the
-- same at every hour. Peak and weekend prices are optional and apply only
-- when the venue's data provides them. When it has them, a game is priced
-- half hour by half hour. Both worked examples from the spec, exact amounts.
--
-- Every case checks the pitch price, the booker's pitch share (price / 10)
-- and what they pay (pitch share + the 80 service fee).
begin;

-- Spec example, one price: a 5-a-side at EUR 50 costs EUR 50 at any hour,
-- any day: 5000 / 10 = 500 + 80 = 580 each.
do $$
declare
  v_player uuid := tests.create_user('one-price-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_monday date := tests.next_weekday(1);
  v_saturday date := tests.next_weekday(6);
  v_case record;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  assert (select peak_cents is null and weekend_cents is null from public.price_rules where venue_id = v_venue),
    'no peak or weekend price unless the venue gives one';

  perform tests.act_as(v_player);
  for v_case in
    select * from (values
      -- day,        start,         end,           pitch, pitch share, pays
      (v_monday,   '10:00'::time, '11:00'::time, 5000,  500,         580, 'weekday morning'),
      (v_monday,   '18:00',       '19:00',       5000,  500,         580, 'weekday evening (no peak price)'),
      (v_monday,   '16:30',       '17:30',       5000,  500,         580, 'across 17:00'),
      (v_saturday, '18:00',       '19:00',       5000,  500,         580, 'Saturday (no weekend price)'),
      (v_monday,   '18:00',       '19:30',       7500,  750,         830, '90 minutes at the one price')
    ) as c (day, start_at, end_at, pitch_price, pitch_share, pays, label)
  loop
    perform tests.check_player_price(v_venue, v_case.day, v_case.start_at, v_case.end_at, '5-a-side', 5,
                                     v_case.pitch_price, v_case.pitch_share, v_case.pays, v_case.label);
  end loop;

  assert (select price_cents from public.venue_free_slots(v_venue, v_saturday, '5-a-side', 60) where start_time = '20:00') = 5000,
    'free slots show the one pitch price';
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
  v_case record;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000, p_peak => 6000, p_weekend => 7000);

  perform tests.act_as(v_player);
  for v_case in
    select * from (values
      -- Spec example, crossing into peak: 2500 + 3000 = 5500; 550 + 80 = 630 each.
      (v_monday,   '16:30'::time, '17:30'::time, 5500,  550,  630,  'spec example: 16:30-17:30 crosses into peak'),
      (v_monday,   '16:00',       '18:00',       11000, 1100, 1180, '16:00-18:00 = 5000 + 6000'),
      (v_monday,   '10:00',       '11:00',       5000,  500,  580,  'off-peak is the one price'),
      (v_friday,   '17:00',       '18:00',       6000,  600,  680,  'Friday evening is peak'),
      (v_saturday, '10:00',       '11:00',       7000,  700,  780,  'Saturday is the weekend price'),
      (v_saturday, '18:00',       '19:00',       7000,  700,  780,  'the weekend has no peak')
    ) as c (day, start_at, end_at, pitch_price, pitch_share, pays, label)
  loop
    perform tests.check_player_price(v_venue, v_case.day, v_case.start_at, v_case.end_at, '5-a-side', 5,
                                     v_case.pitch_price, v_case.pitch_share, v_case.pays, v_case.label);
  end loop;
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
  perform tests.check_player_price(v_peak_only, v_monday, '18:00', '19:00', '5-a-side', 5, 6000, 600, 680, 'peak-only: weekday evening is peak');
  perform tests.check_player_price(v_peak_only, v_saturday, '18:00', '19:00', '5-a-side', 5, 5000, 500, 580, 'peak-only: Saturday is the one price');
  perform tests.check_player_price(v_weekend_only, v_saturday, '18:00', '19:00', '5-a-side', 5, 7000, 700, 780, 'weekend-only: Saturday is weekend');
  perform tests.check_player_price(v_weekend_only, v_monday, '18:00', '19:00', '5-a-side', 5, 5000, 500, 580, 'weekend-only: weekday evening is the one price');
end $$;

select 'venue model 12 (one price by default, optional peak and weekend) passed' as result;

rollback;
