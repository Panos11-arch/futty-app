-- QA 24 November, T4 and T5 (spec 13 "Cancellations and refunds"; €60.00
-- 5-a-side pitch, each pays €6.80, the booker's guarantee €60.00):
--   T5. The cancel quote names every hold it releases with the server's
--       amount, the captain's guarantee hold included (guarantee_hold_cents).
--   T4. Once cancelled, the booking says what happened to the caller's own
--       money, from the server (my_cancellation_outcome): his lines of the
--       cancellation that ended the booking, and the guarantee hold released.
begin;

create function tests.qh_book(p_mode text, out booking uuid, out booker uuid)
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_pitches => 0);
  v public.venue_bookings;
begin
  booker := tests.create_user('qh-' || gen_random_uuid() || '@futty.test');
  perform tests.create_pitch(v_venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(booker);
  v := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => 'whole');
  perform tests.act_as_postgres();
  booking := v.id;
end;
$$;

-- T5 and T4 on the QA's booking: the booker pays cash (€0.80 by card, two
-- hours ago, so outside his free hour) and his €60.00 guarantee is held.
do $$
declare
  s record := tests.qh_book('each_pays_responsible');
  q jsonb;
  o jsonb;
begin
  perform tests.pay_ago((tests.share_of(s.booking, s.booker)).id, 'pi_qh_cash', interval '2 hours', 'cash');
  update public.booking_guarantees set stripe_payment_method_id = 'pm_qh' where booking_id = s.booking;
  perform tests.hold_guarantee(s.booking);

  perform tests.act_as(s.booker);
  q := public.cancellation_quote(s.booking, 'whole_team');
  perform tests.act_as_postgres();
  assert (q ->> 'guarantee_hold_cents')::integer = 6000, format('T5: the €60.00 guarantee hold is named (%s)', q);
  assert (q ->> 'guarantee_hold_placed')::boolean, 'as before';

  perform tests.cancel(s.booking, 'whole_team', s.booker);
  perform tests.act_as(s.booker);
  o := public.my_cancellation_outcome(s.booking);
  perform tests.act_as_postgres();
  assert o ->> 'scope' = 'whole_team', format('T4: the whole team (%s)', o);
  assert jsonb_array_length(o -> 'lines') = 1, 'T4: his own share''s line only';
  assert (o #>> '{lines,0,action}', (o #>> '{lines,0,kept_cents}')::integer, (o #>> '{lines,0,refund_cents}')::integer)
         = ('keep'::text, 80, 0), 'T4: €0.80 kept, nothing back';
  assert (o ->> 'guarantee_cents')::integer = 6000, 'T4: the €60.00 guarantee hold released';
end $$;

-- Before the guarantee is held (a saved card only) nothing is held, so the
-- quote names no hold; a player's own spot never names the guarantee.
do $$
declare
  s record := tests.qh_book('each_pays_responsible');
  v_player uuid := tests.create_user('qh-p-' || gen_random_uuid() || '@futty.test');
  q jsonb;
begin
  perform tests.hold_share((tests.share_of(s.booking, s.booker)).id, 'pi_qh_b');
  perform tests.join_booking(s.booking, v_player);
  perform tests.hold_share((tests.share_of(s.booking, v_player)).id, 'pi_qh_p');
  perform tests.act_as(s.booker);
  q := public.cancellation_quote(s.booking, 'whole_team');
  assert (q ->> 'guarantee_hold_cents')::integer = 0, 'no hold placed yet, none named';
  perform tests.act_as(v_player);
  q := public.cancellation_quote(s.booking, 'my_spot');
  assert (q ->> 'guarantee_hold_cents')::integer = 0, 'my spot: no guarantee';
  perform tests.act_as_postgres();
end $$;

-- Pay for everyone, cancelled in the free hour: €65.50 back, no guarantee.
-- Another player in the game sees only his own line; a stranger sees none.
do $$
declare
  s record := tests.qh_book('pay_all');
  v_stranger uuid := tests.create_user('qh-s-' || gen_random_uuid() || '@futty.test');
  o jsonb;
begin
  perform tests.hold_share((tests.share_of(s.booking, s.booker)).id, 'pi_qh_all');
  perform tests.cancel(s.booking, 'whole_team', s.booker);
  perform tests.act_as(s.booker);
  o := public.my_cancellation_outcome(s.booking);
  assert (o #>> '{lines,0,action}', (o #>> '{lines,0,refund_cents}')::integer, (o ->> 'guarantee_cents')::integer)
         = ('release'::text, 6550, 0), format('€65.50 back, no guarantee (%s)', o);
  perform tests.act_as(v_stranger);
  o := public.my_cancellation_outcome(s.booking);
  assert o is null, 'a stranger learns nothing';
  perform tests.act_as_postgres();
end $$;

-- Not cancelled: nothing to say. Internal access: authenticated only.
do $$
declare
  s record := tests.qh_book('pay_all');
begin
  perform tests.act_as(s.booker);
  assert public.my_cancellation_outcome(s.booking) is null, 'a booking that is on has no outcome';
  perform tests.act_as_postgres();
  assert not has_function_privilege('anon', 'public.my_cancellation_outcome(uuid)', 'execute'), 'not for anon';
  assert has_function_privilege('authenticated', 'public.my_cancellation_outcome(uuid)', 'execute'), 'for players';
end $$;

rollback;
