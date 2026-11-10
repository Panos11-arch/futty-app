-- Every player who could owe money saves a card
-- (docs/specs/13-payments-bookings.md, "When money is held and taken" step 6:
-- "Every player paying in the app saves a card, including a Premium cash
-- player or a player paying fully with venue credit, so top-ups and debts
-- can be charged later"). P4a refused a Premium cash player who isn't the
-- booker (saved_card_required); now they save a card with a SetupIntent,
-- like the each-pays booker. A player in a pay-for-everyone booking pays
-- nothing and can never owe anything, so they save no card.
begin;

do $$
declare
  v_booker uuid := tests.create_user('card-premium-booker@futty.test');
  v_premium uuid := tests.create_user('card-premium-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_plan jsonb;
  v_saved jsonb;
  v_mode text;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_premium);
  foreach v_mode in array array['each_pays_own_spot', 'each_pays_responsible'] loop
    v_booking := tests.booking_with_players(v_booker, v_venue, v_mode, 0, tests.cyprus_today() + 3,
                                            case v_mode when 'each_pays_own_spot' then '12:00' else '14:00' end::time,
                                            case v_mode when 'each_pays_own_spot' then '13:00' else '15:00' end::time,
                                            'card-premium');
    perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_card_' || v_mode, interval '2 hours');
    v_share := tests.join_booking(v_booking.id, v_premium);

    -- A Premium cash player pays nothing by card (no fee, pitch part in cash).
    v_plan := public.plan_share_payment(v_share.id, v_premium, 'cash', false);
    assert v_plan @> jsonb_build_object('amount_cents', 0, 'cash_cents', 600, 'fee_cents', 0, 'needs_saved_card', true),
      format('%s: a card is saved instead, got %s', v_mode, v_plan);

    perform public.attach_share_setup(v_share.id, v_premium, 'cash', 'seti_' || v_mode, null);
    v_saved := public.share_card_saved(v_share.id, 'seti_' || v_mode, 'pm_premium_' || v_mode, now());
    assert v_saved ->> 'result' = 'saved', format('%s: saved, got %s', v_mode, v_saved);
    v_share := tests.share_of(v_booking.id, v_premium);
    assert v_share.status = 'paid' and v_share.stripe_payment_method_id = 'pm_premium_' || v_mode
           and v_share.payment_method = 'cash' and v_share.cash_cents = 600,
      format('%s: holds their spot with a saved card, got %s', v_mode, row_to_json(v_share));
  end loop;
end $$;

-- A player whose spot the booker paid for (pay for everyone) has nothing
-- to pay or save.
do $$
declare
  v_booker uuid := tests.create_user('card-payall-booker@futty.test');
  v_player uuid := tests.create_user('card-payall-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3, p_label => 'card-payall');
  v_share := tests.join_booking(v_booking.id, v_player);
  assert v_share.status = 'covered', 'covered by the booker';
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false) $q$, v_share.id, v_player))
         = 'share_not_pending', 'nothing to pay';
end $$;

rollback;
