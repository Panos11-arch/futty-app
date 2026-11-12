-- P5: booking_quote, what checkout shows before booking
-- (docs/specs/13-payments-bookings.md, "Prices and fees", "Booking modes",
-- "Venue credit"). Every worked example, with its exact amount:
--   EUR 60 5 v 5: each pays 680; pay for everyone 6550
--   6 v 6 on a 5-a-side pitch: each pays 580; pay for everyone 6660
--   Premium: own share 600; paying for everyone 6495
--   one price EUR 50: 580; crossing into peak (EUR 50 / EUR 60): 630
--   EUR 50 credit on a EUR 60 pitch, paying for everyone: 1550 by card
-- Plus: the non-refundable notice at 5h59m and not at 6h01m, cash refused
-- to a player in debt, and the same refusals as book_slot.
begin;

-- Worked examples on a EUR 60 5-a-side.
do $$
declare
  v_player uuid := tests.create_user('quote-player@futty.test');
  v_premium uuid := tests.create_user('quote-premium@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_six uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  q jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_six, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_six;
  perform tests.make_premium(v_premium);

  perform tests.act_as(v_player);
  q := public.booking_quote(v_venue, v_day, '12:00', '13:00', '5-a-side', 5);
  assert (q ->> 'pitch_cents')::int = 6000, 'the pitch price';
  assert (q ->> 'players')::int = 10, '5 v 5 is 10 players';
  assert (q -> 'each_pays' ->> 'player_cents')::int = 680, format('each pays 680, got %s', q -> 'each_pays');
  assert (q -> 'each_pays' ->> 'player_pitch_cents')::int = 600 and (q -> 'each_pays' ->> 'player_fee_cents')::int = 80,
    'each pays: pitch 600 + service fee 80';
  assert (q -> 'each_pays' -> 'mine' ->> 'card_cents')::int = 680, 'the booker pays 680 too';
  assert (q -> 'pay_all' ->> 'card_cents')::int = 6550, format('pay for everyone 6550, got %s', q -> 'pay_all');
  assert (q -> 'pay_all' ->> 'pitch_cents')::int = 6000 and (q -> 'pay_all' ->> 'fee_cents')::int = 550,
    'pay for everyone: pitch 6000 + 10 x 55';
  assert (q -> 'each_pays' -> 'cash' ->> 'card_cents')::int = 80 and (q -> 'each_pays' -> 'cash' ->> 'cash_cents')::int = 600,
    'cash: 80 by card now, 600 at the venue';
  assert (q -> 'credit' ->> 'available_cents')::int = 0 and q -> 'pay_all' -> 'with_credit' = 'null'::jsonb,
    'no credit, nothing with credit';
  assert (q ->> 'cash_allowed')::boolean and not (q ->> 'in_debt')::boolean, 'cash allowed when not in debt';
  assert q -> 'cancellation' = jsonb_build_object('fee_cents', 100, 'free_minutes', 60, 'refund_cutoff_hours', 6),
    'the cancellation terms come with the quote';
  assert not (q ->> 'non_refundable')::boolean, 'three days ahead is refundable';

  q := public.booking_quote(v_six, v_day, '12:00', '13:00', '5-a-side', 6);
  assert (q ->> 'players')::int = 12, '6 v 6 is 12 players';
  assert (q -> 'each_pays' ->> 'player_cents')::int = 580, format('6 v 6 each pays 580, got %s', q -> 'each_pays');
  assert (q -> 'pay_all' ->> 'card_cents')::int = 6660, format('6 v 6 pay for everyone 6660, got %s', q -> 'pay_all');

  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:00', '13:00', '5-a-side', 6) $q$,
                               v_venue, v_day)) = 'six_a_side_not_allowed',
    '6 v 6 is refused where the venue does not allow it';

  perform tests.act_as(v_premium);
  q := public.booking_quote(v_venue, v_day, '12:00', '13:00', '5-a-side', 5);
  assert (q -> 'each_pays' -> 'mine' ->> 'card_cents')::int = 600, 'a Premium player pays 600 for their own share';
  assert (q -> 'each_pays' ->> 'player_cents')::int = 680, 'the other players still pay 680';
  assert (q -> 'pay_all' ->> 'card_cents')::int = 6495, format('Premium booker pays for everyone: 6495, got %s', q -> 'pay_all');
  perform tests.act_as_postgres();
end $$;

-- One price, and crossing into peak (weekday 16:30-17:30, peak from 17:00).
do $$
declare
  v_player uuid := tests.create_user('quote-peak@futty.test');
  v_one uuid := tests.create_venue(p_pitches => 1);
  v_peak uuid := tests.create_venue(p_pitches => 1);
  v_weekday date := tests.next_weekday(2);
  q jsonb;
begin
  perform tests.set_price(v_one, '5-a-side', 5000);
  perform tests.set_price(v_peak, '5-a-side', 5000, 6000);
  perform tests.act_as(v_player);
  q := public.booking_quote(v_one, v_weekday, '19:00', '20:00', '5-a-side', 5);
  assert (q -> 'each_pays' ->> 'player_cents')::int = 580, format('one price EUR 50: 580 each, got %s', q -> 'each_pays');
  q := public.booking_quote(v_peak, v_weekday, '16:30', '17:30', '5-a-side', 5);
  assert (q ->> 'pitch_cents')::int = 5500, 'half off-peak, half peak: 5500';
  assert (q -> 'each_pays' ->> 'player_cents')::int = 630, format('crossing into peak: 630 each, got %s', q -> 'each_pays');
  perform tests.act_as_postgres();
end $$;

-- Credit at the venue: EUR 50 on a EUR 60 pitch.
do $$
declare
  v_player uuid := tests.create_user('quote-credit@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_other uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  q jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_other, '5-a-side', 6000);
  perform tests.give_credit(v_player, v_venue, 5000);
  perform tests.give_credit(v_player, v_other, 900);
  perform tests.act_as(v_player);
  q := public.booking_quote(v_venue, v_day, '12:00', '13:00', '5-a-side', 5);
  assert (q -> 'credit' ->> 'available_cents')::int = 5000, 'only the credit at this venue counts';
  assert (q -> 'credit' ->> 'expires_at') is not null, 'with its expiry';
  assert q -> 'pay_all' -> 'with_credit' = jsonb_build_object('credit_cents', 5000, 'fee_cents', 550, 'card_cents', 1550),
    format('EUR 50 credit, paying for everyone: 10.00 + 5.50 = 15.50 by card, got %s', q -> 'pay_all' -> 'with_credit');
  assert q -> 'each_pays' -> 'mine' -> 'with_credit' = jsonb_build_object('credit_cents', 600, 'fee_cents', 0, 'card_cents', 0),
    format('credit covering the pitch part: no fee, nothing by card, got %s', q -> 'each_pays' -> 'mine' -> 'with_credit');
  assert (q -> 'each_pays' -> 'mine' ->> 'card_cents')::int = 680, 'without credit the share is unchanged';
  perform tests.act_as_postgres();
end $$;

-- The non-refundable notice: kickoff 5h59m away yes, 6h01m away no.
do $$
declare
  v_player uuid := tests.create_user('quote-late@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1, p_open => '00:00', p_close => '24:00');
  v_slot record;
  v_kickoff timestamptz;
  q jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_player);
  select * into v_slot from tests.slot_starting_in(interval '7 hours');
  q := public.booking_quote(v_venue, v_slot.day, v_slot.start_time, v_slot.end_time, '5-a-side', 5);
  v_kickoff := (q ->> 'kickoff_at')::timestamptz;
  assert v_kickoff = (v_slot.day + v_slot.start_time) at time zone 'Asia/Nicosia', 'kickoff in Cyprus time';
  assert (q ->> 'refunds_stop_at')::timestamptz = v_kickoff - interval '6 hours', 'refunds stop 6 hours before';
  assert not (q ->> 'non_refundable')::boolean, 'more than 6 hours away: refundable';
  perform tests.act_as_postgres();
  -- The rule itself, at the edges the app also tests.
  assert public.money_is_non_refundable(v_kickoff - interval '5 hours 59 minutes', v_kickoff), '5h59m: non-refundable';
  assert not public.money_is_non_refundable(v_kickoff - interval '6 hours 1 minute', v_kickoff), '6h01m: refundable';

  perform tests.act_as(v_player);
  select * into v_slot from tests.slot_starting_in(interval '3 hours');
  q := public.booking_quote(v_venue, v_slot.day, v_slot.start_time, v_slot.end_time, '5-a-side', 5);
  assert (q ->> 'non_refundable')::boolean, 'less than 6 hours away: the notice must be accepted';
  perform tests.act_as_postgres();
end $$;

-- A player in debt: no cash; the same refusals as book_slot.
do $$
declare
  v_player uuid := tests.create_user('quote-debt@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_unpriced uuid := tests.create_venue(p_pitches => 1);
  v_hidden uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
  q jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  delete from public.price_rules where venue_id = v_unpriced;
  update public.venues set is_live = false where id = v_hidden;
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_player, 'venue', v_venue, gen_random_uuid(), 680, 600, 80, 'unpaid_share');

  perform tests.act_as(v_player);
  q := public.booking_quote(v_venue, v_day, '12:00', '13:00', '5-a-side', 5);
  assert (q ->> 'in_debt')::boolean and not (q ->> 'cash_allowed')::boolean, 'a player in debt is offered no cash';

  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:00', '13:00', '5-a-side', 5) $q$,
                               v_unpriced, v_day)) = 'price_not_set', 'no price, no quote';
  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:00', '13:00', '5-a-side', 5) $q$,
                               v_hidden, v_day)) = 'venue_not_found', 'a venue that is not live is not found';
  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:00', '13:00', '5-a-side', 5) $q$,
                               v_venue, tests.cyprus_today() + 8)) = 'beyond_booking_window', 'standard accounts: 7 days';
  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:00', '13:00', '5-a-side', 5) $q$,
                               v_venue, tests.cyprus_today() - 1)) = 'slot_in_past', 'not in the past';
  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:15', '13:15', '5-a-side', 5) $q$,
                               v_venue, v_day)) = 'slot_not_on_grid', 'on the half-hour grid';
  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:00', '13:00', '7-a-side', 5) $q$,
                               v_venue, v_day)) = 'invalid_format', 'a format the venue offers';
  perform tests.act_as_postgres();
end $$;

-- A slot already taken can't be quoted.
do $$
declare
  v_booker uuid := tests.create_user('quote-full-booker@futty.test');
  v_player uuid := tests.create_user('quote-full@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_day date := tests.cyprus_today() + 3;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  perform public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'pay_all');
  perform tests.act_as(v_player);
  assert tests.error_of(format($q$ select public.booking_quote(%L, %L, '12:00', '13:00', '5-a-side', 5) $q$,
                               v_venue, v_day)) = 'slot_full', 'the only pitch is booked';
  perform tests.act_as_postgres();
end $$;

rollback;
