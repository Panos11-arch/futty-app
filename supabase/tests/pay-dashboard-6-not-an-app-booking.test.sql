-- A walk-in or phone booking is never an app booking (docs/specs/13-payments-
-- bookings.md "Venue dashboard": no match, no players, no payment mode, no
-- collection). Its booker is the staff member who added it, so every path
-- that trusts "the booker" must refuse it: cancelling (old and new paths and
-- every quote), inviting and accepting, squad posts, booking detail, the
-- match, and above all add_booking_share_internal, the one place players are
-- added and priced. Only cancel_counter_booking cancels it, and a booking
-- cancelled any other way can't be marked paid.
--
-- And the one-booking-per-person-per-start rule, now leaving counter
-- bookings out, still holds for players and owner blocks.
begin;

do $$
declare
  v_owner uuid := tests.create_user('counter-guard-owner@futty.test');
  v_player uuid := tests.create_user('counter-guard-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_day date := tests.cyprus_today() + 2;
  v_counter uuid;
  v_invite uuid;
  v_scope text;
  v_app public.venue_bookings;
  v_err text;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  update public.profiles set username = 'counterguardplayer' where id = v_player;
  perform tests.act_as(v_owner);
  v_counter := public.add_counter_booking(v_venue, v_day, '10:00', '11:00', '5-a-side', 'walk_in', 'A', null,
                                          p_paid_method => 'cash');

  -- As its "booker", the staff member who added it.
  foreach v_scope in array array['my_spot', 'whole_team', 'venue'] loop
    assert tests.error_of(format('select public.cancellation_quote(%L, %L)', v_counter, v_scope)) = 'counter_booking',
      format('no %s quote', v_scope);
  end loop;
  assert tests.error_of(format($q$ select public.add_booking_player(%L, 'counterguardplayer') $q$, v_counter))
         = 'counter_booking', 'no invites';
  assert tests.error_of(format($q$ select public.create_squad_post(%L, null, '5-a-side', 'players',
                                     p_players_needed => 2, p_venue_booking_id => %L) $q$, v_venue, v_counter))
         = 'counter_booking', 'no squad post';
  assert tests.error_of(format('select public.booking_detail(%L)', v_counter)) = 'counter_booking',
    'not in the booker''s booking screens';
  perform tests.act_as_postgres();

  -- Anyone else asking for a quote learns nothing about it: the same error
  -- they get for someone else's app booking, never counter_booking.
  v_app := tests.booking_with_players(v_owner, v_venue, 'each_pays_own_spot', 0, v_day, '12:00', '13:00', 'cg-app');
  foreach v_scope in array array['my_spot', 'whole_team', 'venue'] loop
    v_err := tests.error_as(v_player, format('select public.cancellation_quote(%L, %L)', v_counter, v_scope));
    assert v_err = tests.error_as(v_player, format('select public.cancellation_quote(%L, %L)', v_app.id, v_scope))
       and v_err = case v_scope when 'my_spot' then 'not_in_booking' when 'whole_team' then 'not_your_booking'
                                else 'not_your_venue' end,
      format('a stranger''s %s quote of a walk-in: got %s', v_scope, v_err);
  end loop;
  assert tests.error_as(null, format($q$ select public.cancellation_quote(%L, 'venue') $q$, v_counter))
         = 'not_authenticated', 'signed out';

  -- The cancel-booking Edge Function's two paths (service role).
  assert tests.error_of(format($q$ select public.cancel_booking_internal(%L, 'whole_team', %L, null) $q$, v_counter, v_owner))
         = 'counter_booking', 'cancel_booking_internal';
  assert tests.error_of(format('select public.cancel_booking_for(%L, %L)', v_counter, v_owner)) = 'counter_booking',
    'cancel_booking_for (the path for bookings from before P4a)';

  -- The one place players are added and priced.
  assert tests.error_of(format('select public.add_booking_share_internal(%L, %L)', v_counter, v_player))
         = 'counter_booking', 'add_booking_share_internal';
  assert tests.error_of(format('select public.create_match_for_booking(%L)', v_counter)) = 'not_a_game', 'no match';

  -- An invite that got there anyway can't be accepted.
  insert into public.invites (kind, booking_id, invited_profile_id, invited_by)
  values ('booking', v_counter, v_player, v_owner) returning id into v_invite;
  assert tests.error_as(v_player, format('select public.accept_invite(%L)', v_invite)) = 'counter_booking',
    'no accepting';

  assert not exists (select 1 from public.booking_payment_shares where booking_id = v_counter), 'no shares';
  assert not exists (select 1 from public.matches where booking_id = v_counter), 'no match';
  assert not exists (select 1 from public.squad_posts where venue_booking_id = v_counter), 'no post';
  assert (select status from public.invites where id = v_invite) = 'pending', 'invite not accepted';
  assert (select status from public.venue_bookings where id = v_counter) = 'confirmed', 'still booked';
  assert (select cancelled_at is null from public.venue_counter_bookings where booking_id = v_counter), 'not cancelled';
  assert (select count(*) from public.money_ledger where booking_id = v_counter) = 1, 'only its counter payment';
end $$;

-- A counter booking cancelled some other way can't be marked paid or
-- cancelled again.
do $$
declare
  v_owner uuid := tests.create_user('counter-other-cancel-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_counter uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  perform tests.act_as(v_owner);
  v_counter := public.add_counter_booking(v_venue, tests.cyprus_today() + 2, '10:00', '11:00', '5-a-side',
                                          'walk_in', 'A', null);
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'cancelled' where id = v_counter;

  perform tests.act_as(v_owner);
  assert tests.error_of(format($q$ select public.mark_counter_paid(%L, 'cash') $q$, v_counter)) = 'booking_cancelled',
    'not paid';
  assert tests.error_of(format('select public.cancel_counter_booking(%L)', v_counter)) = 'booking_cancelled',
    'not cancelled twice';
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.money_ledger where booking_id = v_counter), 'no ledger row';
end $$;

-- One active booking per person per start still holds for players and owner
-- blocks; staff may add several counter bookings at one start.
do $$
declare
  v_owner uuid := tests.create_user('counter-index-owner@futty.test');
  v_booker uuid := tests.create_user('counter-index-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 3);
  v_day date := tests.cyprus_today() + 2;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  perform tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 0, v_day, '12:00', '13:00');
  assert tests.error_as(v_booker, format($q$ select public.book_slot(%L, %L, '12:00', '13:00', 1, '5-a-side', 5,
                                                                     'each_pays_own_spot') $q$, v_venue, v_day))
         = 'duplicate_booking', 'a player''s second booking at the same start';

  perform tests.act_as(v_owner);
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status,
                                     created_by, amount_cents, booking_type)
  values (v_venue, v_day, '15:00', '16:00', 1, 0, 'Training', 'confirmed', v_owner, 0, 'owner_block');
  assert tests.error_of(format($q$ insert into public.venue_bookings (venue_id, booking_day, start_time, end_time,
                                     pitches, capacity, format, status, created_by, amount_cents, booking_type)
                                   values (%L, %L, '15:00', '16:00', 1, 0, 'Training', 'confirmed', %L, 0, 'owner_block') $q$,
                               v_venue, v_day, v_owner)) like 'duplicate key%', 'a second owner block at the same start';
  -- Counter bookings at that start, and alongside it, are fine.
  perform public.add_counter_booking(v_venue, v_day, '15:00', '16:00', '5-a-side', 'walk_in', 'A', null);
  perform public.add_counter_booking(v_venue, v_day, '15:00', '16:00', '5-a-side', 'phone', 'B', '99123456');
  perform tests.act_as_postgres();
end $$;

rollback;
