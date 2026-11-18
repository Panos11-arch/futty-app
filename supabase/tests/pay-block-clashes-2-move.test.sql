-- Moving a clashing booking (decided 18 November): staff move an app booking
-- to a free pitch, or combination, of the same size that hosts its format, at
-- the same time. The booking keeps its players, shares, payments and match.
-- Refused: a taken, blocked or closed pitch, a different size, a format the
-- pitch doesn't host, another venue's pitch, a walk-in, a game that has
-- started.
begin;

create function tests.bc_venue(p_owner uuid, out venue uuid, out a uuid, out b uuid, out c uuid, out d uuid)
language plpgsql
as $$
begin
  venue := tests.create_venue(p_owner => p_owner, p_pitches => 0);
  a := tests.create_pitch(venue, 'Pitch A', '5-a-side', null, 1);
  b := tests.create_pitch(venue, 'Pitch B', '5-a-side', null, 2);
  c := tests.create_pitch(venue, 'Pitch C', '5-a-side', null, 3);
  d := tests.create_pitch(venue, 'Pitch D', '7-a-side', array['7-a-side', '5-a-side'], 4);
  insert into public.pitch_combinations (venue_id, format, pitch_ids)
  values (venue, '7-a-side', array[a, b]), (venue, '7-a-side', array[b, c]);
  perform tests.set_price(venue, '5-a-side', 6000);
  perform tests.set_price(venue, '7-a-side', 8000);
end;
$$;

create function tests.bc_pitches(p_booking uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select array_agg(pitch_id order by pitch_id) from public.booking_pitches where booking_id = p_booking
$$;

create function tests.bc_sorted(p_ids uuid[])
returns uuid[] language sql immutable as $$ select array_agg(x order by x) from unnest(p_ids) x $$;

do $$
declare
  v_owner uuid := tests.create_user('bc2-owner@futty.test');
  v_other_owner uuid := tests.create_user('bc2-other@futty.test');
  v_booker uuid := tests.create_user('bc2-booker@futty.test');
  v_v record;
  v_other record;
  v_day date := tests.cyprus_today() + 2;
  v_game public.venue_bookings;
  v_seven public.venue_bookings;
  v_walk uuid;
  v_closed uuid;
  v_blocked uuid;
  v_sixes uuid;
  v_shares jsonb;
  v_match uuid;
  v_started public.venue_bookings;
begin
  v_v := tests.bc_venue(v_owner);
  v_other := tests.bc_venue(v_other_owner);
  v_closed := tests.create_pitch(v_v.venue, 'Pitch E', '5-a-side', null, 5);
  update public.pitches set is_open = false where id = v_closed;
  v_blocked := tests.create_pitch(v_v.venue, 'Pitch F', '5-a-side', null, 6);
  insert into public.venue_blocks (venue_id, pitch_id, block_day, starts_at, ends_at, created_by)
  values (v_v.venue, v_blocked, v_day, '17:00', '18:30', v_owner);
  v_sixes := tests.create_pitch(v_v.venue, 'Pitch G', '5-a-side', array['6-a-side'], 7);

  v_game := tests.booking_with_players(v_booker, v_v.venue, 'each_pays_own_spot', 2, v_day, '18:00', '19:00', 'bc2');
  perform tests.pay_ago((tests.player(v_game.id, 0)).id, 'pi_bc2_0', interval '2 hours');
  perform tests.pay_ago((tests.player(v_game.id, 1)).id, 'pi_bc2_1', interval '5 minutes');
  assert tests.bc_pitches(v_game.id) = array[v_v.a], 'the game is on A';
  select jsonb_agg(jsonb_build_object('id', id, 'profile', profile_id, 'status', status, 'amount', amount_cents,
                                      'intent', stripe_payment_intent_id) order by id)
  into v_shares from public.booking_payment_shares where booking_id = v_game.id;
  v_match := (tests.match_of(v_game.id)).id;

  perform tests.act_as(v_owner);
  v_walk := public.add_counter_booking(v_v.venue, v_day, '18:00', '19:00', '5-a-side', 'walk_in', 'Kostas', null, v_v.b);

  -- Refused, in each way.
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_v.b))
         = 'slot_full', 'B is taken';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_v.d))
         = 'invalid_pitches', 'D is a 7-a-side pitch: a different size';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_v.a))
         = 'invalid_pitches', 'it is already on A';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_closed))
         = 'invalid_pitches', 'E is closed';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_blocked))
         = 'pitch_blocked', 'F is blocked';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_sixes))
         = 'invalid_pitches', 'G doesn''t host 5-a-side';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_other.c))
         = 'invalid_pitches', 'another venue''s pitch';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L, %L]::uuid[]) $q$,
                               v_game.id, v_v.b, v_v.c)) = 'invalid_pitches', 'two pitches for a 5-a-side game';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, null) $q$, v_game.id)) = 'invalid_pitches',
    'nowhere';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_walk, v_v.c))
         = 'counter_booking', 'a walk-in isn''t moved here';
  perform tests.act_as(v_other_owner);
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_v.c))
         = 'not_venue_staff', 'another venue''s staff';
  perform tests.act_as(v_booker);
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_game.id, v_v.c))
         = 'not_venue_staff', 'the booker';
  perform tests.act_as_postgres();
  assert tests.bc_pitches(v_game.id) = array[v_v.a], 'still on A';

  -- Moved to C: same time, same players, same money, same match.
  perform tests.act_as(v_owner);
  perform public.venue_move_booking(v_game.id, array[v_v.c]);
  perform tests.act_as_postgres();
  assert tests.bc_pitches(v_game.id) = array[v_v.c], 'now on C';
  assert (select status = 'confirmed' and booking_day = v_day and start_time = '18:00' and end_time = '19:00'
                 and amount_cents = v_game.amount_cents and pitches = 1
          from public.venue_bookings where id = v_game.id), 'the booking itself is unchanged';
  assert v_shares = (select jsonb_agg(jsonb_build_object('id', id, 'profile', profile_id, 'status', status,
                                                         'amount', amount_cents, 'intent', stripe_payment_intent_id)
                                      order by id)
                     from public.booking_payment_shares where booking_id = v_game.id), 'shares and payments unchanged';
  assert (tests.match_of(v_game.id)).id = v_match and (tests.match_of(v_game.id)).status = 'scheduled', 'same match';
  assert not exists (select 1 from public.booking_cancellations where booking_id = v_game.id), 'nothing cancelled';

  -- A combination: the 7-a-side game on A+B (D taken) moves to B+C, not to
  -- A+C (no such combination).
  perform tests.act_as(v_owner);
  perform public.add_counter_booking(v_v.venue, v_day, '20:00', '21:00', '7-a-side', 'walk_in', 'Seven', null, v_v.d);
  perform tests.act_as(tests.create_user('bc2-seven@futty.test'));
  v_seven := public.book_slot(v_v.venue, v_day, '20:00', '21:00', 1, '7-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as(v_owner);
  assert tests.bc_pitches(v_seven.id) = tests.bc_sorted(array[v_v.a, v_v.b]), 'on A+B';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L, %L]::uuid[]) $q$,
                               v_seven.id, v_v.a, v_v.c)) = 'invalid_pitches', 'A+C isn''t a combination';
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_seven.id, v_v.c))
         = 'invalid_pitches', 'one 5-a-side pitch is smaller';
  perform public.venue_move_booking(v_seven.id, array[v_v.b, v_v.c]);
  perform tests.act_as_postgres();
  assert tests.bc_pitches(v_seven.id) = tests.bc_sorted(array[v_v.b, v_v.c]), 'now on B+C';

  -- A game that has kicked off isn't moved.
  v_started := tests.booking_with_players(tests.create_user('bc2-started@futty.test'), v_v.venue, 'each_pays_own_spot',
                                          0, v_day, '10:00', '11:00', 'bc2s');
  perform tests.set_kickoff(v_started.id, now() - interval '10 minutes');
  perform tests.act_as(v_owner);
  assert tests.error_of(format($q$ select public.venue_move_booking(%L, array[%L]::uuid[]) $q$, v_started.id, v_v.c))
         = 'game_started', 'started';
  perform tests.act_as_postgres();
end $$;

select 'pay block clashes 2 (move) passed' as result;

rollback;
