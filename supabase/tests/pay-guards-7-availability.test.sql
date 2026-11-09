-- P2 rule 7: other users see availability only, not who booked, their team
-- or the amounts.
begin;

do $$
declare
  v_booker uuid := tests.create_user('avail-booker@futty.test');
  v_stranger uuid := tests.create_user('avail-stranger@futty.test');
  v_owner uuid := tests.create_user('avail-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_price => 60);
  v_day date := tests.cyprus_today() + 1;
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_count integer;
  v_price integer;
begin
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5);
  v_post := public.create_squad_post(
    v_venue, (v_day + time '12:00') at time zone 'Asia/Nicosia', '5-a-side', 'players',
    p_players_needed => 3, p_venue_booking_id => v_booking.id);

  select count(*) into v_count from public.venue_bookings where id = v_booking.id;
  assert v_count = 1, 'the booker sees their own booking';

  -- A stranger can't read the booking row...
  perform tests.act_as(v_stranger);
  select count(*) into v_count from public.venue_bookings where id = v_booking.id;
  assert v_count = 0, 'a stranger must not read someone else''s booking';

  -- ...but sees the slot as taken...
  select count(*) into v_count
  from public.venue_day_availability(v_venue, v_day)
  where start_time = '12:00' and end_time = '13:00' and pitches = 1;
  assert v_count = 1, 'availability should show the taken slot';

  -- ...and the price of joining the post, without the booking's total.
  select share_cents, fee_cents into v_price, v_count from public.squad_post_price(v_post.id);
  assert v_price = 680, format('joining should cost 680 cents, got %s', v_price);
  assert v_count = 80, format('of which the service fee is 80 cents, got %s', v_count);

  -- The venue's owner still sees bookings at their venue.
  perform tests.act_as(v_owner);
  select count(*) into v_count from public.venue_bookings where id = v_booking.id;
  assert v_count = 1, 'the venue owner sees bookings at their venue';
end $$;

select 'pay-guards rule 7 (availability only) passed' as result;

rollback;
