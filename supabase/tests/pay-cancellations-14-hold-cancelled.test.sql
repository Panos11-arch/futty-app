-- P4b last fixes (decided 10 November; docs/specs/13-payments-bookings.md,
-- "Venue credit"; migration pay_cancellations_hold_cancelled):
--   - Only the release job (payment not finished within 15 minutes) can
--     reopen a booking. It marks the intent it's cancelling first
--     (credit_release_started). Any other cancellation of a held payment
--     (a hold expiring after 7 days, a cancel in the Stripe dashboard)
--     never reopens or cancels a confirmed booking: the money for that
--     share is released or returned, the booking stays as it is, and the
--     founders get an admin alert. Card, credit or both alike.
--   - Nobody is asked to pay again on a booking that's already cancelled.
begin;

-- A hold cancelled outside the release job, paid by card only: the booker
-- paying for everyone. The booking stays confirmed; the founders are told.
do $$
declare
  v_booker uuid := tests.create_user('hc-card-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_alert public.admin_alerts;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3, p_label => 'hc-card');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_hc_card');
  assert (v_share.status, v_share.amount_cents, v_share.credit_cents) = ('authorized', 6550, 0), 'held by card';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'confirmed';

  -- Stripe's payment_intent.canceled (the hold expired after 7 days).
  perform tests.act_as_service_role();
  assert public.release_share_credit_reservation(v_share.id, 'pi_hc_card', true), 'handled';
  perform tests.act_as_postgres();

  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert v_booking.status = 'confirmed' and v_booking.payment_window_started_at is null,
    format('the booking stays as it is; got %s', row_to_json(v_booking));
  v_share := tests.share_of(v_booking.id, v_booker);
  assert (v_share.status, v_share.held_at is null, v_share.amount_cents) = ('pending', true, 6550), 'the share is unpaid';
  assert exists (select 1 from public.money_ledger where stripe_id = 'pi_hc_card' and kind = 'cancel'), 'the release is recorded';
  select * into v_alert from public.admin_alerts where kind = 'hold_cancelled' and share_id = v_share.id;
  assert v_alert.id is not null and v_alert.booking_id = v_booking.id
         and v_alert.details @> '{"intent_id": "pi_hc_card", "amount_cents": 6550, "credit_cents": 0, "is_booker": true}',
    format('the founders are alerted; got %s', row_to_json(v_alert));
  assert not exists (select 1 from public.notifications where profile_id = v_booker and body like '%15 minutes%'),
    'no new payment window';
  -- Before kickoff the player is asked to pay again; the notification opens
  -- the payment screen for this booking.
  assert (select (count(*), min(body), min(data ->> 'bookingId'))
          from public.notifications where profile_id = v_booker and type = 'match_payment_due')
         = (1::bigint,
            format('Your payment for %s, %s, 12:00 didn''t go through. Pay €65.50 to keep your spot.',
                   (select name from public.venues where id = v_venue), to_char(v_booking.booking_day, 'FMDay DD Mon')),
            v_booking.id::text),
    format('the booker is asked to pay again; got %s',
           (select json_agg(n) from public.notifications n where profile_id = v_booker));

  perform tests.act_as_service_role();
  assert not public.release_share_credit_reservation(v_share.id, 'pi_hc_card', true), 'Stripe retries the event: once';
  assert not exists (select 1 from public.bookings_past_payment_window() where booking_id = v_booking.id), 'never expired';
  assert not public.expire_unpaid_booking(v_booking.id), 'never cancelled';
  perform tests.act_as_postgres();
  assert (select count(*) from public.admin_alerts where share_id = v_share.id) = 1, 'one alert';
  assert exists (select 1 from public.booking_pitches where booking_id = v_booking.id), 'the pitch stays booked';
end $$;

-- The same for a player who paid with credit and card (500 + 180), held:
-- the credit comes back, the booking stays confirmed, the founders are told.
do $$
declare
  v_booker uuid := tests.create_user('hc-credit-booker@futty.test');
  v_player uuid := tests.create_user('hc-credit-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_old uuid;
  v_old_expiry timestamptz;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_old := tests.give_credit(v_player, v_venue, 500, interval '10 months');
  select expires_at into v_old_expiry from public.venue_credits where id = v_old;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'hc-credit');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_hc_credit_b');
  v_share := tests.join_booking(v_booking.id, v_player);
  v_share := tests.pay_ago(v_share.id, 'pi_hc_credit', interval '0', 'card', true);
  assert (v_share.status, v_share.amount_cents, v_share.credit_cents) = ('authorized', 180, 500), 'held: 180 + 500 credit';

  -- Cancelled in the Stripe dashboard.
  perform tests.act_as_service_role();
  assert public.release_share_credit_reservation(v_share.id, 'pi_hc_credit', true), 'handled';
  perform tests.act_as_postgres();

  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the booking stays confirmed';
  v_share := tests.share_of(v_booking.id, v_player);
  assert (v_share.status, v_share.credit_cents, v_share.amount_cents) = ('pending', 0, 680), 'unpaid, priced without credit';
  assert (select (remaining_cents, expires_at) from public.venue_credits where id = v_old) = (500, v_old_expiry),
    'the 500 credit is back with its expiry';
  assert exists (select 1 from public.money_ledger where share_id = v_share.id and kind = 'credit_returned'), 'recorded';
  assert exists (select 1 from public.admin_alerts where kind = 'hold_cancelled' and share_id = v_share.id
                 and details @> '{"credit_cents": 500, "is_booker": false}'), 'the founders are alerted';
  assert exists (select 1 from public.notifications where profile_id = v_player and type = 'match_payment_due'
                 and body like '%didn''t go through. Pay €6.80 to keep your spot.'),
    'the player is asked to pay the full 680 by card, the credit no longer used';
end $$;

-- After kickoff the player isn't asked to pay again: collection handles
-- it. The money is still released, the booking stays, the founders are told.
do $$
declare
  v_booker uuid := tests.create_user('hc-late-booker@futty.test');
  v_player uuid := tests.create_user('hc-late-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'hc-late');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_hc_late_b');
  v_share := tests.pay_ago((tests.join_booking(v_booking.id, v_player)).id, 'pi_hc_late');
  perform tests.set_kickoff(v_booking.id, now() - interval '10 minutes');

  perform tests.act_as_service_role();
  assert public.release_share_credit_reservation(v_share.id, 'pi_hc_late', true), 'handled';
  perform tests.act_as_postgres();

  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'the booking stays';
  assert (tests.share_of(v_booking.id, v_player)).status = 'pending', 'unpaid, for collection';
  assert exists (select 1 from public.admin_alerts where kind = 'hold_cancelled' and share_id = v_share.id), 'alerted';
  assert not exists (select 1 from public.notifications where profile_id = v_player and type = 'match_payment_due'),
    'no notification after kickoff';
end $$;

-- A booker's credit hold cancelled outside the release job: no reopening
-- either (only the job's own cancel reopens; pay-cancellations-13 has it).
do $$
declare
  v_booker uuid := tests.create_user('hc-bcredit-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_booker, v_venue, 2000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3, p_label => 'hc-bcredit');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_hc_bcredit', interval '0', 'card', true);
  -- The release job marked a different, earlier intent of this share.
  update public.booking_payment_shares set release_job_intent_id = 'pi_hc_bcredit_old' where id = v_share.id;
  perform tests.act_as_service_role();
  assert public.release_share_credit_reservation(v_share.id, 'pi_hc_bcredit', true), 'handled';
  perform tests.act_as_postgres();
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert v_booking.status = 'confirmed' and v_booking.payment_window_started_at is null, 'not reopened';
  assert public.venue_credit_available_cents(v_booker, v_venue) = 2000, 'the €20 credit is back';
  assert exists (select 1 from public.admin_alerts where kind = 'hold_cancelled' and share_id = v_share.id), 'alerted';
end $$;

-- The release job's mark: only for the share's current payment.
do $$
declare
  v_booker uuid := tests.create_user('hc-mark-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 0, tests.cyprus_today() + 3, p_label => 'hc-mark');
  v_share := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_hc_mark');
  perform tests.act_as_service_role();
  assert not public.credit_release_started(v_share.id, 'pi_other'), 'not the share''s payment';
  assert public.credit_release_started(v_share.id, 'pi_hc_mark'), 'marked';
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_booker)).release_job_intent_id = 'pi_hc_mark', 'recorded on the share';
end $$;

-- Nobody is asked to pay again on a cancelled booking. Here the booking was
-- cancelled and its money is being released: Stripe's cancel event for a
-- held share (marked by the job or not) arrives before the release step
-- closes the share. Nothing happens here: no "Pay again", no alert; the
-- release step closes the share and its credit comes back.
do $$
declare
  v_owner uuid := tests.create_user('hc-cx-owner@futty.test');
  v_booker uuid := tests.create_user('hc-cx-booker@futty.test');
  v_a uuid := tests.create_user('hc-cx-a@futty.test');
  v_b uuid := tests.create_user('hc-cx-b@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_sa public.booking_payment_shares;
  v_sb public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.give_credit(v_a, v_venue, 500);
  perform tests.give_credit(v_b, v_venue, 500);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                          p_label => 'hc-cx');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_hc_cx_b');
  v_sa := tests.pay_ago((tests.join_booking(v_booking.id, v_a)).id, 'pi_hc_cx_a', interval '0', 'card', true);
  v_sb := tests.pay_ago((tests.join_booking(v_booking.id, v_b)).id, 'pi_hc_cx_bb', interval '0', 'card', true);
  update public.booking_payment_shares set release_job_intent_id = 'pi_hc_cx_bb' where id = v_sb.id;
  -- Cancelled while both are held (as when a booking expires and its
  -- money is released).
  update public.venue_bookings set status = 'cancelled' where id = v_booking.id;

  perform tests.act_as_service_role();
  assert not public.release_share_credit_reservation(v_sa.id, 'pi_hc_cx_a', true), 'not the job''s: nothing';
  assert not public.release_share_credit_reservation(v_sb.id, 'pi_hc_cx_bb', true), 'the job''s: nothing either';
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.notifications where profile_id in (v_a, v_b) and type = 'match_payment_due'),
    'nobody is asked to pay again';
  assert not exists (select 1 from public.admin_alerts where share_id in (v_sa.id, v_sb.id)), 'no alert';
  assert (tests.share_of(v_booking.id, v_a)).status = 'authorized', 'left for the release step';

  -- The release step finishes: the share is closed and its credit is back.
  perform tests.act_as_service_role();
  perform public.money_release_done(v_booking.id, v_sa.id, null, 'pi_hc_cx_a', 'cancelled');
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_a)).status = 'cancelled', 'closed';
  assert public.venue_credit_available_cents(v_a, v_venue) = 500, 'the credit is back';
end $$;

-- One lock order, booking then share, wherever the hold webhooks and the
-- undo touch the same rows: the first row each of them locks is the
-- booking, so two of them can never wait on each other.
do $$
declare
  v_fn text;
  v_def text;
  v_first text;
begin
  foreach v_fn in array array[
    'public.share_payment_held(uuid, text, integer, text, timestamptz)',
    'public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz)',
    'public.share_card_saved(uuid, text, text, timestamptz)',
    'public.release_share_credit_reservation(uuid, text, boolean)',
    'public.credit_release_started(uuid, text)'
  ] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    -- The statement that takes the first row lock.
    v_first := split_part(v_def, 'for update', 1);
    v_first := reverse(split_part(reverse(v_first), ';', 1));
    assert v_first ~ 'from public\.venue_bookings\s',
      format('%s locks the booking first; its first lock is: %s', v_fn, v_first);
  end loop;
end $$;

select 'pay cancellations 14 (held payment cancelled elsewhere) passed' as result;
rollback;
