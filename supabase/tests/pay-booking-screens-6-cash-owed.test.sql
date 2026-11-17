-- booking_detail says whether the caller may pay their own share in cash now
-- and what that costs (the payment planner's own rules and amounts), so Pay
-- my share can offer cash; my_owed tells a cash_unpaid item's booking mode
-- and booker, so the app can show spec 13's sentence ("Cash at the venue").
-- Only the caller's own share; everything else unchanged.
begin;

-- booking_detail as p_user, back to postgres afterwards.
create function tests.detail_as(p_user uuid, p_booking uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  v := public.booking_detail(p_booking);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- What booking_detail returned before this change, as p_user: the modes
-- detail, P12's switch and P8's gipedo (null outside Gipedo Pano).
create function tests.detail_before(p_user uuid, p_booking uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.set_claims('postgres', p_user);
  v := public.booking_detail_modes(p_booking)
       || jsonb_build_object('switch', public.booking_switch_info(p_booking, p_user), 'gipedo', null,
                             -- P6e: no venue offers in these games.
                             'venue_players', '[]'::jsonb);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- Cash allowed, with the planner's amounts (EUR 60 pitch, 5 v 5: EUR 6.00
-- pitch part in cash, EUR 0.80 fee by card), only for the caller's own share.
do $$
declare
  v_booker uuid := tests.create_user('cashdetail-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_day date := tests.cyprus_today() + 3;
  v_booking public.venue_bookings;
  v_one public.booking_payment_shares;
  v_two public.booking_payment_shares;
  d jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);

  -- The booker, still paying (booking pending_payment), in responsible mode.
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_responsible', 0, v_day, '12:00', '13:00', 'cd-resp');
  d := tests.detail_as(v_booker, v_booking.id);
  assert (d ->> 'cash_allowed')::boolean, format('the booker may pay cash, got %s', d);
  assert d -> 'me' -> 'cash' = jsonb_build_object('cash_cents', 600, 'card_cents', 80),
    format('EUR 6.00 cash and EUR 0.80 by card, got %s', d -> 'me' -> 'cash');
  assert d - 'cash_allowed' #- '{me,cash}' = tests.detail_before(v_booker, v_booking.id),
    'every other field as before';

  -- Two joiners in just-my-spot mode, once the booker has paid.
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, v_day, '14:00', '15:00', 'cd-own');
  perform tests.hold_share((tests.player(v_booking.id, 0)).id, 'pi_cd_own_booker');
  v_one := tests.player(v_booking.id, 1);
  v_two := tests.player(v_booking.id, 2);
  d := tests.detail_as(v_one.profile_id, v_booking.id);
  assert (d ->> 'cash_allowed')::boolean and d -> 'me' -> 'cash' = jsonb_build_object('cash_cents', 600, 'card_cents', 80),
    format('a joiner may pay EUR 6.00 cash and EUR 0.80 by card, got %s', d);
  assert d - 'cash_allowed' #- '{me,cash}' = tests.detail_before(v_one.profile_id, v_booking.id),
    'every other field as before';
  -- Nothing about anyone else's share: the roster still hides their amounts.
  assert (select bool_and(e -> 'cash' is null and e -> 'amount_cents' = 'null'::jsonb)
          from jsonb_array_elements(d -> 'roster') e where not (e ->> 'is_me')::boolean),
    format('no one else''s amounts, got %s', d -> 'roster');
  assert (d -> 'me' ->> 'share_id')::uuid = v_one.id, 'the cash amounts are for the caller''s own share';

  -- The booker, already paid: nothing to pay, so no cash.
  d := tests.detail_as(v_booker, v_booking.id);
  assert not (d ->> 'cash_allowed')::boolean and d -> 'me' -> 'cash' = 'null'::jsonb,
    format('a paid share has no cash option, got %s', d);

  -- A player in debt can't choose cash (spec 13, "Debt").
  insert into public.venue_debts (profile_id, owed_to, venue_id, booking_id, amount_cents, venue_cents, futty_cents, reason)
  values (v_two.profile_id, 'venue', v_venue, gen_random_uuid(), 680, 600, 80, 'unpaid_share');
  d := tests.detail_as(v_two.profile_id, v_booking.id);
  assert not (d ->> 'cash_allowed')::boolean and d -> 'me' -> 'cash' = 'null'::jsonb,
    format('no cash for a player in debt, got %s', d);
  assert d - 'cash_allowed' #- '{me,cash}' = tests.detail_before(v_two.profile_id, v_booking.id),
    'every other field as before';

  -- Once collection is due (2 hours after the match), no more choosing cash.
  perform tests.end_match(v_booking.id);
  d := tests.detail_as(v_one.profile_id, v_booking.id);
  assert not (d ->> 'cash_allowed')::boolean and d -> 'me' -> 'cash' = 'null'::jsonb,
    format('no cash once collection is due, got %s', d);
end $$;

-- Pay for everyone: card only, for the booker and the players.
do $$
declare
  v_booker uuid := tests.create_user('cashdetail-payall@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  d jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'pay_all', 1, tests.cyprus_today() + 3, '12:00', '13:00', 'cd-all');
  d := tests.detail_as(v_booker, v_booking.id);
  assert not (d ->> 'cash_allowed')::boolean and d -> 'me' -> 'cash' = 'null'::jsonb,
    format('no cash in pay for everyone, got %s', d);
  assert d - 'cash_allowed' #- '{me,cash}' = tests.detail_before(v_booker, v_booking.id),
    'every other field as before';
end $$;

-- Gipedo Pano: card holds only; the Gipedo block is unchanged.
do $$
declare
  v_captain uuid := tests.create_user('cashdetail-gipedo@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_team uuid := tests.create_team('Cash detail Gipedo');
  v_booking public.venue_bookings;
  d jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.join_team(v_team, v_captain, 'captain');
  perform tests.act_as(v_captain);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'gipedo_pano', v_team);
  perform tests.act_as_postgres();
  d := tests.detail_as(v_captain, v_booking.id);
  assert not (d ->> 'cash_allowed')::boolean and d -> 'me' -> 'cash' = 'null'::jsonb,
    format('no cash for a Gipedo hold, got %s', d);
  assert d -> 'gipedo' ->> 'my_side' = 'a' and d -> 'gipedo' -> 'team' ->> 'id' = v_team::text,
    format('the Gipedo block as before, got %s', d -> 'gipedo');
end $$;

-- Who may read it, as before: not a stranger, not a walk-in's "booker".
do $$
declare
  v_owner uuid := tests.create_user('cashdetail-owner@futty.test');
  v_booker uuid := tests.create_user('cashdetail-guard-booker@futty.test');
  v_stranger uuid := tests.create_user('cashdetail-stranger@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_booking public.venue_bookings;
  v_counter uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          '12:00', '13:00', 'cd-guard');
  assert tests.error_as(v_stranger, format('select public.booking_detail(%L)', v_booking.id)) = 'booking_not_found',
    'a stranger learns nothing';
  assert tests.error_as(null, format('select public.booking_detail(%L)', v_booking.id)) = 'not_authenticated',
    'signed out';
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.booking_detail(%L)', v_booking.id)) like 'permission denied%',
    'anon cannot call it';
  perform tests.act_as_postgres();

  perform tests.act_as(v_owner);
  v_counter := public.add_counter_booking(v_venue, tests.cyprus_today() + 3, '16:00', '17:00', '5-a-side', 'walk_in', 'A',
                                          null, p_paid_method => 'cash');
  assert tests.error_of(format('select public.booking_detail(%L)', v_counter)) = 'counter_booking',
    'a walk-in is never an app booking';
  perform tests.act_as_postgres();
end $$;

-- my_owed: a cash_unpaid item tells the booking's mode, the booker's name and
-- whether the caller is the booker; every other field and item as before.
do $$
declare
  v_booker uuid := tests.create_user('cashowed-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_day date := tests.cyprus_today() + 3;
  v_mode text;
  v_start time;
  v_booking public.venue_bookings;
  v_player public.booking_payment_shares;
  v_other public.booking_payment_shares;
  p jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.profiles set full_name = 'Nikos Booker' where id = v_booker;
  for v_mode, v_start in select * from (values ('each_pays_responsible', '12:00'::time),
                                              ('each_pays_own_spot', '14:00'::time)) m loop
    -- Each mode at its own venue, so both can be moved to the same kickoff.
    v_venue := tests.create_venue(p_pitches => 2);
    perform tests.set_price(v_venue, '5-a-side', 6000);
    v_booking := tests.booking_with_players(v_booker, v_venue, v_mode, 2, v_day, v_start,
                                            (v_start + interval '1 hour')::time, 'co-' || left(v_mode, 12));
    perform tests.hold_share((tests.player(v_booking.id, 0)).id, 'pi_co_booker_' || v_mode, p_method => 'cash');
    v_player := tests.player(v_booking.id, 1);
    v_other := tests.player(v_booking.id, 2);
    perform tests.hold_share(v_player.id, 'pi_co_player_' || v_mode, p_method => 'cash');

    -- Before the match: the other player's unpaid spot is due, unchanged.
    perform tests.act_as(v_other.profile_id);
    p := public.my_owed() -> 'payments';
    assert jsonb_array_length(p) = 1 and p -> 0 = jsonb_build_object(
             'kind', 'payment_due', 'booking_id', v_booking.id, 'share_id', v_other.id,
             'venue_name', p -> 0 ->> 'venue_name', 'booking_day', v_booking.booking_day,
             'start_time', p -> 0 -> 'start_time', 'amount_cents', 680),
      format('%s: payment_due as before, got %s', v_mode, p);
    perform tests.act_as_postgres();

    -- After the match, before collection: the unticked cash parts are due. Only
    -- 3 of 10 played, so the EUR 60 pitch is split 3 ways: EUR 20.00 (as before).
    perform tests.set_kickoff(v_booking.id, now() - interval '45 minutes');
    perform tests.act_as(v_player.profile_id);
    p := public.my_owed() -> 'payments';
    assert jsonb_array_length(p) = 1 and (p -> 0) - 'start_time' - 'booking_day' - 'venue_name' = jsonb_build_object(
             'kind', 'cash_unpaid', 'booking_id', v_booking.id, 'share_id', v_player.id, 'amount_cents', 2000,
             'payment_mode', v_mode, 'booker_name', 'Nikos Booker', 'is_booker', false),
      format('%s: the player''s cash part, with mode and booker, got %s', v_mode, p);
    perform tests.act_as(v_booker);
    p := public.my_owed() -> 'payments';
    assert (select e ->> 'kind' = 'cash_unpaid' and (e ->> 'share_id')::uuid = (tests.player(v_booking.id, 0)).id
                   and (e ->> 'is_booker')::boolean and e ->> 'payment_mode' = v_mode
            from jsonb_array_elements(p) e where (e ->> 'booking_id')::uuid = v_booking.id),
      format('%s: the booker''s own cash part says they are the booker, got %s', v_mode, p);
    -- The other player (never paid) sees only their own, never anyone's cash part.
    perform tests.act_as(v_other.profile_id);
    assert not exists (select 1 from jsonb_array_elements(public.my_owed() -> 'payments') e
                       where e ->> 'kind' = 'cash_unpaid'),
      format('%s: no one else''s cash part', v_mode);
    perform tests.act_as_postgres();
  end loop;

  -- A failed guarantee hold has no new fields.
  perform tests.act_as(v_booker);
  v_booking := public.book_slot(v_venue, tests.cyprus_today() + 2, '18:00', '19:00', 1, '5-a-side', 5, 'each_pays_responsible');
  perform tests.act_as_postgres();
  perform tests.hold_share((tests.share_of(v_booking.id, v_booker)).id, 'pi_co_guarantee_share');
  update public.booking_guarantees set status = 'failed', last_error = 'card_declined' where booking_id = v_booking.id;
  perform tests.act_as(v_booker);
  assert (select e - 'start_time' - 'booking_day' - 'venue_name' = jsonb_build_object(
                   'kind', 'card_failed', 'booking_id', v_booking.id, 'share_id', null, 'amount_cents', 6000)
          from jsonb_array_elements(public.my_owed() -> 'payments') e where e ->> 'kind' = 'card_failed'),
    'card_failed as before';
  perform tests.act_as_postgres();
end $$;

rollback;
