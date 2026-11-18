-- Saving a block with clashes (decided 18 November): every app booking still
-- clashing is cancelled by the venue through the existing venue cancel
-- (cancel_booking_internal, scope 'venue'), with exactly the quote staff saw:
-- whole share back, card or credit within 48 hours, and the venue owes
-- Stripe's €0.35 per player (spec 13 "The venue cancels a booking"). A game
-- that has started stays on. If anything changed since the list was shown,
-- nothing happens (clashes_changed). A Gipedo Pano booking's holds are
-- released by the same cancel.
begin;

-- 1. The venue cancel, exactly: three payments taken and one held.
do $$
declare
  v_owner uuid := tests.create_user('bc3-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_pitch uuid;
  v_day date := tests.cyprus_today() + 3;
  v_game public.venue_bookings;
  v_other public.venue_bookings;
  v_held public.booking_payment_shares;
  v_list jsonb;
  v_venue_quote jsonb;
  v_result jsonb;
  v_cancel public.booking_cancellations;
  v_line public.booking_cancellation_lines;
  v_owed integer;
  v_share public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_game := tests.booking_with_players(tests.create_user('bc3-booker@futty.test'), v_venue, 'each_pays_own_spot', 3,
                                       v_day, '18:00', '19:00', 'bc3');
  perform tests.pay_ago((tests.player(v_game.id, 0)).id, 'pi_bc3_0', interval '2 hours');
  perform tests.pay_ago((tests.player(v_game.id, 1)).id, 'pi_bc3_1', interval '2 hours');
  perform tests.pay_ago((tests.player(v_game.id, 2)).id, 'pi_bc3_2', interval '2 hours');
  v_held := tests.pay_ago((tests.player(v_game.id, 3)).id, 'pi_bc3_3', interval '5 minutes');
  select pitch_id into v_pitch from public.booking_pitches where booking_id = v_game.id;
  -- Another game the block doesn't touch.
  v_other := tests.booking_with_players(tests.create_user('bc3-other@futty.test'), v_venue, 'each_pays_own_spot', 0,
                                        v_day, '20:00', '21:00', 'bc3o');

  perform tests.act_as(v_owner);
  v_venue_quote := public.cancellation_quote(v_game.id, 'venue');
  v_list := public.venue_block_clashes(v_venue, v_pitch, v_day, '17:00', '20:00');
  assert (v_list ->> 'venue_stripe_fee_cents')::integer = 3 * 35,
    format('Stripe''s fees on these payments: €1.05, got %s', v_list -> 'venue_stripe_fee_cents');

  assert tests.error_of(format($q$ select public.venue_add_block(%L, %L, %L, '17:00', '20:00', null, 'stale') $q$,
                               v_venue, v_pitch, v_day)) = 'clashes_changed', 'a quote not shown is refused';
  assert tests.error_of(format($q$ select public.venue_add_block(%L, %L, %L, '17:00', '20:00', null, null) $q$,
                               v_venue, v_pitch, v_day)) = 'quote_required', 'a quote is needed';

  v_result := public.venue_add_block(v_venue, v_pitch, v_day, '17:00', '20:00', ' Floodlights ', v_list ->> 'quote');
  perform tests.act_as_postgres();

  assert (v_result ->> 'cancelled')::integer = 1 and v_result -> 'call_them' = '[]'::jsonb,
    format('one game cancelled, nobody to call, got %s', v_result);
  assert (select pitch_id = v_pitch and block_day = v_day and starts_at = '17:00' and ends_at = '20:00'
                 and reason = 'Floodlights' and created_by = v_owner
          from public.venue_blocks where id = (v_result ->> 'block_id')::uuid), 'the block is saved';
  assert (select status from public.venue_bookings where id = v_game.id) = 'cancelled', 'the game is cancelled';
  assert (select status from public.venue_bookings where id = v_other.id) <> 'cancelled', 'the 20:00 game stays on';
  assert not exists (select 1 from public.booking_pitches where booking_id = v_game.id), 'its pitch is released';

  -- Exactly the venue cancel: scope 'venue', by the staff member, with the
  -- quote and plan they were shown.
  select * into v_cancel from public.booking_cancellations where booking_id = v_game.id;
  assert v_cancel.scope = 'venue' and v_cancel.cancelled_by = v_owner and v_cancel.quote = v_venue_quote ->> 'quote',
    'a venue cancel with the quote shown';
  assert v_cancel.plan -> 'lines' = v_venue_quote -> 'lines', 'line for line what the venue quote said';
  assert (select count(*) from public.booking_cancellation_lines where cancellation_id = v_cancel.id) = 4, 'four lines';
  assert (select count(*) from public.booking_cancellation_lines
          where cancellation_id = v_cancel.id and action = 'refund_choice' and refund_cents = 680
            and choose_by is not null and work = 'pending') = 3, 'three €6.80 refunds, card or credit';
  select * into v_line from public.booking_cancellation_lines where cancellation_id = v_cancel.id and share_id = v_held.id;
  assert v_line.action = 'release' and v_line.work = 'pending' and v_line.stripe_intent_id = 'pi_bc3_3',
    'the hold is released by the payment jobs';

  -- The players choose; the venue owes €0.35 per payment taken.
  perform tests.act_as_service_role();
  for v_line in select * from public.booking_cancellation_lines
                where cancellation_id = v_cancel.id and action = 'refund_choice' loop
    perform public.choose_cancellation_refund(v_line.id, v_line.profile_id, 'credit');
  end loop;
  perform tests.act_as_postgres();
  select sum(amount_cents) into v_owed from public.venue_payables where booking_id = v_game.id;
  assert v_owed = 105, format('the venue owes €1.05, got %s', v_owed);
  for v_share in select * from public.booking_payment_shares where booking_id = v_game.id loop
    assert v_share.status in ('refund_due', 'cancelled', 'credited', 'refunded'),
      format('no share is still in, got %s', v_share.status);
  end loop;
end $$;

-- 2. Anything that changes after the list was shown: a player paying.
do $$
declare
  v_owner uuid := tests.create_user('bc3c-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  v_game public.venue_bookings;
  v_list jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_game := tests.booking_with_players(tests.create_user('bc3c-booker@futty.test'), v_venue, 'each_pays_own_spot', 1,
                                       v_day, '18:00', '19:00', 'bc3c');
  perform tests.act_as(v_owner);
  v_list := public.venue_block_clashes(v_venue, null, v_day, null, null);
  perform tests.act_as_postgres();
  perform tests.pay_ago((tests.player(v_game.id, 1)).id, 'pi_bc3c_1', interval '2 hours');
  perform tests.act_as(v_owner);
  assert tests.error_of(format($q$ select public.venue_add_block(%L, null, %L, null, null, null, %L) $q$,
                               v_venue, v_day, v_list ->> 'quote')) = 'clashes_changed', 'a new payment since';
  perform tests.act_as_postgres();
  assert (select status from public.venue_bookings where id = v_game.id) <> 'cancelled', 'nothing cancelled';
  assert not exists (select 1 from public.venue_blocks where venue_id = v_venue), 'no block';
end $$;

-- 3. A game that has kicked off stays on, and the block is still saved. Its
-- players aren't told anything.
do $$
declare
  v_owner uuid := tests.create_user('bc3s-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1, p_open => '00:00', p_close => '23:59');
  v_game public.venue_bookings;
  v_day date;
  v_list jsonb;
  v_result jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_game := tests.booking_with_players(tests.create_user('bc3s-booker@futty.test'), v_venue, 'each_pays_own_spot', 1,
                                       tests.cyprus_today() + 1, '12:00', '13:00', 'bc3s');
  perform tests.set_kickoff(v_game.id, now() - interval '10 minutes');
  select booking_day into v_day from public.venue_bookings where id = v_game.id;

  perform tests.act_as(v_owner);
  v_list := public.venue_block_clashes(v_venue, null, v_day, null, null);
  assert jsonb_array_length(v_list -> 'clashes') = 1 and (v_list -> 'clashes' -> 0 ->> 'started')::boolean
         and v_list -> 'clashes' -> 0 -> 'quote' = 'null'::jsonb and (v_list ->> 'venue_stripe_fee_cents')::integer = 0,
    format('listed as started, with no cancel, got %s', v_list);
  v_result := public.venue_add_block(v_venue, null, v_day, null, null, null, v_list ->> 'quote');
  perform tests.act_as_postgres();
  assert (v_result ->> 'cancelled')::integer = 0, 'nothing cancelled';
  assert (select status from public.venue_bookings where id = v_game.id) <> 'cancelled', 'the game stays on';
  assert exists (select 1 from public.venue_blocks where id = (v_result ->> 'block_id')::uuid), 'the block is saved';
  assert not exists (select 1 from public.notifications n
                     join public.booking_payment_shares s on s.profile_id = n.profile_id
                     where s.booking_id = v_game.id and n.type in ('venue_closed_new_bookings', 'booking_cancelled')),
    'nobody is told';
end $$;

-- 4. Gipedo Pano: the same venue cancel stands it down and releases the
-- captain's hold.
do $$
declare
  v_owner uuid := tests.create_user('bc3g-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_home uuid := tests.create_user('bc3g-home@futty.test');
  v_team uuid := tests.create_team('BC3 Home');
  v_game public.venue_bookings;
  v_share public.booking_payment_shares;
  v_list jsonb;
  v_line public.booking_cancellation_lines;
begin
  perform tests.join_team(v_team, v_home, 'captain');
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_home);
  v_game := public.book_slot(v_venue, tests.cyprus_today() + 2, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', v_team);
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_game.id, v_home)).id, 'pi_bc3g_home');
  v_share := tests.share_of(v_game.id, v_home);
  assert v_share.status = 'authorized', 'the captain''s hold is placed';

  perform tests.act_as(v_owner);
  v_list := public.venue_block_clashes(v_venue, null, tests.cyprus_today() + 2, null, null);
  perform public.venue_add_block(v_venue, null, tests.cyprus_today() + 2, null, null, null, v_list ->> 'quote');
  perform tests.act_as_postgres();

  select l.* into v_line from public.booking_cancellation_lines l
  join public.booking_cancellations c on c.id = l.cancellation_id
  where c.booking_id = v_game.id and c.scope = 'venue' and l.share_id = v_share.id;
  assert v_line.action = 'release' and v_line.stripe_intent_id = 'pi_bc3g_home' and v_line.work = 'pending',
    format('the hold is released, got %s / %s', v_line.action, v_line.work);
  assert (select status from public.venue_bookings where id = v_game.id) = 'cancelled', 'cancelled';
end $$;

select 'pay block clashes 3 (confirm) passed' as result;

rollback;
