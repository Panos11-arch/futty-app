-- P2 rule 8: owner-block inserts and updates re-check venue ownership and capacity.
begin;

do $$
declare
  v_owner uuid := tests.create_user('block-owner@futty.test');
  v_other_owner uuid := tests.create_user('block-other-owner@futty.test');
  v_player uuid := tests.create_user('block-player@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 1;
  v_block uuid;
  v_error text;
begin
  update public.profiles set role = 'venue_owner' where id in (v_owner, v_other_owner);

  -- A player takes both pitches 12:00-13:00 (a 7-a-side on the two combined).
  perform tests.act_as(v_player);
  perform public.book_slot(v_venue, v_day, '12:00', '13:00', 2, '7-a-side', 5);

  -- The owner blocks one pitch at 14:00.
  perform tests.act_as(v_owner);
  insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by, amount_cents, booking_type)
  values (v_venue, v_day, '14:00', '15:00', 1, 0, 'Training', 'confirmed', v_owner, 0, 'owner_block')
  returning id into v_block;

  -- Moving the block onto the full 12:00 slot is refused.
  v_error := tests.error_of(format(
    'update public.venue_bookings set start_time = ''12:00'', end_time = ''13:00'' where id = %L', v_block));
  assert v_error = 'slot_full', format('moving a block onto a full slot: got %s', coalesce(v_error, 'success'));

  -- So is moving it to someone else's venue.
  v_error := tests.error_of(format('update public.venue_bookings set venue_id = %L where id = %L', v_other_venue, v_block));
  assert v_error is not null, 'moving a block to another owner''s venue should be refused';

  -- Cancel it, fill its slot, then reinstating it is refused.
  update public.venue_bookings set status = 'cancelled' where id = v_block;
  perform tests.act_as(v_player);
  perform public.book_slot(v_venue, v_day, '14:00', '15:00', 2, '7-a-side', 5);
  perform tests.act_as(v_owner);
  v_error := tests.error_of(format('update public.venue_bookings set status = ''confirmed'' where id = %L', v_block));
  assert v_error = 'slot_full', format('reinstating a block into a full slot: got %s', coalesce(v_error, 'success'));

  -- Blocking another owner's venue is refused.
  v_error := tests.error_of(format(
    'insert into public.venue_bookings (venue_id, booking_day, start_time, end_time, pitches, capacity, format, status, created_by, amount_cents, booking_type)
     values (%L, %L, ''16:00'', ''17:00'', 1, 0, ''Training'', ''confirmed'', %L, 0, ''owner_block'')', v_other_venue, v_day, v_owner));
  assert v_error is not null, 'blocking another owner''s venue should be refused';
end $$;

select 'pay-guards rule 8 (owner blocks) passed' as result;

rollback;
