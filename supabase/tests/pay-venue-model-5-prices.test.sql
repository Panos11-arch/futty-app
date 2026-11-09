-- P3: price rules per format pick the right price: peak on weekdays inside
-- the venue's peak window (Monday to Friday 17:00 to closing by default),
-- off-peak on weekdays outside it, weekend all day Saturday and Sunday. A
-- game that crosses into peak pays each half hour at its own band. Prices
-- come from the server only.
--
-- Every case checks the pitch price, the booker's pitch share (price / 10)
-- and what they pay (pitch share + the 80 service fee).
begin;

do $$
declare
  v_player uuid := tests.create_user('prices-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_weekday date := (select min(d) from generate_series(1, 5) as dow, tests.next_weekday(dow) as d);
  v_saturday date := tests.next_weekday(6);
  v_sunday date := tests.next_weekday(7);
  v_case record;
begin
  -- 5-a-side: EUR 50 (off-peak), with a peak price of EUR 60 and a weekend
  -- price of EUR 70.
  perform tests.set_price(v_venue, '5-a-side', 5000, p_peak => 6000, p_weekend => 7000);

  perform tests.act_as(v_player);
  for v_case in
    select * from (values
      -- day,        start,         end,           pitch, pitch share, pays
      (v_weekday,  '18:00'::time, '19:00'::time, 6000,  600,         680, 'weekday evening is peak'),
      (v_weekday,  '17:00',       '18:00',       6000,  600,         680, 'peak starts at 17:00'),
      (v_weekday,  '23:00',       '24:00',       6000,  600,         680, 'peak runs to closing'),
      (v_weekday,  '10:00',       '11:00',       5000,  500,         580, 'weekday morning is off-peak'),
      (v_weekday,  '16:00',       '17:00',       5000,  500,         580, 'the hour before peak is off-peak'),
      (v_weekday,  '16:30',       '17:30',       5500,  550,         630, 'half off-peak, half peak'),
      (v_weekday,  '12:00',       '13:30',       7500,  750,         830, '90 minutes off-peak'),
      (v_saturday, '10:00',       '11:00',       7000,  700,         780, 'Saturday morning is weekend'),
      (v_saturday, '18:00',       '19:00',       7000,  700,         780, 'Saturday evening is weekend, not peak'),
      (v_sunday,   '18:00',       '19:00',       7000,  700,         780, 'Sunday is weekend')
    ) as c (day, start_at, end_at, pitch_price, pitch_share, pays, label)
  loop
    perform tests.check_player_price(v_venue, v_case.day, v_case.start_at, v_case.end_at, '5-a-side', 5,
                                     v_case.pitch_price, v_case.pitch_share, v_case.pays, v_case.label);
  end loop;

  -- A venue-specific peak window: 18:00-22:00 only, on its price rule.
  perform tests.act_as_postgres();
  update public.price_rules set peak_starts = '18:00', peak_ends = '22:00' where venue_id = v_venue;
  perform tests.act_as(v_player);
  perform tests.check_player_price(v_venue, v_weekday, '17:00', '18:00', '5-a-side', 5, 5000, 500, 580, '17:00 is off-peak with an 18:00 peak start');
  perform tests.check_player_price(v_venue, v_weekday, '21:00', '22:00', '5-a-side', 5, 6000, 600, 680, '21:00 is still peak');
  perform tests.check_player_price(v_venue, v_weekday, '22:00', '23:00', '5-a-side', 5, 5000, 500, 580, '22:00 is off-peak again');

  -- The venue's free slots carry the same pitch price.
  assert (select price_cents from public.venue_free_slots(v_venue, v_weekday, '5-a-side', 60) where start_time = '20:00') = 6000,
    'free slot at 20:00: pitch price 6000';
  perform tests.check_player_price(v_venue, v_weekday, '20:00', '21:00', '5-a-side', 5, 6000, 600, 680, 'booking the 20:00 free slot');
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
    'select public.book_slot(%L::uuid, %L::date, ''12:00'', ''13:00'', 1, ''5-a-side'', 5, ''each_pays_own_spot'')', v_venue, tests.cyprus_today() + 1));
  assert v_error = 'price_not_set', format('no price rule: got %s', coalesce(v_error, 'success'));
end $$;

select 'venue model 5 (price rules) passed' as result;

rollback;
