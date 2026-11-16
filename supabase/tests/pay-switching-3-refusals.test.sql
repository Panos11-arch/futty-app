-- P12: when switching is refused (docs/specs/13-payments-bookings.md,
-- "Switching after booking" and "Server-side checks"; decided 16 November):
--   only the booker; until the refund cutoff before kickoff (exactly at the
--   cutoff is allowed); 6 v 6 -> 5 v 5 only while 10 or fewer have joined;
--   6 v 6 only where the venue allows it and on 5-a-side pitches; once per
--   booking; never a Gipedo Pano booking or another format.
begin;

-- The cutoff: refused 1 minute after it (5h59m before kickoff), allowed at it.
do $$
declare
  v_booker uuid := tests.create_user('switch-cutoff-booker@futty.test');
  v_late public.venue_bookings;
  v_at_cutoff public.venue_bookings;
  v_venue uuid;
begin
  v_venue := tests.create_venue(p_pitches => 1);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_late := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                       p_label => 'switch-late');
  perform tests.pay_ago((tests.player(v_late.id, 0)).id, 'pi_swlate_0', interval '2 hours');
  perform tests.set_kickoff(v_late.id, now() + public.rule_refund_cutoff() - interval '1 minute');
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 6)', v_late.id)) = 'switch_closed',
    'refused at 5h59m before kickoff';
  assert (select capacity from public.venue_bookings where id = v_late.id) = 10, 'still 10 spots';
  assert not exists (select 1 from public.notifications where type = 'booking_switched'
                     and data ->> 'bookingId' = v_late.id::text), 'nobody is told';

  v_venue := tests.create_venue(p_pitches => 1);
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_at_cutoff := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                            p_label => 'switch-cutoff');
  perform tests.pay_ago((tests.player(v_at_cutoff.id, 0)).id, 'pi_swcut_0', interval '2 hours');
  perform tests.set_kickoff(v_at_cutoff.id, now() + public.rule_refund_cutoff());
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 6)', v_at_cutoff.id)) is null,
    'allowed at exactly the cutoff';
  assert (select capacity from public.venue_bookings where id = v_at_cutoff.id) = 12, 'now 12 spots';
end $$;

-- 6 v 6 -> 5 v 5: refused with 11 joined, allowed with 10.
do $$
declare
  v_booker uuid := tests.create_user('switch-eleven-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_6v6_with_players(v_booker, v_venue, 'each_pays_own_spot', 10, tests.cyprus_today() + 3,
                                              p_label => 'switch-eleven');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_sweleven_0', interval '2 hours');
  assert (select count(*) from public.booking_payment_shares where booking_id = v_booking.id) = 11, '11 joined';
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 5)', v_booking.id)) = 'too_many_players',
    'refused with 11 joined';
  assert (select capacity from public.venue_bookings where id = v_booking.id) = 12, 'still 12 spots';

  -- One leaves: 10 joined, allowed.
  update public.booking_payment_shares set status = 'cancelled' where id = (tests.player(v_booking.id, 10)).id;
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 5)', v_booking.id)) is null,
    'allowed with 10 joined';
end $$;

-- Only the booker.
do $$
declare
  v_booker uuid := tests.create_user('switch-who-booker@futty.test');
  v_outsider uuid := tests.create_user('switch-who-outsider@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_booking public.venue_bookings;
  v_player uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 2, tests.cyprus_today() + 3,
                                          p_label => 'switch-who');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swwho_0', interval '2 hours');
  v_player := (tests.player(v_booking.id, 1)).profile_id;
  assert tests.error_as(v_player, format('select public.switch_players_per_side(%L, 6)', v_booking.id)) = 'not_booker',
    'a player in the booking can''t switch';
  assert tests.error_as(v_outsider, format('select public.switch_players_per_side(%L, 6)', v_booking.id)) = 'not_booker',
    'nor can anyone else';
  assert tests.error_as(v_outsider, format('select public.switch_players_per_side(%L, 6)', gen_random_uuid())) = 'booking_not_found',
    'an unknown booking';
  assert (select capacity from public.venue_bookings where id = v_booking.id) = 10, 'still 10 spots';
end $$;

-- 6 v 6 only where the venue allows it, and only on 5-a-side pitches.
do $$
declare
  v_booker uuid := tests.create_user('switch-where-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 1);
  v_big uuid := tests.create_venue(p_pitches => 0);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'switch-noflag');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swnoflag_0', interval '2 hours');
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 6)', v_booking.id)) = 'six_a_side_not_allowed',
    'the venue doesn''t allow 6 v 6';

  -- A 7-a-side pitch that also takes 5s.
  perform tests.create_pitch(v_big, 'Big', '7-a-side', array['5-a-side', '7-a-side']);
  perform tests.set_price(v_big, '5-a-side', 6000);
  update public.venues set allows_6v6_on_5s = true where id = v_big;
  v_booking := tests.booking_with_players(v_booker, v_big, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'switch-big');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swbig_0', interval '2 hours');
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 6)', v_booking.id)) = 'six_a_side_not_allowed',
    'a 5 v 5 on a bigger pitch can''t switch to 6 v 6';
end $$;

-- Other formats, Gipedo Pano, unpaid, cancelled, once only, bad input.
do $$
declare
  v_booker uuid := tests.create_user('switch-what-booker@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_seven public.venue_bookings;
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_venue, '7-a-side', 9000);
  update public.venues set allows_6v6_on_5s = true where id = v_venue;

  perform tests.act_as(v_booker);
  v_seven := public.book_slot(v_venue, tests.cyprus_today() + 3, '15:00', '16:00', 2, '7-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 6)', v_seven.id)) = 'not_switchable',
    'a 7-a-side can''t switch';

  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, tests.cyprus_today() + 3,
                                          p_label => 'switch-what');
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 6)', v_booking.id)) = 'booking_not_confirmed',
    'not until the booker has paid';
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_swwhat_0', interval '2 hours');

  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 7)', v_booking.id)) = 'invalid_players_per_side',
    '5 or 6 a side only';
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 5)', v_booking.id)) = 'already_that_format',
    'already 5 v 5';

  update public.venue_bookings set payment_mode = 'gipedo_pano' where id = v_booking.id;
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 6)', v_booking.id)) = 'not_switchable',
    'Gipedo Pano can''t switch';
  update public.venue_bookings set payment_mode = 'each_pays_own_spot' where id = v_booking.id;

  perform tests.switch(v_booking.id, 6);
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 5)', v_booking.id)) = 'already_switched',
    'once per booking';

  perform tests.cancel(v_booking.id, 'whole_team', v_booker);
  assert tests.error_as(v_booker, format('select public.switch_players_per_side(%L, 5)', v_booking.id)) = 'booking_cancelled',
    'not a cancelled booking';
end $$;

rollback;
