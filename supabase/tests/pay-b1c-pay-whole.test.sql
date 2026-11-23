-- B1c, part 2b (Booking v2, spec 13 "Invites, after payment"): "Pay the
-- whole pitch and play". With no side B 24 hours before kickoff, the captain
-- pays the other half in the app (Stripe's payment sheet, decided 23
-- November): one payment, the other half plus that half's players at his
-- fee (examples 6a and 6b). Only the verified webhook (other_half_paid)
-- makes it count: it's recorded in the ledger, the choice is made, and the
-- other half's spots are his (covered: his players join for nothing).
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.b1c3_setup(p_mode text default 'pay_all', out venue uuid, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
begin
  booker := tests.create_user('b1c3-booker-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.act_as(booker);
  v := public.book_slot(venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => 'half');
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((select id from public.booking_payment_shares where booking_id = booking and profile_id = booker),
                           'pi_b1c3_a_' || gen_random_uuid());
  perform tests.set_kickoff(booking, now() + interval '23 hours');
  perform public.booking_no_opponent_due();
end;
$$;

create function tests.b1c3_username(p_profile uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.profiles set username = coalesce(username, 'b1c3' || replace(left(p_profile::text, 13), '-', ''))
  where id = p_profile returning username;
$$;

-- 1. The plan: €22.75 paying for everyone (6a), €24.00 paying for myself (6b),
--    from the server; only the lone captain, only once due, before the cut-off.
do $$
declare
  s record := tests.b1c3_setup();
  e record := tests.b1c3_setup('each_pays_responsible');
  v jsonb;
begin
  v := public.plan_other_half_payment(s.booking, s.booker);
  assert (v ->> 'amount_cents', v ->> 'fee_cents', v ->> 'pitch_cents') = ('2275', '275', '2000'), format('6a: %s', v);
  v := public.plan_other_half_payment(e.booking, e.booker);
  assert (v ->> 'amount_cents', v ->> 'fee_cents') = ('2400', '400'), format('6b: %s', v);
  assert tests.error_of(format('select public.plan_other_half_payment(%L, %L)', s.booking, e.booker)) = 'not_your_booking',
    'only the captain';
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  assert tests.error_of(format('select public.plan_other_half_payment(%L, %L)', s.booking, s.booker)) = 'choice_closed',
    'closed 6 hours before kickoff';
end $$;

-- 2. Not due yet: nothing to pay.
do $$
declare
  s record := tests.b1c3_setup();
  v public.venue_bookings;
begin
  perform tests.act_as(s.booker);
  v := public.book_slot(s.venue, tests.cyprus_today() + 4, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all', p_kind => 'half');
  perform tests.act_as_postgres();
  assert tests.error_of(format('select public.plan_other_half_payment(%L, %L)', v.id, s.booker)) = 'choice_not_due',
    'only once the 24-hour choice is due';
end $$;

-- 3. Attaching the payment: only the plan's amount, only over the intent it replaces.
do $$
declare
  s record := tests.b1c3_setup();
  v jsonb := public.plan_other_half_payment(s.booking, s.booker);
  v_id uuid := (v ->> 'payment_id')::uuid;
begin
  assert tests.error_of(format('select public.attach_other_half_intent(%L, %L, ''pi_x'', 2000, null)', v_id, s.booker))
         = 'payment_changed', 'the wrong amount';
  perform public.attach_other_half_intent(v_id, s.booker, 'pi_b1c3_1', 2275, null);
  assert (public.plan_other_half_payment(s.booking, s.booker) ->> 'stripe_payment_intent_id') = 'pi_b1c3_1', 'attached';
  assert tests.error_of(format('select public.attach_other_half_intent(%L, %L, ''pi_b1c3_2'', 2275, null)', v_id, s.booker))
         = 'payment_changed', 'not over a payment it didn''t replace';
end $$;

-- 4. Paid (the webhook): recorded in the ledger (the venue €20.00, Futty the
--    fees less Stripe's), the choice is made, and side B is his, covered.
do $$
declare
  s record := tests.b1c3_setup();
  v jsonb := public.plan_other_half_payment(s.booking, s.booker);
  v_id uuid := (v ->> 'payment_id')::uuid;
  r jsonb;
  v_side public.booking_sides;
  v_player uuid := tests.create_user('b1c3-p-' || gen_random_uuid() || '@futty.test');
  l record;
begin
  perform public.attach_other_half_intent(v_id, s.booker, 'pi_b1c3_paid', 2275, null);
  r := public.other_half_paid(v_id, 'pi_b1c3_paid', 2275, 47);
  assert r ->> 'result' = 'paid', format('paid: %s', r);
  select * into l from public.money_ledger where stripe_intent_id = 'pi_b1c3_paid' and kind = 'capture';
  assert (l.booking_id, l.amount_cents, l.venue_cents, l.futty_cents, l.stripe_fee_cents) = (s.booking, 2275, 2000, 228, 47),
    format('ledger: %s', row(l.amount_cents, l.venue_cents, l.futty_cents, l.stripe_fee_cents));
  assert (select no_opponent_choice from public.venue_bookings where id = s.booking) = 'play_whole', 'the choice is made';
  select * into v_side from public.booking_sides where booking_id = s.booking and side = 'b';
  assert (v_side.captain_id, v_side.payment_mode, v_side.pitch_cents, v_side.players) = (s.booker, 'pay_all', 2000, 5)
         and v_side.paid_at is not null, 'side B is his, paid';
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  perform public.booking_no_opponent_auto_cancel_due();
  assert (select status from public.venue_bookings where id = s.booking) = 'confirmed', 'never cancelled at the cut-off';
  assert (public.other_half_paid(v_id, 'pi_b1c3_paid', 2275, 47)) ->> 'result' = 'duplicate', 'the same event twice';

  -- His players fill side A first, then side B, all covered.
  for i in 1..5 loop
    v_player := tests.create_user('b1c3-p' || i || '-' || gen_random_uuid() || '@futty.test');
    perform tests.act_as(s.booker);
    perform public.add_booking_player(s.booking, tests.b1c3_username(v_player));
    perform tests.act_as(v_player);
    perform public.accept_invite((select id from public.invites where booking_id = s.booking and invited_profile_id = v_player));
    perform tests.act_as_postgres();
  end loop;
  assert (select array_agg(side || ':' || status order by side, status) from public.booking_payment_shares
          where booking_id = s.booking and not is_booker)
         = array['a:covered', 'a:covered', 'a:covered', 'a:covered', 'b:covered'],
    'four fill side A (with the captain), the fifth goes to side B';
end $$;

-- 5. Money that can't count is given back: the booking was cancelled
--    meanwhile, or the amount isn't the plan's.
do $$
declare
  s record := tests.b1c3_setup();
  t record := tests.b1c3_setup();
  v_id uuid;
  r jsonb;
begin
  v_id := (public.plan_other_half_payment(s.booking, s.booker) ->> 'payment_id')::uuid;
  perform public.attach_other_half_intent(v_id, s.booker, 'pi_b1c3_late', 2275, null);
  perform tests.act_as(s.booker);
  perform public.booking_no_opponent_choice(s.booking, 'cancel');
  perform tests.act_as_postgres();
  r := public.other_half_paid(v_id, 'pi_b1c3_late', 2275, 47);
  assert (r ->> 'result', r ->> 'reason') = ('refund', 'booking_cancelled'), format('cancelled: %s', r);
  assert exists (select 1 from public.money_ledger where stripe_intent_id = 'pi_b1c3_late' and kind = 'capture'),
    'recorded before it''s given back';

  v_id := (public.plan_other_half_payment(t.booking, t.booker) ->> 'payment_id')::uuid;
  perform public.attach_other_half_intent(v_id, t.booker, 'pi_b1c3_short', 2275, null);
  r := public.other_half_paid(v_id, 'pi_b1c3_short', 2000, 40);
  assert (r ->> 'result', r ->> 'reason') = ('refund', 'amount_mismatch'), format('short: %s', r);
  assert (select no_opponent_choice from public.venue_bookings where id = t.booking) is null, 'no choice made';
end $$;

-- 6. Choosing it without paying is refused: the payment makes the choice.
do $$
declare
  s record := tests.b1c3_setup();
begin
  perform tests.act_as(s.booker);
  assert tests.error_of(format('select public.booking_no_opponent_choice(%L, ''play_whole'')', s.booking))
         = 'play_whole_needs_payment', 'pay in the app';
  perform tests.act_as_postgres();
end $$;

-- 7. Who can call what; who reads the payment.
do $$
declare
  s record := tests.b1c3_setup();
  v_other uuid := tests.create_user('b1c3-o-' || gen_random_uuid() || '@futty.test');
begin
  perform public.plan_other_half_payment(s.booking, s.booker);
  perform tests.act_as(s.booker);
  assert tests.error_of(format('select public.plan_other_half_payment(%L, %L)', s.booking, s.booker)) like '%permission denied%',
    'the Edge Function plans it';
  assert tests.error_of('select public.other_half_paid(gen_random_uuid(), ''pi'', 1, 0)') like '%permission denied%',
    'only the webhook pays it';
  assert (select count(*) from public.booking_other_half_payments where booking_id = s.booking) = 1, 'he reads his';
  perform tests.act_as(v_other);
  assert (select count(*) from public.booking_other_half_payments where booking_id = s.booking) = 0, 'nobody else';
  perform tests.act_as_postgres();
end $$;

rollback;
