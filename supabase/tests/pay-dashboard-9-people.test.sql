-- The venue's bookings, customers, debt and credit (docs/specs/14 P6, added
-- 11 November; docs/specs/13-payments-bookings.md "Cash, debt and venue
-- credit", "Venue dashboard"). Only the venue's own staff.
--   bookings   app, walk-in and phone bookings in a date range, filtered by
--              source and status; never an owner's training block
--   customers  (decided 13 and 14 November, Dimitris; for Panos to confirm)
--              app players with a share, debt or credit at this venue, or
--              who booked a game here (a free game has no shares), shown by
--              name only (never email or phone), with their bookings, debt
--              and credit at this venue; walk-in and phone contacts with the
--              name and phone staff entered. A customer at venue A is never
--              listed at venue B. Booking counts are the bookings still
--              on: a player still in (or a free game's booker, while it
--              isn't cancelled), a walk-in or phone booking not cancelled.
--   debt       debts owed to the venue, open (and settled when asked)
--   credit     each player's credit still available at the venue
begin;

do $$
declare
  v_owner_a uuid := tests.create_user('people-owner-a@futty.test');
  v_owner_b uuid := tests.create_user('people-owner-b@futty.test');
  v_booker uuid := tests.create_user('people-booker@futty.test', '{"full_name": "Bea Booker"}');
  v_credit_only uuid := tests.create_user('people-credit@futty.test', '{"full_name": "Cal Credit"}');
  v_debt_only uuid := tests.create_user('people-debt@futty.test', '{"full_name": "Dee Debt"}');
  v_b_only uuid := tests.create_user('people-b-only@futty.test', '{"full_name": "Ben B-only"}');
  v_stranger uuid := tests.create_user('people-stranger@futty.test');
  v_free_booker uuid := tests.create_user('people-free@futty.test', '{"full_name": "Fay Free"}');
  v_left uuid := tests.create_user('people-left@futty.test', '{"full_name": "Leo Left"}');
  v_venue_a uuid := tests.create_venue(p_owner => v_owner_a, p_pitches => 3);
  v_venue_b uuid := tests.create_venue(p_owner => v_owner_b, p_pitches => 1);
  v_day date := tests.cyprus_today() + 2;
  v_booking public.venue_bookings;
  v_booking_b public.venue_bookings;
  v_joiner uuid;
  v_walk_in uuid;
  v_phone uuid;
  v_phone_again uuid;
  v_block uuid;
  v_free_game uuid;
  v_contact_a uuid;
  v_contact_b uuid;
  v_open_debt uuid;
  v_settled_debt uuid;
  v_futty_debt uuid;
  v_spent uuid;
  v_list jsonb;
  v_entry jsonb;
  v_ids text[];
begin
  perform tests.set_price(v_venue_a, '5-a-side', 6000);
  perform tests.set_price(v_venue_b, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue_a, 'each_pays_own_spot', 1, v_day, '12:00', '13:00', 'people');
  v_joiner := (tests.player(v_booking.id, 1)).profile_id;
  -- A player who left the game for a refund: still a customer, no booking on.
  perform tests.join_booking(v_booking.id, v_left);
  update public.booking_payment_shares set status = 'refunded' where booking_id = v_booking.id and profile_id = v_left;
  v_booking_b := tests.booking_with_players(v_b_only, v_venue_b, 'each_pays_own_spot', 0, v_day, '12:00', '13:00', 'people-b');

  perform tests.act_as(v_owner_a);
  v_walk_in := public.add_counter_booking(v_venue_a, v_day, '15:00', '16:00', '5-a-side', 'walk_in', 'Walter', null,
                                          null, 5000, 'cash');
  v_phone := public.add_counter_booking(v_venue_a, v_day, '16:00', '17:00', '5-a-side', 'phone', 'Phoebe', '99 111 222');
  v_phone_again := public.add_counter_booking(v_venue_a, v_day + 1, '16:00', '17:00', '5-a-side', 'phone', 'Phoebe P',
                                              '+357 99111222');
  perform public.cancel_counter_booking(v_phone_again);
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format,
                                     booking_type, created_by, amount_cents, note)
  values (v_venue_a, v_day, '08:00', '09:00', 1, 0, '5-a-side', 'owner_block', v_owner_a, 0, 'Academy')
  returning id into v_block;
  -- A free game (no price, so no shares): its booker is still a customer.
  perform tests.act_as_postgres();
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format,
                                     booking_type, created_by, amount_cents, status)
  values (v_venue_a, v_day + 1, '18:00', '19:00', 1, 10, '5-a-side', 'user_booking', v_free_booker, 0, 'confirmed')
  returning id into v_free_game;
  perform tests.act_as(v_owner_a);
  perform tests.act_as(v_owner_b);
  -- The same number at venue B is B's own customer.
  perform public.add_counter_booking(v_venue_b, v_day, '15:00', '16:00', '5-a-side', 'phone', 'Phoebe at B', '99111222');
  perform tests.act_as_postgres();
  select contact_id into v_contact_a from public.venue_counter_bookings where booking_id = v_phone;
  select id into v_contact_b from public.venue_contacts where venue_id = v_venue_b;

  -- Credit at A: available, expired and fully spent ones.
  perform tests.give_credit(v_credit_only, v_venue_a, 580);
  perform tests.give_credit(v_credit_only, v_venue_a, 300, interval '13 months');
  v_spent := tests.give_credit(v_booker, v_venue_a, 100);
  update public.venue_credits set remaining_cents = 0 where id = v_spent;
  perform tests.give_credit(v_b_only, v_venue_b, 400);

  -- Debts: open and settled at A, one owed to Futty, one at B.
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_debt_only, 'venue', v_venue_a, v_booking.id, 680, 600, 80, 'unpaid_share') returning id into v_open_debt;
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_joiner, 'venue', v_venue_a, v_booking.id, 600, 600, 0, 'cash_unpaid') returning id into v_settled_debt;
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_booker, 'futty', null, v_booking.id, 500, 0, 500, 'cancellation_fee') returning id into v_futty_debt;
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_b_only, 'venue', v_venue_b, v_booking_b.id, 680, 600, 80, 'unpaid_share');
  perform tests.act_as(v_owner_a);
  perform public.settle_debt(v_settled_debt);

  ---------------------------------------------------------------------------
  -- Bookings list.
  v_list := public.venue_bookings_list(v_venue_a, v_day, v_day + 1);
  select array_agg(e ->> 'id' order by e ->> 'id') into v_ids from jsonb_array_elements(v_list) e;
  assert v_ids = (select array_agg(x::text order by x::text)
                  from unnest(array[v_booking.id, v_walk_in, v_phone, v_phone_again, v_free_game]) x),
    format('app, walk-in and phone, no owner block, nothing of B, got %s', v_list);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'id' = v_booking.id::text);
  assert v_entry @> jsonb_build_object('source', 'app', 'status', 'pending_payment', 'name', 'Bea Booker',
                                       'payment_mode', 'each_pays_own_spot', 'joined', 2, 'start_time', '12:00:00'),
    format('the app booking, got %s', v_entry);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'id' = v_walk_in::text);
  assert v_entry @> '{"source": "walk_in", "status": "confirmed", "name": "Walter", "venue_price_cents": 6000,
                      "charged_cents": 5000, "paid_method": "cash"}', format('the walk-in, got %s', v_entry);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'id' = v_phone_again::text);
  assert v_entry @> '{"source": "phone", "status": "cancelled", "name": "Phoebe P", "phone": "+35799111222"}',
    format('the cancelled phone booking, its contact''s latest name, got %s', v_entry);
  -- Filters.
  assert (select array_agg(e ->> 'id' order by e ->> 'booking_day')
          from jsonb_array_elements(public.venue_bookings_list(v_venue_a, v_day, v_day + 1, 'app')) e)
         = array[v_booking.id::text, v_free_game::text], 'app only';
  assert (select array_agg(e ->> 'id') from jsonb_array_elements(public.venue_bookings_list(v_venue_a, v_day, v_day + 1, 'walk_in')) e)
         = array[v_walk_in::text], 'walk-ins only';
  assert (select array_agg(e ->> 'id' order by e ->> 'booking_day')
          from jsonb_array_elements(public.venue_bookings_list(v_venue_a, v_day, v_day + 1, 'phone')) e)
         = array[v_phone::text, v_phone_again::text], 'phone only';
  assert (select array_agg(e ->> 'id') from jsonb_array_elements(
            public.venue_bookings_list(v_venue_a, v_day, v_day + 1, 'phone', 'cancelled')) e)
         = array[v_phone_again::text], 'cancelled phone bookings';
  assert (select count(*) from jsonb_array_elements(public.venue_bookings_list(v_venue_a, v_day, v_day + 1, null, 'confirmed')) e)
         = 3, 'confirmed, any source';
  assert (select array_agg(e ->> 'id') from jsonb_array_elements(
            public.venue_bookings_list(v_venue_a, v_day, v_day, null, 'pending_payment')) e)
         = array[v_booking.id::text], 'the app booking still waiting for the booker''s payment';
  assert public.venue_bookings_list(v_venue_a, v_day, v_day, 'walk_in', 'cancelled') = '[]', 'no cancelled walk-in';
  assert (select count(*) from jsonb_array_elements(public.venue_bookings_list(v_venue_a, v_day, v_day)) e) = 3,
    'the range is inclusive and holds';
  assert tests.error_of(format('select public.venue_bookings_list(%L, %L, %L)', v_venue_a, v_day + 1, v_day)) = 'invalid_range',
    'from after to';
  assert tests.error_of(format('select public.venue_bookings_list(%L, null, %L)', v_venue_a, v_day)) = 'invalid_range', 'no from';
  assert tests.error_of(format($q$ select public.venue_bookings_list(%L, %L, %L, 'owner_block') $q$, v_venue_a, v_day, v_day))
         = 'invalid_source', 'owner blocks aren''t a source';
  assert tests.error_of(format($q$ select public.venue_bookings_list(%L, %L, %L, null, 'paid') $q$, v_venue_a, v_day, v_day))
         = 'invalid_status', 'unknown status';

  ---------------------------------------------------------------------------
  -- Customers at A.
  v_list := public.venue_customers(v_venue_a);
  assert (select array_agg(e ->> 'profile_id' order by e ->> 'profile_id') from jsonb_array_elements(v_list) e
          where e ->> 'kind' = 'player')
         = (select array_agg(x::text order by x::text)
            from unnest(array[v_booker, v_joiner, v_credit_only, v_debt_only, v_free_booker, v_left]) x),
    format('players with a share, debt or credit at A, or who booked there, got %s', v_list);
  assert (select array_agg(e ->> 'contact_id' order by e ->> 'contact_id') from jsonb_array_elements(v_list) e
          where e ->> 'kind' = 'contact')
         = (select array_agg(id::text order by id::text) from public.venue_contacts where venue_id = v_venue_a),
    'A''s contacts';
  assert v_list::text not like '%' || v_b_only || '%' and v_list::text not like '%Phoebe at B%'
         and v_list::text not like '%' || v_contact_b || '%', 'nothing of venue B';
  assert v_list::text not like '%futty.test%', 'no email';
  assert v_list::text not like '%' || v_stranger || '%', 'nobody without anything at A';

  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'profile_id' = v_booker::text);
  assert v_entry @> '{"kind": "player", "name": "Bea Booker", "bookings": 1, "debt_cents": 0, "credit_cents": 0}'
         and not v_entry ? 'phone' and not v_entry ? 'email',
    format('booker: Futty''s debt and spent credit don''t count at the venue, got %s', v_entry);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'profile_id' = v_joiner::text);
  assert v_entry @> '{"kind": "player", "bookings": 1, "debt_cents": 0, "credit_cents": 0}',
    format('joiner: settled debt is no debt, got %s', v_entry);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'profile_id' = v_credit_only::text);
  assert v_entry @> '{"name": "Cal Credit", "bookings": 0, "debt_cents": 0, "credit_cents": 580}',
    format('credit only: the expired 300 doesn''t count, got %s', v_entry);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'profile_id' = v_debt_only::text);
  assert v_entry @> '{"name": "Dee Debt", "bookings": 0, "debt_cents": 680, "credit_cents": 0}',
    format('debt only, got %s', v_entry);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'contact_id' = v_contact_a::text);
  assert v_entry @> jsonb_build_object('kind', 'contact', 'name', 'Phoebe P', 'phone', '+35799111222', 'bookings', 1,
                                       'last_booking_day', v_day),
    format('one caller however the number was typed; the cancelled booking isn''t counted, got %s', v_entry);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'profile_id' = v_free_booker::text);
  assert v_entry @> jsonb_build_object('kind', 'player', 'name', 'Fay Free', 'bookings', 1, 'last_booking_day', v_day + 1,
                                       'debt_cents', 0, 'credit_cents', 0),
    format('a free game''s booker, got %s', v_entry);
  v_entry := (select e from jsonb_array_elements(v_list) e where e ->> 'profile_id' = v_left::text);
  assert v_entry @> '{"kind": "player", "name": "Leo Left", "bookings": 0, "last_booking_day": null}',
    format('left for a refund: listed, nothing on, got %s', v_entry);

  -- One customer's details.
  v_entry := public.venue_customer(v_venue_a, 'player', v_booker);
  assert v_entry @> jsonb_build_object('kind', 'player', 'profile_id', v_booker, 'name', 'Bea Booker')
         and jsonb_array_length(v_entry -> 'bookings') = 1
         and v_entry -> 'bookings' -> 0 @> jsonb_build_object('booking_id', v_booking.id, 'is_booker', true,
                                                               'booking_status', 'pending_payment', 'share_status', 'pending')
         and v_entry -> 'debts' = '[]' and not v_entry ? 'email' and v_entry::text not like '%futty.test%',
    format('booker''s details, got %s', v_entry);
  v_entry := public.venue_customer(v_venue_a, 'player', v_joiner);
  assert jsonb_array_length(v_entry -> 'debts') = 1
         and v_entry -> 'debts' -> 0 @> jsonb_build_object('debt_id', v_settled_debt, 'amount_cents', 600, 'settled_by', 'venue'),
    format('joiner: settled debts listed too, got %s', v_entry);
  v_entry := public.venue_customer(v_venue_a, 'player', v_credit_only);
  assert v_entry -> 'bookings' = '[]' and v_entry ->> 'credit_cents' = '580'
         and jsonb_array_length(v_entry -> 'credits') = 2
         and (select count(*) from jsonb_array_elements(v_entry -> 'credits') c where (c ->> 'available')::boolean) = 1,
    format('credit only: both credits, one available, got %s', v_entry);
  v_entry := public.venue_customer(v_venue_a, 'player', v_free_booker);
  assert jsonb_array_length(v_entry -> 'bookings') = 1
         and v_entry -> 'bookings' -> 0 @> jsonb_build_object('booking_id', v_free_game, 'is_booker', true,
                                                               'booking_status', 'confirmed', 'share_status', null),
    format('free game''s booker: the booking, no share, got %s', v_entry);
  v_entry := public.venue_customer(v_venue_a, 'contact', v_contact_a);
  assert v_entry @> jsonb_build_object('kind', 'contact', 'contact_id', v_contact_a, 'name', 'Phoebe P', 'phone', '+35799111222')
         and (select array_agg(b ->> 'booking_id' order by b ->> 'booking_day') from jsonb_array_elements(v_entry -> 'bookings') b)
             = array[v_phone::text, v_phone_again::text],
    format('the caller''s bookings, got %s', v_entry);

  -- Never someone who isn't A's customer.
  assert tests.error_of(format($q$ select public.venue_customer(%L, 'player', %L) $q$, v_venue_a, v_b_only))
         = 'customer_not_found', 'B''s player at A';
  assert tests.error_of(format($q$ select public.venue_customer(%L, 'player', %L) $q$, v_venue_a, v_stranger))
         = 'customer_not_found', 'a stranger';
  assert tests.error_of(format($q$ select public.venue_customer(%L, 'contact', %L) $q$, v_venue_a, v_contact_b))
         = 'customer_not_found', 'B''s contact at A';
  assert tests.error_of(format($q$ select public.venue_customer(%L, 'staff', %L) $q$, v_venue_a, v_booker))
         = 'invalid_kind', 'unknown kind';

  ---------------------------------------------------------------------------
  -- Debt and credit at A.
  v_list := public.venue_debt_list(v_venue_a);
  assert jsonb_array_length(v_list) = 1
         and v_list -> 0 @> jsonb_build_object('debt_id', v_open_debt, 'profile_id', v_debt_only, 'name', 'Dee Debt',
                                               'amount_cents', 680, 'venue_cents', 600, 'futty_cents', 80,
                                               'reason', 'unpaid_share', 'booking_id', v_booking.id,
                                               'booking_day', v_day, 'settled_at', null),
    format('open debts owed to A, got %s', v_list);
  v_list := public.venue_debt_list(v_venue_a, true);
  assert (select array_agg(e ->> 'debt_id' order by e ->> 'debt_id') from jsonb_array_elements(v_list) e)
         = (select array_agg(x::text order by x::text) from unnest(array[v_open_debt, v_settled_debt]) x),
    format('and settled ones; never Futty''s or B''s, got %s', v_list);
  assert v_list::text not like '%futty.test%', 'no email';

  v_list := public.venue_credit_list(v_venue_a);
  assert jsonb_array_length(v_list) = 1
         and v_list -> 0 @> jsonb_build_object('profile_id', v_credit_only, 'name', 'Cal Credit', 'available_cents', 580)
         and jsonb_array_length(v_list -> 0 -> 'credits') = 1
         and v_list -> 0 -> 'credits' -> 0 @> '{"remaining_cents": 580}',
    format('only credit still available, got %s', v_list);
  perform tests.act_as_postgres();
end $$;

rollback;
