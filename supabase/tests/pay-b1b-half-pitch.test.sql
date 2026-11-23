-- B1b (Booking v2, spec 13 "Two kinds of booking" and "How each side
-- pays"): whole and half pitch, side A with its captain, and each side's way
-- to pay. Every amount is a B0 worked example on a €40.00 5-a-side pitch
-- (10 players). Half pitches stay switched off until B1c-B1e and the app
-- (B2-B5) are done: booking_v2_settings.half_pitch_enabled.
begin;

create function tests.b1b_setup(p_price integer default 4000, out venue uuid, out p1 uuid, out booker uuid)
language plpgsql
as $$
begin
  booker := tests.create_user('b1b-booker-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  p1 := tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  perform tests.set_price(venue, '5-a-side', p_price);
end;
$$;

create function tests.b1b_book(p_venue uuid, p_who uuid, p_kind text, p_mode text, p_day date default null)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
  v_day date := coalesce(p_day, tests.cyprus_today() + 2);
begin
  perform tests.act_as(p_who);
  v_booking := public.book_slot(p_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, p_mode, p_kind => p_kind);
  perform tests.act_as_postgres();
  return v_booking;
end;
$$;

create function tests.b1b_share(p_booking uuid, p_profile uuid)
returns public.booking_payment_shares
language sql
as $$ select * from public.booking_payment_shares where booking_id = p_booking and profile_id = p_profile $$;

-- 0. Half pitches are off until they're switched on.
do $$
declare
  s record := tests.b1b_setup();
begin
  assert not public.half_pitch_enabled(), 'off by default';
  assert tests.error_of(format('select tests.b1b_book(%L, %L, ''half'', ''pay_all'')', s.venue, s.booker))
         = 'half_pitch_not_available', 'refused while off';
end $$;

update public.booking_v2_settings set half_pitch_enabled = true;

-- 1. Whole pitch, pay for everyone: €40.00 + 10 × €0.55 = €45.50 (example 1).
--    A Premium booker: €44.95 (example 11).
do $$
declare
  s record := tests.b1b_setup();
  v public.venue_bookings;
  v_share public.booking_payment_shares;
  v_premium uuid := tests.create_user('b1b-premium-' || gen_random_uuid() || '@futty.test');
begin
  v := tests.b1b_book(s.venue, s.booker, 'whole', 'pay_all');
  v_share := tests.b1b_share(v.id, s.booker);
  assert v.booking_kind = 'whole' and v_share.side is null, 'whole: no sides';
  assert (v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents) = (4550, 4000, 550),
    format('example 1: %s', row(v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents));
  assert not exists (select 1 from public.booking_sides where booking_id = v.id), 'no side rows on a whole pitch';
  perform tests.make_premium(v_premium);
  v := tests.b1b_book(s.venue, v_premium, 'whole', 'pay_all', tests.cyprus_today() + 3);
  assert (tests.b1b_share(v.id, v_premium)).amount_cents = 4495, 'example 11: Premium booker €44.95';
end $$;

-- 2. Whole pitch, pay for myself: each €4.80, the booker's guarantee
--    €40.00 (example 2); a Premium player's own spot €4.00 (example 11).
do $$
declare
  s record := tests.b1b_setup();
  v public.venue_bookings;
  v_joiner uuid := tests.create_user('b1b-joiner-' || gen_random_uuid() || '@futty.test');
  v_premium uuid := tests.create_user('b1b-premium-' || gen_random_uuid() || '@futty.test');
begin
  v := tests.b1b_book(s.venue, s.booker, 'whole', 'each_pays_responsible');
  assert (tests.b1b_share(v.id, s.booker)).amount_cents = 480, 'the booker''s own share €4.80';
  assert (select amount_cents from public.booking_guarantees where booking_id = v.id) = 4000, 'guarantee €40.00';
  perform public.add_booking_share_internal(v.id, v_joiner);
  assert (tests.b1b_share(v.id, v_joiner)).amount_cents = 480, 'a player €4.80';
  perform tests.make_premium(v_premium);
  perform public.add_booking_share_internal(v.id, v_premium);
  assert (tests.b1b_share(v.id, v_premium)).amount_cents = 400, 'a Premium player €4.00';
end $$;

-- 3. Whole pitch, cash: €0.80 in the app and €4.00 in cash (example 3).
do $$
declare
  s record := tests.b1b_setup();
  v public.venue_bookings;
  v_joiner uuid := tests.create_user('b1b-cash-' || gen_random_uuid() || '@futty.test');
  v_plan jsonb;
begin
  v := tests.b1b_book(s.venue, s.booker, 'whole', 'each_pays_responsible');
  perform public.add_booking_share_internal(v.id, v_joiner);
  v_plan := public.plan_share_payment((tests.b1b_share(v.id, v_joiner)).id, v_joiner, 'cash', false);
  assert (v_plan ->> 'amount_cents')::integer = 80 and (v_plan ->> 'cash_cents')::integer = 400,
    format('example 3: %s', v_plan);
end $$;

-- 4. Half pitch, side A pays for everyone: €20.00 + 5 × €0.55 = €22.75
--    (example 4). Side A's row: its half, 5 players, its captain.
do $$
declare
  s record := tests.b1b_setup();
  v public.venue_bookings;
  v_share public.booking_payment_shares;
  v_side public.booking_sides;
begin
  v := tests.b1b_book(s.venue, s.booker, 'half', 'pay_all');
  v_share := tests.b1b_share(v.id, s.booker);
  select * into v_side from public.booking_sides where booking_id = v.id and side = 'a';
  assert v.booking_kind = 'half', 'a half pitch';
  assert (v_side.captain_id, v_side.payment_mode, v_side.pitch_cents, v_side.players) = (s.booker, 'pay_all', 2000, 5),
    format('side A: %s', row(v_side.captain_id, v_side.payment_mode, v_side.pitch_cents, v_side.players));
  assert (v_share.side, v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents) = ('a', 2275, 2000, 275),
    format('example 4: %s', row(v_share.side, v_share.amount_cents, v_share.pitch_cents, v_share.fee_cents));
  assert not exists (select 1 from public.booking_guarantees where booking_id = v.id), 'paying for everyone: no guarantee';
end $$;

-- 5. Half pitch, side A pays for myself: each €4.80; the captain's
--    guarantee is his side's half, €20.00 (example 5, decided 23 November).
--    Players join side A, at most 5.
do $$
declare
  s record := tests.b1b_setup();
  v public.venue_bookings;
  v_player uuid;
  i integer;
begin
  v := tests.b1b_book(s.venue, s.booker, 'half', 'each_pays_responsible');
  assert (tests.b1b_share(v.id, s.booker)).amount_cents = 480, 'the captain''s share €4.80';
  assert (select amount_cents from public.booking_guarantees where booking_id = v.id) = 2000, 'guarantee: his half, €20.00';
  for i in 1 .. 5 loop
    v_player := tests.create_user(format('b1b-side-a-%s-%s@futty.test', i, gen_random_uuid()));
    perform public.add_booking_share_internal(v.id, v_player);
  end loop;
  assert (select count(*) from public.booking_payment_shares where booking_id = v.id and side = 'a') = 5,
    'side A is full at 5: the sixth gets no spot';
  assert (select bool_and(amount_cents = 480) from public.booking_payment_shares where booking_id = v.id), 'each €4.80';
end $$;

-- 6. An odd pitch price: each side pays its half rounded down (decided
--    23 November). €45.55: side A's half €22.77; pay for everyone €25.52;
--    pay for myself €4.55 each, the captain €4.57, plus €0.80.
do $$
declare
  s record := tests.b1b_setup(4555);
  v public.venue_bookings;
begin
  v := tests.b1b_book(s.venue, s.booker, 'half', 'pay_all');
  assert (select pitch_cents from public.booking_sides where booking_id = v.id and side = 'a') = 2277, 'half rounded down';
  assert (tests.b1b_share(v.id, s.booker)).amount_cents = 2552, 'pay for everyone €25.52';
  v := tests.b1b_book(s.venue, s.booker, 'half', 'each_pays_responsible', tests.cyprus_today() + 3);
  assert (tests.b1b_share(v.id, s.booker)).amount_cents = 537, 'the captain €4.57 + €0.80';
  assert (select amount_cents from public.booking_guarantees where booking_id = v.id) = 2277, 'guarantee €22.77';
end $$;

-- 7. A half pitch is card only, with no "Just my spot", and Losers pay
--    arrives in B1d.
do $$
declare
  s record := tests.b1b_setup();
  v public.venue_bookings;
  v_joiner uuid := tests.create_user('b1b-halfcash-' || gen_random_uuid() || '@futty.test');
begin
  assert tests.error_of(format('select tests.b1b_book(%L, %L, ''half'', ''each_pays_own_spot'')', s.venue, s.booker))
         = 'just_my_spot_removed', 'no Just my spot';
  assert tests.error_of(format('select tests.b1b_book(%L, %L, ''half'', ''gipedo_pano'')', s.venue, s.booker))
         = 'losers_pay_not_available', 'Losers pay comes in B1d';
  v := tests.b1b_book(s.venue, s.booker, 'half', 'each_pays_responsible');
  perform public.add_booking_share_internal(v.id, v_joiner);
  assert tests.error_of(format('select public.plan_share_payment(%L, %L, ''cash'', false)',
                               (tests.b1b_share(v.id, v_joiner)).id, v_joiner)) = 'cash_whole_pitch_only',
    'cash is whole pitch only';
end $$;

-- 8. The checkout quote for both kinds (booking_quote_v2).
do $$
declare
  s record := tests.b1b_setup();
  q jsonb;
begin
  perform tests.act_as(s.booker);
  q := public.booking_quote_v2(s.venue, tests.cyprus_today() + 2, '12:00', '13:00', '5-a-side');
  perform tests.act_as_postgres();
  assert (q #>> '{whole,pay_all,card_cents}')::integer = 4550, format('whole, pay for everyone: %s', q -> 'whole');
  assert (q #>> '{whole,pay_for_myself,card_cents}')::integer = 480, 'whole, pay for myself';
  assert (q #>> '{whole,pay_for_myself,guarantee_cents}')::integer = 4000, 'whole guarantee';
  assert (q #>> '{whole,cash,card_cents}')::integer = 80 and (q #>> '{whole,cash,cash_cents}')::integer = 400, 'cash';
  assert (q #>> '{half,pay_all,card_cents}')::integer = 2275, format('half, pay for everyone: %s', q -> 'half');
  assert (q #>> '{half,pay_for_myself,card_cents}')::integer = 480, 'half, pay for myself';
  assert (q #>> '{half,pay_for_myself,guarantee_cents}')::integer = 2000, 'half guarantee';
  assert (q #>> '{half,available}')::boolean, 'half available while switched on';
  assert not (q -> 'half') ? 'cash', 'no cash on a half pitch';
end $$;

-- 9. Collection on a half pitch counts side A's own half and players:
--    4 of 5 paid, the fifth's €4.00 pitch part is due (taken from the
--    captain's €20.00 guarantee at collection).
do $$
declare
  s record := tests.b1b_setup();
  v public.venue_bookings;
  v_player uuid;
  i integer;
  v_due integer;
begin
  v := tests.b1b_book(s.venue, s.booker, 'half', 'each_pays_responsible');
  for i in 1 .. 4 loop
    v_player := tests.create_user(format('b1b-coll-%s-%s@futty.test', i, gen_random_uuid()));
    perform public.add_booking_share_internal(v.id, v_player);
  end loop;
  select sum(due_pitch_cents) into v_due from public.collection_amounts(v.id);
  assert v_due = 2000, format('side A''s pitch part due in all: %s', v_due);
  assert (select bool_and(due_pitch_cents = 400) from public.collection_amounts(v.id)), 'each €4.00';
end $$;

-- 10. A half pitch can't switch to 6 v 6; side rows are read only by people
--     in the booking, and never written by players.
do $$
declare
  s record := tests.b1b_setup();
  v public.venue_bookings;
  v_stranger uuid := tests.create_user('b1b-stranger-' || gen_random_uuid() || '@futty.test');
begin
  v := tests.b1b_book(s.venue, s.booker, 'half', 'pay_all');
  update public.venue_bookings set status = 'confirmed' where id = v.id;
  select * into v from public.venue_bookings where id = v.id;
  assert public.switch_refusal(v, s.booker, 6) = 'not_switchable', 'no 6 v 6 switch on a half pitch';
  perform tests.act_as(s.booker);
  assert (select count(*) from public.booking_sides where booking_id = v.id) = 1, 'the booker sees side A';
  perform tests.act_as(v_stranger);
  assert (select count(*) from public.booking_sides where booking_id = v.id) = 0, 'a stranger doesn''t';
  perform tests.act_as_postgres();
  assert not has_table_privilege('authenticated', 'public.booking_sides', 'insert'), 'players never write sides';
  assert not has_table_privilege('authenticated', 'public.booking_v2_settings', 'update'), 'or switch half pitches on';
end $$;

select 'pay b1b half pitch passed' as result;

rollback;
