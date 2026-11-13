-- Walk-in and phone bookings (docs/specs/05-product.md section 12, launch
-- item 5; docs/specs/13-payments-bookings.md "Venue dashboard", decided 13
-- November): staff add a booking at the counter so the app never
-- double-books; the server prefills the venue's price for the slot and staff
-- may change it (both are kept); it's marked paid by cash or card at the
-- counter, which writes one counter_paid ledger row; a paid one can be
-- cancelled with a reversing row. No match, no Stripe, no players.
begin;

-- Price, override, walk-in and phone, paid at once or later, once.
do $$
declare
  v_owner uuid := tests.create_user('counter-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 2;
  v_walk_in uuid;
  v_phone uuid;
  v_free uuid;
  v_row public.venue_counter_bookings;
  v_booking public.venue_bookings;
  v_contact public.venue_contacts;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);

  perform tests.act_as(v_owner);
  -- Walk-in, venue price, paid cash at once.
  v_walk_in := public.add_counter_booking(v_venue, v_day, '18:00', '19:00', '5-a-side', 'walk_in', 'Andreas',
                                          null, p_paid_method => 'cash');
  -- Phone booking for a regular at a discount, paid later.
  v_phone := public.add_counter_booking(v_venue, v_day, '18:00', '19:00', '5-a-side', 'phone', 'Maria',
                                        '+35799000001', p_charged_cents => 4000);
  -- Free (a favour): nothing to record when paid.
  v_free := public.add_counter_booking(v_venue, v_day, '20:00', '21:00', '5-a-side', 'walk_in', 'Kids club',
                                       null, p_charged_cents => 0);
  perform tests.act_as_postgres();

  select * into v_row from public.venue_counter_bookings where booking_id = v_walk_in;
  assert v_row.source = 'walk_in' and v_row.venue_price_cents = 5000 and v_row.charged_cents = 5000,
    format('walk-in at the venue price, got %s / %s', v_row.venue_price_cents, v_row.charged_cents);
  assert v_row.paid_method = 'cash' and v_row.paid_at is not null and v_row.paid_by = v_owner, 'paid cash at once';
  select * into v_booking from public.venue_bookings where id = v_walk_in;
  assert v_booking.booking_type = 'counter' and v_booking.status = 'confirmed' and v_booking.amount_cents = 5000
         and v_booking.payment_mode is null and v_booking.capacity = 10 and v_booking.created_by = v_owner,
    'a confirmed counter booking with no payment mode';
  assert (select count(*) from public.booking_pitches where booking_id = v_walk_in) = 1, 'holds a pitch';
  assert (select count(*) from public.money_ledger where booking_id = v_walk_in) = 1, 'one ledger row';
  assert (select kind = 'counter_paid' and amount_cents = 5000 and venue_cents = 5000 and futty_cents = 0
                 and stripe_fee_cents = 0 and stripe_id is null and reason = 'counter_paid_cash'
          from public.money_ledger where booking_id = v_walk_in), 'all of it the venue''s, no Stripe';

  select * into v_row from public.venue_counter_bookings where booking_id = v_phone;
  assert v_row.source = 'phone' and v_row.venue_price_cents = 5000 and v_row.charged_cents = 4000
         and v_row.paid_at is null, 'the override is kept next to the venue price, not paid yet';
  select * into v_contact from public.venue_contacts where id = v_row.contact_id;
  assert v_contact.name = 'Maria' and v_contact.phone = '+35799000001' and v_contact.venue_id = v_venue, 'contact kept';
  assert not exists (select 1 from public.money_ledger where booking_id = v_phone), 'nothing until paid';

  perform tests.act_as(v_owner);
  perform public.mark_counter_paid(v_phone, 'card');
  assert tests.error_of(format($q$ select public.mark_counter_paid(%L, 'cash') $q$, v_phone)) = 'already_paid', 'once';
  perform public.mark_counter_paid(v_free, 'cash');
  -- Same phone number again: the same contact.
  perform public.add_counter_booking(v_venue, v_day, '21:00', '22:00', '5-a-side', 'phone', 'Maria P.', '+35799000001');
  perform tests.act_as_postgres();

  assert (select amount_cents = 4000 and venue_cents = 4000 and reason = 'counter_paid_card'
          from public.money_ledger where booking_id = v_phone and kind = 'counter_paid'), 'the charged amount, card';
  assert (select count(*) from public.money_ledger where booking_id = v_phone) = 1, 'once';
  assert not exists (select 1 from public.money_ledger where booking_id = v_free), '€0 writes nothing';
  assert (select paid_method from public.venue_counter_bookings where booking_id = v_free) = 'cash', 'but it is paid';
  assert (select count(*) from public.venue_contacts where venue_id = v_venue and phone = '+35799000001') = 1,
    'a repeat caller reuses the contact';

  -- No match, and not in anyone's bookings or the money balance check.
  assert tests.match_of(v_walk_in) is null, 'no match';
  assert (select balanced from public.money_balance(v_walk_in)), 'counter money is outside the balance check';
end $$;

-- The app can never double-book it, and the slot must make sense.
do $$
declare
  v_owner uuid := tests.create_user('counter-slot-owner@futty.test');
  v_booker uuid := tests.create_user('counter-slot-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_pitches => 1);
  v_pitch uuid;
  v_other_pitch uuid;
  v_day date := tests.cyprus_today() + 2;
  v_counter uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  select id into v_pitch from public.pitches where venue_id = v_venue;
  select id into v_other_pitch from public.pitches where venue_id = v_other_venue;
  perform tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '12:00', '13:00');

  perform tests.act_as(v_owner);
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '12:30', '13:30', '5-a-side', 'walk_in', 'A', null) $q$,
                               v_venue, v_day)) = 'slot_full', 'over an app booking';
  v_counter := public.add_counter_booking(v_venue, v_day, '14:00', '15:00', '5-a-side', 'walk_in', 'A', null,
                                          p_pitch_id => v_pitch);
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '14:00', '15:00', '5-a-side', 'phone', 'B', null) $q$,
                               v_venue, v_day)) = 'slot_full', 'over another counter booking';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '16:00', '17:00', '5-a-side', 'walk_in', 'A', null, %L) $q$,
                               v_venue, v_day, v_other_pitch)) = 'invalid_pitch', 'another venue''s pitch';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '16:00', '17:00', '7-a-side', 'walk_in', 'A', null) $q$,
                               v_venue, v_day)) = 'invalid_format', 'a format the venue doesn''t host';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '16:00', '17:00', '5-a-side', 'email', 'A', null) $q$,
                               v_venue, v_day)) = 'invalid_source', 'walk-in or phone only';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '16:00', '17:00', '5-a-side', 'walk_in', '  ', null) $q$,
                               v_venue, v_day)) = 'name_required', 'a name';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '16:00', '17:00', '5-a-side', 'walk_in', 'A', null, null, -1) $q$,
                               v_venue, v_day)) = 'invalid_amount', 'no negative amounts';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '16:00', '17:00', '5-a-side', 'walk_in', 'A', null, null, null, 'cheque') $q$,
                               v_venue, v_day)) = 'invalid_paid_method', 'cash or card';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '16:15', '17:00', '5-a-side', 'walk_in', 'A', null) $q$,
                               v_venue, v_day)) = 'slot_not_on_grid', 'half-hour grid';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '07:00', '08:00', '5-a-side', 'walk_in', 'A', null) $q$,
                               v_venue, v_day)) = 'outside_opening_hours', 'inside opening hours';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '18:00', '17:00', '5-a-side', 'walk_in', 'A', null) $q$,
                               v_venue, v_day)) = 'invalid_time_range', 'ends after it starts';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '18:00', '19:00', '5-a-side', 'walk_in', 'A', null) $q$,
                               v_venue, tests.cyprus_today() - 1)) = 'slot_ended', 'not a game that has ended';

  -- A block stops counter bookings too (staff lift it first).
  insert into public.venue_blocks (venue_id, pitch_id, block_day, starts_at, ends_at, created_by)
  values (v_venue, null, v_day, '19:00', '21:00', v_owner);
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '19:00', '20:00', '5-a-side', 'walk_in', 'A', null) $q$,
                               v_venue, v_day)) = 'slot_full', 'blocked: no free pitch';
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '20:00', '21:00', '5-a-side', 'walk_in', 'A', null, %L) $q$,
                               v_venue, v_day, v_pitch)) = 'slot_blocked', 'blocked pitch chosen';
  perform tests.act_as_postgres();

  -- A venue with no price: staff must give the amount.
  delete from public.price_rules where venue_id = v_venue;
  perform tests.act_as(v_owner);
  assert tests.error_of(format($q$ select public.add_counter_booking(%L, %L, '16:00', '17:00', '5-a-side', 'walk_in', 'A', null) $q$,
                               v_venue, v_day)) = 'price_required', 'no venue price and none given';
  v_counter := public.add_counter_booking(v_venue, v_day, '16:00', '17:00', '5-a-side', 'walk_in', 'A', null,
                                          p_charged_cents => 3000);
  perform tests.act_as_postgres();
  assert (select venue_price_cents is null and charged_cents = 3000 from public.venue_counter_bookings
          where booking_id = v_counter), 'no venue price recorded, the amount given';
end $$;

-- Cancelling: pitches freed; a paid one is reversed; not once it started.
do $$
declare
  v_owner uuid := tests.create_user('counter-cancel-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_day date := tests.cyprus_today() + 2;
  v_unpaid uuid;
  v_paid uuid;
  v_started uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  perform tests.act_as(v_owner);
  v_unpaid := public.add_counter_booking(v_venue, v_day, '10:00', '11:00', '5-a-side', 'walk_in', 'A', null);
  v_paid := public.add_counter_booking(v_venue, v_day, '11:00', '12:00', '5-a-side', 'phone', 'B', null,
                                       p_paid_method => 'card');
  v_started := public.add_counter_booking(v_venue, v_day, '12:00', '13:00', '5-a-side', 'walk_in', 'C', null);
  perform public.cancel_counter_booking(v_unpaid);
  perform public.cancel_counter_booking(v_paid);
  assert tests.error_of(format('select public.cancel_counter_booking(%L)', v_paid)) = 'booking_cancelled', 'once';
  assert tests.error_of(format($q$ select public.mark_counter_paid(%L, 'cash') $q$, v_unpaid)) = 'booking_cancelled',
    'not paid after cancelling';
  -- The slot is free again.
  perform public.add_counter_booking(v_venue, v_day, '10:00', '11:00', '5-a-side', 'walk_in', 'D', null);
  perform tests.act_as_postgres();

  assert (select status from public.venue_bookings where id = v_unpaid) = 'cancelled', 'cancelled';
  assert not exists (select 1 from public.booking_pitches where booking_id in (v_unpaid, v_paid)), 'pitches freed';
  assert not exists (select 1 from public.money_ledger where booking_id = v_unpaid), 'unpaid: no ledger row';
  assert (select count(*) from public.money_ledger where booking_id = v_paid and kind = 'counter_paid') = 2,
    'paid: the payment and its reversal';
  assert (select amount_cents = 5000 and venue_cents = -5000 and reason = 'counter_booking_cancelled'
          from public.money_ledger where booking_id = v_paid and ref = 'counter_cancel:' || v_paid), 'the reversal';
  assert (select sum(venue_cents) from public.money_ledger where booking_id = v_paid) = 0, 'nets to nothing';
  assert (select cancelled_at is not null from public.venue_counter_bookings where booking_id = v_paid), 'recorded';

  perform tests.set_kickoff(v_started, now() - interval '5 minutes');
  perform tests.act_as(v_owner);
  assert tests.error_of(format('select public.cancel_counter_booking(%L)', v_started)) = 'game_started',
    'nothing is cancelled once the game has started';
  -- It can still be marked paid after it started.
  perform public.mark_counter_paid(v_started, 'cash');
  perform tests.act_as_postgres();
end $$;

-- A counter booking is never an app booking.
do $$
declare
  v_owner uuid := tests.create_user('counter-only-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_counter uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  perform tests.act_as(v_owner);
  v_counter := public.add_counter_booking(v_venue, tests.cyprus_today() + 1, '10:00', '11:00', '5-a-side',
                                          'walk_in', 'A', null);
  assert tests.error_of(format('select public.request_collection(%L)', v_counter)) = 'nothing_to_collect',
    'no collection';
  assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'venue') $q$, v_counter)) is not null,
    'not through the app''s cancellation';
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.booking_payment_shares where booking_id = v_counter), 'no shares';
end $$;

rollback;
