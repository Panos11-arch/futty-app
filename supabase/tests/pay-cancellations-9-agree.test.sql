-- cancellation_quote and cancel_booking_internal always agree: the screen can
-- never promise something different from what happens. A property test over
-- random times: each round makes a booking whose players paid at random
-- moments (some only held, some taken, some unpaid), moves kickoff to a
-- random time, picks a random scope, and checks that what the cancellation
-- did is exactly what the quote said: the same lines, the same extra
-- charge, every share in the state its line says, and credit issued for
-- exactly the quoted amounts.
begin;

do $$
declare
  v_round integer;
  v_owner uuid;
  v_booker uuid;
  v_venue uuid;
  v_booking public.venue_bookings;
  v_mode text;
  v_scope text;
  v_caller uuid;
  v_quote jsonb;
  v_done jsonb;
  v_line jsonb;
  v_status text;
  v_credit integer;
  v_kickoff interval;
  i integer;
begin
  perform setseed(0.4242);
  v_owner := tests.create_user('agree-owner@futty.test');
  update public.profiles set role = 'venue_owner' where id = v_owner;

  for v_round in 1 .. 40 loop
    v_booker := tests.create_user(format('agree-booker-%s@futty.test', v_round));
    v_venue := tests.create_venue(p_owner => v_owner, p_pitches => 1);
    perform tests.set_price(v_venue, '5-a-side', 6000 + (random() * 300)::integer);
    v_mode := (array['pay_all', 'each_pays_responsible', 'each_pays_own_spot'])[1 + floor(random() * 3)::integer];
    v_booking := tests.booking_with_players(v_booker, v_venue, v_mode, 3, tests.cyprus_today() + 5,
                                            p_label => 'agree-' || v_round);
    for i in 0 .. 3 loop
      -- 0 = unpaid, else held 0 to 3 hours ago (taken if over an hour).
      if i = 0 or random() < 0.8 then
        if v_mode <> 'pay_all' or i = 0 then
          perform tests.pay_ago((tests.player(v_booking.id, i)).id, format('pi_agree_%s_%s', v_round, i),
                                make_interval(mins => (random() * 180)::integer),
                                case when v_mode <> 'pay_all' and random() < 0.2 then 'cash' else 'card' end);
        end if;
      end if;
    end loop;

    -- Kickoff from 1 to 30 hours away.
    v_kickoff := make_interval(mins => 60 + (random() * 29 * 60)::integer);
    perform tests.set_kickoff(v_booking.id, now() + v_kickoff);

    v_scope := (array['my_spot', 'whole_team', 'venue'])[1 + floor(random() * 3)::integer];
    v_caller := case v_scope when 'whole_team' then v_booker when 'venue' then v_owner
                  else (tests.player(v_booking.id, 1 + floor(random() * 3)::integer)).profile_id end;

    perform tests.act_as(v_caller);
    v_quote := public.cancellation_quote(v_booking.id, v_scope);
    perform tests.act_as_service_role();
    v_done := public.cancel_booking_internal(v_booking.id, v_scope, v_caller, v_quote ->> 'quote');
    perform tests.act_as_postgres();

    assert v_done -> 'lines' = v_quote -> 'lines', format('round %s (%s, %s): lines differ', v_round, v_mode, v_scope);
    assert v_done -> 'booker_fee' = v_quote -> 'booker_fee', format('round %s: extra charge differs', v_round);
    assert (v_done ->> 'cancels_booking')::boolean
           = ((select status from public.venue_bookings where id = v_booking.id) = 'cancelled'),
      format('round %s: booking state differs', v_round);
    assert (v_done -> 'booker_fee' = 'null'::jsonb)
           = not exists (select 1 from public.booking_cancellation_fees where booking_id = v_booking.id),
      format('round %s: fee row', v_round);

    for v_line in select * from jsonb_array_elements(v_quote -> 'lines') loop
      if v_line ->> 'share_id' is null then
        continue;
      end if;
      select status into v_status from public.booking_payment_shares where id = (v_line ->> 'share_id')::uuid;
      assert v_status = case v_line ->> 'action'
          when 'release' then 'cancelled' when 'none' then 'cancelled' when 'keep' then 'forfeited'
          when 'keep_and_credit' then 'credited' when 'refund_choice' then 'refund_due' end,
        format('round %s: %s line left the share %s', v_round, v_line ->> 'action', v_status);
      select coalesce(sum(amount_cents), 0) into v_credit from public.venue_credits
      where source_share_id = (v_line ->> 'share_id')::uuid;
      assert v_credit = case when (v_line ->> 'needs_capture')::boolean then 0 else (v_line ->> 'credit_cents')::integer end,
        format('round %s: credit %s, quoted %s', v_round, v_credit, v_line ->> 'credit_cents');
      assert (v_line ->> 'kept_cents')::integer + (v_line ->> 'credit_cents')::integer + (v_line ->> 'refund_cents')::integer
             = (v_line ->> 'value_cents')::integer, format('round %s: a line doesn''t add up: %s', v_round, v_line);
    end loop;
    assert (select balanced from public.money_balance(v_booking.id)), format('round %s: the books balance', v_round);
  end loop;
end $$;

rollback;
