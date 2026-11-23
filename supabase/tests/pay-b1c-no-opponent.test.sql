-- B1c, part 2a (Booking v2, spec 13 "Invites, after payment"): no side B by
-- 24 hours before kickoff. The captain left on his own chooses "Pay the
-- whole pitch and play" (the other half plus that half's players' fees,
-- examples 6a and 6b; its payment is part 2b) or "Cancel free" (everything
-- refunded, holds released). No choice by 6 hours before kickoff = cancelled
-- free. The same timing as Gipedo Pano's decision 1.
begin;

update public.booking_v2_settings set half_pitch_enabled = true;

create function tests.b1c2_setup(p_mode text default 'pay_all', p_price integer default 4000,
                                 out venue uuid, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v public.venue_bookings;
begin
  booker := tests.create_user('b1c2-booker-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  perform tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', p_price);
  perform tests.act_as(booker);
  v := public.book_slot(venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => 'half');
  perform tests.act_as_postgres();
  booking := v.id;
  perform tests.hold_share((select id from public.booking_payment_shares where booking_id = booking and profile_id = booker),
                           'pi_b1c2_a_' || gen_random_uuid());
end;
$$;

create function tests.b1c2_choose(p_booking uuid, p_as uuid, p_choice text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_as);
  v := public.booking_no_opponent_choice(p_booking, p_choice);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.b1c2_quote(p_booking uuid, p_as uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_as);
  v := public.booking_no_opponent_quote(p_booking);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- 1. 24 hours before kickoff with no side B, the captain is asked, once,
--    with the amount from the server: €22.75 when side A pays for everyone
--    (example 6a).
do $$
declare
  s record := tests.b1c2_setup();
begin
  perform tests.set_kickoff(s.booking, now() + interval '25 hours');
  assert public.booking_no_opponent_due() = 0, 'not before 24 hours';
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  assert public.booking_no_opponent_due() = 1, 'due 24 hours before kickoff';
  assert (select no_opponent_at from public.venue_bookings where id = s.booking) is not null, 'recorded';
  assert tests.notified(s.booker, 'no_opponent') = 1, 'the captain is asked';
  assert (tests.last_notification(s.booker, 'no_opponent')).body like '%€22.75%', 'with the amount';
  assert public.booking_no_opponent_due() = 0, 'once';
end $$;

-- 2. The quote: the other half plus 5 × the half's fee. Paying for everyone
--    €20.00 + 5 × €0.55 = €22.75 (6a); paying for myself €20.00 + 5 × €0.80 =
--    €24.00 (6b). An odd pitch (€45.55): the other half rounded down, €22.77,
--    Futty absorbs the cent.
do $$
declare
  s record := tests.b1c2_setup();
  e record := tests.b1c2_setup('each_pays_responsible');
  o record := tests.b1c2_setup('pay_all', 4555);
  v jsonb;
begin
  v := tests.b1c2_quote(s.booking, s.booker);
  assert (v ->> 'pitch_cents', v ->> 'fee_cents', v ->> 'amount_cents') = ('2000', '275', '2275'), format('6a: %s', v);
  v := tests.b1c2_quote(e.booking, e.booker);
  assert (v ->> 'pitch_cents', v ->> 'fee_cents', v ->> 'amount_cents') = ('2000', '400', '2400'), format('6b: %s', v);
  v := tests.b1c2_quote(o.booking, o.booker);
  assert (v ->> 'pitch_cents', v ->> 'amount_cents') = ('2277', '2552'), format('odd cent: %s', v);
  assert tests.error_of(format('select tests.b1c2_quote(%L, %L)', s.booking, e.booker)) = 'not_your_booking',
    'only the captain';
end $$;

-- 3. Not due: a paid side B, a whole pitch, or a booking still waiting for
--    its payment.
do $$
declare
  s record := tests.b1c2_setup();
  v_whole public.venue_bookings;
  v_b uuid := tests.create_user('b1c2-b-' || gen_random_uuid() || '@futty.test');
  v jsonb;
begin
  perform tests.act_as(s.booker);
  perform public.invite_opposition(s.booking, array[v_b]);
  v_whole := public.book_slot(s.venue, tests.cyprus_today() + 3, '14:00', '15:00', 1, '5-a-side', 5, 'pay_all', p_kind => 'whole');
  perform tests.act_as(v_b);
  v := public.accept_opposition((select id from public.booking_opposition_invites where booking_id = s.booking), 'pay_all');
  perform tests.act_as_postgres();
  perform tests.hold_share((v ->> 'share_id')::uuid, 'pi_b1c2_b_' || gen_random_uuid());
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform tests.set_kickoff(v_whole.id, now() + interval '22 hours');
  assert public.booking_no_opponent_due() = 0, 'side B paid, and a whole pitch has no opposition';
end $$;

-- 4. "Cancel free": the booking is cancelled, nothing is kept, and what was
--    paid or held is given back by the job's release step.
do $$
declare
  s record := tests.b1c2_setup();
  v_other uuid := tests.create_user('b1c2-other-' || gen_random_uuid() || '@futty.test');
  v jsonb;
begin
  assert tests.error_of(format('select tests.b1c2_choose(%L, %L, ''cancel'')', s.booking, s.booker)) = 'choice_not_due',
    'not before it''s due';
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.booking_no_opponent_due();
  assert tests.error_of(format('select tests.b1c2_choose(%L, %L, ''cancel'')', s.booking, v_other)) = 'not_your_booking',
    'only the captain';
  assert tests.error_of(format('select tests.b1c2_choose(%L, %L, ''maybe'')', s.booking, s.booker)) = 'invalid_choice',
    'one of the two';
  v := tests.b1c2_choose(s.booking, s.booker, 'cancel');
  assert v ->> 'result' = 'cancelled', 'cancelled';
  assert (select (status, no_opponent_choice) from public.venue_bookings where id = s.booking)
         = ('cancelled'::text, 'cancel'::text), 'the booking is cancelled free';
  assert exists (select 1 from public.booking_money_to_release(s.booking) m where m.kind = 'share'),
    'side A''s payment is given back by the release step';
  assert tests.error_of(format('select tests.b1c2_choose(%L, %L, ''cancel'')', s.booking, s.booker)) = 'already_chosen',
    'once';
end $$;

-- 5. The choice closes 6 hours before kickoff; with none made, the booking
--    is cancelled free.
do $$
declare
  s record := tests.b1c2_setup();
begin
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.booking_no_opponent_due();
  assert public.booking_no_opponent_auto_cancel_due() = 0, 'not before 6 hours';
  perform tests.set_kickoff(s.booking, now() + interval '5 hours');
  assert tests.error_of(format('select tests.b1c2_choose(%L, %L, ''cancel'')', s.booking, s.booker)) = 'choice_closed',
    'too late to choose';
  assert public.booking_no_opponent_auto_cancel_due() = 1, 'cancelled free';
  assert (select (status, no_opponent_choice) from public.venue_bookings where id = s.booking)
         = ('cancelled'::text, 'auto_cancel'::text), 'by the job';
  assert tests.notified(s.booker, 'booking_cancelled') = 1, 'the captain is told';
  assert public.booking_no_opponent_auto_cancel_due() = 0, 'once';
end $$;

-- 6. "Pay the whole pitch and play" is paid in the app (part 2b).
do $$
declare
  s record := tests.b1c2_setup();
begin
  perform tests.set_kickoff(s.booking, now() + interval '23 hours');
  perform public.booking_no_opponent_due();
  assert tests.error_of(format('select tests.b1c2_choose(%L, %L, ''play_whole'')', s.booking, s.booker))
         = 'play_whole_not_available', 'not yet';
end $$;

-- 7. The jobs are the server's.
do $$
declare
  s record := tests.b1c2_setup();
begin
  perform tests.act_as(s.booker);
  assert tests.error_of('select public.booking_no_opponent_due()') like '%permission denied%', 'due: server only';
  assert tests.error_of('select public.booking_no_opponent_auto_cancel_due()') like '%permission denied%', 'auto-cancel: server only';
  perform tests.act_as_postgres();
end $$;

rollback;
