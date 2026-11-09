-- P2 rule 3: standard accounts book up to 7 days ahead, Premium up to 14
-- (Cyprus dates, day 0 = today). Premium comes only from profiles.is_premium.
begin;

do $$
declare
  v_standard uuid := tests.create_user('window-standard@futty.test');
  v_premium uuid := tests.create_user('window-premium@futty.test');
  v_venue uuid := tests.create_venue(p_open => '00:00', p_close => '00:00');
  v_today date := tests.cyprus_today();
  v_now timestamp := now() at time zone 'Asia/Nicosia';
  v_error text;
begin
  update public.profiles set is_premium = true where id = v_premium;

  perform tests.act_as(v_standard);
  perform public.book_slot(v_venue, v_today + 7, '12:00', '13:00', 1, '5-a-side', 5);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:00'', ''13:00'', 1, ''5-a-side'', 5)', v_venue, v_today + 8));
  assert v_error = 'beyond_booking_window', format('standard, day 8: got %s', coalesce(v_error, 'success'));

  -- The app can't make itself Premium.
  v_error := tests.error_of(format('update public.profiles set is_premium = true where id = %L', v_standard));
  assert v_error like 'permission denied%', format('setting is_premium from the app: got %s', coalesce(v_error, 'success'));

  perform tests.act_as(v_premium);
  perform public.book_slot(v_venue, v_today + 14, '12:00', '13:00', 1, '5-a-side', 5);
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''12:00'', ''13:00'', 1, ''5-a-side'', 5)', v_venue, v_today + 15));
  assert v_error = 'beyond_booking_window', format('Premium, day 15: got %s', coalesce(v_error, 'success'));

  -- A slot that started 1 minute ago (Cyprus time) is refused.
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, %L::time, %L::time, 1, ''5-a-side'', 5)',
    v_venue, (v_now - interval '1 minute')::date,
    date_trunc('minute', v_now - interval '1 minute')::time,
    date_trunc('minute', v_now - interval '1 minute')::time + interval '1 hour'));
  assert v_error = 'slot_in_past', format('a slot that started a minute ago: got %s', coalesce(v_error, 'success'));
end $$;

select 'pay-guards rule 3 (booking window) passed' as result;

rollback;
