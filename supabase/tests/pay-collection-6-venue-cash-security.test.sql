-- Venue staff, cash after the match, the match_result_confirmed stub and
-- who may call what (docs/specs/13-payments-bookings.md, "Cash at the
-- venue", "Server-side checks"; docs/specs/match-record.md section 6.2;
-- 14, P4c):
--   only a venue's own staff tick cash and run collection early, and only
--   once the match has ended (decided 10 November);
--   after the match an unticked cash player is asked "Pay €6.00 by card
--   now, or remain in debt to [venue]." (amount from the server), once,
--   and can pay it by card with no fee until collection starts.
begin;

-- Ticking cash and running collection early: the venue's staff only.
do $$
declare
  v_owner uuid := tests.create_user('venue-tick-owner@futty.test');
  v_other_owner uuid := tests.create_user('venue-tick-other@futty.test');
  v_booker uuid := tests.create_user('venue-tick-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
  v_card public.booking_payment_shares;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'venue-tick');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_vtick_' || i, interval '2 hours',
                          case when i = 1 then 'cash' else 'card' end);
  end loop;
  v_cash := tests.player(v_booking.id, 1);
  v_card := tests.player(v_booking.id, 2);

  perform tests.act_as(v_other_owner);
  assert tests.error_of(format('select public.mark_cash_received(%L)', v_cash.id)) = 'not_venue_staff', 'another venue';
  assert tests.error_of(format('select public.request_collection(%L)', v_booking.id)) = 'not_venue_staff', 'another venue';
  perform tests.act_as(v_booker);
  assert tests.error_of(format('select public.mark_cash_received(%L)', v_cash.id)) = 'not_venue_staff', 'a player';
  perform tests.act_as(v_owner);
  assert tests.error_of(format('select public.mark_cash_received(%L)', v_card.id)) = 'not_cash', 'a card share';
  -- Early collection only once the match has ended.
  assert tests.error_of(format('select public.request_collection(%L)', v_booking.id)) = 'match_not_over', 'not yet';
  perform tests.act_as_postgres();

  perform tests.end_match(v_booking.id, interval '30 minutes');
  assert not exists (select 1 from public.collections_due() where booking_id = v_booking.id), 'not due by itself yet';
  perform tests.act_as(v_owner);
  perform public.request_collection(v_booking.id);
  perform tests.act_as_postgres();
  assert exists (select 1 from public.collections_due() where booking_id = v_booking.id and collection_id is null),
    'due once the venue asks, after the match';
  perform public.start_collection(v_booking.id);

  -- Once collection has started, unticked cash is a debt; ticking is closed.
  perform tests.act_as(v_owner);
  assert tests.error_of(format('select public.mark_cash_received(%L)', v_cash.id)) = 'collection_started', 'too late';
  assert tests.error_of(format('select public.request_collection(%L)', v_booking.id)) = 'already_collected', 'once';
  perform tests.act_as_postgres();
end $$;

-- After the match: "Pay €6.00 by card now, or remain in debt to [venue]."
-- once; paying it by card (no fee) counts as paid in cash.
do $$
declare
  v_booker uuid := tests.create_user('cash-prompt-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
  v_payer public.booking_payment_shares;
  v_note public.notifications;
  v_plan jsonb;
  v_name text;
  v_start jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  select name into v_name from public.venues where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'cash-prompt');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_cprompt_' || i, interval '2 hours',
                          case when i in (1, 2) then 'cash' else 'card' end);
  end loop;
  v_cash := tests.player(v_booking.id, 1);
  v_payer := tests.player(v_booking.id, 2);

  -- Not before the match ends; paying by card isn't open yet either.
  assert public.send_cash_prompts() = 0, 'the match isn''t over';
  assert tests.error_of(format('select public.plan_cash_payment(%L, %L)', v_payer.id, v_payer.profile_id))
         = 'match_not_over', 'not before the match ends';

  perform tests.end_match(v_booking.id, interval '10 minutes');
  assert public.send_cash_prompts() = 2, 'both unticked cash players are asked';
  assert public.send_cash_prompts() = 0, 'once';
  select * into v_note from public.notifications where type = 'cash_unpaid_prompt' and profile_id = v_cash.profile_id;
  assert v_note.body = format('Pay €6.00 by card now, or remain in debt to %s.', v_name),
    format('the spec''s words, got %s', v_note.body);
  assert v_note.data @> jsonb_build_object('amountCents', 600, 'shareId', v_cash.id, 'bookingId', v_booking.id),
    format('the amount comes from the server, got %s', v_note.data);

  -- Paying it by card: 600, no fee.
  v_plan := public.plan_cash_payment(v_payer.id, v_payer.profile_id);
  assert v_plan @> jsonb_build_object('amount_cents', 600, 'share_id', v_payer.id), format('600, got %s', v_plan);
  assert tests.error_of(format('select public.plan_cash_payment(%L, %L)', v_payer.id, v_booker)) = 'not_your_share',
    'only their own';
  perform public.attach_cash_intent(v_payer.id, v_payer.profile_id, 'pi_cash_card', 600, null);
  assert public.cash_paid_by_card(v_payer.id, 'pi_cash_card', 600, tests.stripe_fee(600)) ->> 'result' = 'paid', 'paid';
  assert (tests.player(v_booking.id, 2)).cash_received_at is not null, 'counts as received';
  assert (select venue_cents from public.money_ledger where kind = 'capture' and stripe_id = 'pi_cash_card') = 600,
    'all of it to the venue';
  assert public.cash_paid_by_card(v_payer.id, 'pi_cash_card', 600, tests.stripe_fee(600)) ->> 'result' = 'duplicate',
    'reported twice: once';

  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  assert (tests.item(v_booking.id, v_payer.id)).id is null, 'paid by card: owes nothing';
  assert (tests.item(v_booking.id, v_cash.id)).kind = 'unpaid_cash', 'the other still owes';

  -- After collection started, paying the cash part is closed (it's a debt now),
  -- and paying a share is closed too.
  assert tests.error_of(format('select public.plan_cash_payment(%L, %L)', v_cash.id, v_cash.profile_id))
         = 'collection_started', 'closed';
  assert public.cash_paid_by_card(v_cash.id, 'pi_cash_late', 600, tests.stripe_fee(600)) @> '{"result": "refund"}',
    'a payment that lands after collection started is given back';
end $$;

-- A share can't be paid once its collection is due.
do $$
declare
  v_booker uuid := tests.create_user('collect-closed-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_late public.booking_payment_shares;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'collect-closed');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_cclosed_0', interval '2 hours');
  v_late := tests.player(v_booking.id, 1);
  perform tests.end_match(v_booking.id, interval '1 hour');
  assert public.plan_share_payment(v_late.id, v_late.profile_id, 'card', true) ->> 'amount_cents' = '680',
    'after the match, before collection: still payable';
  perform tests.end_match(v_booking.id, interval '2 hours');
  assert tests.error_of(format($q$ select public.plan_share_payment(%L, %L, 'card', true) $q$, v_late.id, v_late.profile_id))
         = 'collection_started', 'collection is due: it''s collected instead';
end $$;

-- match_result_confirmed: the stub for contract 3, exactly the columns of
-- match-record.md section 6.2, no rows, readable by service_role only.
do $$
declare
  v_columns text;
begin
  select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) into v_columns
  from information_schema.columns where table_schema = 'public' and table_name = 'match_result_confirmed';
  assert v_columns = 'match_id uuid, booking_id uuid, venue_id uuid, friendly_match_id uuid, league_fixture_id uuid, '
    || 'side_a_team_id uuid, side_b_team_id uuid, side_a_score integer, side_b_score integer, outcome text, '
    || 'result_status text, disputed boolean, confirmed_via text, forfeit_side text, forfeit_reason text, '
    || 'kickoff_at timestamp with time zone, ends_at timestamp with time zone, '
    || 'kickoff_local timestamp without time zone, ends_local timestamp without time zone, '
    || 'settled_at timestamp with time zone',
    format('exactly contract 3''s columns, got %s', v_columns);
  assert (select count(*) from public.match_result_confirmed) = 0, 'no rows until A2';
  assert has_table_privilege('service_role', 'public.match_result_confirmed', 'select'), 'service_role reads it';
  assert not has_table_privilege('authenticated', 'public.match_result_confirmed', 'select'), 'players don''t';
  assert not has_table_privilege('anon', 'public.match_result_confirmed', 'select'), 'anon doesn''t';
end $$;

-- Internal functions are service_role only; staff functions are for signed-in callers.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.collection_amounts(uuid)', 'public.start_collection(uuid)', 'public.collections_due()',
    'public.collection_open_intents(uuid)', 'public.collection_top_ups_due(uuid)',
    'public.collection_top_up_paid(uuid, text, integer, integer)', 'public.collection_top_up_failed(uuid, text, text)',
    'public.collection_top_up_errored(uuid, text, text)', 'public.settle_collection(uuid)',
    'public.collection_guarantee_done(uuid, text, integer, integer)', 'public.collection_failed(uuid, text)',
    'public.send_short_game_warnings()', 'public.send_cash_prompts()', 'public.cancellation_fees_to_debts()',
    'public.plan_debt_payment(uuid, uuid)', 'public.attach_debt_intent(uuid, uuid, text, integer, text)',
    'public.debt_paid(uuid, text, integer, integer)', 'public.plan_cash_payment(uuid, uuid)',
    'public.attach_cash_intent(uuid, uuid, text, integer, text)', 'public.cash_paid_by_card(uuid, text, integer, integer)',
    'public.create_venue_debt(uuid, text, uuid, uuid, integer, integer, integer, text, uuid, uuid)'
  ] loop
    assert has_function_privilege('service_role', v_fn, 'execute'), format('%s: service_role', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'execute'), format('%s: not players', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('%s: not anon', v_fn);
  end loop;
  foreach v_fn in array array['public.mark_cash_received(uuid)', 'public.request_collection(uuid)',
                              'public.settle_debt(uuid)', 'public.player_in_debt(uuid)'] loop
    assert has_function_privilege('authenticated', v_fn, 'execute'), format('%s: signed-in callers', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('%s: not anon', v_fn);
  end loop;
  assert not has_table_privilege('authenticated', 'public.booking_collections', 'insert')
     and not has_table_privilege('authenticated', 'public.booking_collection_items', 'update')
     and not has_table_privilege('authenticated', 'public.venue_debts', 'insert'),
    'nobody writes collections or debts directly';
end $$;

-- A player can only ask whether they themselves are in debt.
do $$
declare
  v_debtor uuid := tests.create_user('debt-ask-debtor@futty.test');
  v_other uuid := tests.create_user('debt-ask-other@futty.test');
begin
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_debtor, 'futty', null, gen_random_uuid(), 100, 0, 100, 'cancellation_fee');
  perform tests.act_as(v_other);
  assert tests.error_of(format('select public.player_in_debt(%L)', v_debtor)) = 'not_allowed', 'not someone else';
  perform tests.act_as(v_debtor);
  assert public.player_in_debt(v_debtor), 'their own';
  perform tests.act_as_postgres();
end $$;

rollback;
