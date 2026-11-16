-- P4d security: every new table has RLS; the payout job's functions are
-- service_role only; the Payouts screen's functions answer only the
-- venue's owner; venues see only their own account and payouts.
begin;

do $$
declare
  v_fn text;
  v_table text;
begin
  foreach v_table in array array['venue_stripe_accounts', 'venue_payouts', 'venue_payout_items', 'payout_runs'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || v_table)::regclass), format('%s: RLS on', v_table);
    assert not has_table_privilege('anon', 'public.' || v_table, 'select'), format('%s: not anon', v_table);
    assert not has_table_privilege('authenticated', 'public.' || v_table, 'insert')
       and not has_table_privilege('authenticated', 'public.' || v_table, 'update')
       and not has_table_privilege('authenticated', 'public.' || v_table, 'delete'),
      format('%s: nobody writes it from the app', v_table);
  end loop;
  assert not has_table_privilege('authenticated', 'public.payout_runs', 'select'), 'the job''s runs are internal';

  foreach v_fn in array array[
    'public.payout_ready_at(public.venue_bookings)', 'public.payout_rows(uuid)', 'public.venue_can_receive_payouts(uuid)',
    'public.prepare_payouts()', 'public.payouts_due()', 'public.finish_payout_run(uuid)',
    'public.payout_sent(uuid, text, integer)', 'public.payout_errored(uuid, text)',
    'public.payout_reversed(text, text, integer, integer)', 'public.connect_account_for_venue(uuid, uuid)',
    'public.connect_account_created(uuid, text)',
    'public.connect_account_updated(text, boolean, boolean, boolean, integer, text)',
    'public.connect_account_deauthorized(text)', 'public.reconcile_money()', 'public.booking_money_breakdown(uuid)'
  ] loop
    assert has_function_privilege('service_role', v_fn, 'execute'), format('%s: service_role', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'execute'), format('%s: not players', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('%s: not anon', v_fn);
    assert (select array_to_string(proconfig, ',') from pg_proc where oid = v_fn::regprocedure) = 'search_path=""',
      format('%s: search_path is empty', v_fn);
  end loop;
  foreach v_fn in array array['public.venue_payouts_overview(uuid)', 'public.venue_payout_bookings(uuid, uuid)',
                              'public.venue_booking_money(uuid, uuid)'] loop
    assert has_function_privilege('authenticated', v_fn, 'execute'), format('%s: signed-in callers', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('%s: not anon', v_fn);
    assert (select array_to_string(proconfig, ',') from pg_proc where oid = v_fn::regprocedure) = 'search_path=""',
      format('%s: search_path is empty', v_fn);
  end loop;
end $$;

-- Only the venue's owner sees its account, payouts and what each booking
-- paid; another venue's owner, a player and anon don't.
do $$
declare
  v_owner uuid := tests.create_user('pp5-owner@futty.test');
  v_other uuid := tests.create_user('pp5-other@futty.test');
  v_player uuid := tests.create_user('pp5-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_owner => v_other, p_pitches => 1);
  v_booking public.venue_bookings;
  v_start jsonb;
  v_payout uuid;
  v_detail jsonb;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.connect_venue(v_venue);
  perform tests.connect_venue(v_other_venue);
  v_booking := tests.booking_with_players(v_player, v_venue, 'each_pays_own_spot', 9, tests.cyprus_today() + 3,
                                          p_label => 'pp5');
  for i in 0 .. 9 loop
    perform tests.pay_ago((tests.player(v_booking.id, i)).id, 'pi_pp5_' || i, interval '2 hours');
  end loop;
  perform tests.end_match(v_booking.id);
  v_start := public.start_collection(v_booking.id);
  perform public.settle_collection((v_start ->> 'collection_id')::uuid);
  perform tests.run_payouts();
  select id into v_payout from public.venue_payouts where venue_id = v_venue;

  perform tests.act_as(v_owner);
  assert (select count(*) from public.venue_payouts) = 1, 'the owner sees their payout';
  assert (select count(*) from public.venue_payout_items) > 0, 'and what it covered';
  assert (select count(*) from public.venue_stripe_accounts) = 1, 'and only their own account';
  v_detail := public.venue_payout_bookings(v_venue, v_payout);
  assert (v_detail ->> 'amount_cents')::integer = 6000 and jsonb_array_length(v_detail -> 'bookings') = 1
         and v_detail -> 'bookings' -> 0 @> jsonb_build_object('booking_id', v_booking.id, 'this_payout_cents', 6000,
                                                                'taken_cents', 6800, 'venue_cents', 6000,
                                                                'transferred_cents', 6000, 'paid_at_venue_cents', 0),
    format('what the booking paid, got %s', v_detail);
  assert public.venue_booking_money(v_venue, v_booking.id) ->> 'transferred_cents' = '6000', 'one booking';
  assert tests.error_of(format('select public.venue_booking_money(%L, %L)', v_other_venue, v_booking.id)) = 'not_venue_staff',
    'not as another venue';

  perform tests.act_as(v_other);
  assert (select count(*) from public.venue_payouts) = 0, 'another owner sees none of it';
  assert (select count(*) from public.venue_payout_items) = 0, 'or what it covered';
  assert (select count(*) from public.venue_stripe_accounts) = 1, 'only their own account';
  assert tests.error_of(format('select public.venue_payouts_overview(%L)', v_venue)) = 'not_venue_staff', 'no overview';
  assert tests.error_of(format('select public.venue_payout_bookings(%L, %L)', v_venue, v_payout)) = 'not_venue_staff', 'no detail';
  assert tests.error_of(format('select public.venue_payout_bookings(%L, %L)', v_other_venue, v_payout)) = 'payout_not_found',
    'not through their own venue either';
  assert tests.error_of(format('select public.venue_booking_money(%L, %L)', v_other_venue, v_booking.id)) = 'booking_not_found',
    'nor a booking that isn''t theirs';

  perform tests.act_as(v_player);
  assert (select count(*) from public.venue_payouts) = 0 and (select count(*) from public.venue_stripe_accounts) = 0,
    'a player sees nothing';
  assert tests.error_of(format('select public.venue_payouts_overview(%L)', v_venue)) = 'not_venue_staff', 'no overview';
  perform tests.act_as_postgres();

  assert tests.error_of(format('select public.connect_account_for_venue(%L, %L)', v_venue, v_player)) = 'not_venue_staff',
    'onboarding: only the owner';
  assert (public.connect_account_for_venue(v_venue, v_owner) ->> 'stripe_account_id') like 'acct\_%', 'the owner gets it';
end $$;

rollback;
