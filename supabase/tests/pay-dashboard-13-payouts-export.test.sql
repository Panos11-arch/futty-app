-- The payouts CSV (docs/specs/13-payments-bookings.md "Venue dashboard",
-- The CSV, the payouts CSV): venue_payouts_export gives every payout sent in
-- a day, week or month (by sent_at, as a Cyprus date), one row per payout
-- and booking with what that payout sent for the booking, each payout's
-- total, and the period's total sent and total reversed. Every amount is
-- read from venue_payouts and venue_payout_items. Pending payouts are left
-- out. Only the venue's owner.
begin;

-- The columns the app's CSV reads (lib/money/payouts-row-columns.json), read
-- from the file itself so the server and the app can't drift apart.
create temp table payouts_csv_columns (ord serial, line text);
\copy payouts_csv_columns (line) from '../lib/money/payouts-row-columns.json'
grant select on payouts_csv_columns to authenticated;

-- Who may call it, and how.
do $$
declare
  v_fn text := 'public.venue_payouts_export(uuid, text, date)';
begin
  assert has_function_privilege('authenticated', v_fn, 'execute'), 'signed-in callers';
  assert has_function_privilege('service_role', v_fn, 'execute'), 'service_role';
  assert not has_function_privilege('anon', v_fn, 'execute'), 'not anon';
  assert (select array_to_string(proconfig, ',') from pg_proc where oid = v_fn::regprocedure) = 'search_path=""',
    'search_path is empty';
  assert (select prosecdef from pg_proc where oid = v_fn::regprocedure), 'security definer';
end $$;

do $$
declare
  v_owner uuid := tests.create_user('pdx-owner@futty.test');
  v_other uuid := tests.create_user('pdx-other@futty.test');
  v_booker uuid := tests.create_user('pdx-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_other_venue uuid := tests.create_venue(p_owner => v_other, p_pitches => 1);
  v_account text;
  v_a public.venue_bookings;
  v_b public.venue_bookings;
  v_a_rows uuid[];
  v_b_rows uuid[];
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
  v_p4 uuid;
  v_p1_a integer;
  v_p1_b integer;
  v_p2_a integer;
  v_p4_b integer;
  v_nov jsonb;
  v_oct jsonb;
  v_day jsonb;
  v_columns jsonb;
  v_row jsonb;
  v_payout jsonb;
  i integer;
begin
  v_columns := (select string_agg(line, E'\n' order by ord) from payouts_csv_columns)::jsonb;
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_account := tests.connect_venue(v_venue);

  -- Two bookings with card money in the ledger: A at 12:00, B at 18:00.
  v_a := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 3, tests.cyprus_today() + 3,
                                    '12:00', '13:00', 'pdx-a');
  v_b := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                    '18:00', '19:00', 'pdx-b');
  for i in 0 .. 3 loop
    perform tests.pay_ago((tests.player(v_a.id, i)).id, 'pi_pdx_a' || i, interval '2 hours');
  end loop;
  for i in 0 .. 1 loop
    perform tests.pay_ago((tests.player(v_b.id, i)).id, 'pi_pdx_b' || i, interval '2 hours');
  end loop;
  select array_agg(id order by created_at, id) into v_a_rows from public.money_ledger
  where booking_id = v_a.id and kind = 'capture';
  select array_agg(id order by created_at, id) into v_b_rows from public.money_ledger
  where booking_id = v_b.id and kind = 'capture';
  assert array_length(v_a_rows, 1) = 4 and array_length(v_b_rows, 1) = 2, 'every player paid by card';

  select sum(venue_cents) into v_p1_a from public.money_ledger where id in (v_a_rows[1], v_a_rows[2]);
  select venue_cents into v_p1_b from public.money_ledger where id = v_b_rows[1];
  select venue_cents into v_p2_a from public.money_ledger where id = v_a_rows[3];
  select venue_cents into v_p4_b from public.money_ledger where id = v_b_rows[2];

  -- P1: sent at 23:30 UTC on 31 October, which is 01:30 on 1 November in
  -- Cyprus. Two of A's rows and one of B's.
  insert into public.venue_payouts (venue_id, booking_id, amount_cents, status, stripe_account_id, stripe_transfer_id,
                                    attempts, sent_at)
  values (v_venue, v_b.id, v_p1_a + v_p1_b, 'sent', v_account, 'tr_pdx_1', 1, '2026-10-31 23:30:00+00')
  returning id into v_p1;
  insert into public.venue_payout_items (payout_id, ledger_id, booking_id, venue_cents)
  select v_p1, l.id, l.booking_id, l.venue_cents from public.money_ledger l
  where l.id in (v_a_rows[1], v_a_rows[2], v_b_rows[1]);

  -- P2: sent on 10 November and reversed in full on 12 November; its items
  -- are released.
  insert into public.venue_payouts (venue_id, booking_id, amount_cents, status, stripe_account_id, stripe_transfer_id,
                                    attempts, sent_at, reversed_at)
  values (v_venue, v_a.id, v_p2_a, 'reversed', v_account, 'tr_pdx_2', 1, '2026-11-10 10:00:00+00',
          '2026-11-12 10:00:00+00')
  returning id into v_p2;
  insert into public.venue_payout_items (payout_id, ledger_id, booking_id, venue_cents, released_at)
  select v_p2, l.id, l.booking_id, l.venue_cents, '2026-11-12 10:00:00+00' from public.money_ledger l
  where l.id = v_a_rows[3];

  -- P3: made but not sent yet (pending).
  insert into public.venue_payouts (venue_id, booking_id, amount_cents, status, stripe_account_id)
  values (v_venue, v_a.id, (select venue_cents from public.money_ledger where id = v_a_rows[4]), 'pending', v_account)
  returning id into v_p3;
  insert into public.venue_payout_items (payout_id, ledger_id, booking_id, venue_cents)
  select v_p3, l.id, l.booking_id, l.venue_cents from public.money_ledger l where l.id = v_a_rows[4];

  -- P4: sent at 21:00 UTC on 31 October, which is 23:00 on 31 October in Cyprus.
  insert into public.venue_payouts (venue_id, booking_id, amount_cents, status, stripe_account_id, stripe_transfer_id,
                                    attempts, sent_at)
  values (v_venue, v_b.id, v_p4_b, 'sent', v_account, 'tr_pdx_4', 1, '2026-10-31 21:00:00+00')
  returning id into v_p4;
  insert into public.venue_payout_items (payout_id, ledger_id, booking_id, venue_cents)
  select v_p4, l.id, l.booking_id, l.venue_cents from public.money_ledger l where l.id = v_b_rows[2];

  -- ---- Owner only ---------------------------------------------------------------
  assert tests.error_as(v_other, format('select public.venue_payouts_export(%L, ''month'', ''2026-11-15'')', v_venue))
         = 'not_venue_staff', 'another venue''s owner is refused';
  assert tests.error_as(v_booker, format('select public.venue_payouts_export(%L, ''month'', ''2026-11-15'')', v_venue))
         = 'not_venue_staff', 'a player is refused';
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.venue_payouts_export(%L, ''month'', ''2026-11-15'')', v_venue))
         like 'permission denied%', 'anon is refused';
  perform tests.act_as_postgres();
  assert tests.error_as(v_owner, format('select public.venue_payouts_export(%L, ''year'', ''2026-11-15'')', v_venue))
         = 'invalid_period', 'only day, week or month';

  perform tests.act_as(v_owner);
  v_nov := public.venue_payouts_export(v_venue, 'month', '2026-11-15');
  v_oct := public.venue_payouts_export(v_venue, 'month', '2026-10-15');
  v_day := public.venue_payouts_export(v_venue, 'day', '2026-11-01');
  perform tests.act_as_postgres();
  assert tests.error_as(v_owner, format('select public.venue_payouts_export(%L, ''month'', ''2026-11-15'')', v_other_venue))
         = 'not_venue_staff', 'an owner can''t read another venue''s payouts';

  assert v_nov ->> 'period' = 'month' and v_nov ->> 'from' = '2026-11-01' and v_nov ->> 'to' = '2026-11-30',
    format('November: %s', v_nov);

  -- ---- Cyprus time: 23:30 UTC on 31 October is November -----------------------
  assert (select array_agg(p ->> 'payout_id') from jsonb_array_elements(v_nov -> 'payouts') p)
         = array[v_p1::text, v_p2::text], format('November has P1 and P2, sent order: %s', v_nov -> 'payouts');
  assert (select array_agg(p ->> 'payout_id') from jsonb_array_elements(v_oct -> 'payouts') p) = array[v_p4::text],
    format('October has only P4: %s', v_oct -> 'payouts');
  v_row := v_nov -> 'rows' -> 0;
  assert v_row ->> 'payout_id' = v_p1::text and v_row ->> 'sent_on' = '2026-11-01' and v_row ->> 'sent_at' = '01:30'
         and v_row ->> 'stripe_transfer_id' = 'tr_pdx_1' and v_row ->> 'status' = 'sent',
    format('P1 is dated 1 November 01:30, Cyprus: %s', v_row);
  v_row := v_oct -> 'rows' -> 0;
  assert v_row ->> 'sent_on' = '2026-10-31' and v_row ->> 'sent_at' = '23:00', format('P4 is 31 October 23:00: %s', v_row);
  assert (select array_agg(p ->> 'payout_id') from jsonb_array_elements(v_day -> 'payouts') p) = array[v_p1::text],
    format('the day 1 November has P1: %s', v_day -> 'payouts');

  -- ---- One row per payout and booking: what that payout sent for it ------------
  assert jsonb_array_length(v_nov -> 'rows') = 3, format('three rows: %s', v_nov -> 'rows');
  assert (v_nov -> 'rows' -> 0 ->> 'booking_id') = v_a.id::text
         and (v_nov -> 'rows' -> 0 ->> 'venue_cents')::integer = v_p1_a
         and (v_nov -> 'rows' -> 0 ->> 'booking_day')::date = v_a.booking_day
         and (v_nov -> 'rows' -> 0 ->> 'start_time') = '12:00:00',
    format('P1 sent A''s two rows as one: %s', v_nov -> 'rows' -> 0);
  assert (v_nov -> 'rows' -> 1 ->> 'booking_id') = v_b.id::text
         and (v_nov -> 'rows' -> 1 ->> 'venue_cents')::integer = v_p1_b
         and (v_nov -> 'rows' -> 1 ->> 'start_time') = '18:00:00',
    format('then B: %s', v_nov -> 'rows' -> 1);

  -- ---- A reversed payout shows as reversed and counts in total reversed --------
  v_row := v_nov -> 'rows' -> 2;
  assert v_row ->> 'payout_id' = v_p2::text and v_row ->> 'status' = 'reversed'
         and (v_row ->> 'venue_cents')::integer = v_p2_a and v_row ->> 'stripe_transfer_id' = 'tr_pdx_2',
    format('P2 is reversed, with what it sent: %s', v_row);
  assert (v_nov -> 'totals' ->> 'reversed_cents')::integer = v_p2_a, format('reversed total: %s', v_nov -> 'totals');
  assert (v_nov -> 'totals' ->> 'sent_cents')::integer = v_p1_a + v_p1_b, format('sent total: %s', v_nov -> 'totals');

  -- ---- Pending payouts are left out --------------------------------------------
  assert not exists (select 1 from jsonb_array_elements(v_nov -> 'rows') r where r ->> 'payout_id' = v_p3::text)
     and not exists (select 1 from jsonb_array_elements(v_nov -> 'payouts') p where p ->> 'payout_id' = v_p3::text),
    'the pending payout is not in the file';
  assert (select count(*) from jsonb_array_elements(v_nov -> 'rows') r where r ->> 'status' = 'pending') = 0,
    'no pending rows';

  -- ---- The totals equal the rows ------------------------------------------------
  foreach v_payout in array array[v_nov, v_oct, v_day] loop
    assert (v_payout -> 'totals' ->> 'rows')::integer = jsonb_array_length(v_payout -> 'rows'), 'rows counted';
    assert (select coalesce(sum((r ->> 'venue_cents')::integer), 0) from jsonb_array_elements(v_payout -> 'rows') r)
           = (v_payout -> 'totals' ->> 'sent_cents')::integer + (v_payout -> 'totals' ->> 'reversed_cents')::integer,
      format('sent and reversed are every row: %s', v_payout);
    assert (select coalesce(sum((p ->> 'amount_cents')::integer) filter (where p ->> 'status' = 'sent'), 0)
            from jsonb_array_elements(v_payout -> 'payouts') p) = (v_payout -> 'totals' ->> 'sent_cents')::integer,
      'sent is the sent payouts';
    assert (select coalesce(sum((p ->> 'amount_cents')::integer) filter (where p ->> 'status' = 'reversed'), 0)
            from jsonb_array_elements(v_payout -> 'payouts') p) = (v_payout -> 'totals' ->> 'reversed_cents')::integer,
      'reversed is the reversed payouts';
    assert not exists (
      select 1 from jsonb_array_elements(v_payout -> 'payouts') p
      where (p ->> 'amount_cents')::integer
              <> (select sum((r ->> 'venue_cents')::integer) from jsonb_array_elements(v_payout -> 'rows') r
                  where r ->> 'payout_id' = p ->> 'payout_id')
         or (p ->> 'rows')::integer
              <> (select count(*) from jsonb_array_elements(v_payout -> 'rows') r where r ->> 'payout_id' = p ->> 'payout_id')),
      format('each payout''s total is its rows: %s', v_payout);
  end loop;
  assert (select p ->> 'amount_cents' from jsonb_array_elements(v_nov -> 'payouts') p where p ->> 'payout_id' = v_p1::text)::integer
         = (select amount_cents from public.venue_payouts where id = v_p1), 'the payout total is venue_payouts.amount_cents';

  -- Its rows have exactly the columns the app's CSV reads.
  assert (select jsonb_agg(k order by k) from jsonb_object_keys(v_nov -> 'rows' -> 0) k)
         = (select jsonb_agg(c order by c) from jsonb_array_elements_text(v_columns) c),
    format('columns %s, got %s', v_columns, v_nov -> 'rows' -> 0);

  -- An empty period: no rows, zero totals.
  perform tests.act_as(v_owner);
  v_day := public.venue_payouts_export(v_venue, 'week', '2026-09-15');
  perform tests.act_as_postgres();
  assert v_day -> 'rows' = '[]'::jsonb and v_day -> 'payouts' = '[]'::jsonb
         and v_day -> 'totals' = '{"rows": 0, "sent_cents": 0, "reversed_cents": 0}'::jsonb,
    format('empty week: %s', v_day);
end $$;

rollback;
