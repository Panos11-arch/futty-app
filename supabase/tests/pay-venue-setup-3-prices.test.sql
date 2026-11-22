-- Venue setup: prices (docs/specs/13-payments-bookings.md "Prices and fees"
-- and "Venue setup", decided 17 November, Dimitris; for Panos to confirm).
-- Staff set each format's one price, the same on every day and at every
-- hour (19 November). A new price applies to new bookings and quotes only: a game
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
  v_wed date := tests.next_weekday(3);
  v_sat date := tests.next_weekday(6);
  v_booking public.venue_bookings;
  v_setup jsonb;
begin
  -- One price, €50 an hour: €50 at any hour, any day; €5.00 + €0.80 = €5.80 each.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000);
  perform tests.act_as(v_booker);
  perform tests.check_player_price(v_venue, v_wed, '20:00', '21:00', '5-a-side', 5, 5000, 500, 580, 'one price, weekday evening');
  perform tests.check_player_price(v_venue, v_sat, '10:00', '11:00', '5-a-side', 5, 5000, 500, 580, 'one price, Saturday');
  perform tests.act_as_postgres();

  -- A game already booked keeps its price, and so does a player who joins
  -- after the change: €60 booked, then the price drops to €50.
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 6000);
  perform tests.act_as_postgres();
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_wed, '12:00', '13:00', 'prices');
  assert v_booking.amount_cents = 6000, 'booked at €60';
  perform tests.act_as(v_owner);
  perform public.set_price_rule(v_venue, '5-a-side', 5000);
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

  -- Bad prices are refused and change nothing.
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', -1)$q$, v_venue))
    = 'invalid_price', 'a negative price';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', null)$q$, v_venue))
    = 'invalid_price', 'no one price';
  -- A price is more than €0 (decided 17 November): a €0 price would make
  -- free games by mistake.
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 0)$q$, v_venue))
    = 'invalid_price', 'a €0 price';
  assert tests.error_as(v_owner, format(
    $q$select public.set_price_rule(%L, 'futsal', 5000)$q$, v_venue))
    = 'invalid_format', 'not a format';
  assert (select price_cents from public.price_rules where venue_id = v_venue and format = '5-a-side') = 5000,
    'refusals change nothing';

  -- Only the venue's own staff.
  assert tests.error_as(v_other_owner, format(
    $q$select public.set_price_rule(%L, '5-a-side', 1)$q$, v_venue))
    = 'not_venue_staff', 'another venue''s staff can''t set a price';
  assert tests.error_as(v_other_owner, format($q$select public.remove_price_rule(%L, '5-a-side')$q$, v_venue))
    = 'not_venue_staff', 'another venue''s staff can''t remove a price';
  assert tests.error_as(v_booker, format(
    $q$select public.set_price_rule(%L, '5-a-side', 1)$q$, v_venue))
    = 'not_venue_staff', 'a player can''t set a price';
  assert (select price_cents from public.price_rules where venue_id = v_venue and format = '5-a-side') = 5000,
    'still €50';
  assert (select price_cents from public.price_rules where venue_id = v_other_venue and format = '5-a-side') = 6000,
    'the other venue is untouched';
end;
$$;

rollback;
