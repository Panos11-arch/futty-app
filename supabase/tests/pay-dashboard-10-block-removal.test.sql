-- Removing a block (docs/specs/13-payments-bookings.md "Blocking pitches",
-- decided 14 November, Dimitris; for Panos to confirm): staff can remove a
-- block their venue added. It only reopens the slot to new bookings and
-- never touches existing bookings, their players or their money. Staff of
-- another venue, and players, can't remove it.
begin;

do $$
declare
  v_owner uuid := tests.create_user('unblock-owner@futty.test');
  v_other_owner uuid := tests.create_user('unblock-other-owner@futty.test');
  v_booker uuid := tests.create_user('unblock-booker@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 1);
  v_pitch uuid;
  v_day date := tests.cyprus_today() + 2;
  v_booking public.venue_bookings;
  v_block uuid;
  v_rows integer;
  v_shares_before jsonb;
  v_ledger_before integer;
  v_walk_in uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.set_price(v_other_venue, '5-a-side', 6000);
  select id into v_pitch from public.pitches where venue_id = v_venue;

  -- A game booked before the block, with a paid player.
  v_booking := tests.booking_with_players(v_booker, v_venue, 'each_pays_own_spot', 1, v_day, '12:00', '13:00', 'unblock');
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_unblock_0', interval '2 hours');
  select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'amount_cents', amount_cents) order by id)
    into v_shares_before from public.booking_payment_shares where booking_id = v_booking.id;
  select count(*) into v_ledger_before from public.money_ledger where booking_id = v_booking.id;

  -- The owner blocks the pitch from 12:00 to 14:00: no new booking at 13:00.
  perform tests.act_as(v_owner);
  insert into public.venue_blocks (venue_id, pitch_id, block_day, starts_at, ends_at, reason, created_by)
  values (v_venue, v_pitch, v_day, '12:00', '14:00', 'Resurfacing', v_owner)
  returning id into v_block;
  assert tests.error_of(format(
    $q$select public.add_counter_booking(%L, %L, '13:00', '14:00', '5-a-side', 'walk_in', 'Andreas', null, %L)$q$,
    v_venue, v_day, v_pitch)) = 'slot_blocked', 'blocked: no new booking';

  -- Staff of another venue can't remove it, and nor can a player.
  perform tests.act_as(v_other_owner);
  delete from public.venue_blocks where id = v_block;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'another venue''s staff can''t remove it';
  perform tests.act_as(v_booker);
  delete from public.venue_blocks where id = v_block;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'a player can''t remove it';
  perform tests.act_as_postgres();
  assert exists (select 1 from public.venue_blocks where id = v_block), 'still there';

  -- The owner removes it.
  perform tests.act_as(v_owner);
  delete from public.venue_blocks where id = v_block;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'the owner removes it';

  -- The slot takes new bookings again.
  v_walk_in := public.add_counter_booking(v_venue, v_day, '13:00', '14:00', '5-a-side', 'walk_in', 'Andreas', null,
                                          v_pitch);
  perform tests.act_as_postgres();
  assert v_walk_in is not null, 'reopened to new bookings';

  -- The game booked before is untouched: still on, same players, same money.
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  assert v_booking.status = 'confirmed', 'the existing game stays on';
  assert exists (select 1 from public.booking_pitches where booking_id = v_booking.id and pitch_id = v_pitch),
    'it still holds its pitch';
  assert (select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'amount_cents', amount_cents) order by id)
          from public.booking_payment_shares where booking_id = v_booking.id) = v_shares_before,
    'its players and their shares are unchanged';
  assert (select count(*) from public.money_ledger where booking_id = v_booking.id) = v_ledger_before,
    'no money moved';
end;
$$;

rollback;
