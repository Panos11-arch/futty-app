-- P2 rule 1: book_slot only accepts a sensible slot.
begin;

do $$
declare
  v_user uuid := tests.create_user('slot-test@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2, p_open => '08:00', p_close => '23:00');
  v_midnight uuid := tests.create_venue(p_open => '18:00', p_close => '00:00');
  v_day date := tests.cyprus_today() + 1;
  v_case record;
  v_error text;
  v_booking public.venue_bookings;
begin
  perform tests.act_as(v_user);

  for v_case in
    select * from (values
      (0, '12:00', '13:00', '5-a-side', 'invalid_pitches', 'zero pitches'),
      (3, '12:00', '13:00', '5-a-side', 'invalid_pitches', 'more pitches than the venue has'),
      (1, '13:00', '12:00', '5-a-side', 'invalid_time_range', 'end before start'),
      (1, '12:00', '12:00', '5-a-side', 'invalid_time_range', 'end equal to start'),
      (1, '12:15', '13:15', '5-a-side', 'slot_not_on_grid', 'start off the 30-minute grid'),
      (1, '12:00', '12:45', '5-a-side', 'slot_not_on_grid', 'end off the 30-minute grid'),
      (1, '07:00', '08:00', '5-a-side', 'outside_opening_hours', 'before opening'),
      (1, '22:30', '23:30', '5-a-side', 'outside_opening_hours', 'after closing'),
      (1, '12:00', '13:00', '6-a-side', 'invalid_format', 'unknown format'),
      (1, '12:00', '13:00', 'futsal', 'invalid_format', 'unknown format')
    ) as c (pitches, start_at, end_at, format, expected, label)
  loop
    v_error := tests.error_of(format(
      'select public.book_slot(%L::uuid, %L::date, %L::time, %L::time, %s, %L, 5, ''each_pays_own_spot'')',
      v_venue, v_day, v_case.start_at, v_case.end_at, v_case.pitches, v_case.format));
    assert v_error = v_case.expected,
      format('%s: expected %s, got %s', v_case.label, v_case.expected, coalesce(v_error, 'success'));
  end loop;

  -- A sensible slot is accepted: both pitches, inside hours, on the grid.
  v_booking := public.book_slot(v_venue, v_day, '12:00', '13:30', 2, '7-a-side', 5, 'each_pays_own_spot');
  assert v_booking.pitches = 2 and v_booking.format = '7-a-side', 'a valid slot should be booked';

  -- A venue that closes at midnight takes a 23:00-24:00 slot.
  v_booking := public.book_slot(v_midnight, v_day, '23:00', '24:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  assert v_booking.end_time = '24:00', 'a slot ending at midnight should be allowed when the venue closes at midnight';
end $$;

select 'pay-guards rule 1 (sensible slot) passed' as result;

rollback;
