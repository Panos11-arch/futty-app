-- P12: who can switch, and what the booking screen is told
-- (docs/specs/13-payments-bookings.md, "Server-side checks"; CLAUDE.md rule 4):
--   switch_players_per_side is for signed-in players (the function checks the
--   booker); signed-out callers can't run it; the helpers that move credit
--   or price shares are service_role only; booking_detail says whether the
--   caller can switch and what each player's pitch part changes by, computed
--   on the server.
begin;

do $$
declare
  v_booker uuid := tests.create_user('switch-sec-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_player uuid;
  v_detail jsonb;
  v_fn text;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'switch-sec');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swsec_0', interval '2 hours');
  v_player := (tests.player(v_booking.id, 1)).profile_id;

  -- Signed out: no access at all.
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.switch_players_per_side(%L, 6)', v_booking.id)) like 'permission denied%',
    'anon can''t switch';
  perform tests.act_as_postgres();

  -- The internal helpers: service_role only.
  foreach v_fn in array array[
    format('select public.issue_switch_credit(%L)', (tests.player(v_booking.id, 0)).id),
    format('select public.booking_switch_info(%L, %L)', v_booking.id, v_booker),
    format('select public.switch_credit_due(s) from public.booking_payment_shares s where s.id = %L', (tests.player(v_booking.id, 0)).id),
    format('select public.switch_refusal(b, %L, 6) from public.venue_bookings b where b.id = %L', v_booker, v_booking.id)
  ] loop
    assert tests.error_as(v_booker, v_fn) like 'permission denied%', format('players can''t run: %s', v_fn);
  end loop;

  -- The booker sees they can switch, and the 100 each player would get.
  perform tests.act_as(v_booker);
  v_detail := public.booking_detail(v_booking.id);
  perform tests.act_as_postgres();
  assert (v_detail -> 'switch' ->> 'can_switch')::boolean and (v_detail -> 'switch' ->> 'to_players_per_side')::integer = 6
         and v_detail -> 'switch' ->> 'money' = 'credit' and (v_detail -> 'switch' ->> 'each_cents')::integer = 100
         and (v_detail -> 'switch' ->> 'booker_cents')::integer = 100
         and (v_detail -> 'switch' ->> 'closes_at')::timestamptz = tests.kickoff_of(v_booking.id) - public.rule_refund_cutoff(),
    format('the booker can switch to 6 v 6 for 100 credit each, got %s', v_detail -> 'switch');

  -- A player sees it, but can't switch.
  perform tests.act_as(v_player);
  v_detail := public.booking_detail(v_booking.id);
  perform tests.act_as_postgres();
  assert not (v_detail -> 'switch' ->> 'can_switch')::boolean and v_detail -> 'switch' ->> 'refusal' = 'not_booker',
    format('a player can''t switch, got %s', v_detail -> 'switch');

  -- After the switch: switched, no second switch.
  perform tests.switch(v_booking.id, 6);
  perform tests.act_as(v_booker);
  v_detail := public.booking_detail(v_booking.id);
  perform tests.act_as_postgres();
  assert (v_detail -> 'switch' ->> 'switched')::boolean and not (v_detail -> 'switch' ->> 'can_switch')::boolean
         and (v_detail -> 'booking' ->> 'players_per_side')::integer = 6,
    format('switched to 6 v 6, got %s', v_detail -> 'switch');
end $$;

-- 6 v 6 -> 5 v 5 on the screen: each paid player pays 100 more.
do $$
declare
  v_booker uuid := tests.create_user('switch-sec6-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_detail jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_6v6_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, tests.cyprus_today() + 3,
                                              p_label => 'switch-sec6');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swsec6_0', interval '2 hours');
  perform tests.act_as(v_booker);
  v_detail := public.booking_detail(v_booking.id);
  perform tests.act_as_postgres();
  assert (v_detail -> 'switch' ->> 'to_players_per_side')::integer = 5 and v_detail -> 'switch' ->> 'money' = 'extra'
         and (v_detail -> 'switch' ->> 'each_cents')::integer = 100,
    format('to 5 v 5 for 100 more each, got %s', v_detail -> 'switch');

  -- A Gipedo Pano booking has no switch.
  update public.venue_bookings set payment_mode = 'gipedo_pano' where id = v_booking.id;
  perform tests.act_as(v_booker);
  v_detail := public.booking_detail(v_booking.id);
  perform tests.act_as_postgres();
  assert v_detail -> 'switch' = 'null'::jsonb, format('no switch, got %s', v_detail -> 'switch');
end $$;

rollback;
