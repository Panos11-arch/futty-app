-- P4b second re-review (decided 10 November; docs/specs/13-payments-bookings.md,
-- "Venue credit"; migration pay_cancellations_undo):
--   High    a hold undone on the booker's share puts the booking back to
--           pending_payment with a new 15-minute payment window from that
--           moment, and the booker is told to pay again. Not paid within
--           it, the normal expiry cancels the booking and frees the pitch.
--   Medium  the payment_intent.canceled webhook undoes the hold too, so a
--           job that cancelled at Stripe and died before the database call
--           doesn't leave the share "held" with no hold.
begin;

-- High, pay for everyone: the booker pays €45.50 by card + €20 credit, the
-- release job cancels the intent just as it was held. The booking goes back
-- to pending_payment with a new window; paying again inside it confirms it.
do $$
declare
  v_booker uuid := tests.create_user('undo-all-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_undone_at timestamptz;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_booker, v_venue, 2000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3, p_label => 'undo-all');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_undo_all', interval '0', 'card', true);
  assert (v_share.status, v_share.amount_cents, v_share.credit_cents) = ('authorized', 4550, 2000), 'held: 45.50 + 20.00 credit';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the hold confirmed it';
  -- The release job runs at least 15 minutes after the payment started, so
  -- the booking's own window is long over.
  update public.venue_bookings set created_at = now() - interval '30 minutes' where id = v_booking.id;

  perform tests.act_as_service_role();
  v_undone_at := now();
  assert public.release_share_credit_reservation(v_share.id, 'pi_undo_all', true), 'undone';
  perform tests.act_as_postgres();

  v_share := tests.share_of(v_booking.id, v_booker);
  assert (v_share.status, v_share.amount_cents, v_share.credit_cents) = ('pending', 6550, 0), 'unpaid again, priced without credit';
  assert public.venue_credit_available_cents(v_booker, v_venue) = 2000, 'the €20 credit is back';
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert (v_booking.status, v_booking.payment_window_started_at) = ('pending_payment', v_undone_at),
    format('back to pending_payment, window from now; got %s', row_to_json(v_booking));
  assert public.booking_payment_window_ends_at(v_booking) = v_undone_at + interval '15 minutes', '15 minutes from the undo';
  assert exists (select 1 from public.notifications where profile_id = v_booker and type = 'match_payment_due'
                 and body like '%within 15 minutes%'), 'the booker is told to pay again within 15 minutes';
  assert exists (select 1 from public.booking_pitches where booking_id = v_booking.id), 'the pitch is still held for them';

  perform tests.act_as_service_role();
  assert not exists (select 1 from public.bookings_past_payment_window() where booking_id = v_booking.id),
    'inside the new window: not expired';
  assert not public.expire_unpaid_booking(v_booking.id), 'nothing to expire yet';
  perform tests.act_as_postgres();

  -- Pays again inside the new window (by card this time): confirmed.
  v_share := tests.pay_ago(v_share.id, 'pi_undo_all_2');
  assert (v_share.status, v_share.amount_cents) = ('authorized', 6550), 'paid again';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'confirmed again';
end $$;

-- High, pay for everyone, not paid again: once the new window is over the
-- normal expiry cancels the booking and frees the pitch.
do $$
declare
  v_booker uuid := tests.create_user('undo-exp-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_booker, v_venue, 2000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3, p_label => 'undo-exp');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_undo_exp', interval '0', 'card', true);
  update public.venue_bookings set created_at = now() - interval '30 minutes' where id = v_booking.id;
  perform tests.act_as_service_role();
  perform public.release_share_credit_reservation(v_share.id, 'pi_undo_exp', true);
  perform tests.act_as_postgres();

  -- 16 minutes after the undo.
  update public.venue_bookings set payment_window_started_at = now() - interval '16 minutes' where id = v_booking.id;
  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false) $q$, v_share.id, v_booker))
         = 'payment_window_closed', 'too late to start paying';
  assert exists (select 1 from public.bookings_past_payment_window() where booking_id = v_booking.id), 'the job finds it';
  -- A hold that lands after the new window is refused, as for any booker.
  v_result := public.share_payment_held(v_share.id, 'pi_undo_exp', 6550, 'pm_late', now());
  assert v_result ->> 'result' = 'expired', format('a late payment expires it, got %s', v_result);
  assert not public.expire_unpaid_booking(v_booking.id), 'once';
  perform tests.act_as_postgres();

  assert (select status from public.venue_bookings where id = v_booking.id) = 'cancelled', 'cancelled';
  assert not exists (select 1 from public.booking_pitches where booking_id = v_booking.id), 'the pitch is released';
  assert exists (select 1 from public.booking_money_to_release(v_booking.id) where kind = 'share' and id = v_share.id),
    'the share and its intent are left for the normal release, which closes them';
  assert public.venue_credit_available_cents(v_booker, v_venue) = 2000, 'the credit stays with the booker';
end $$;

-- High, responsible mode: the booker's own share is undone (another player
-- has paid meanwhile). Back to pending_payment with a new window; not paid
-- again, the normal expiry cancels the booking, frees the pitch and leaves
-- the other player's money to be released.
do $$
declare
  v_booker uuid := tests.create_user('undo-resp-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_other public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_booker, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 1, tests.cyprus_today() + 3,
                                          p_label => 'undo-resp');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_undo_resp', interval '0', 'card', true);
  assert v_share.status = 'authorized' and v_share.credit_cents = 500, 'the booker''s share held, 500 credit';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'confirmed';
  v_other := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_undo_resp_other');
  update public.venue_bookings set created_at = now() - interval '30 minutes' where id = v_booking.id;

  perform tests.act_as_service_role();
  assert public.release_share_credit_reservation(v_share.id, 'pi_undo_resp', true), 'undone';
  perform tests.act_as_postgres();
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert v_booking.status = 'pending_payment' and v_booking.payment_window_started_at is not null,
    'back to pending_payment with a new window';
  assert (tests.share_of(v_booking.id, v_booker)).status = 'pending', 'the booker''s share is unpaid';
  assert (tests.share_of(v_booking.id, v_other.profile_id)).status = 'authorized', 'the other player''s share is untouched';
  assert exists (select 1 from public.notifications where profile_id = v_booker and type = 'match_payment_due'
                 and body like '%within 15 minutes%'), 'the booker is told';

  update public.venue_bookings set payment_window_started_at = now() - interval '16 minutes' where id = v_booking.id;
  perform tests.act_as_service_role();
  assert exists (select 1 from public.bookings_past_payment_window() where booking_id = v_booking.id), 'the job finds it';
  assert public.expire_unpaid_booking(v_booking.id), 'expired';
  perform tests.act_as_postgres();
  assert (select status from public.venue_bookings where id = v_booking.id) = 'cancelled', 'cancelled';
  assert not exists (select 1 from public.booking_pitches where booking_id = v_booking.id), 'the pitch is released';
  assert exists (select 1 from public.booking_money_to_release(v_booking.id) where kind = 'share' and id = v_other.id),
    'the other player''s hold is left for the release';
end $$;

-- High: a player's share (not the booker's) undone leaves the booking as it is.
do $$
declare
  v_booker uuid := tests.create_user('undo-player-booker@futty.test');
  v_player uuid := tests.create_user('undo-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'undo-player');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_undo_player_b');
  v_share := tests.join_booking(v_booking.id, v_player);
  v_share := tests.pay_ago(v_share.id, 'pi_undo_player', interval '0', 'card', true);
  perform tests.act_as_service_role();
  assert public.release_share_credit_reservation(v_share.id, 'pi_undo_player', true), 'undone';
  perform tests.act_as_postgres();
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert v_booking.status = 'confirmed' and v_booking.payment_window_started_at is null, 'the booking stands';
end $$;

-- Medium: the job cancelled the intent at Stripe and died before the
-- database call. The share is still "held" and the job no longer looks at
-- it; Stripe's payment_intent.canceled webhook (p_hold_released) undoes it:
-- unpaid again, its credit back.
do $$
declare
  v_booker uuid := tests.create_user('undo-wh-booker@futty.test');
  v_player uuid := tests.create_user('undo-wh-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'undo-wh');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_undo_wh_b');
  v_share := tests.join_booking(v_booking.id, v_player);
  v_share := tests.pay_ago(v_share.id, 'pi_undo_wh', interval '0', 'card', true);
  assert v_share.status = 'authorized', 'held';
  update public.venue_credit_spends set created_at = now() - interval '20 minutes' where share_id = v_share.id;

  perform tests.act_as_service_role();
  assert not exists (select 1 from public.credit_reservations_to_release() where share_id = v_share.id),
    'the job no longer finds it once it is held';
  -- The webhook, as stripe-webhook/modes.ts sends it.
  assert public.release_share_credit_reservation(v_share.id, 'pi_undo_wh', true), 'the webhook undoes it';
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_player);
  assert (v_share.status, v_share.credit_cents, v_share.amount_cents) = ('pending', 0, 680), 'unpaid again';
  assert public.venue_credit_available_cents(v_player, v_venue) = 500, 'the credit is back';
  assert exists (select 1 from public.money_ledger where stripe_id = 'pi_undo_wh' and kind = 'cancel'), 'the release recorded';

  -- The same event again (Stripe retries): nothing more.
  perform tests.act_as_service_role();
  assert not public.release_share_credit_reservation(v_share.id, 'pi_undo_wh', true), 'once';
  perform tests.act_as_postgres();
end $$;

-- Medium: the webhook for an intent cancelled any other way leaves a share
-- that isn't held alone: a free-hour cancellation's release, and a share
-- paid by card only.
do $$
declare
  v_booker uuid := tests.create_user('undo-wh2-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_cancelled public.booking_payment_shares;
  v_card public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'undo-wh2');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_undo_wh2_b', interval '2 hours');
  v_cancelled := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_undo_wh2_c');
  v_card := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_undo_wh2_d');
  perform tests.cancel(v_booking.id, 'my_spot', v_cancelled.profile_id);

  perform tests.act_as_service_role();
  assert not public.release_share_credit_reservation(v_cancelled.id, 'pi_undo_wh2_c', true), 'a cancelled share: nothing';
  assert not public.release_share_credit_reservation(v_card.id, 'pi_undo_wh2_d', true), 'no credit on it: left to the old handling';
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_cancelled.profile_id)).status = 'cancelled', 'still cancelled';
  assert (tests.share_of(v_booking.id, v_card.profile_id)).status = 'authorized', 'untouched';
end $$;

select 'pay cancellations 13 (undo: booker window, webhook) passed' as result;
rollback;
