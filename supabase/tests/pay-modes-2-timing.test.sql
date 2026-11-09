-- When money is held and taken (docs/specs/13-payments-bookings.md):
--   every share is held (manual capture) when paid, and taken when its free
--   hour ends: 60 minutes after it was held, or 6 hours before kickoff if
--   that's sooner (decided 9 November), not before;
--   a share paid less than 6 hours before kickoff is taken at once and only
--   after the player accepts "This booking is non-refundable" (the time is
--   stored on the share). Per share (decided 9 November), and decided when
--   the player confirms payment, not when the payment was started.
begin;

-- Held when paid; due for capture at 60 minutes, not before.
do $$
declare
  v_booker uuid := tests.create_user('timing-hold-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_plan jsonb;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  v_share := tests.share_of(v_booking.id, v_booker);

  perform tests.act_as_service_role();
  v_plan := public.plan_share_payment(v_share.id, v_booker, 'card', false);
  assert v_plan ->> 'capture_method' = 'manual', 'more than 6 hours ahead: held, captured later';
  assert (v_plan ->> 'non_refundable')::boolean = false, 'and not non-refundable';
  perform tests.act_as_postgres();
  perform tests.pay_share(v_share.id, 'pi_timing_hold');

  -- The webhook: Stripe says the card is held.
  perform tests.act_as_service_role();
  v_result := public.share_payment_held(v_share.id, 'pi_timing_hold', 680, 'pm_timing', now());
  perform tests.act_as_postgres();
  assert v_result ->> 'result' = 'held', format('held, got %s', v_result);
  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.status = 'authorized', 'the share is held';
  assert v_share.stripe_payment_method_id = 'pm_timing', 'the card is saved on the share';
  assert v_share.capture_due_at = v_share.held_at + interval '60 minutes', 'taken 60 minutes after it was held';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed',
    'the booker''s hold and saved card confirm the booking';
  assert (select (kind, amount_cents, stripe_id, venue_cents, futty_cents, stripe_fee_cents) = ('hold', 680, 'pi_timing_hold', 0, 0, 0)
          from public.money_ledger where share_id = v_share.id),
    'the hold is in the ledger, moving no money';

  -- A repeat delivery changes nothing.
  perform tests.act_as_service_role();
  assert public.share_payment_held(v_share.id, 'pi_timing_hold', 680, 'pm_timing', now()) ->> 'result' = 'duplicate',
    'repeat is a no-op';
  perform tests.act_as_postgres();
  assert (select count(*) from public.money_ledger where share_id = v_share.id) = 1, 'one ledger row';

  -- 59 minutes after the hold: not yet.
  update public.booking_payment_shares
  set held_at = now() - interval '59 minutes',
      capture_due_at = public.money_capture_due_at(now() - interval '59 minutes', tests.kickoff_of(v_booking.id))
  where id = v_share.id;
  perform tests.act_as_service_role();
  assert not exists (select 1 from public.shares_due_for_capture() where share_id = v_share.id), 'not before 60 minutes';
  perform tests.act_as_postgres();

  -- 60 minutes: due.
  update public.booking_payment_shares
  set held_at = now() - interval '60 minutes',
      capture_due_at = public.money_capture_due_at(now() - interval '60 minutes', tests.kickoff_of(v_booking.id))
  where id = v_share.id;
  perform tests.act_as_service_role();
  assert (select (stripe_payment_intent_id, amount_cents) = ('pi_timing_hold', 680)
          from public.shares_due_for_capture() where share_id = v_share.id), 'due at 60 minutes';

  -- Stripe's actual fee on 6.80 is 35 cents: the venue gets 600, Futty 45.
  v_result := public.share_captured(v_share.id, 680, 35);
  assert v_result ->> 'result' = 'captured', format('captured, got %s', v_result);
  assert public.share_captured(v_share.id, 680, 35) ->> 'result' = 'duplicate', 'capturing twice records once';
  assert not exists (select 1 from public.shares_due_for_capture() where share_id = v_share.id), 'nothing left to take';
  perform tests.act_as_postgres();

  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.status = 'paid' and v_share.paid_at is not null, 'the share is taken';
  assert (select (amount_cents, venue_cents, futty_cents, stripe_fee_cents) = (680, 600, 45, 35)
          from public.money_ledger where share_id = v_share.id and kind = 'capture'),
    'one capture in the ledger: 600 venue, 45 Futty, 35 Stripe';
  assert (select balanced and taken_cents = 680 from public.money_balance(v_booking.id)), 'the books balance';
end $$;

-- The free hour ends 6 hours before kickoff when that's sooner (decided 9
-- November): a share held 6 h 30 before kickoff is taken 30 minutes later.
do $$
begin
  assert public.money_capture_due_at(timestamptz '2026-12-01 10:00+02', timestamptz '2026-12-03 10:00+02')
         = timestamptz '2026-12-01 11:00+02', 'far from kickoff: 60 minutes after the hold';
  assert public.money_capture_due_at(timestamptz '2026-12-01 09:30+02', timestamptz '2026-12-01 16:00+02')
         = timestamptz '2026-12-01 10:00+02', '6 h 30 before kickoff: taken at the 6-hour line';
  assert public.money_capture_due_at(timestamptz '2026-12-01 11:00+02', timestamptz '2026-12-01 16:00+02')
         <= timestamptz '2026-12-01 11:00+02', 'under 6 hours: due at once';
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
  v_plan jsonb;
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
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false) $q$, v_share.id, v_booker))
         = 'non_refundable_not_accepted', 'refused without the acknowledgement';
  assert tests.error_of(format($q$ select public.attach_share_intent(%L, %L, 'card', false, 'pi_x', 680, 'immediate', null) $q$,
                               v_share.id, v_booker)) = 'non_refundable_not_accepted', 'attaching is refused too';
  perform tests.act_as_postgres();
  assert (tests.share_of(v_booking.id, v_booker)).non_refundable_accepted_at is null, 'nothing stored when refused';

  v_plan := tests.pay_share(v_share.id, 'pi_timing_late', 'card', true);
  assert v_plan ->> 'capture_method' = 'immediate', format('captured at once, got %s', v_plan);
  assert (v_plan ->> 'non_refundable')::boolean, 'non-refundable';
  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.non_refundable_accepted_at is not null, 'the acceptance time is stored on the share';

  -- Stripe takes it at once: the webhook gets payment_intent.succeeded.
  perform tests.act_as_service_role();
  v_result := public.share_payment_captured(v_share.id, 'pi_timing_late', 680, 'pm_late', 80, 35, now());
  perform tests.act_as_postgres();
  assert v_result ->> 'result' = 'captured', format('captured, got %s', v_result);
  v_share := tests.share_of(v_booking.id, v_booker);
  assert v_share.status = 'paid' and v_share.held_at is null, 'taken without a hold';
  assert (select status from public.venue_bookings where id = v_booking.id) = 'confirmed', 'booking confirmed';
  assert (select (kind, amount_cents, venue_cents) = ('capture', 680, 600) from public.money_ledger where share_id = v_share.id),
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
  update public.venue_bookings set created_at = now() - interval '3 days', status = 'confirmed' where id = v_booking.id;
  v_share := tests.join_booking(v_booking.id, v_player);

  perform tests.act_as_service_role();
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', false) $q$, v_share.id, v_player))
         = 'non_refundable_not_accepted', 'a late share on an old booking needs the acknowledgement';
  assert public.plan_share_payment(v_share.id, v_player, 'card', true) ->> 'capture_method' = 'immediate',
    'and is captured at once';
  perform tests.act_as_postgres();
end $$;

-- RACE: the payment is started 6 h 05 before kickoff (held, refundable, no
-- notice), and the player confirms it at 5 h 58. The decision is made at
-- confirmation: without the notice the hold is refused and released, the
-- share stays unpaid; with it, the hold is taken at once.
do $$
declare
  v_booker uuid := tests.create_user('timing-race-booker@futty.test');
  v_player uuid := tests.create_user('timing-race-player@futty.test');
  v_late uuid := tests.create_user('timing-race-accepted@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_plan jsonb;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed', created_at = now() - interval '2 days' where id = v_booking.id;

  -- 6 h 05 before kickoff: the plan is a manual hold, no notice needed.
  perform tests.set_kickoff(v_booking.id, now() + interval '6 hours 5 minutes');
  v_share := tests.join_booking(v_booking.id, v_player);
  v_plan := tests.pay_share(v_share.id, 'pi_race_605');
  assert (v_plan ->> 'capture_method', (v_plan ->> 'non_refundable')::boolean) = ('manual', false),
    format('6 h 05 before: refundable, held, got %s', v_plan);

  -- 7 minutes later the player confirms: 5 h 58 before kickoff (the test
  -- moves kickoff instead of the clock).
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours 58 minutes');
  perform tests.act_as_service_role();
  v_result := public.share_payment_held(v_share.id, 'pi_race_605', 680, 'pm_race', now());
  perform tests.act_as_postgres();
  assert (v_result ->> 'result', v_result ->> 'reason') = ('release', 'non_refundable_not_accepted'),
    format('confirmed under 6 hours without the notice: refused, got %s', v_result);
  v_share := tests.share_of(v_booking.id, v_player);
  assert v_share.status = 'pending', 'the share stays unpaid';
  assert exists (select 1 from public.notifications where profile_id = v_player and type = 'match_payment_due'),
    'the player is asked to pay again and accept the notice';

  -- A player who accepted the notice when starting at 6 h 05 and confirms at
  -- 5 h 58: held and due at once.
  perform tests.set_kickoff(v_booking.id, now() + interval '6 hours 5 minutes');
  v_share := tests.join_booking(v_booking.id, v_late);
  v_plan := tests.pay_share(v_share.id, 'pi_race_accepted', 'card', true);
  assert v_plan ->> 'capture_method' = 'manual', 'started 6 h 05 before: a hold';
  perform tests.set_kickoff(v_booking.id, now() + interval '5 hours 58 minutes');
  perform tests.act_as_service_role();
  v_result := public.share_payment_held(v_share.id, 'pi_race_accepted', 680, 'pm_race2', now());
  assert v_result ->> 'result' = 'held', format('held, got %s', v_result);
  assert exists (select 1 from public.shares_due_for_capture() where share_id = v_share.id),
    'confirmed under 6 hours: taken at once (the free hour is already over)';
  perform tests.act_as_postgres();
end $$;

-- Exactly 6 hours or more before kickoff is not "less than 6 hours".
do $$
begin
  assert public.money_is_non_refundable(timestamptz '2026-12-01 10:00+02', timestamptz '2026-12-01 16:00+02') = false,
    'exactly 6 hours before: refundable rules apply';
  assert public.money_is_non_refundable(timestamptz '2026-12-01 10:01+02', timestamptz '2026-12-01 16:00+02'),
    '5 h 59 before: non-refundable';
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
    'an unpaid new booking is never auto-cancelled by the old job';
  assert exists (select 1 from public.bookings_needing_share_cancellation() where booking_id = v_old),
    'an old booking keeps the old logic';
  perform tests.act_as_postgres();
end $$;

rollback;
