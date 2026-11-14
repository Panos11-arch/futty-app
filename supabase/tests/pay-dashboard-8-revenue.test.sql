-- Revenue by source (docs/specs/13-payments-bookings.md "Venue dashboard",
-- Revenue (P6b), decided 13 November): read from money_ledger.venue_cents,
-- never amount_cents, dated by when the money moved as a Cyprus date; weeks
-- run Monday to Sunday. Sources: app card (every row that went through
-- Stripe or moves money between Futty and the venue), app cash (ticked cash,
-- a debt settled at the venue and Futty's part of it), walk-in and phone
-- (counter_paid, by the walk-in's source). Futty's and Stripe's columns are
-- the ledger's own. venue_revenue_export (the CSV: rows, per-source totals
-- and totals from one snapshot) and venue_revenue (the screen) are the same
-- rows and the same totals.
begin;

-- The export's rows as a table, called as whoever is acting.
create function tests.revenue_rows(p_venue uuid, p_period text, p_day date)
returns table (ledger_id uuid, moved_on date, moved_at text, source text, kind text, reason text, booking_id uuid,
               booking_day date, start_time time, who text, venue_cents integer, futty_cents integer,
               stripe_fee_cents integer, venue_price_cents integer, charged_cents integer)
language sql
as $$
  select * from jsonb_to_recordset(public.venue_revenue_export(p_venue, p_period, p_day) -> 'rows')
    as r (ledger_id uuid, moved_on date, moved_at text, source text, kind text, reason text, booking_id uuid,
          booking_day date, start_time time, who text, venue_cents integer, futty_cents integer,
          stripe_fee_cents integer, venue_price_cents integer, charged_cents integer);
$$;
grant execute on function tests.revenue_rows(uuid, text, date) to authenticated;

-- The columns the app's CSV reads (lib/money/revenue-row-columns.json), read
-- from the file itself so the server and the app can't drift apart.
create temp table revenue_csv_columns (ord serial, line text);
\copy revenue_csv_columns (line) from '../lib/money/revenue-row-columns.json'

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
  v_free uuid;
  v_unpaid_free uuid;
  v_phone uuid;
  v_debt uuid;
  v_rev jsonb;
  v_export jsonb;
  v_columns jsonb;
  v_ledger record;
  v_rows record;
  v_back_name text;
begin
  v_columns := (select string_agg(line, E'\n' order by ord) from revenue_csv_columns)::jsonb;
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
  -- A free walk-in, marked paid: no money moves, but the price was changed.
  v_free := public.add_counter_booking(v_venue, v_day, '19:00', '20:00', '5-a-side', 'walk_in', 'Kids club',
                                       null, null, 0, 'cash');
  -- A free walk-in not marked paid yet: not in the period's revenue.
  v_unpaid_free := public.add_counter_booking(v_venue, v_day, '20:00', '21:00', '5-a-side', 'walk_in', 'Later lot',
                                              null, null, 0);
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
  v_export := public.venue_revenue_export(v_venue, 'day', v_today);
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

  -- Overrides, read from the counter bookings paid in the period: the
  -- discount and the free walk-in (no money moved); not the cancelled phone
  -- booking at the venue's price, nor the free one not yet marked paid.
  assert jsonb_array_length(v_rev -> 'overrides') = 2
         and v_rev -> 'overrides' @> jsonb_build_array(
               jsonb_build_object('booking_id', v_walk_in, 'source', 'walk_in', 'contact_name', 'Regular Rex',
                                  'venue_price_cents', 6000, 'charged_cents', 4500, 'moved_on', v_today),
               jsonb_build_object('booking_id', v_free, 'source', 'walk_in', 'contact_name', 'Kids club',
                                  'venue_price_cents', 6000, 'charged_cents', 0, 'moved_on', v_today)),
    format('the discounted and the free walk-in, got %s', v_rev -> 'overrides');
  assert not (v_rev -> 'overrides')::text like '%' || v_unpaid_free || '%', 'not paid, not shown';

  -- The export is the screen: the same totals and the same per-source totals.
  assert v_export -> 'totals' = v_rev -> 'totals' and v_export -> 'sources' = v_rev -> 'sources'
         and v_export ->> 'from' = v_rev ->> 'from' and v_export ->> 'to' = v_rev ->> 'to',
    format('export %s vs screen %s', v_export, v_rev);
  assert jsonb_array_length(v_export -> 'rows') = v_ledger.n, 'one export row per ledger row';
  -- Its rows have exactly the columns the app's CSV reads.
  assert (select bool_and((select jsonb_agg(k order by k) from jsonb_object_keys(r) k)
                          = (select jsonb_agg(c order by c) from jsonb_array_elements_text(v_columns) c))
          from jsonb_array_elements(v_export -> 'rows') r),
    format('columns %s, got %s', v_columns, v_export -> 'rows' -> 0);

  -- The rows add up to the screen, source by source.
  perform tests.act_as(v_owner);
  select count(*)::integer as n, sum(venue_cents)::integer as venue, sum(futty_cents)::integer as futty,
         sum(stripe_fee_cents)::integer as stripe,
         sum(venue_cents) filter (where source = 'app_card')::integer as card,
         sum(venue_cents) filter (where source = 'app_cash')::integer as cash,
         sum(venue_cents) filter (where source = 'walk_in')::integer as walk_in,
         coalesce(sum(venue_cents) filter (where source = 'phone'), 0)::integer as phone,
         bool_and(moved_on = v_today) as all_today
  into v_rows from tests.revenue_rows(v_venue, 'day', v_today);
  perform tests.act_as_postgres();
  assert v_rows.n = v_ledger.n and v_rows.venue = 6300 and v_rows.futty = 179 and v_rows.stripe = 61
         and v_rows.card = 600 and v_rows.cash = 1200 and v_rows.walk_in = 4500 and v_rows.phone = 0 and v_rows.all_today,
    format('rows match the screen, got %s', to_jsonb(v_rows));

  -- Each row says what it is and who.
  v_back_name := public.profile_display_name(v_cash_back.profile_id);
  perform tests.act_as(v_owner);
  assert exists (select 1 from tests.revenue_rows(v_venue, 'day', v_today) r
                 where r.source = 'walk_in' and r.kind = 'counter_paid' and r.booking_id = v_walk_in
                   and r.who = 'Regular Rex' and r.venue_price_cents = 6000 and r.charged_cents = 4500
                   and r.booking_day = v_day and r.start_time = '15:00' and r.moved_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
    'the walk-in row';
  assert exists (select 1 from tests.revenue_rows(v_venue, 'day', v_today) r
                 where r.source = 'app_cash' and r.kind = 'cash_received' and r.venue_cents = -600
                   and r.reason = 'cash_returned' and r.who = v_back_name),
    'the handed-back cash row';
  assert exists (select 1 from tests.revenue_rows(v_venue, 'day', v_today) r
                 where r.source = 'app_cash' and r.kind = 'venue_payable' and r.venue_cents = -80 and r.futty_cents = 80),
    'Futty''s part of the settled debt';
  assert not exists (select 1 from tests.revenue_rows(v_venue, 'day', v_today) r
                     where r.booking_id = v_booking_b.id), 'nothing of venue B';
  assert not exists (select 1 from tests.revenue_rows(v_venue, 'day', v_today) r
                     where r.venue_price_cents is not null and r.source not in ('walk_in', 'phone')),
    'prices only on walk-in and phone rows';
  assert not exists (select 1 from tests.revenue_rows(v_venue, 'day', v_today) r where r.booking_id = v_free),
    'a free walk-in moves no money';

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
  assert tests.error_of(format($q$ select public.venue_revenue_export(%L, 'year', %L) $q$, v_venue, v_today))
         = 'invalid_period', 'export: year';
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
  select array_agg(booking_id) into v_ids from tests.revenue_rows(v_venue, 'day', v_sunday);
  assert v_ids @> array[v_sun_late] and not v_ids && array[v_mon_early], format('Sunday, got %s', v_ids);
  -- The Monday: only the 00:30 row.
  select array_agg(booking_id) into v_ids from tests.revenue_rows(v_venue, 'day', v_sunday + 1);
  assert v_ids @> array[v_mon_early] and not v_ids && array[v_sun_late], format('Monday, got %s', v_ids);

  -- The week holding that Sunday ends on it; the next starts on the Monday.
  v_rev := public.venue_revenue(v_venue, 'week', v_sunday);
  assert (v_rev ->> 'from')::date = v_sunday - 6 and (v_rev ->> 'to')::date = v_sunday
         and extract(isodow from (v_rev ->> 'from')::date) = 1, format('Monday to Sunday, got %s', v_rev);
  select array_agg(booking_id) into v_ids from tests.revenue_rows(v_venue, 'week', v_sunday - 3);
  assert v_ids @> array[v_sun_late] and not v_ids && array[v_mon_early], format('last week, got %s', v_ids);
  select array_agg(booking_id) into v_ids from tests.revenue_rows(v_venue, 'week', v_sunday + 1);
  assert v_ids @> array[v_mon_early] and not v_ids && array[v_sun_late], format('this week, got %s', v_ids);

  -- Months by the calendar.
  v_rev := public.venue_revenue(v_venue, 'month', v_month_end);
  assert (v_rev ->> 'from')::date = date_trunc('month', v_month_end)::date and (v_rev ->> 'to')::date = v_month_end,
    format('last month, got %s', v_rev);
  select array_agg(booking_id) into v_ids from tests.revenue_rows(v_venue, 'month', v_month_end);
  assert v_ids @> array[v_month_last] and not v_ids && array[v_month_first], format('last month, got %s', v_ids);
  select array_agg(booking_id) into v_ids from tests.revenue_rows(v_venue, 'month', v_month_end + 1);
  assert v_ids @> array[v_month_first] and not v_ids && array[v_month_last], format('this month, got %s', v_ids);

  -- A week's screen and export agree, source by source.
  v_rev := public.venue_revenue(v_venue, 'week', v_sunday + 1);
  assert v_rev -> 'sources' = public.venue_revenue_export(v_venue, 'week', v_sunday + 1) -> 'sources',
    'week: export sources are the screen''s';
  assert (select jsonb_object_agg(s ->> 'source', (s ->> 'venue_cents')::integer) from jsonb_array_elements(v_rev -> 'sources') s)
         = (select jsonb_object_agg(src, coalesce(total, 0))
            from unnest(array['app_card', 'app_cash', 'walk_in', 'phone']) src
            left join lateral (select sum(r.venue_cents)::integer as total
                               from tests.revenue_rows(v_venue, 'week', v_sunday + 1) r where r.source = src) t on true),
    format('week sources equal its rows, got %s', v_rev -> 'sources');
  perform tests.act_as_postgres();

  -- The period is a stable function, and the ledger's dates are indexed.
  assert (select provolatile from pg_proc where oid = 'public.revenue_period(text, date)'::regprocedure) = 's',
    'revenue_period is stable';
  assert exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'money_ledger'
                   and indexdef like '%(created_at)%'), 'money_ledger.created_at is indexed';
end $$;

-- Cash ticked one Cyprus day and handed back the next: each row on its own day.
do $$
declare
  v_owner uuid := tests.create_user('rev-back-owner@futty.test');
  v_booker uuid := tests.create_user('rev-back-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_today date := tests.cyprus_today();
  v_booking public.venue_bookings;
  v_cash public.booking_payment_shares;
  v_yesterday jsonb;
  v_now jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, v_today + 3, '12:00', '13:00', 'rev-back');
  v_cash := tests.pay_ago((tests.player(v_booking.id, 1)).id, 'pi_rev_back', interval '5 minutes', 'cash');
  perform tests.act_as(v_owner);
  perform public.mark_cash_received(v_cash.id);
  perform tests.act_as_postgres();
  perform tests.cancel(v_booking.id, 'my_spot', v_cash.profile_id);
  -- Ticked late yesterday evening, Cyprus time.
  update public.money_ledger set created_at = ((v_today - 1) + time '23:50') at time zone 'Asia/Nicosia'
  where share_id = v_cash.id and kind = 'cash_received' and venue_cents > 0;

  perform tests.act_as(v_owner);
  v_yesterday := public.venue_revenue_export(v_venue, 'day', v_today - 1);
  v_now := public.venue_revenue_export(v_venue, 'day', v_today);
  perform tests.act_as_postgres();
  assert v_yesterday -> 'sources' -> 1 @> '{"source": "app_cash", "venue_cents": 600, "rows": 1}',
    format('yesterday: the cash taken, got %s', v_yesterday -> 'sources' -> 1);
  assert (select bool_and(r ->> 'moved_on' = (v_today - 1)::text) from jsonb_array_elements(v_yesterday -> 'rows') r),
    'yesterday''s rows are yesterday''s';
  assert v_now -> 'sources' -> 1 @> '{"source": "app_cash", "venue_cents": -600, "rows": 1}',
    format('today: the cash handed back, got %s', v_now -> 'sources' -> 1);
end $$;

-- Rows that aren't a person's money have no "who"; a counter_paid row
-- without a walk-in or phone booking is refused, and never read as no source.
do $$
declare
  v_owner uuid := tests.create_user('rev-who-owner@futty.test');
  v_booker uuid := tests.create_user('rev-who-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_today date := tests.cyprus_today();
  v_booking public.venue_bookings;
  v_export jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_today + 3, '12:00', '13:00', 'rev-who');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_rev_who', interval '2 hours');
  -- A venue-level movement: no share, debt or guarantee behind it.
  insert into public.money_ledger (booking_id, kind, amount_cents, ref, reason, venue_cents, futty_cents)
  values (v_booking.id, 'transfer', 100, 'rev-who-venue-level', 'venue_level_test', -100, 100);

  perform tests.act_as(v_owner);
  v_export := public.venue_revenue_export(v_venue, 'day', v_today);
  perform tests.act_as_postgres();
  assert (select r -> 'who' = 'null'::jsonb from jsonb_array_elements(v_export -> 'rows') r where r ->> 'reason' = 'venue_level_test'),
    format('venue-level: nobody, got %s', v_export -> 'rows');
  assert (select r ->> 'who' from jsonb_array_elements(v_export -> 'rows') r where r ->> 'kind' = 'capture')
         = public.profile_display_name(v_booker), 'a share''s row names its player';

  -- counter_paid on an app booking: refused when written.
  assert tests.error_of(format($q$ insert into public.money_ledger (booking_id, kind, amount_cents, ref, reason, venue_cents)
                                   values (%L, 'counter_paid', 500, 'rev-who-counter', 'x', 500) $q$, v_booking.id))
         = 'counter_paid_needs_counter_booking', 'counter_paid needs a walk-in or phone booking';
  -- And if one ever got in, reading it fails loudly.
  alter table public.money_ledger disable trigger money_ledger_counter_paid_check;
  insert into public.money_ledger (booking_id, kind, amount_cents, ref, reason, venue_cents)
  values (v_booking.id, 'counter_paid', 500, 'rev-who-counter', 'x', 500);
  alter table public.money_ledger enable trigger money_ledger_counter_paid_check;
  perform tests.act_as(v_owner);
  assert tests.error_of(format($q$ select public.venue_revenue_export(%L, 'day', %L) $q$, v_venue, v_today))
         = 'counter_paid_without_source', 'export refuses';
  assert tests.error_of(format($q$ select public.venue_revenue(%L, 'day', %L) $q$, v_venue, v_today))
         = 'counter_paid_without_source', 'screen refuses';
  perform tests.act_as_postgres();
end $$;

rollback;
