-- P3: price rules per format. A venue has one price per format, the same on
-- every day and at every hour (spec 13 "Pitch prices", 19 November). Prices
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
begin
  -- 5-a-side: EUR 60.
  perform tests.set_price(v_venue, '5-a-side', 6000);

  perform tests.act_as(v_player);
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
