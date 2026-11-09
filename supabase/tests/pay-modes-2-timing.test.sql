-- When money is held and taken (docs/specs/13-payments-bookings.md):
--   every share is held (manual capture) when paid, and taken 60 minutes
--   after it was held, not before;
--   a share paid less than 6 hours before kickoff is taken at once and only
--   after the player accepts "This booking is non-refundable" (the time is
--   stored on the share). Decided 9 November: this is per share, so it also
--   applies to a player paying late on a booking made days earlier.
begin;

-- Held when paid; due for capture at 60 minutes, not before.
do $$
declare
  v_booker uuid := tests.create_user('timing-hold-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_prepared jsonb;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_booker);

  perform tests.act_as_service_role();
  v_prepared := public.prepare_share_payment(v_share.id, v_booker, 'card', false);
  assert v_prepared ->> 'capture_method' = 'manual', 'more than 6 hours ahead: held, captured later';
  assert (v_prepared ->> 'non_refundable')::boolean = false, 'and not non-refundable';
  perform public.set_share_payment_intent(v_share.id, 'pi_timing_hold');

  -- The webhook: Stripe says the card is held.
  v_result := public.share_payment_held('pi_timing_hold', 680, 'pm_timing');
  perform tests.act_as_postgres();
  assert v_result ->> 'result' = 'held', format('held, got %s', v_result);
  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.status = 'authorized', 'the share is held';
  assert v_share.capture_due_at = v_share.held_at + interval '60 minutes', 'taken 60 minutes after it was held';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed',
    'the booker''s hold confirms the booking';
  assert (select (kind, amount_cents, stripe_id) = ('hold', 680, 'pi_timing_hold')
          from public.money_ledger where share_id = v_share.id),
    'the hold is in the ledger';

  -- A repeat delivery changes nothing.
  perform tests.act_as_service_role();
  assert public.share_payment_held('pi_timing_hold', 680, 'pm_timing') ->> 'result' = 'duplicate', 'repeat is a no-op';
  -- An amount that isn't the share's is refused.
  assert tests.error_of($q$ select public.share_payment_held('pi_timing_hold', 1, 'pm_timing') $q$) = 'amount_mismatch',
    'the held amount must be the share';
  perform tests.act_as_postgres();
  assert (select count(*) from public.money_ledger where share_id = v_share.id) = 1, 'one ledger row';

  -- 59 minutes after the hold: not yet.
  update public.booking_payment_shares
  set held_at = now() - interval '59 minutes', capture_due_at = public.money_capture_due_at(now() - interval '59 minutes')
  where id = v_share.id;
  perform tests.act_as_service_role();
  assert not exists (select 1 from public.shares_due_for_capture() where share_id = v_share.id), 'not before 60 minutes';
  perform tests.act_as_postgres();

  -- 60 minutes: due.
  update public.booking_payment_shares
  set held_at = now() - interval '60 minutes', capture_due_at = public.money_capture_due_at(now() - interval '60 minutes')
  where id = v_share.id;
  perform tests.act_as_service_role();
  assert (select (stripe_payment_intent_id, amount_cents) = ('pi_timing_hold', 680)
          from public.shares_due_for_capture() where share_id = v_share.id), 'due at 60 minutes';

  v_result := public.share_captured(v_share.id, 680);
  assert v_result ->> 'result' = 'captured', format('captured, got %s', v_result);
  assert public.share_captured(v_share.id, 680) ->> 'result' = 'duplicate', 'capturing twice records once';
  assert not exists (select 1 from public.shares_due_for_capture() where share_id = v_share.id), 'nothing left to take';
  perform tests.act_as_postgres();

  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.status = 'paid' and v_share.paid_at is not null, 'the share is taken';
  assert (select count(*) from public.money_ledger where share_id = v_share.id and kind = 'capture' and amount_cents = 680) = 1,
    'one capture in the ledger';
end $$;

-- A booking made 5 hours before kickoff: refused without the
-- acknowledgement; with it, captured at once.
do $$
declare
  v_booker uuid := tests.create_user('timing-late-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_slot record := tests.slot_starting_in(interval '5 hours');
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_prepared jsonb;
  v_result jsonb;
begin
  -- A 30-minute slot at 12000 an hour = 6000.
  perform tests.set_price(v_venue, '5-a-side', 12000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_slot.day, v_slot.start_time, v_slot.end_time, 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.amount_cents = 680, 'still 680';

  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.prepare_share_payment(%L, %L, 'card', false) $q$, v_share.id, v_booker))
         = 'non_refundable_not_accepted', 'refused without the acknowledgement';
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_booker)).non_refundable_accepted_at is null, 'nothing stored when refused';

  perform tests.act_as_service_role();
  v_prepared := public.prepare_share_payment(v_share.id, v_booker, 'card', true);
  perform tests.act_as_postgres();
  assert v_prepared ->> 'capture_method' = 'immediate', format('captured at once, got %s', v_prepared);
  assert (v_prepared ->> 'non_refundable')::boolean, 'non-refundable';
  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.non_refundable_accepted_at is not null, 'the acceptance time is stored on the share';

  -- Stripe takes it at once: the webhook gets payment_intent.succeeded.
  perform tests.act_as_service_role();
  perform public.set_share_payment_intent(v_share.id, 'pi_timing_late');
  v_result := public.share_payment_captured('pi_timing_late', 680, 'pm_late');
  perform tests.act_as_postgres();
  assert v_result ->> 'result' = 'captured', format('captured, got %s', v_result);
  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.status = 'paid' and v_share.held_at is null, 'taken without a hold';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'booking confirmed';
  assert (select (kind, amount_cents) = ('capture', 680) from public.money_ledger where share_id = v_share.id),
    'one capture in the ledger, no hold';
end $$;

-- Per share: a player paying 5 hours before kickoff on a booking made days
-- earlier is also captured at once and needs the acknowledgement.
do $$
declare
  v_booker uuid := tests.create_user('timing-share-booker@futty.test');
  v_player uuid := tests.create_user('timing-share-player@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_slot record := tests.slot_starting_in(interval '5 hours');
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 12000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, v_slot.day, v_slot.start_time, v_slot.end_time, 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  update public.venue_bookings set created_at = now() - interval '3 days' where id = v_booking.id;
  v_share := tests.join_booking(v_booking.id, v_player);

  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.prepare_share_payment(%L, %L, 'card', false) $q$, v_share.id, v_player))
         = 'non_refundable_not_accepted', 'a late share on an old booking needs the acknowledgement';
  assert public.prepare_share_payment(v_share.id, v_player, 'card', true) ->> 'capture_method' = 'immediate',
    'and is captured at once';
  perform tests.act_as_postgres();
end $$;

-- Exactly 6 hours or more before kickoff is not "less than 6 hours".
do $$
begin
  assert public.money_is_non_refundable(timestamptz '2026-12-01 10:00+02', timestamptz '2026-12-01 16:00+02') = false,
    'exactly 6 hours before: refundable rules apply';
  assert public.money_is_non_refundable(timestamptz '2026-12-01 10:01+02', timestamptz '2026-12-01 16:00+02'),
    '5 h 59 before: non-refundable';
  assert public.money_capture_due_at(timestamptz '2026-12-01 10:00+02') = timestamptz '2026-12-01 11:00+02',
    'capture 60 minutes after the hold';
end $$;

-- The old 3-hour auto-cancel is gone for new bookings; old bookings keep it.
do $$
declare
  v_booker uuid := tests.create_user('timing-autocancel@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2, p_open => '00:00', p_close => '24:00');
  v_slot record := tests.slot_starting_in(interval '2 hours');
  v_new public.venue_bookings;
  v_old uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 12000);
  perform tests.act_as(v_booker);
  v_new := public.book_slot(v_venue, v_slot.day, v_slot.start_time, v_slot.end_time, 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_new.id;

  -- A booking from before P4a: no mode, the old flat-fee shares.
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status,
                                     created_by, amount_cents, service_fee_cents_per_player)
  values (v_venue, v_slot.day, v_slot.start_time, v_slot.end_time, 1, 10, '5-a-side', 'confirmed',
          tests.create_user('timing-autocancel-old@futty.test'), 6000, 80)
  returning id into v_old;

  perform tests.act_as_service_role();
  assert not exists (select 1 from public.bookings_needing_share_cancellation() where booking_id = v_new.id),
    'an unpaid new booking is never auto-cancelled';
  assert exists (select 1 from public.bookings_needing_share_cancellation() where booking_id = v_old),
    'an old booking keeps the old logic';
  perform tests.act_as_postgres();
end $$;

rollback;
