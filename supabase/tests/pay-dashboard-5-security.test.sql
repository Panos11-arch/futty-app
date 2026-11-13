-- Only a venue's own staff can run its dashboard (docs/specs/13-payments-
-- bookings.md "Server-side checks": only a venue's own staff can tick cash,
-- settle debt, block pitches, flag conditions or cancel that venue's
-- bookings; 14 P6: RLS and function checks). Staff of venue A can't touch
-- venue B, through any write or read, new or existing; players and signed-out
-- callers can't either; internal helpers and the new tables are closed.
begin;

do $$
declare
  v_owner_a uuid := tests.create_user('sec-owner-a@futty.test');
  v_owner_b uuid := tests.create_user('sec-owner-b@futty.test');
  v_booker uuid := tests.create_user('sec-booker@futty.test');
  v_venue_a uuid := tests.create_venue(p_owner => v_owner_a, p_pitches => 1);
  v_venue_b uuid := tests.create_venue(p_owner => v_owner_b, p_pitches => 1);
  v_pitch_b uuid;
  v_day date := tests.cyprus_today() + 2;
  v_booking_b public.venue_bookings;
  v_cash_b public.booking_payment_shares;
  v_counter_b uuid;
  v_flag_b uuid;
  v_debt_b uuid;
  v_caller uuid;
  v_sql text;
  v_err text;
begin
  perform tests.set_price(v_venue_a, '5-a-side', 6000);
  perform tests.set_price(v_venue_b, '5-a-side', 6000);
  select id into v_pitch_b from public.pitches where venue_id = v_venue_b;
  v_booking_b := tests.booking_with_players(v_booker, v_venue_b, 'each_pays_own_spot', 1, v_day, '12:00', '13:00', 'sec');
  perform tests.pay_ago((tests.player(v_booking_b.id, 0)).id, 'pi_sec_0', interval '2 hours');
  perform tests.pay_ago((tests.player(v_booking_b.id, 1)).id, 'pi_sec_1', interval '2 hours', 'cash');
  v_cash_b := tests.player(v_booking_b.id, 1);
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_booker, 'venue', v_venue_b, v_booking_b.id, 680, 600, 80, 'unpaid_share') returning id into v_debt_b;

  perform tests.act_as(v_owner_b);
  v_counter_b := public.add_counter_booking(v_venue_b, v_day, '15:00', '16:00', '5-a-side', 'phone', 'B regular',
                                            '+35799000009');
  v_flag_b := public.flag_conditions(v_venue_b, v_day + 1, null, null, null, null);
  perform tests.act_as_postgres();

  -- Every staff function, called on venue B by venue A's staff and by a player.
  foreach v_caller in array array[v_owner_a, v_booker] loop
    perform tests.act_as(v_caller);
    foreach v_sql in array array[
      format($q$ select public.add_counter_booking(%L, %L, '17:00', '18:00', '5-a-side', 'walk_in', 'X', null) $q$, v_venue_b, v_day),
      format($q$ select public.mark_counter_paid(%L, 'cash') $q$, v_counter_b),
      format('select public.cancel_counter_booking(%L)', v_counter_b),
      format('select public.flag_conditions(%L, %L, null, null, null, null)', v_venue_b, v_day),
      format('select public.clear_conditions(%L)', v_flag_b),
      format('select public.set_venue_allows_6v6(%L, true)', v_venue_b),
      format('select public.venue_day_board(%L, %L)', v_venue_b, v_day),
      format('select public.venue_booking_roster(%L)', v_booking_b.id),
      format('select public.venue_booking_roster(%L)', v_counter_b),
      format('select public.mark_cash_received(%L)', v_cash_b.id),
      format('select public.request_collection(%L)', v_booking_b.id),
      format('select public.settle_debt(%L)', v_debt_b)
    ] loop
      v_err := tests.error_of(v_sql);
      assert v_err = 'not_venue_staff', format('%s as %s: expected not_venue_staff, got %s', v_sql,
        case when v_caller = v_owner_a then 'venue A staff' else 'a player' end, coalesce(v_err, 'success'));
    end loop;
    assert tests.error_of(format($q$ select public.cancellation_quote(%L, 'venue') $q$, v_booking_b.id)) = 'not_your_venue',
      'venue cancel of another venue''s booking';
    assert tests.error_of(format('select public.move_booking_pitches(%L, array[%L]::uuid[])', v_booking_b.id, v_pitch_b))
           = 'not_your_venue', 'moving another venue''s booking';
    assert tests.error_of(format('select public.move_booking_pitches(%L, array[%L]::uuid[])', v_counter_b, v_pitch_b))
           = 'not_your_venue', 'moving another venue''s walk-in';
    assert tests.error_of(format($q$ insert into public.venue_blocks (venue_id, pitch_id, block_day, created_by)
                                     values (%L, %L, %L, %L) $q$, v_venue_b, v_pitch_b, v_day, v_caller))
           = 'not_your_venue', 'blocking another venue''s pitch';
    -- Their rows are invisible.
    assert not exists (select 1 from public.venue_contacts where venue_id = v_venue_b), 'B''s contacts';
    assert not exists (select 1 from public.venue_counter_bookings where venue_id = v_venue_b), 'B''s walk-ins';
    assert not exists (select 1 from public.venue_condition_flags where venue_id = v_venue_b), 'B''s flags';
    assert not exists (select 1 from public.venue_blocks where venue_id = v_venue_b), 'B''s blocks';
    perform tests.act_as_postgres();
  end loop;

  -- Nothing changed at venue B.
  assert (select paid_at is null and cancelled_at is null from public.venue_counter_bookings where booking_id = v_counter_b),
    'B''s walk-in untouched';
  assert (select cleared_at is null from public.venue_condition_flags where id = v_flag_b), 'B''s flag untouched';
  assert not (select allows_6v6_on_5s from public.venues where id = v_venue_b), 'B''s setting untouched';
  assert (tests.player(v_booking_b.id, 1)).cash_received_at is null, 'B''s cash untouched';
  assert (select settled_at is null from public.venue_debts where id = v_debt_b), 'B''s debt untouched';
  assert (select count(*) from public.venue_condition_flags where venue_id = v_venue_b) = 1, 'no new flag at B';
  assert (select count(*) from public.venue_counter_bookings where venue_id = v_venue_b) = 1, 'no new walk-in at B';

  -- Venue B's staff see their own.
  perform tests.act_as(v_owner_b);
  assert (select count(*) from public.venue_contacts where venue_id = v_venue_b) = 1, 'own contacts';
  assert (select count(*) from public.venue_counter_bookings where venue_id = v_venue_b) = 1, 'own walk-ins';
  assert (select count(*) from public.venue_condition_flags where venue_id = v_venue_b) = 1, 'own flags';
  perform tests.act_as_postgres();

  -- Signed out: nothing at all.
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.venue_day_board(%L, %L)', v_venue_b, v_day)) like 'permission denied%',
    'anon can''t call staff functions';
  assert tests.error_of('select 1 from public.venue_contacts') like 'permission denied%', 'anon can''t read contacts';
  perform tests.act_as_postgres();
end $$;

-- Grants: staff functions for signed-in callers (they check staff
-- themselves); no direct writes to the new tables.
do $$
declare
  v_fn text;
  v_table text;
begin
  foreach v_fn in array array[
    'public.add_counter_booking(uuid, date, time, time, text, text, text, text, uuid, integer, text)',
    'public.mark_counter_paid(uuid, text)', 'public.cancel_counter_booking(uuid)',
    'public.flag_conditions(uuid, date, time, time, uuid, text)', 'public.clear_conditions(uuid)',
    'public.set_venue_allows_6v6(uuid, boolean)', 'public.venue_day_board(uuid, date)',
    'public.venue_booking_roster(uuid)', 'public.mark_cash_received(uuid)'
  ] loop
    assert has_function_privilege('authenticated', v_fn, 'execute'), format('%s: signed-in callers', v_fn);
    assert has_function_privilege('service_role', v_fn, 'execute'), format('%s: service_role', v_fn);
    assert not has_function_privilege('anon', v_fn, 'execute'), format('%s: not anon', v_fn);
    assert (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = v_fn::regprocedure),
      format('%s: security definer with an empty search_path', v_fn);
  end loop;
  -- Internal helpers: service role only.
  foreach v_fn in array array['public.normalize_cy_phone(text)', 'public.reverse_cash_received(uuid)'] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute')
       and not has_function_privilege('anon', v_fn, 'execute'), format('%s: internal', v_fn);
    assert has_function_privilege('service_role', v_fn, 'execute'), format('%s: service_role', v_fn);
  end loop;
  foreach v_table in array array['public.venue_contacts', 'public.venue_counter_bookings', 'public.venue_condition_flags',
                                 'public.venue_condition_warnings'] loop
    assert (select relrowsecurity from pg_class where oid = v_table::regclass), format('%s: RLS on', v_table);
    assert has_table_privilege('authenticated', v_table, 'select'), format('%s: staff read through RLS', v_table);
    assert not has_table_privilege('authenticated', v_table, 'insert')
       and not has_table_privilege('authenticated', v_table, 'update')
       and not has_table_privilege('authenticated', v_table, 'delete'), format('%s: written only by functions', v_table);
    assert not has_table_privilege('anon', v_table, 'select'), format('%s: not anon', v_table);
  end loop;
end $$;

rollback;
