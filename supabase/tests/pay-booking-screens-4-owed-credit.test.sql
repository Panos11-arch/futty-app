-- P5: my_owed and my_credit, for "Pay what I owe", the debt banner and the
-- credit screen (docs/specs/13-payments-bookings.md, "Debt", "Venue
-- credit"; 15-design.md section 5, "Debt and credit"). Each player sees
-- only their own.
begin;

do $$
declare
  v_player uuid := tests.create_user('owed-player@futty.test');
  v_other uuid := tests.create_user('owed-other@futty.test');
  v_booker uuid := tests.create_user('owed-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_booking public.venue_bookings;
  v_guarantee_booking public.venue_bookings;
  o jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);

  -- Nothing owed.
  perform tests.act_as(v_player);
  o := public.my_owed();
  assert o = jsonb_build_object('blocked', false, 'debt_cents', 0, 'debts', '[]'::jsonb, 'payments', '[]'::jsonb),
    format('nothing owed, got %s', o);
  perform tests.act_as_postgres();

  -- A spot not yet paid, and the booker's failed guarantee hold.
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_guarantee_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '18:00', '19:00', 1, '5-a-side', 5,
                                          'each_pays_responsible');
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_owed_booker');
  perform tests.join_booking(v_booking.id, v_player);
  perform tests.hold_share((tests.share_of(v_guarantee_booking.id, v_booker)).id, 'pi_owed_guarantee_share');
  update public.booking_guarantees set status = 'failed', last_error = 'card_declined'
  where booking_id = v_guarantee_booking.id;

  -- A debt to the venue and one to Futty: both block, both listed.
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_player, 'venue', v_venue, gen_random_uuid(), 680, 600, 80, 'unpaid_share'),
         (v_player, 'futty', null, gen_random_uuid(), 600, 0, 600, 'cancellation_fee'),
         (v_other, 'venue', v_venue, gen_random_uuid(), 680, 600, 80, 'unpaid_share');
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason,
                                  settled_at, settled_by)
  values (v_player, 'venue', v_venue, gen_random_uuid(), 500, 500, 0, 'cash_unpaid', now(), 'venue');

  perform tests.act_as(v_player);
  o := public.my_owed();
  assert (o ->> 'blocked')::boolean, 'a debt blocks booking';
  assert (o ->> 'debt_cents')::int = 1280, format('680 to the venue + 600 to Futty, got %s', o ->> 'debt_cents');
  assert jsonb_array_length(o -> 'debts') = 2, 'only their unpaid debts';
  assert (select (d ->> 'venue_id')::uuid = v_venue and d ->> 'venue_name' like 'Test venue%'
                 and (d ->> 'amount_cents')::int = 680
          from jsonb_array_elements(o -> 'debts') d where d ->> 'owed_to' = 'venue'),
    'owed to which venue, and how much';
  assert (select d -> 'venue_name' = 'null'::jsonb and (d ->> 'amount_cents')::int = 600
          from jsonb_array_elements(o -> 'debts') d where d ->> 'owed_to' = 'futty'),
    'a debt to Futty has no venue';
  assert jsonb_array_length(o -> 'payments') = 1 and o -> 'payments' -> 0 ->> 'kind' = 'payment_due'
         and (o -> 'payments' -> 0 ->> 'amount_cents')::int = 680
         and (o -> 'payments' -> 0 ->> 'booking_id')::uuid = v_booking.id,
    format('their unpaid spot is due, got %s', o -> 'payments');

  perform tests.act_as(v_booker);
  o := public.my_owed();
  assert not (o ->> 'blocked')::boolean, 'a failed payment is not a debt';
  assert jsonb_array_length(o -> 'payments') = 1 and o -> 'payments' -> 0 ->> 'kind' = 'card_failed'
         and (o -> 'payments' -> 0 ->> 'amount_cents')::int = 6000,
    format('the booker''s failed guarantee hold, got %s', o -> 'payments');

  -- After the match, an unticked cash part is due (debts settled first: a
  -- player in debt can't choose cash).
  perform tests.act_as_postgres();
  update public.venue_debts set settled_at = now(), settled_by = 'venue' where profile_id = v_player and settled_at is null;
  perform tests.hold_share((tests.share_of(v_booking.id, v_player)).id, 'pi_owed_cash', p_method => 'cash');
  perform tests.set_kickoff(v_booking.id, now() - interval '45 minutes');
  perform tests.act_as(v_player);
  o := public.my_owed();
  assert jsonb_array_length(o -> 'payments') = 1 and o -> 'payments' -> 0 ->> 'kind' = 'cash_unpaid'
         and (o -> 'payments' -> 0 ->> 'amount_cents')::int = 3000,
    format('only 2 of 10 joined, so the EUR 60 pitch is split 2 ways: pay EUR 30.00 by card now, got %s', o -> 'payments');
  perform tests.act_as_postgres();
  update public.booking_payment_shares set cash_received_at = now() where booking_id = v_booking.id and profile_id = v_player;
  perform tests.act_as(v_player);
  assert jsonb_array_length(public.my_owed() -> 'payments') = 0, 'nothing due once the venue ticks it';

  perform tests.act_as_anon();
  assert tests.error_of($q$ select public.my_owed() $q$) like 'permission denied%', 'anon cannot call my_owed';
  perform tests.act_as_postgres();
end $$;

-- Credit per venue, with expiry, soonest first; only the caller's own.
do $$
declare
  v_player uuid := tests.create_user('credit-player@futty.test');
  v_other uuid := tests.create_user('credit-other@futty.test');
  v_a uuid := tests.create_venue(p_pitches => 1);
  v_b uuid := tests.create_venue(p_pitches => 1);
  c jsonb;
begin
  perform tests.give_credit(v_player, v_a, 580, interval '2 months');
  perform tests.give_credit(v_player, v_a, 100);
  perform tests.give_credit(v_player, v_b, 500, interval '6 months');
  perform tests.give_credit(v_player, v_b, 900, interval '13 months');   -- expired
  perform tests.give_credit(v_other, v_a, 700);

  perform tests.act_as(v_player);
  c := public.my_credit();
  assert jsonb_array_length(c) = 2, format('two venues, got %s', c);
  assert (c -> 0 ->> 'venue_id')::uuid = v_b and (c -> 0 ->> 'available_cents')::int = 500,
    'the venue whose credit expires soonest first; expired credit is left out';
  assert (c -> 1 ->> 'venue_id')::uuid = v_a and (c -> 1 ->> 'available_cents')::int = 680, '580 + 100 at the other venue';
  assert jsonb_array_length(c -> 1 -> 'credits') = 2
         and (c -> 1 -> 'credits' -> 0 ->> 'remaining_cents')::int = 580
         and (c -> 1 -> 'credits' -> 0 ->> 'expires_at')::timestamptz < (c -> 1 -> 'credits' -> 1 ->> 'expires_at')::timestamptz,
    'each credit with its expiry, soonest first';

  perform tests.act_as(v_other);
  assert jsonb_array_length(public.my_credit()) = 1, 'another player sees only their own';
  perform tests.act_as_anon();
  assert tests.error_of($q$ select public.my_credit() $q$) like 'permission denied%', 'anon cannot call my_credit';
  perform tests.act_as_postgres();
end $$;

-- Security: definer functions with an empty search_path; the helper is internal.
do $$
declare
  f text;
begin
  foreach f in array array['booking_search_options()', 'venues_free_at(date,time,integer,text,integer)',
                           'booking_quote(uuid,date,time,time,text,integer)', 'booking_detail(uuid)', 'my_owed()',
                           'my_credit()', 'venue_page(uuid)', 'booking_slot_checked(uuid,date,time,time,text,integer,boolean)']
  loop
    assert (select p.prosecdef and p.proconfig @> array['search_path=""']
            from pg_proc p where p.oid = ('public.' || f)::regprocedure),
      format('%s is security definer with search_path = ''''', f);
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), format('anon cannot call %s', f);
  end loop;
  assert not has_function_privilege('authenticated', 'public.booking_slot_checked(uuid,date,time,time,text,integer,boolean)',
                                    'execute'), 'booking_slot_checked is internal';
  assert has_function_privilege('service_role', 'public.booking_slot_checked(uuid,date,time,time,text,integer,boolean)',
                                'execute'), 'service_role may call it';
  assert has_function_privilege('authenticated', 'public.booking_quote(uuid,date,time,time,text,integer)', 'execute'),
    'the app may call booking_quote';
end $$;

rollback;
