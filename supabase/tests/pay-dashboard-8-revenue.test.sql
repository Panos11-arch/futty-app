-- Revenue by source (docs/specs/13-payments-bookings.md "Venue dashboard",
-- Revenue (P6b), decided 13 November): read from money_ledger.venue_cents,
-- never amount_cents, dated by when the money moved as a Cyprus date; weeks
-- run Monday to Sunday. Sources: app card (every row that went through
-- Stripe or moves money between Futty and the venue), app cash (ticked cash,
-- a debt settled at the venue and Futty's part of it), walk-in and phone
-- (counter_paid, by the walk-in's source). Futty's fee and Stripe's fee are
-- the ledger's own columns. venue_revenue_rows (the CSV) and venue_revenue
-- (the screen) are the same rows and the same totals.
begin;

-- One Cyprus day with app card, app cash and walk-in money, reversals included.
do $$
declare
  v_owner uuid := tests.create_user('rev-owner@futty.test');
  v_owner_b uuid := tests.create_user('rev-owner-b@futty.test');
  v_booker uuid := tests.create_user('rev-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3);
  v_venue_b uuid := tests.create_venue(p_owner => v_owner_b, p_pitches => 1);
  v_today date := tests.cyprus_today();
  v_day date := tests.cyprus_today() + 3;
  v_booking public.venue_bookings;
  v_booking_b public.venue_bookings;
  v_card public.booking_payment_shares;
  v_cash public.booking_payment_shares;
  v_cash_back public.booking_payment_shares;
  v_walk_in uuid;
  v_phone uuid;
  v_debt uuid;
  v_rev jsonb;
  v_src jsonb;
  v_ledger record;
  v_rows record;
  v_back_name text;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_venue_b, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 4, v_day, '12:00', '13:00', 'rev');

  -- App card: €6.80, taken 2 hours ago (out of the free hour): 600 venue,
  -- Stripe's 35, Futty's 45.
  v_card := tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_rev_0', interval '2 hours');
  -- App cash, ticked: €0.80 fee by card (26 Stripe, 54 Futty), €6.00 cash.
  v_cash := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_rev_1', interval '2 hours', 'cash');
  -- App cash, ticked, then cancelled in the free hour: the cash is handed back.
  v_cash_back := tests.pay_ago((tests.player(v_booking.id, 2)).id, 'pi_rev_2', interval '5 minutes', 'cash');
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_cash.id);
  perform public.mark_cash_received(v_cash_back.id);
  perform tests.act_as_postgres();
  perform tests.cancel(v_booking.id, 'my_spot', v_cash_back.profile_id);

  perform tests.act_as(v_owner);
  -- Walk-in at a regular's price: €45.00 instead of €60.00, cash.
  v_walk_in := public.add_counter_booking(v_venue, v_day, '15:00', '16:00', '5-a-side', 'walk_in', 'Regular Rex',
                                          null, null, 4500, 'cash');
  -- Phone booking paid by card at the counter, then cancelled: + and -.
  v_phone := public.add_counter_booking(v_venue, v_day, '17:00', '18:00', '5-a-side', 'phone', 'Caller Cleo',
                                        '99123456', null, null, 'card');
  perform public.cancel_counter_booking(v_phone);
  perform tests.act_as_postgres();

  -- A €6.80 debt settled at the counter: +680 cash, -80 owed to Futty.
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values ((tests.player(v_booking.id, 3)).profile_id, 'venue', v_venue, v_booking.id, 680, 600, 80, 'unpaid_share')
  returning id into v_debt;
  perform tests.act_as(v_owner);
  perform public.settle_debt(v_debt);
  perform tests.act_as_postgres();

  -- Venue B's money the same day is never counted at A.
  v_booking_b := tests.booking_with_players(v_booker, v_venue_b, 'each_pays_own_spot', 0, v_day, '12:00', '13:00', 'rev-b');
  perform tests.pay_ago((tests.player(v_booking_b.id, 0)).id, 'pi_rev_b', interval '2 hours');

  perform tests.act_as(v_owner);
  v_rev := public.venue_revenue(v_venue, 'day', v_today);
  perform tests.act_as_postgres();

  assert v_rev ->> 'period' = 'day' and (v_rev ->> 'from')::date = v_today and (v_rev ->> 'to')::date = v_today,
    format('the day, got %s', v_rev);
  assert (select jsonb_agg(s ->> 'source') from jsonb_array_elements(v_rev -> 'sources') s)
         = '["app_card", "app_cash", "walk_in", "phone"]', 'every source, in order';

  -- The exact amounts.
  assert v_rev -> 'sources' -> 0 @> '{"source": "app_card", "venue_cents": 600, "futty_cents": 99, "stripe_fee_cents": 61}',
    format('app card: 600 venue, 45 + 54 Futty, 35 + 26 Stripe, got %s', v_rev -> 'sources' -> 0);
  assert v_rev -> 'sources' -> 1 @> '{"source": "app_cash", "venue_cents": 1200, "futty_cents": 80, "stripe_fee_cents": 0, "rows": 5}',
    format('app cash: 600 + 600 - 600 + 680 - 80, got %s', v_rev -> 'sources' -> 1);
  assert v_rev -> 'sources' -> 2 @> '{"source": "walk_in", "venue_cents": 4500, "futty_cents": 0, "stripe_fee_cents": 0, "rows": 1}',
    format('walk-in: what was charged, got %s', v_rev -> 'sources' -> 2);
  assert v_rev -> 'sources' -> 3 @> '{"source": "phone", "venue_cents": 0, "futty_cents": 0, "stripe_fee_cents": 0, "rows": 2}',
    format('phone: paid then reversed, got %s', v_rev -> 'sources' -> 3);
  assert v_rev -> 'totals' @> '{"venue_cents": 6300, "futty_cents": 179, "stripe_fee_cents": 61}',
    format('totals, got %s', v_rev -> 'totals');

  -- And they are the ledger: venue A's money rows that moved today, Cyprus time.
  select coalesce(sum(l.venue_cents), 0)::integer as venue, coalesce(sum(l.futty_cents), 0)::integer as futty,
         coalesce(sum(l.stripe_fee_cents), 0)::integer as stripe, count(*)::integer as n
  into v_ledger
  from public.money_ledger l join public.venue_bookings b on b.id = l.booking_id
  where b.venue_id = v_venue and (l.created_at at time zone 'Asia/Nicosia')::date = v_today
    and l.kind in ('capture', 'refund', 'transfer', 'venue_payable', 'cash_received', 'counter_paid', 'debt_cash_received');
  assert (v_rev -> 'totals' ->> 'venue_cents')::integer = v_ledger.venue
         and (v_rev -> 'totals' ->> 'futty_cents')::integer = v_ledger.futty
         and (v_rev -> 'totals' ->> 'stripe_fee_cents')::integer = v_ledger.stripe
         and (v_rev -> 'totals' ->> 'rows')::integer = v_ledger.n,
    format('totals equal the ledger %s, got %s', to_jsonb(v_ledger), v_rev -> 'totals');
  -- Revenue is venue_cents, never amount_cents: the phone booking's +6000 and
  -- -6000 rows both have amount_cents 6000.
  assert (select sum(amount_cents) from public.money_ledger where booking_id = v_phone) = 12000, 'amounts are positive';

  -- The override is shown, with both prices.
  assert jsonb_array_length(v_rev -> 'overrides') = 1
         and v_rev -> 'overrides' -> 0 @> jsonb_build_object('booking_id', v_walk_in, 'source', 'walk_in',
           'contact_name', 'Regular Rex', 'venue_price_cents', 6000, 'charged_cents', 4500),
    format('the discounted walk-in, got %s', v_rev -> 'overrides');

  -- The CSV rows are the same rows with the same totals.
  perform tests.act_as(v_owner);
  select count(*)::integer as n, sum(venue_cents)::integer as venue, sum(futty_cents)::integer as futty,
         sum(stripe_fee_cents)::integer as stripe,
         sum(venue_cents) filter (where source = 'app_card')::integer as card,
         sum(venue_cents) filter (where source = 'app_cash')::integer as cash,
         sum(venue_cents) filter (where source = 'walk_in')::integer as walk_in,
         coalesce(sum(venue_cents) filter (where source = 'phone'), 0)::integer as phone,
         bool_and(moved_on = v_today) as all_today
  into v_rows from public.venue_revenue_rows(v_venue, 'day', v_today);
  perform tests.act_as_postgres();
  assert v_rows.n = v_ledger.n and v_rows.venue = 6300 and v_rows.futty = 179 and v_rows.stripe = 61
         and v_rows.card = 600 and v_rows.cash = 1200 and v_rows.walk_in = 4500 and v_rows.phone = 0 and v_rows.all_today,
    format('rows match the screen, got %s', to_jsonb(v_rows));

  -- Each row says what it is and who.
  v_back_name := public.profile_display_name(v_cash_back.profile_id);
  perform tests.act_as(v_owner);
  assert exists (select 1 from public.venue_revenue_rows(v_venue, 'day', v_today) r
                 where r.source = 'walk_in' and r.kind = 'counter_paid' and r.booking_id = v_walk_in
                   and r.who = 'Regular Rex' and r.venue_price_cents = 6000 and r.charged_cents = 4500
                   and r.booking_day = v_day and r.start_time = '15:00' and r.moved_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
    'the walk-in row';
  assert exists (select 1 from public.venue_revenue_rows(v_venue, 'day', v_today) r
                 where r.source = 'app_cash' and r.kind = 'cash_received' and r.venue_cents = -600
                   and r.reason = 'cash_returned' and r.who = v_back_name),
    'the handed-back cash row';
  assert exists (select 1 from public.venue_revenue_rows(v_venue, 'day', v_today) r
                 where r.source = 'app_cash' and r.kind = 'venue_payable' and r.venue_cents = -80 and r.futty_cents = 80),
    'Futty''s part of the settled debt';
  assert not exists (select 1 from public.venue_revenue_rows(v_venue, 'day', v_today) r
                     where r.booking_id = v_booking_b.id), 'nothing of venue B';
  assert not exists (select 1 from public.venue_revenue_rows(v_venue, 'day', v_today) r
                     where r.venue_price_cents is not null and r.source not in ('walk_in', 'phone')),
    'prices only on walk-in and phone rows';

  -- Venue B sees only its own.
  perform tests.act_as(v_owner_b);
  v_rev := public.venue_revenue(v_venue_b, 'day', v_today);
  assert v_rev -> 'totals' @> '{"venue_cents": 600, "rows": 1}', format('B: its one payment, got %s', v_rev -> 'totals');
  perform tests.act_as_postgres();

  -- Bad input.
  perform tests.act_as(v_owner);
  assert tests.error_of(format($q$ select public.venue_revenue(%L, 'year', %L) $q$, v_venue, v_today)) = 'invalid_period',
    'year';
  assert tests.error_of(format('select public.venue_revenue(%L, null, %L)', v_venue, v_today)) = 'invalid_period', 'null period';
  assert tests.error_of(format($q$ select public.venue_revenue(%L, 'day', null) $q$, v_venue)) = 'invalid_day', 'no day';
  assert tests.error_of(format($q$ select * from public.venue_revenue_rows(%L, 'year', %L) $q$, v_venue, v_today))
         = 'invalid_period', 'rows: year';
  perform tests.act_as_postgres();
end $$;

-- Dated by the Cyprus date the money moved; weeks Monday to Sunday; months
-- by the calendar.
do $$
declare
  v_owner uuid := tests.create_user('rev-dates-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3);
  v_day date := tests.cyprus_today() + 3;
  v_sunday date := date_trunc('week', tests.cyprus_today())::date - 1;
  v_month_end date := date_trunc('month', tests.cyprus_today())::date - 1;
  v_sun_late uuid;
  v_mon_early uuid;
  v_month_last uuid;
  v_month_first uuid;
  v_rev jsonb;
  v_ids uuid[];
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_owner);
  v_sun_late := public.add_counter_booking(v_venue, v_day, '09:00', '10:00', '5-a-side', 'walk_in', 'A', null, null, 100, 'cash');
  v_mon_early := public.add_counter_booking(v_venue, v_day, '10:00', '11:00', '5-a-side', 'walk_in', 'B', null, null, 200, 'cash');
  v_month_last := public.add_counter_booking(v_venue, v_day, '11:00', '12:00', '5-a-side', 'phone', 'C', null, null, 400, 'card');
  v_month_first := public.add_counter_booking(v_venue, v_day, '12:00', '13:00', '5-a-side', 'phone', 'D', null, null, 800, 'card');
  perform tests.act_as_postgres();

  -- 23:30 and 00:30 Cyprus time are both the same UTC day (Cyprus is ahead).
  update public.money_ledger set created_at = (v_sunday + time '23:30') at time zone 'Asia/Nicosia'
  where ref = 'counter_paid:' || v_sun_late;
  update public.money_ledger set created_at = (v_sunday + 1 + time '00:30') at time zone 'Asia/Nicosia'
  where ref = 'counter_paid:' || v_mon_early;
  update public.money_ledger set created_at = (v_month_end + time '23:30') at time zone 'Asia/Nicosia'
  where ref = 'counter_paid:' || v_month_last;
  update public.money_ledger set created_at = (v_month_end + 1 + time '00:30') at time zone 'Asia/Nicosia'
  where ref = 'counter_paid:' || v_month_first;
  assert (select (created_at at time zone 'UTC')::date from public.money_ledger where ref = 'counter_paid:' || v_mon_early)
         = v_sunday, 'Monday 00:30 in Cyprus is still Sunday in UTC';

  perform tests.act_as(v_owner);
  -- The Sunday: only the 23:30 row.
  select array_agg(booking_id) into v_ids from public.venue_revenue_rows(v_venue, 'day', v_sunday);
  assert v_ids @> array[v_sun_late] and not v_ids && array[v_mon_early], format('Sunday, got %s', v_ids);
  -- The Monday: only the 00:30 row.
  select array_agg(booking_id) into v_ids from public.venue_revenue_rows(v_venue, 'day', v_sunday + 1);
  assert v_ids @> array[v_mon_early] and not v_ids && array[v_sun_late], format('Monday, got %s', v_ids);

  -- The week holding that Sunday ends on it; the next starts on the Monday.
  v_rev := public.venue_revenue(v_venue, 'week', v_sunday);
  assert (v_rev ->> 'from')::date = v_sunday - 6 and (v_rev ->> 'to')::date = v_sunday
         and extract(isodow from (v_rev ->> 'from')::date) = 1, format('Monday to Sunday, got %s', v_rev);
  select array_agg(booking_id) into v_ids from public.venue_revenue_rows(v_venue, 'week', v_sunday - 3);
  assert v_ids @> array[v_sun_late] and not v_ids && array[v_mon_early], format('last week, got %s', v_ids);
  select array_agg(booking_id) into v_ids from public.venue_revenue_rows(v_venue, 'week', v_sunday + 1);
  assert v_ids @> array[v_mon_early] and not v_ids && array[v_sun_late], format('this week, got %s', v_ids);

  -- Months by the calendar.
  v_rev := public.venue_revenue(v_venue, 'month', v_month_end);
  assert (v_rev ->> 'from')::date = date_trunc('month', v_month_end)::date and (v_rev ->> 'to')::date = v_month_end,
    format('last month, got %s', v_rev);
  select array_agg(booking_id) into v_ids from public.venue_revenue_rows(v_venue, 'month', v_month_end);
  assert v_ids @> array[v_month_last] and not v_ids && array[v_month_first], format('last month, got %s', v_ids);
  select array_agg(booking_id) into v_ids from public.venue_revenue_rows(v_venue, 'month', v_month_end + 1);
  assert v_ids @> array[v_month_first] and not v_ids && array[v_month_last], format('this month, got %s', v_ids);

  -- A week's screen and CSV agree, source by source.
  v_rev := public.venue_revenue(v_venue, 'week', v_sunday + 1);
  assert (select jsonb_object_agg(s ->> 'source', (s ->> 'venue_cents')::integer) from jsonb_array_elements(v_rev -> 'sources') s)
         = (select jsonb_object_agg(src, coalesce(total, 0))
            from unnest(array['app_card', 'app_cash', 'walk_in', 'phone']) src
            left join lateral (select sum(r.venue_cents)::integer as total
                               from public.venue_revenue_rows(v_venue, 'week', v_sunday + 1) r where r.source = src) t on true),
    format('week sources equal its rows, got %s', v_rev -> 'sources');
  perform tests.act_as_postgres();
end $$;

rollback;
