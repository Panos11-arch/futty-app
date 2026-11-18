-- Walk-in and phone bookings in a block (decided 18 November): they're
-- cancelled too, exactly as the dashboard's own cancel does (a paid one gets
-- its reversing counter_paid row), and staff get each contact to call, with
-- what a paid one paid at the counter to hand back. One that has started
-- stays on.
begin;

do $$
declare
  v_owner uuid := tests.create_user('bc4-owner@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 4);
  v_day date := tests.cyprus_today() + 2;
  v_paid uuid;
  v_phone uuid;
  v_free uuid;
  v_later uuid;
  v_list jsonb;
  v_result jsonb;
  v_call jsonb;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  perform tests.act_as(v_owner);
  v_paid := public.add_counter_booking(v_venue, v_day, '18:00', '19:00', '5-a-side', 'walk_in', 'Andreas', null,
                                       p_charged_cents => 4500, p_paid_method => 'cash');
  v_phone := public.add_counter_booking(v_venue, v_day, '18:00', '19:00', '5-a-side', 'phone', 'Maria', '99 000 001');
  v_free := public.add_counter_booking(v_venue, v_day, '18:30', '19:30', '5-a-side', 'walk_in', 'Kids club', null,
                                       p_charged_cents => 0, p_paid_method => 'cash');
  v_later := public.add_counter_booking(v_venue, v_day, '20:00', '21:00', '5-a-side', 'phone', 'Later', '99 000 002');

  v_list := public.venue_block_clashes(v_venue, null, v_day, '18:00', '20:00');
  assert jsonb_array_length(v_list -> 'clashes') = 3, format('three, got %s', v_list);
  v_result := public.venue_add_block(v_venue, null, v_day, '18:00', '20:00', 'Works', v_list ->> 'quote');
  perform tests.act_as_postgres();

  assert (v_result ->> 'cancelled')::integer = 3, 'three cancelled';
  v_call := v_result -> 'call_them';
  assert jsonb_array_length(v_call) = 3, format('three to call, got %s', v_call);
  assert exists (select 1 from jsonb_array_elements(v_call) c
                 where (c ->> 'booking_id')::uuid = v_paid and c ->> 'contact_name' = 'Andreas'
                   and c -> 'phone' = 'null'::jsonb and (c ->> 'refund_cents')::integer = 4500),
    'Andreas paid €45.00 at the counter: hand it back';
  assert exists (select 1 from jsonb_array_elements(v_call) c
                 where (c ->> 'booking_id')::uuid = v_phone and c ->> 'contact_name' = 'Maria'
                   and c ->> 'phone' = '+35799000001' and c ->> 'source' = 'phone'
                   and (c ->> 'refund_cents')::integer = 0), 'Maria hasn''t paid';
  assert exists (select 1 from jsonb_array_elements(v_call) c
                 where (c ->> 'booking_id')::uuid = v_free and (c ->> 'refund_cents')::integer = 0),
    'a free one has nothing to hand back';

  assert (select count(*) from public.venue_bookings where id in (v_paid, v_phone, v_free) and status = 'cancelled') = 3
         and (select count(*) from public.venue_counter_bookings
              where booking_id in (v_paid, v_phone, v_free) and cancelled_at is not null) = 3, 'all three cancelled';
  assert (select status from public.venue_bookings where id = v_later) = 'confirmed', 'the 20:00 one stays on';
  -- The money: one reversing row for the paid one, as cancel_counter_booking.
  assert (select count(*) from public.money_ledger where booking_id = v_paid and kind = 'counter_paid') = 2
         and (select sum(venue_cents) from public.money_ledger where booking_id = v_paid and kind = 'counter_paid') = 0
         and exists (select 1 from public.money_ledger where booking_id = v_paid and kind = 'counter_paid'
                     and venue_cents = -4500 and reason = 'counter_booking_cancelled'),
    'the €45.00 is taken back off revenue';
  assert not exists (select 1 from public.money_ledger where booking_id in (v_phone, v_free)
                     and reason = 'counter_booking_cancelled'), 'nothing to reverse for the others';
end $$;

-- cancel_counter_booking itself is unchanged.
do $$
declare
  v_owner uuid := tests.create_user('bc4c-owner@futty.test');
  v_stranger uuid := tests.create_user('bc4c-stranger@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 1);
  v_walk uuid;
begin
  perform tests.set_price(v_venue, '5-a-side', 5000);
  perform tests.act_as(v_owner);
  v_walk := public.add_counter_booking(v_venue, tests.cyprus_today() + 2, '18:00', '19:00', '5-a-side', 'walk_in',
                                       'Andreas', null, p_paid_method => 'card');
  perform tests.act_as(v_stranger);
  assert tests.error_of(format('select public.cancel_counter_booking(%L)', v_walk)) = 'not_venue_staff', 'staff only';
  assert tests.error_of(format('select public.cancel_counter_booking(%L)', gen_random_uuid())) = 'booking_not_found',
    'unknown booking';
  perform tests.act_as(v_owner);
  perform public.cancel_counter_booking(v_walk);
  assert tests.error_of(format('select public.cancel_counter_booking(%L)', v_walk)) = 'booking_cancelled', 'once';
  perform tests.act_as_postgres();
  assert (select sum(venue_cents) from public.money_ledger where booking_id = v_walk) = 0, 'paid and reversed';
end $$;

select 'pay block clashes 4 (walk-ins) passed' as result;

rollback;
