-- One customer's page (docs/specs/13-payments-bookings.md "Venue dashboard",
-- Customers): for each booking, whether the venue has received the cash
-- part (cash_received: true once ticked, false until then, null for a card
-- player or a game without a share), and for each credit whether it has
-- expired (expired), so the app never decides either from the phone's clock.
begin;

do $$
declare
  v_owner uuid := tests.create_user('cust-cash-owner@futty.test');
  v_booker uuid := tests.create_user('cust-cash-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_ticked public.booking_payment_shares;
  v_unticked public.booking_payment_shares;
  v_card public.booking_payment_shares;
  v_live uuid;
  v_spent uuid;
  v_old uuid;
  v_entry jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'cust-cash');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_custcash_' || i, interval '2 hours',
                          case when i in (1, 2) then 'cash' else 'card' end);
  end loop;
  v_ticked := tests.player(v_booking.id, 1);
  v_unticked := tests.player(v_booking.id, 2);
  v_card := tests.player(v_booking.id, 3);

  v_live := tests.give_credit(v_ticked.profile_id, v_venue, 580);
  v_spent := tests.give_credit(v_ticked.profile_id, v_venue, 100);
  update public.venue_credits set remaining_cents = 0 where id = v_spent;
  v_old := tests.give_credit(v_ticked.profile_id, v_venue, 300, interval '13 months');

  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_ticked.id);

  v_entry := public.venue_customer(v_venue, 'player', v_ticked.profile_id);
  assert v_entry -> 'bookings' -> 0 @> '{"payment_method": "cash", "cash_cents": 600, "cash_received": true}',
    format('ticked cash: received, got %s', v_entry -> 'bookings');
  assert (select c from jsonb_array_elements(v_entry -> 'credits') c where c ->> 'credit_id' = v_live::text)
         @> '{"expired": false, "available": true}', format('live credit, got %s', v_entry -> 'credits');
  assert (select c from jsonb_array_elements(v_entry -> 'credits') c where c ->> 'credit_id' = v_spent::text)
         @> '{"expired": false, "available": false, "remaining_cents": 0}',
    format('spent, not expired, got %s', v_entry -> 'credits');
  assert (select c from jsonb_array_elements(v_entry -> 'credits') c where c ->> 'credit_id' = v_old::text)
         @> '{"expired": true, "available": false}', format('expired credit, got %s', v_entry -> 'credits');

  v_entry := public.venue_customer(v_venue, 'player', v_unticked.profile_id);
  assert v_entry -> 'bookings' -> 0 @> '{"payment_method": "cash", "cash_received": false}',
    format('cash not ticked: not received, got %s', v_entry -> 'bookings');

  v_entry := public.venue_customer(v_venue, 'player', v_card.profile_id);
  assert v_entry -> 'bookings' -> 0 @> '{"payment_method": "card", "cash_received": null}',
    format('card player: no cash state, got %s', v_entry -> 'bookings');
end $$;

rollback;
