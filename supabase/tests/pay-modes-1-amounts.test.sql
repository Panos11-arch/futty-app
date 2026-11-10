-- Booking modes and fees (docs/specs/13-payments-bookings.md, "Prices and
-- fees" and "Booking modes"). Every worked example from the P4a prompt, with
-- its exact amount:
--   EUR 60 5 v 5, each pays: every share 680
--   EUR 61.11 5 v 5: booker 612 + 80 = 692, the others 611 + 80 = 691
--   6 v 6 at a venue that allows it: 580 each
--   pay for everyone: 6550 (5 v 5) and 6660 (6 v 6); Premium booker 6495
--   Premium player, own share: 600
--   a cash player pays 80 by card
begin;

-- The money function itself.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- pitch, players, mode,                    booker, premium, method, pitch part, fee, card, cash, label
      (6000, 10, 'each_pays_own_spot',    false, false, 'card', 600,  80,   680,  0,    'EUR 60 5 v 5, a player'),
      (6000, 10, 'each_pays_responsible', true,  false, 'card', 600,  80,   680,  0,    'EUR 60 5 v 5, the booker'),
      (6111, 10, 'each_pays_own_spot',    true,  false, 'card', 612,  80,   692,  0,    'EUR 61.11, the booker gets the leftover cent'),
      (6111, 10, 'each_pays_own_spot',    false, false, 'card', 611,  80,   691,  0,    'EUR 61.11, the others'),
      (6000, 12, 'each_pays_own_spot',    false, false, 'card', 500,  80,   580,  0,    '6 v 6'),
      (6000, 10, 'pay_all',               true,  false, 'card', 6000, 550,  6550, 0,    'pay for everyone, 5 v 5'),
      (6000, 12, 'pay_all',               true,  false, 'card', 6000, 660,  6660, 0,    'pay for everyone, 6 v 6'),
      (6000, 10, 'pay_all',               true,  true,  'card', 6000, 495,  6495, 0,    'Premium booker pays for everyone'),
      (6000, 10, 'pay_all',               false, false, 'card', 0,    0,    0,    0,    'a player in a paid-for booking'),
      (6000, 10, 'each_pays_own_spot',    false, true,  'card', 600,  0,    600,  0,    'Premium player, own share'),
      (6000, 10, 'each_pays_own_spot',    false, false, 'cash', 600,  80,   80,   600,  'cash player pays the fee by card'),
      (6000, 10, 'each_pays_responsible', false, true,  'cash', 600,  0,    0,    600,  'Premium cash player pays nothing by card')
    ) as c (pitch, players, mode, booker, premium, method, part, fee, card, cash, label)
  loop
    assert (select (m.pitch_cents, m.fee_cents, m.card_cents, m.cash_cents)
              = (r.part, r.fee, r.card, r.cash)
            from public.money_share(r.pitch, r.players, r.mode, r.booker, r.premium, r.method) m),
      format('%s: expected pitch %s fee %s card %s cash %s, got %s', r.label, r.part, r.fee, r.card, r.cash,
             (select row(m.*) from public.money_share(r.pitch, r.players, r.mode, r.booker, r.premium, r.method) m));
  end loop;

  assert tests.error_of($q$ select public.money_share(6000, 10, 'pay_all', true, false, 'cash') $q$) = 'cash_not_allowed',
    'cash is only allowed in the two each_pays modes';
  assert tests.error_of($q$ select public.money_share(6000, 10, 'pay_later', true, false, 'card') $q$) = 'invalid_payment_mode',
    'an unknown mode is refused';
  assert tests.error_of($q$ select public.money_share(6000, 10, 'each_pays_own_spot', true, false, 'cheque') $q$) = 'invalid_payment_method',
    'an unknown payment method is refused';
  assert tests.error_of($q$ select public.money_share(6000, 0, 'each_pays_own_spot', true, false, 'card') $q$) = 'invalid_money_input',
    'zero players is refused';
end $$;

-- EUR 60 5 v 5, each pays: the booker and all 9 others pay 680.
do $$
declare
  v_booker uuid := tests.create_user('modes-each-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_player uuid;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();

  assert v_booking.payment_mode = 'each_pays_own_spot', 'the mode is stored on the booking';
  v_share := tests.share_of(v_booking.id, v_booker);
  assert (v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, v_share.payment_method)
         = (680, 600, 80, 0, 'card'), format('booker share 680 = 600 + 80, got %s', row(v_share.*));

  for i in 1 .. 9 loop
    v_player := tests.create_user(format('modes-each-player-%s@futty.test', i));
    v_share := tests.join_booking(v_booking.id, v_player);
    assert (v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents) = (680, 600, 80),
      format('player %s share should be 680, got %s', i, v_share.amount_cents);
  end loop;
  assert (select sum(pitch_cents) from public.booking_payment_shares where booking_id = v_booking.id) = 6000,
    'the pitch parts add up to the pitch price';

  -- An 11th player has no spot.
  v_player := tests.create_user('modes-each-player-11@futty.test');
  assert (tests.join_booking(v_booking.id, v_player)).id is null, 'no share beyond the booking''s 10 players';
end $$;

-- EUR 61.11 5 v 5: the leftover cent goes on the booker's share.
do $$
declare
  v_booker uuid := tests.create_user('modes-odd-booker@futty.test');
  v_player uuid := tests.create_user('modes-odd-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6111);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();

  assert (tests.share_of(v_booking.id, v_booker)).amount_cents = 692, 'booker 612 + 80 = 692';
  assert (tests.join_booking(v_booking.id, v_player)).amount_cents = 691, 'the others 611 + 80 = 691';
end $$;

-- 6 v 6 on a 5-a-side pitch at a venue that allows it: 580 each, and 6660
-- when the booker pays for everyone.
do $$
declare
  v_booker uuid := tests.create_user('modes-six-booker@futty.test');
  v_player uuid := tests.create_user('modes-six-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 6, 'each_pays_own_spot');
  perform tests.act_as_postgres();

  assert v_booking.capacity = 12, '6 v 6 is 12 players';
  assert (tests.share_of(v_booking.id, v_booker)).amount_cents = 580, 'booker 580';
  assert (tests.join_booking(v_booking.id, v_player)).amount_cents = 580, 'player 580';

  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '14:00', '15:00', 1, '5-a-side', 6, 'pay_all');
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_booker)).amount_cents = 6660, 'pay for everyone 6 v 6: 6660';
end $$;

-- Pay for everyone: one payment of 6550; everyone else's spot is covered.
-- A Premium booker pays 6495 (only their own spot is fee-free).
do $$
declare
  v_booker uuid := tests.create_user('modes-all-booker@futty.test');
  v_premium uuid := tests.create_user('modes-all-premium@futty.test');
  v_player uuid := tests.create_user('modes-all-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_premium);

  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_booker);
  assert (v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents) = (6550, 6000, 550),
    format('pay for everyone 5 v 5: 6550 = 6000 + 10 x 55, got %s', row(v_share.*));
  assert v_booking.service_fee_cents_per_player = 55, 'the booking records the 55-cent fee';

  v_share := tests.join_booking(v_booking.id, v_player);
  assert (v_share.amount_cents, v_share.status) = (0, 'covered'), 'a player in a paid-for booking pays nothing';

  perform tests.act_as(v_premium);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_premium)).amount_cents = 6495, 'Premium booker paying for everyone: 6495';
end $$;

-- Premium player, own share: 600. A cash player pays 80 by card and 600 at
-- the venue; cash isn't allowed when the booker pays for everyone.
do $$
declare
  v_booker uuid := tests.create_user('modes-cash-booker@futty.test');
  v_premium uuid := tests.create_user('modes-cash-premium@futty.test');
  v_cash uuid := tests.create_user('modes-cash-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_booking public.venue_bookings;
  v_paid_all public.venue_bookings;
  v_share public.booking_payment_shares;
  v_prepared jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_premium);

  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_paid_all := public.book_slot(v_venue, tests.cyprus_today() + 3, '14:00', '15:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();

  v_share := tests.join_booking(v_booking.id, v_premium);
  assert v_share.amount_cents = 600, format('Premium player own share 600, got %s', v_share.amount_cents);

  v_share := tests.join_booking(v_booking.id, v_cash);
  perform tests.act_as_service_role();
  v_prepared := public.plan_share_payment(v_share.id, v_cash, 'cash', false);
  perform tests.act_as_postgres();
  assert (v_prepared ->> 'amount_cents')::int = 80, format('a cash player pays 80 by card, got %s', v_prepared);
  assert (v_prepared ->> 'cash_cents')::int = 600, 'and 600 in cash at the venue';
  assert (tests.share_of(v_booking.id, v_cash)).payment_method = 'card', 'planning writes nothing';

  v_prepared := tests.pay_share(v_share.id, 'pi_cash_fee', 'cash');
  v_share := tests.share_of(v_booking.id, v_cash);
  assert (v_share.payment_method, v_share.amount_cents, v_share.cash_cents, v_share.stripe_payment_intent_id)
         = ('cash', 80, 600, 'pi_cash_fee'), 'the share records cash, with its intent';

  -- Switching back to card puts the pitch part back on the card.
  perform tests.act_as_service_role();
  v_prepared := public.plan_share_payment(v_share.id, v_cash, 'card', false);
  perform tests.act_as_postgres();
  assert (v_prepared ->> 'amount_cents')::int = 680, 'card again: 680';

  -- Premium cash player who isn't the booker: nothing by card, but every
  -- player paying in the app saves a card (P4c): a SetupIntent instead of
  -- a payment, never let through without one.
  perform tests.act_as_service_role();
  v_prepared := public.plan_share_payment((tests.share_of(v_booking.id, v_premium)).id, v_premium, 'cash', false);
  assert v_prepared @> '{"amount_cents": 0, "needs_saved_card": true}',
    format('a Premium cash player saves a card, got %s', v_prepared);
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'cash', false) $q$,
                               (tests.share_of(v_paid_all.id, v_booker)).id, v_booker)) = 'cash_not_allowed',
    'no cash when the booker pays for everyone';
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false) $q$,
                               (tests.share_of(v_booking.id, v_booker)).id, v_cash)) = 'not_your_share',
    'a player can only pay their own share';
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_premium)).status = 'pending', 'planning writes nothing';
end $$;

-- The mode is required: no silent default on money (decided 9 November).
do $$
declare
  v_booker uuid := tests.create_user('modes-required@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  assert tests.error_of(format($q$ select public.book_slot(%L::uuid, %L::date, '12:00', '13:00', 1, '5-a-side', 5) $q$,
                               v_venue, v_day)) = 'mode_required', 'no mode: refused';
  assert tests.error_of(format($q$ select public.book_slot(%L::uuid, %L::date, '12:00', '13:00', 1, 10, '5-a-side') $q$,
                               v_venue, v_day)) = 'mode_required', 'the pre-P2 signature is refused too';
  assert tests.error_of(format($q$ select public.book_slot(%L::uuid, %L::date, '12:00', '13:00', 1, '5-a-side', 5, 'pay_later') $q$,
                               v_venue, v_day)) = 'invalid_payment_mode', 'an unknown mode is refused';
  perform tests.act_as_postgres();
end $$;

-- Joining a squad post shows what the joiner will pay, from the same maths.
do $$
declare
  v_booker uuid := tests.create_user('modes-post-booker@futty.test');
  v_joiner uuid := tests.create_user('modes-post-joiner@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_each public.venue_bookings;
  v_all public.venue_bookings;
  v_each_post uuid;
  v_all_post uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_each := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_all := public.book_slot(v_venue, tests.cyprus_today() + 3, '14:00', '15:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_postgres();
  insert into public.squad_posts (type, posted_by, venue_booking_id, venue_id, format)
  values ('players', v_booker, v_each.id, v_venue, '5-a-side')
  returning id into v_each_post;
  insert into public.squad_posts (type, posted_by, venue_booking_id, venue_id, format)
  values ('players', v_booker, v_all.id, v_venue, '5-a-side')
  returning id into v_all_post;

  perform tests.act_as(v_joiner);
  assert (select (share_cents, fee_cents) = (680, 80) from public.squad_post_price(v_each_post)),
    'each pays: joining costs 680';
  assert (select (share_cents, fee_cents) = (0, 0) from public.squad_post_price(v_all_post)),
    'paid for everyone: joining costs nothing';
  perform tests.act_as_postgres();
end $$;

rollback;
