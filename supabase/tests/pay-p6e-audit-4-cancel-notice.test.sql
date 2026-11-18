-- P6e audit fix 4: staff are told a booking was cancelled only if they were
-- told about it first (a venue_new_booking log row exists for them). A
-- booking confirmed and cancelled between two runs tells them nothing.
begin;

do $$
declare
  v_owner uuid := tests.create_user('audit-cn-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2, p_open => '07:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 3;
  v_quick public.venue_bookings;
  v_told public.venue_bookings;
  v_quick_booker uuid := tests.create_user('audit-cn-quick@futty.test');
  v_told_booker uuid := tests.create_user('audit-cn-told@futty.test');
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);

  -- Confirmed, then cancelled before the next run: neither notice.
  v_quick := tests.booking_with_players(v_quick_booker, v_venue, 'each_pays_own_spot', 0, v_day, '18:00', '19:00', 'audit-cn-q');
  perform tests.pay_ago((tests.player(v_quick.id, 0)).id, 'pi_audit_cn_q');
  assert (select status from public.venue_bookings where id = v_quick.id) = 'confirmed', 'confirmed';
  perform tests.cancel(v_quick.id, 'whole_team', v_quick_booker);
  perform public.venue_notifications_tick(tests.kickoff_of(v_quick.id) - interval '1 day');
  assert (select count(*) from public.notifications where profile_id = v_owner
          and data ->> 'bookingId' = v_quick.id::text
          and type in ('venue_new_booking', 'venue_booking_cancelled')) = 0,
    'confirmed and cancelled within one run: staff hear nothing';

  -- Confirmed and told, then cancelled: the cancellation is sent, once.
  v_told := tests.booking_with_players(v_told_booker, v_venue, 'each_pays_own_spot', 0, v_day, '20:00', '21:00', 'audit-cn-t');
  perform tests.pay_ago((tests.player(v_told.id, 0)).id, 'pi_audit_cn_t');
  perform public.venue_notifications_tick(tests.kickoff_of(v_told.id) - interval '1 day');
  assert (select count(*) from public.notifications where profile_id = v_owner and type = 'venue_new_booking'
          and data ->> 'bookingId' = v_told.id::text) = 1, 'told about the booking';
  perform tests.cancel(v_told.id, 'whole_team', v_told_booker);
  perform public.venue_notifications_tick(tests.kickoff_of(v_told.id) - interval '1 day');
  perform public.venue_notifications_tick(tests.kickoff_of(v_told.id) - interval '1 day');
  assert (select count(*) from public.notifications where profile_id = v_owner and type = 'venue_booking_cancelled'
          and data ->> 'bookingId' = v_told.id::text) = 1, 'then told it was cancelled, once';
end $$;

rollback;
