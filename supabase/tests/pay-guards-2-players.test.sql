-- P2 rule 2: player numbers come from the server, not the app.
begin;

-- Run as postgres: switch the 6 v 6 flag on for one venue.
create temporary table ids as
select tests.create_user('players-test@futty.test') as booker,
       -- 4 pitches, so 9s and 11s (3 and 4 pitches combined) fit too.
       tests.create_venue(p_price => 60, p_pitches => 4) as plain_venue,
       tests.create_venue(p_price => 60) as six_venue;
update public.venues set allows_6v6_on_5s = true where id = (select six_venue from ids);
grant select on ids to authenticated;

do $$
declare
  v ids;
  v_day date := tests.cyprus_today() + 1;
  v_booking public.venue_bookings;
  v_share integer;
  v_error text;
  v_case record;
begin
  select * into v from ids;
  perform tests.act_as(v.booker);

  -- Capacity 100 is impossible. Old app builds still send p_capacity; since
  -- P4a they send no booking mode either, so they're refused outright
  -- (mode_required, decided 9 November) and the capacity is never used.
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''10:00'', ''11:00'', 1, 100, ''5-a-side'')', v.plain_venue, v_day));
  assert v_error = 'mode_required', format('old signature: got %s', coalesce(v_error, 'success'));

  -- The current signature: 10 players, whatever the app thinks.
  v_booking := public.book_slot(v.plain_venue, v_day, '10:00', '11:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  assert v_booking.capacity = 10, format('5 v 5 should be 10 players, got %s', v_booking.capacity);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 680, format('EUR 60 / 10 players + 80 fee = 680 cents, got %s', v_share);
  perform tests.assert_share(v_booking.id, v.booker, 600, 680, '6000 / 10 = 600, + 80');

  -- The new signature has no capacity at all; players per side is 5 or 6.
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''11:00'', ''12:00'', 1, ''5-a-side'', 50, ''each_pays_own_spot'')', v.plain_venue, v_day));
  assert v_error = 'invalid_players_per_side', format('50 per side: got %s', coalesce(v_error, 'success'));

  -- Each format's player count.
  for v_case in select * from (values ('5-a-side', 10), ('7-a-side', 14), ('9-a-side', 18), ('11-a-side', 22)) as c (format, players)
  loop
    v_booking := public.book_slot(v.plain_venue, v_day, '14:00', '15:00', 1, v_case.format, 5, 'each_pays_own_spot');
    assert v_booking.capacity = v_case.players,
      format('%s should hold %s players, got %s', v_case.format, v_case.players, v_booking.capacity);
    perform tests.act_as_postgres();
    update public.venue_bookings set status = 'cancelled' where id = v_booking.id;
    perform tests.act_as(v.booker);
  end loop;

  -- 6 v 6 is refused at a venue without the flag...
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''16:00'', ''17:00'', 1, ''5-a-side'', 6, ''each_pays_own_spot'')', v.plain_venue, v_day));
  assert v_error = 'six_a_side_not_allowed', format('6 v 6 without the flag: got %s', coalesce(v_error, 'success'));

  -- ...and on anything but a 5-a-side pitch, even where it's allowed...
  v_error := tests.error_of(format(
    'select public.book_slot(%L::uuid, %L::date, ''16:00'', ''17:00'', 1, ''7-a-side'', 6, ''each_pays_own_spot'')', v.six_venue, v_day));
  assert v_error = 'six_a_side_not_allowed', format('6 v 6 on a 7-a-side: got %s', coalesce(v_error, 'success'));

  -- ...and accepted with it: EUR 60 -> 12 players -> 500 + 80 = 580 cents each.
  v_booking := public.book_slot(v.six_venue, v_day, '16:00', '17:00', 1, '5-a-side', 6, 'each_pays_own_spot');
  assert v_booking.capacity = 12, format('6 v 6 should hold 12 players, got %s', v_booking.capacity);
  select amount_cents into v_share from public.booking_payment_shares where booking_id = v_booking.id and is_booker;
  assert v_share = 580, format('EUR 60 / 12 players + 80 fee = 580 cents, got %s', v_share);
  perform tests.assert_share(v_booking.id, v.booker, 500, 580, '6 v 6: 6000 / 12 = 500, + 80');
end $$;

select 'pay-guards rule 2 (player numbers) passed' as result;

rollback;
