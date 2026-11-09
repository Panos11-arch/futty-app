-- Peak and weekend hours are per venue, stored with its price rules
-- (docs/specs/13-payments-bookings.md, "Prices and fees", decided 9
-- November). Until a venue's data says otherwise: peak Monday to Friday
-- from 17:00 until closing, weekend Saturday and Sunday all day, off-peak
-- otherwise.
begin;

do $$
declare
  v_player uuid := tests.create_user('hours-rules-player@futty.test');
  -- Both open 08:00 to midnight. EUR 60 peak, EUR 50 off-peak, EUR 70 weekend.
  v_default uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_custom uuid := tests.create_venue(p_pitches => 1, p_open => '08:00', p_close => '24:00');
  v_monday date := tests.next_weekday(1);
  v_thursday date := tests.next_weekday(4);
  v_friday date := tests.next_weekday(5);
  v_saturday date := tests.next_weekday(6);
  v_rule public.price_rules;
  v_booking public.venue_bookings;
  v_error text;
begin
  perform tests.set_price(v_default, '5-a-side', 6000, 5000, 7000);
  perform tests.set_price(v_custom, '5-a-side', 6000, 5000, 7000);

  -- The hours are on the price rule, with the agreed defaults.
  select * into v_rule from public.price_rules where venue_id = v_default and format = '5-a-side';
  assert v_rule.peak_weekdays = array[1, 2, 3, 4, 5]::smallint[], format('default peak days: %s', v_rule.peak_weekdays);
  assert v_rule.peak_starts = '17:00', format('default peak start: %s', v_rule.peak_starts);
  assert v_rule.peak_ends is null, 'default peak runs until closing';
  assert v_rule.weekend_weekdays = array[6, 7]::smallint[], format('default weekend days: %s', v_rule.weekend_weekdays);

  -- They no longer live on venues.
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'venues' and column_name in ('peak_starts', 'peak_ends')
  ), 'peak hours belong to price_rules, not venues';

  -- The defaults, for a venue whose data says nothing else.
  perform tests.act_as(v_player);
  assert public.slot_price_cents(v_default, v_friday, '18:00', '19:00', '5-a-side') = 6000, 'Friday 18:00 is peak';
  assert public.slot_price_cents(v_default, v_friday, '23:00', '24:00', '5-a-side') = 6000, 'peak runs until closing';
  assert public.slot_price_cents(v_default, v_friday, '10:00', '11:00', '5-a-side') = 5000, 'Friday 10:00 is off-peak';
  assert public.slot_price_cents(v_default, v_monday, '16:00', '17:00', '5-a-side') = 5000, 'Monday 16:00 is off-peak';
  assert public.slot_price_cents(v_default, v_saturday, '10:00', '11:00', '5-a-side') = 7000, 'Saturday is weekend all day';

  -- A venue with its own hours: weekend Friday to Sunday, peak Monday to
  -- Thursday 18:00-22:00.
  perform tests.act_as_postgres();
  update public.price_rules
  set weekend_weekdays = array[5, 6, 7], peak_weekdays = array[1, 2, 3, 4], peak_starts = '18:00', peak_ends = '22:00'
  where venue_id = v_custom;

  perform tests.act_as(v_player);
  assert public.slot_price_cents(v_custom, v_friday, '10:00', '11:00', '5-a-side') = 7000, 'Friday is weekend at this venue';
  assert public.slot_price_cents(v_custom, v_thursday, '17:00', '18:00', '5-a-side') = 5000, 'Thursday 17:00 is off-peak here';
  assert public.slot_price_cents(v_custom, v_thursday, '18:00', '19:00', '5-a-side') = 6000, 'Thursday 18:00 is peak here';
  assert public.slot_price_cents(v_custom, v_thursday, '22:00', '23:00', '5-a-side') = 5000, 'peak ends at 22:00 here';
  -- ...and the other venue keeps the defaults.
  assert public.slot_price_cents(v_default, v_friday, '10:00', '11:00', '5-a-side') = 5000, 'the other venue is unchanged';

  -- book_slot and the free slots charge the venue's own bands.
  v_booking := public.book_slot(v_custom, v_friday, '18:00', '19:00', 1, '5-a-side', 5);
  assert v_booking.amount_cents = 7000, format('Friday at the custom venue is weekend: got %s', v_booking.amount_cents);
  assert (select price_cents from public.venue_free_slots(v_custom, v_thursday, '5-a-side', 60) where start_time = '19:00') = 6000,
    'free slot at Thursday 19:00 is peak here';

  -- A weekday in neither list is off-peak all day.
  perform tests.act_as_postgres();
  update public.price_rules set peak_weekdays = array[1, 2, 3], weekend_weekdays = array[6, 7] where venue_id = v_custom;
  perform tests.act_as(v_player);
  assert public.slot_price_cents(v_custom, v_thursday, '19:00', '20:00', '5-a-side') = 5000, 'Thursday is off-peak all day now';

  -- A day can't be both peak and weekend, and weekdays are 1 to 7.
  perform tests.act_as_postgres();
  v_error := tests.error_of(format(
    'update public.price_rules set peak_weekdays = array[1, 6] where venue_id = %L', v_custom));
  assert v_error is not null, 'a day that is both peak and weekend must be refused';
  v_error := tests.error_of(format(
    'update public.price_rules set weekend_weekdays = array[8] where venue_id = %L', v_custom));
  assert v_error is not null, 'weekday 8 must be refused';
  v_error := tests.error_of(format(
    'update public.price_rules set peak_starts = ''20:00'', peak_ends = ''19:00'' where venue_id = %L', v_custom));
  assert v_error is not null, 'a peak window that ends before it starts must be refused';
end $$;

select 'venue model 10 (peak and weekend hours per venue) passed' as result;

rollback;
