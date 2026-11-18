-- P6e audit fix 1: switching 6 v 6 -> 5 v 5 counts every spot taken, app
-- players and accepted venue players (booking_spots_taken), not only shares
-- (docs/specs/13-payments-bookings.md "Switching after booking" and
-- "Venue-offered players": "He takes a spot").
begin;

create or replace function tests.audit_6v6(p_owner uuid, p_label text)
returns public.venue_bookings
language plpgsql
as $$
declare
  v_venue uuid := tests.create_venue(p_owner => p_owner, p_pitches => 1);
  v_booking public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  -- 10 app players: the booker and 9 others.
  v_booking := tests.booking_6v6_with_players(tests.create_user(p_label || '-booker@futty.test'), v_venue,
                                              'each_pays_own_spot', 9, tests.cyprus_today() + 3, p_label => p_label);
  perform tests.pay_ago((tests.player(v_booking.id, 0)).id, 'pi_' || p_label || '_0', interval '2 hours');
  select * into v_booking from public.venue_bookings where id = v_booking.id;
  return v_booking;
end;
$$;

create or replace function tests.audit_venue_player(p_owner uuid, p_booking public.venue_bookings, p_name text)
returns void
language plpgsql
as $$
declare
  v_offer jsonb;
begin
  perform tests.act_as(p_owner);
  v_offer := public.offer_venue_player(p_booking.id, p_name);
  perform tests.act_as(p_booking.created_by);
  perform public.answer_venue_player((v_offer ->> 'id')::uuid, true);
  perform tests.act_as_postgres();
end;
$$;

-- 10 app players and 2 accepted venue players in a 6 v 6: 12 spots taken,
-- so 5 v 5 (10 spots) is refused and nothing changes.
do $$
declare
  v_owner uuid := tests.create_user('audit-sw-owner@futty.test');
  v_booking public.venue_bookings := tests.audit_6v6(v_owner, 'audit-sw-vp');
begin
  assert v_booking.capacity = 12 and v_booking.status = 'confirmed', format('a confirmed 6 v 6, got %s', row_to_json(v_booking));
  perform tests.audit_venue_player(v_owner, v_booking, 'Andreas');
  perform tests.audit_venue_player(v_owner, v_booking, 'Marios');
  assert (select count(*) from public.booking_payment_shares where booking_id = v_booking.id) = 10, '10 app players';
  assert public.booking_spots_taken(v_booking.id) = 12, '12 spots taken';

  assert tests.error_as(v_booking.created_by, format('select public.switch_players_per_side(%L, 5)', v_booking.id))
         = 'too_many_players', 'refused: 10 app + 2 venue players don''t fit 5 v 5';
  assert (select capacity from public.venue_bookings where id = v_booking.id) = 12, 'still 12 spots';
  assert not exists (select 1 from public.notifications where type = 'booking_switched'
                     and data ->> 'bookingId' = v_booking.id::text), 'nobody is told';
end $$;

-- The same game with no venue player: allowed, as before.
do $$
declare
  v_owner uuid := tests.create_user('audit-sw-plain-owner@futty.test');
  v_booking public.venue_bookings := tests.audit_6v6(v_owner, 'audit-sw-plain');
begin
  assert public.booking_spots_taken(v_booking.id) = 10, '10 spots taken';
  assert tests.error_as(v_booking.created_by, format('select public.switch_players_per_side(%L, 5)', v_booking.id)) is null,
    'allowed: 10 app players fit 5 v 5';
  assert (select capacity from public.venue_bookings where id = v_booking.id) = 10, 'now 10 spots';
end $$;

-- An offer the booker hasn't answered takes no spot, so it doesn't block.
do $$
declare
  v_owner uuid := tests.create_user('audit-sw-open-owner@futty.test');
  v_booking public.venue_bookings := tests.audit_6v6(v_owner, 'audit-sw-open');
begin
  perform tests.act_as(v_owner);
  perform public.offer_venue_player(v_booking.id, 'Andreas');
  perform tests.act_as_postgres();
  assert tests.error_as(v_booking.created_by, format('select public.switch_players_per_side(%L, 5)', v_booking.id)) is null,
    'an open offer doesn''t block the switch';
end $$;

rollback;
