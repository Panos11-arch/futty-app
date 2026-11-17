-- U8 (docs/app-store-screenshots.md): the local seed gives player1 a next
-- game, a team and a result, and every amount in it is the server's own.
-- CI loads supabase/seed.sql before these tests (supabase db start).
begin;

do $$
declare
  v_player1 uuid := 'a0000000-0000-4000-8000-000000000002';
  v_player3 uuid := 'a0000000-0000-4000-8000-000000000004';
  v_north uuid := 'b0000000-0000-4000-8000-000000000001';
  v_booking public.venue_bookings;
  v_unpaid public.booking_payment_shares;
  v_plan jsonb;
begin
  select * into v_booking from public.venue_bookings where created_by = v_player1 and venue_id = v_north;
  assert v_booking.id is not null, 'player1 has a booking at Test Arena North';

  -- In the future, in Cyprus time, inside the 7-day window.
  assert (v_booking.booking_day + v_booking.start_time) > (now() at time zone 'Asia/Nicosia'), 'kicks off later';
  assert v_booking.booking_day <= (now() at time zone 'Asia/Nicosia')::date + 7, 'inside the booking window';

  -- The price is the venue's, as book_slot works it out; nothing hard-coded.
  assert v_booking.amount_cents = public.slot_price_cents(v_north, v_booking.booking_day, v_booking.start_time,
                                                          v_booking.end_time, '5-a-side'),
    format('server price, got %s', v_booking.amount_cents);

  -- Three players: two cards held, player3 still to pay, each share as the
  -- server plans it.
  assert (select count(*) from public.booking_payment_shares where booking_id = v_booking.id) = 3, 'three players';
  assert (select count(*) from public.booking_payment_shares where booking_id = v_booking.id and status = 'authorized') = 2,
    'two held';
  select * into v_unpaid from public.booking_payment_shares where booking_id = v_booking.id and profile_id = v_player3;
  assert v_unpaid.status = 'pending', 'player3 has not paid';
  v_plan := public.plan_share_payment(v_unpaid.id, v_player3, 'card', false);
  assert v_unpaid.amount_cents = (v_plan ->> 'amount_cents')::integer,
    format('share %s is the planned %s', v_unpaid.amount_cents, v_plan ->> 'amount_cents');

  -- A "need players" post for that game, a team and a confirmed result.
  assert exists (select 1 from public.squad_posts where venue_booking_id = v_booking.id), 'need players post';
  assert exists (select 1 from public.team_members where profile_id = v_player1 and role = 'captain'), 'player1 captains a team';
  assert exists (select 1 from public.match_players mp join public.matches m on m.id = mp.match_id
                 where mp.profile_id = v_player1 and m.status = 'confirmed' and m.kickoff_at < now()), 'a result';

  -- No real Stripe ids: the fake intents are marked as seed.
  assert not exists (select 1 from public.booking_payment_shares
                     where booking_id = v_booking.id and stripe_payment_intent_id is not null
                       and stripe_payment_intent_id not like 'pi_seed_%'), 'fake intents only';
end $$;

rollback;
