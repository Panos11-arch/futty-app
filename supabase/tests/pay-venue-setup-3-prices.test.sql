-- Venue setup: prices (docs/specs/13-payments-bookings.md "Prices and fees"
-- and "Venue setup", decided 17 November, Dimitris; for Panos to confirm).
-- Staff set each format's one price, and optional peak and weekend prices
-- and hours. A new price applies to new bookings and quotes only: a game
-- already booked, and every player who joins it later, keeps its price.
-- The worked examples of "Prices and fees" with their exact amounts.
begin;

do $$
declare
  v_owner uuid := tests.create_user('prices-owner@futty.test');
  v_other_owner uuid := tests.create_user('prices-other-owner@futty.test');
  v_booker uuid := tests.create_user('prices-booker@futty.test');
  v_joiner uuid := tests.create_user('prices-joiner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2, p_open => '08:00', p_close => '23:00');
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_tue date := tests.next_weekday(2);
  v_wed date := tests.next_weekday(3);
  v_sat date := tests.next_weekday(6);
  v_booking public.venue_bookings;
  v_rule public.price_rules;
  v_setup jsonb;
begin
  -- One price, €50 an hour: €50 at any hour, any day; €5.00 + €0.80 = €5.80 each.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000, null, null, null, null, null, null);
  perform tests.act_as(v_booker);
  perform tests.check_player_price(v_venue, v_wed, '20:00', '21:00', '5-a-side', 5, 5000, 500, 580, 'one price, weekday evening');
  perform tests.check_player_price(v_venue, v_sat, '10:00', '11:00', '5-a-side', 5, 5000, 500, 580, 'one price, Saturday');
  perform tests.act_as_postgres();

  -- Crossing into peak: a €60 peak price, 16:30-17:30 on a weekday is
  -- €25 + €30 = €55; €5.50 + €0.80 = €6.30 each. Default peak hours.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000, 6000, null, null, null, null, null);
  perform tests.act_as(v_booker);
  perform tests.check_player_price(v_venue, v_tue, '16:30', '17:30', '5-a-side', 5, 5500, 550, 630, 'crossing into peak');
  perform tests.check_player_price(v_venue, v_sat, '18:00', '19:00', '5-a-side', 5, 5000, 500, 580,
    'no weekend price: Saturday is the one price');
  perform tests.act_as_postgres();
  select * into v_rule from public.price_rules where venue_id = v_venue and format = '5-a-side';
  assert v_rule.peak_weekdays = array[1, 2, 3, 4, 5]::smallint[], 'default peak days Monday to Friday';
  assert v_rule.peak_starts = '17:00' and v_rule.peak_ends is null, 'default peak from 17:00 to closing';
  assert v_rule.weekend_weekdays = array[6, 7]::smallint[], 'default weekend Saturday and Sunday';

  -- A weekend price applies all day Saturday.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000, 6000, 7000, null, null, null, null);
  perform tests.act_as(v_booker);
  perform tests.check_player_price(v_venue, v_sat, '10:00', '11:00', '5-a-side', 5, 7000, 700, 780, 'weekend morning');
  perform tests.act_as_postgres();

  -- The venue's own peak hours: weekdays from 18:00 to 21:00.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000, 6000, null, array[1, 2, 3, 4, 5]::smallint[], '18:00', '21:00',
                                array[6, 7]::smallint[]);
  perform tests.act_as(v_booker);
  perform tests.check_player_price(v_venue, v_tue, '17:00', '18:00', '5-a-side', 5, 5000, 500, 580, 'before the venue''s peak');
  perform tests.check_player_price(v_venue, v_tue, '20:30', '21:30', '5-a-side', 5, 5500, 550, 630, 'leaving the venue''s peak');
  perform tests.act_as_postgres();

  -- A game already booked keeps its price, and so does a player who joins
  -- after the change: €60 booked, then the price drops to €50.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 6000, null, null, null, null, null, null);
  perform tests.act_as_postgres();
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_wed, '12:00', '13:00', 'prices');
  assert v_booking.amount_cents = 6000, 'booked at €60';
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000, null, null, null, null, null, null);
  perform tests.act_as_postgres();
  assert (select amount_cents from public.venue_bookings where id = v_booking.id) = 6000, 'the booking keeps €60';
  perform public.add_booking_share_internal(v_booking.id, v_joiner);
  perform tests.assert_share(v_booking.id, v_joiner, 600, 680, 'a player joining after the change');
  perform tests.act_as(v_booker);
  perform tests.check_player_price(v_venue, v_wed, '14:00', '15:00', '5-a-side', 5, 5000, 500, 580, 'a new booking pays €50');
  perform tests.act_as_postgres();

  -- venue_setup shows the rule.
  perform tests.act_as(v_owner);
  v_setup := public.venue_setup(v_venue);
  perform tests.act_as_postgres();
  assert exists (select 1 from jsonb_array_elements(v_setup -> 'prices') p
                 where p ->> 'format' = '5-a-side' and (p ->> 'price_cents')::integer = 5000), 'venue_setup shows the price';

  -- Removing a format's price: it can't be booked any more.
  perform tests.act_as(v_owner);
  perform public.remove_price_rule(v_venue, '7-a-side');
  perform tests.act_as_postgres();
  assert tests.error_as(v_booker, format(
    $q$select public.book_slot(%L, %L, '10:00', '11:00', 1, '7-a-side', 5, 'each_pays_own_spot')$q$, v_venue, v_wed))
    = 'price_not_set', 'no price, no booking';
  assert tests.error_as(v_owner, format($q$select public.remove_price_rule(%L, '7-a-side')$q$, v_venue))
    = 'price_rule_not_found', 'already removed';

  -- Bad prices and hours are refused and change nothing.
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', -1, null, null, null, null, null, null)$q$, v_venue))
    = 'invalid_price', 'a negative price';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', null, null, null, null, null, null, null)$q$, v_venue))
    = 'invalid_price', 'no one price';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 5000, -5, null, null, null, null, null)$q$, v_venue))
    = 'invalid_price', 'a negative peak price';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 5000, null, -5, null, null, null, null)$q$, v_venue))
    = 'invalid_price', 'a negative weekend price';
  -- A price is more than €0 (decided 17 November): a €0 price would make
  -- free games by mistake.
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 0, null, null, null, null, null, null)$q$, v_venue))
    = 'invalid_price', 'a €0 price';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 5000, 0, null, null, null, null, null)$q$, v_venue))
    = 'invalid_price', 'a €0 peak price';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 5000, null, 0, null, null, null, null)$q$, v_venue))
    = 'invalid_price', 'a €0 weekend price';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, 'futsal', 5000, null, null, null, null, null, null)$q$, v_venue))
    = 'invalid_format', 'not a format';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 5000, 6000, 7000, '{5,6}', null, null, '{6,7}')$q$, v_venue))
    = 'invalid_peak_hours', 'Saturday both peak and weekend';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 5000, 6000, null, null, '17:00', '16:00', null)$q$, v_venue))
    = 'invalid_peak_hours', 'peak ends before it starts';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 5000, 6000, null, '{0,8}', null, null, null)$q$, v_venue))
    = 'invalid_peak_hours', 'not a weekday';
  assert (select price_cents from public.price_rules where venue_id = v_venue and format = '5-a-side') = 5000,
    'refusals change nothing';

  -- Only the venue's own staff.
  assert tests.error_as(v_other_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 1, null, null, null, null, null, null)$q$, v_venue))
    = 'not_venue_staff', 'another venue''s staff can''t set a price';
  assert tests.error_as(v_other_owner, format($q$select public.remove_price_rule(%L, '5-a-side')$q$, v_venue))
    = 'not_venue_staff', 'another venue''s staff can''t remove a price';
  assert tests.error_as(v_booker, format(
    $q$select public.set_price_rule(%L, '5-a-side', 1, null, null, null, null, null, null)$q$, v_venue))
    = 'not_venue_staff', 'a player can''t set a price';
  assert (select price_cents from public.price_rules where venue_id = v_venue and format = '5-a-side') = 5000,
    'still €50';
  assert (select price_cents from public.price_rules where venue_id = v_other_venue and format = '5-a-side') = 6000,
    'the other venue is untouched';
end;
$$;

rollback;
