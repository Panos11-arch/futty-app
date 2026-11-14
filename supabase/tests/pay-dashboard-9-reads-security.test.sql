-- Only a venue's own staff can read its money and its people (docs/specs/14
-- P6: "Only staff of that venue can do any of this (RLS and function
-- checks)"). On venue B, every P6b read is refused to venue A's staff and to
-- a player (not_venue_staff) and closed to signed-out callers; B's own staff
-- get their answers. The internal helpers are closed to the app.
begin;

do $$
declare
  v_owner_a uuid := tests.create_user('reads-sec-owner-a@futty.test');
  v_owner_b uuid := tests.create_user('reads-sec-owner-b@futty.test');
  v_booker uuid := tests.create_user('reads-sec-booker@futty.test');
  v_venue_a uuid := tests.create_venue(p_owner => v_owner_a, p_pitches => 1);
  v_venue_b uuid := tests.create_venue(p_owner => v_owner_b, p_pitches => 1);
  v_day date := tests.cyprus_today() + 2;
  v_today date := tests.cyprus_today();
  v_booking_b public.venue_bookings;
  v_counter_b uuid;
  v_contact_b uuid;
  v_reads text[];
  v_caller uuid;
  v_sql text;
  v_err text;
begin
  perform tests.set_price(v_venue_a, '5-a-side', 6000);
  perform tests.set_price(v_venue_b, '5-a-side', 6000);
  v_booking_b := tests.booking_with_players(v_booker, v_venue_b, 'each_pays_own_spot', 0, v_day, '12:00', '13:00', 'reads-sec');
  perform tests.pay_ago((tests.player(v_booking_b.id, 0)).id, 'pi_reads_sec', interval '2 hours');
  perform tests.give_credit(v_booker, v_venue_b, 580);
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_booker, 'venue', v_venue_b, v_booking_b.id, 680, 600, 80, 'unpaid_share');
  perform tests.act_as(v_owner_b);
  v_counter_b := public.add_counter_booking(v_venue_b, v_day, '15:00', '16:00', '5-a-side', 'phone', 'B regular',
                                            '+35799000019', null, null, 'cash');
  perform tests.act_as_postgres();
  select contact_id into v_contact_b from public.venue_counter_bookings where booking_id = v_counter_b;

  v_reads := array[
    format($q$ select public.venue_revenue(%L, 'day', %L) $q$, v_venue_b, v_today),
    format($q$ select public.venue_revenue_export(%L, 'month', %L) $q$, v_venue_b, v_today),
    format('select public.venue_bookings_list(%L, %L, %L)', v_venue_b, v_today, v_day),
    format('select public.venue_customers(%L)', v_venue_b),
    format($q$ select public.venue_customer(%L, 'player', %L) $q$, v_venue_b, v_booker),
    format($q$ select public.venue_customer(%L, 'contact', %L) $q$, v_venue_b, v_contact_b),
    format('select public.venue_debt_list(%L, true)', v_venue_b),
    format('select public.venue_credit_list(%L)', v_venue_b)
  ];

  -- Venue A's staff, and a player (B's own customer, even), are refused.
  foreach v_caller in array array[v_owner_a, v_booker] loop
    perform tests.act_as(v_caller);
    foreach v_sql in array v_reads loop
      v_err := tests.error_of(v_sql);
      assert v_err = 'not_venue_staff', format('%s as %s: expected not_venue_staff, got %s', v_sql,
        case when v_caller = v_owner_a then 'venue A staff' else 'a player' end, coalesce(v_err, 'success'));
    end loop;
    -- The internal helpers aren't callable from the app.
    assert tests.error_of(format($q$ select public.revenue_period('day', %L) $q$, v_today))
           like 'permission denied%', 'revenue_period is internal';
    assert tests.error_of(format('select public.venue_has_customer(%L, %L)', v_venue_b, v_booker))
           like 'permission denied%', 'venue_has_customer is internal';
    assert tests.error_of(format('select * from public.revenue_rows(%L, now() - interval ''1 day'', now())', v_venue_b))
           like 'permission denied%', 'revenue_rows is internal';
    assert tests.error_of('select public.backfill_debt_cash_received()') like 'permission denied%',
      'the backfill is internal';
    perform tests.act_as_postgres();
  end loop;

  -- Signed out: closed.
  perform tests.act_as_anon();
  foreach v_sql in array v_reads loop
    v_err := tests.error_of(v_sql);
    assert v_err like 'permission denied%', format('%s signed out: expected permission denied, got %s', v_sql,
                                                    coalesce(v_err, 'success'));
  end loop;
  perform tests.act_as_postgres();

  -- B's own staff get their answers.
  perform tests.act_as(v_owner_b);
  foreach v_sql in array v_reads loop
    v_err := tests.error_of(v_sql);
    assert v_err is null, format('%s as B''s staff: expected success, got %s', v_sql, v_err);
  end loop;
  assert (public.venue_revenue(v_venue_b, 'day', v_today) -> 'totals' ->> 'rows')::integer = 2,
    'B''s card payment and walk-in';
  perform tests.act_as_postgres();
end $$;

rollback;
