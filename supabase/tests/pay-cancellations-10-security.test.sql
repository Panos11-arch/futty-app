-- Cancellations and credit are server-side only (CLAUDE.md, working rule 4):
-- the app may ask for a quote; everything that moves money is service_role
-- only, called by Edge Functions with the verified caller. The new tables
-- have RLS and can't be written from the app.
begin;

do $$
declare
  v_fn text;
  v_table text;
begin
  assert has_function_privilege('authenticated', 'public.cancellation_quote(uuid, text)', 'execute'),
    'the app can ask for a quote';
  assert not has_function_privilege('anon', 'public.cancellation_quote(uuid, text)', 'execute'), 'not signed out';

  foreach v_fn in array array[
    'public.cancellation_plan(uuid, text, uuid, timestamptz)',
    'public.cancel_booking_internal(uuid, text, uuid, text)',
    'public.choose_cancellation_refund(uuid, uuid, text)',
    'public.cancellation_work(uuid)',
    'public.cancellation_line_done(uuid, text)',
    'public.cancellation_line_captured(uuid, integer, integer)',
    'public.cancellation_line_refunded(uuid, text)',
    'public.cancellation_line_failed(uuid, text)',
    'public.cancellation_fee_to_charge(uuid)',
    'public.cancellation_fees_due()',
    'public.cancellation_fee_attempted(uuid, text, text, text)',
    'public.cancellation_fee_paid(uuid, text, integer, integer)',
    'public.expire_venue_credits()',
    'public.credit_reservations_to_release()',
    'public.release_share_credit_reservation(uuid, text, boolean)',
    'public.issue_venue_credit(uuid, uuid, integer, text, uuid, uuid)',
    'public.record_money_transfer(uuid, uuid, integer, text, text)',
    'public.return_share_credit_part(uuid, integer, text)',
    'public.share_drop_credit(uuid, text)',
    'public.cancellation_line_not_taken(uuid)',
    'public.cancellation_claim_refund(uuid)',
    'public.booking_payment_window_ends_at(public.venue_bookings)',
    'public.share_card_saved(uuid, text, text, timestamptz)',
    'public.attach_share_setup(uuid, uuid, text, text, text, boolean, boolean)',
    'public.money_credit_payment(integer, integer, integer)',
    'public.venue_credit_available_cents(uuid, uuid)',
    'public.record_ledger_entry(uuid, uuid, uuid, text, integer, text, text, integer, integer, integer)'
  ] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute'), v_fn || ' is not callable from the app';
    assert not has_function_privilege('anon', v_fn, 'execute'), v_fn || ' is not callable signed out';
    assert has_function_privilege('service_role', v_fn, 'execute'), v_fn || ' is callable by service_role';
  end loop;

  foreach v_table in array array['venue_credits', 'venue_credit_spends', 'venue_payables', 'booking_cancellations',
                                 'booking_cancellation_lines', 'booking_cancellation_fees'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || v_table)::regclass), v_table || ' has RLS';
    assert not has_table_privilege('authenticated', 'public.' || v_table, 'insert'), v_table || ': no inserts from the app';
    assert not has_table_privilege('authenticated', 'public.' || v_table, 'update'), v_table || ': no updates from the app';
    assert not has_table_privilege('authenticated', 'public.' || v_table, 'delete'), v_table || ': no deletes from the app';
    assert not has_table_privilege('anon', 'public.' || v_table, 'select'), v_table || ': nothing signed out';
  end loop;

  -- The ledger stays append-only.
  assert not has_table_privilege('service_role', 'public.money_ledger', 'update'), 'ledger: no updates';
  assert not has_table_privilege('service_role', 'public.money_ledger', 'delete'), 'ledger: no deletes';
end $$;

-- A player sees their own lines and fee, nobody else's.
do $$
declare
  v_booker uuid := tests.create_user('sec-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_player uuid;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'sec');
  for i in 0 .. 2 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_sec_' || i, interval '2 hours');
  end loop;
  perform tests.cancel(v_booking.id, 'whole_team', v_booker);
  v_player := (tests.player(v_booking.id, 1)).profile_id;

  perform tests.act_as(v_player);
  assert (select count(*) from public.booking_cancellation_lines) = 1, 'a player sees their own line';
  assert (select count(*) from public.booking_cancellation_fees) = 0, 'not the booker''s charge';
  perform tests.act_as(v_booker);
  assert (select count(*) from public.booking_cancellation_fees) = 1, 'the booker sees their charge';
  perform tests.act_as_postgres();
end $$;

rollback;
