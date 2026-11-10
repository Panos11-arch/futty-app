-- Venue credit (docs/specs/13-payments-bookings.md, "Venue credit", "Prices
-- and fees"): spent only at the venue that issued it, never cashed out; it
-- pays the pitch part of a share with no service fee, and a shortfall is
-- paid by card plus the normal 80 cents. Credit expires 12 months after it
-- was issued; a daily job expires it.
begin;

-- 500 credit against a 600 pitch part: 100 + 80 by card.
do $$
declare
  v_booker uuid := tests.create_user('credit-spend-booker@futty.test');
  v_player uuid := tests.create_user('credit-spend-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_credit uuid;
  v_plan jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_credit := tests.give_credit(v_player, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'credit-spend');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_cs_0');
  v_share := tests.join_booking(v_booking.id, v_player);

  perform tests.act_as_service_role();
  v_plan := public.plan_share_payment(v_share.id, v_player, 'card', false, true);
  perform tests.act_as_postgres();
  assert v_plan @> jsonb_build_object('pitch_cents', 600, 'credit_cents', 500, 'fee_cents', 80, 'amount_cents', 180,
                                      'needs_saved_card', false), format('100 + 80 by card, got %s', v_plan);

  -- Without asking for credit, it isn't used.
  perform tests.act_as_service_role();
  assert (public.plan_share_payment(v_share.id, v_player, 'card', false) ->> 'amount_cents')::integer = 680,
    'credit only when the player chooses it';
  perform tests.act_as_postgres();

  -- Paying reserves it; the hold landing spends it.
  v_share := tests.pay_ago(v_share.id, 'pi_cs_1', interval '0', 'card', true);
  assert v_share.amount_cents = 180 and v_share.credit_cents = 500 and v_share.status = 'authorized', '180 held';
  assert (select remaining_cents from public.venue_credits where id = v_credit) = 0, 'the credit is used';
  assert (select (kind, amount_cents, venue_cents, credit_cents) from public.money_ledger
          where share_id = v_share.id and kind = 'credit_spent') = ('credit_spent'::text, 500, 500, -500),
    'spending it goes to the venue, in the ledger';

  -- Cancelling in the free hour gives the 180 hold back and the 500 credit back.
  perform tests.cancel(v_booking.id, 'my_spot', v_player);
  assert (select remaining_cents from public.venue_credits where id = v_credit) = 500, 'credit returned';
  assert (select count(*) from public.money_ledger where share_id = v_share.id and kind = 'credit_returned') = 1,
    'returned once, in the ledger';
end $$;

-- Credit can't be spent at another venue, or once expired.
do $$
declare
  v_booker uuid := tests.create_user('credit-where-booker@futty.test');
  v_player uuid := tests.create_user('credit-where-player@futty.test');
  v_issuer uuid := tests.create_venue(p_pitches => 1);
  v_other uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_expired uuid;
begin
  perform tests.set_price(v_other, '5-a-side', 6000);
  perform tests.set_price(v_issuer, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_issuer, 500);
  v_booking := tests.booking_with_players(v_booker, v_other, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'credit-where');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false, true) $q$, v_share.id, v_player))
         = 'no_credit_at_venue', 'credit from another venue is refused';
  perform tests.act_as_postgres();

  -- Expired credit at the right venue.
  v_booking := tests.booking_with_players(v_booker, v_issuer, 'each_pays_own_spot', 0, tests.cyprus_today() + 4,
                                          p_label => 'credit-expired');
  v_share := tests.join_booking(v_booking.id, v_player);
  update public.venue_credits set issued_at = now() - interval '12 months 1 day',
                                  expires_at = now() - interval '1 day'
  where profile_id = v_player;
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false, true) $q$, v_share.id, v_player))
         = 'no_credit_at_venue', 'expired credit can''t be spent';

  -- The daily job expires it, once, in the ledger.
  assert public.expire_venue_credits() = 1, 'one credit expired';
  assert public.expire_venue_credits() = 0, 'expiring twice changes nothing';
  perform tests.act_as_postgres();
  select id into v_expired from public.venue_credits where profile_id = v_player;
  assert (select (remaining_cents, expired_at is not null) from public.venue_credits where id = v_expired) = (0, true),
    'nothing left on it';
  assert (select (amount_cents, venue_cents, credit_cents) from public.money_ledger
          where credit_id = v_expired and kind = 'credit_expired') = (500, 500, -500), 'expired credit stays with the venue';
end $$;

-- Credit that covers the whole pitch part: no fee, and the card is saved
-- with a SetupIntent (every player paying in the app saves a card).
do $$
declare
  v_booker uuid := tests.create_user('credit-full-booker@futty.test');
  v_player uuid := tests.create_user('credit-full-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_plan jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 400);
  perform tests.give_credit(v_player, v_venue, 400);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'credit-full');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.act_as_service_role();
  v_plan := public.plan_share_payment(v_share.id, v_player, 'card', false, true);
  assert v_plan @> jsonb_build_object('credit_cents', 600, 'fee_cents', 0, 'amount_cents', 0, 'needs_saved_card', true),
    format('credit covers it, no fee, a card is saved; got %s', v_plan);
  v_plan := public.attach_share_setup(v_share.id, v_player, 'card', 'seti_full', null, true);
  perform public.share_card_saved(v_share.id, 'seti_full', 'pm_full', now());
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_player)).status = 'paid', 'paid with credit';
  assert (select sum(remaining_cents) from public.venue_credits where profile_id = v_player) = 200,
    '600 of the 800 used, from two credits';
  assert (select sum(credit_cents) from public.money_ledger where share_id = v_share.id) = -600, 'in the ledger';
end $$;

-- Credit pays the pitch part of a card payment only.
do $$
declare
  v_booker uuid := tests.create_user('credit-rules-booker@futty.test');
  v_player uuid := tests.create_user('credit-rules-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_pay_all public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 500);
  perform tests.give_credit(v_booker, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'credit-rules');
  v_share := tests.join_booking(v_booking.id, v_player);
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'cash', false, true) $q$, v_share.id, v_player))
         = 'credit_needs_card', 'not with cash';
  perform tests.act_as_postgres();

  perform tests.act_as(v_booker);
  v_pay_all := public.book_slot(v_venue, tests.cyprus_today() + 4, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false, true) $q$,
                               (tests.player(v_pay_all.id, 0)).id, v_booker)) = 'credit_not_allowed_pay_all',
    'not for a pay-for-everyone booking (to confirm)';
  perform tests.act_as_postgres();
end $$;

-- Players see their own credit; the venue sees credit with it; nobody can
-- change it from the app.
do $$
declare
  v_owner uuid := tests.create_user('credit-rls-owner@futty.test');
  v_player uuid := tests.create_user('credit-rls-player@futty.test');
  v_other uuid := tests.create_user('credit-rls-other@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_credit uuid;
begin
  v_credit := tests.give_credit(v_player, v_venue, 500);
  perform tests.act_as(v_player);
  assert (select count(*) from public.venue_credits where id = v_credit) = 1, 'the player sees their credit';
  assert tests.error_of(format($q$ update public.venue_credits set remaining_cents = 99999 where id = %L $q$, v_credit))
         is not null, 'and can''t change it';
  perform tests.act_as(v_owner);
  assert (select count(*) from public.venue_credits where id = v_credit) = 1, 'the venue sees credit with it';
  perform tests.act_as(v_other);
  assert (select count(*) from public.venue_credits where id = v_credit) = 0, 'nobody else does';
  perform tests.act_as_postgres();
end $$;

rollback;
