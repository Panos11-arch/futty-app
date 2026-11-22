-- Pitch prices (docs/specs/13-payments-bookings.md, "Pitch prices", decided
-- 19 November): a venue has one price per format, the same on every day and
-- at every hour. The spec's worked example, exact amount.
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

  perform tests.act_as(v_player);
  for v_case in
    select * from (values
      -- day,        start,         end,           pitch, pitch share, pays
      (v_monday,   '10:00'::time, '11:00'::time, 5000,  500,         580, 'weekday morning'),
      (v_monday,   '18:00',       '19:00',       5000,  500,         580, 'weekday evening'),
      (v_monday,   '16:30',       '17:30',       5000,  500,         580, 'across 17:00'),
      (v_saturday, '18:00',       '19:00',       5000,  500,         580, 'Saturday evening'),
      (v_monday,   '18:00',       '19:30',       7500,  750,         830, '90 minutes at the one price')
    ) as c (day, start_at, end_at, pitch_price, pitch_share, pays, label)
  loop
    perform tests.check_player_price(v_venue, v_case.day, v_case.start_at, v_case.end_at, '5-a-side', 5,
                                     v_case.pitch_price, v_case.pitch_share, v_case.pays, v_case.label);
  end loop;

  assert (select price_cents from public.venue_free_slots(v_venue, v_saturday, '5-a-side', 60) where start_time = '20:00') = 5000,
    'free slots show the one pitch price';
end $$;

select 'venue model 12 (one price) passed' as result;

rollback;
