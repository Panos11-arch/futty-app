-- Local development data, loaded by `npx supabase db reset`. Everything here
-- is made up: no real people, venues or payment details.
--
-- Every user signs in with password "password123" (local only).
--   staff@futty.test    venue staff, owns Test Arena North
--   player1@futty.test  player
--   player2@futty.test  player
--   player3@futty.test  player
--
-- Profiles are created by the on_auth_user_created trigger.
--
-- Local only. `supabase db reset` and the first `supabase db start` load
-- this file; `supabase db push` never does unless given --include-seed,
-- which nothing in this repo uses (tests/guards/seed-local-only.test.ts).
-- As a last guard, the first statement stops the file on any database that
-- already has users, so it can't touch production even if it were pushed.

do $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'supabase/seed.sql is for a fresh local database only; this one already has users';
  end if;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', u.username, 'full_name', u.full_name),
  now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'staff@futty.test',   'teststaff',   'Test Staff'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'player1@futty.test', 'testplayer1', 'Test Player One'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'player2@futty.test', 'testplayer2', 'Test Player Two'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'player3@futty.test', 'testplayer3', 'Test Player Three')
) as u (id, email, username, full_name);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       now(), now(), now()
from auth.users
where email like '%@futty.test';

update public.profiles set role = 'venue_owner'
where id = 'a0000000-0000-4000-8000-000000000001';

update public.profiles p
set city = 'Nicosia', position = v.position, preferred_foot = 'Right'
from (values
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'Goalkeeper'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'Defender'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'Forward')
) as v (id, position)
where p.id = v.id;

-- Two venues with two pitches each, built from the pre-P3 columns by
-- init_venue_model_from_legacy below. Only Test Arena
-- North allows 6 v 6 on its 5-a-side pitches.
insert into public.venues (id, name, city, surface, base_pitches, open_time, close_time, price_per_pitch_hour, owner_profile_id, allows_6v6_on_5s)
values
  ('b0000000-0000-4000-8000-000000000001', 'Test Arena North', 'Nicosia', 'Artificial grass', 2, '08:00', '23:00', 60, 'a0000000-0000-4000-8000-000000000001', true),
  ('b0000000-0000-4000-8000-000000000002', 'Test Arena South', 'Limassol', 'Artificial grass', 2, '09:00', '23:00', 50, null, false);

select public.init_venue_model_from_legacy(id) from public.venues;

-- App Store screenshots (U8, docs/app-store-screenshots.md). Made-up
-- content so Home, Book, the venue page, checkout, Play and Profile aren't
-- empty for player1. Every amount comes from the server's own functions
-- (book_slot, plan_share_payment) from Test Arena North's price: nothing
-- here writes a price. Each part acts as the player who would do it in the
-- app, through request.jwt.claims, as the SQL tests do.
do $$
declare
  v_booker uuid := 'a0000000-0000-4000-8000-000000000002';
  v_mate uuid := 'a0000000-0000-4000-8000-000000000003';
  v_late uuid := 'a0000000-0000-4000-8000-000000000004';
  v_north uuid := 'b0000000-0000-4000-8000-000000000001';
  v_rovers uuid := 'c0000000-0000-4000-8000-000000000001';
  v_united uuid := 'c0000000-0000-4000-8000-000000000002';
  -- Cyprus days, counted from the day the database is reset.
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
  v_booking public.venue_bookings;
  v_share public.booking_payment_shares;
  v_plan jsonb;
  v_match uuid;
  v_kickoff timestamptz;
begin
  -- Two teams: player1 captains Nicosia Rovers with player2 and player3.
  insert into public.teams (id, name) values (v_rovers, 'Nicosia Rovers'), (v_united, 'Strovolos United');
  insert into public.team_members (team_id, profile_id, role) values
    (v_rovers, v_booker, 'captain'), (v_rovers, v_mate, 'player'), (v_rovers, v_late, 'player');

  -- The next game: player1 books 19:00-20:00 in two days, each paying their
  -- own spot; player2 and player3 join. player1 and player2 have paid
  -- (card held); player3 hasn't yet.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_booker, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_booker::text, true);
  v_booking := public.book_slot(v_north, v_today + 2, '19:00', '20:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform public.add_booking_share_internal(v_booking.id, v_mate);
  perform public.add_booking_share_internal(v_booking.id, v_late);

  -- Held cards, as create-share-payment and Stripe's webhook record them.
  -- Fake intent ids: the local stack never calls Stripe.
  for v_share in
    select * from public.booking_payment_shares where booking_id = v_booking.id and profile_id in (v_booker, v_mate)
  loop
    v_plan := public.plan_share_payment(v_share.id, v_share.profile_id, 'card', false);
    perform public.attach_share_intent(v_share.id, v_share.profile_id, 'card', false, 'pi_seed_' || v_share.id,
      (v_plan ->> 'amount_cents')::integer, v_plan ->> 'capture_method', v_share.stripe_payment_intent_id);
    perform public.share_payment_held(v_share.id, 'pi_seed_' || v_share.id, (v_plan ->> 'amount_cents')::integer,
      'pm_seed_' || v_share.id, now());
  end loop;

  -- "Need players" for that game: two more, any level.
  perform public.create_squad_post(v_north, (v_booking.booking_day + v_booking.start_time) at time zone 'Asia/Nicosia',
    '5-a-side', 'players', null, null, 2, v_booking.id);

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- A result: Rovers beat United 4-2 three days ago, confirmed, and long
  -- since handled by the levels job (levels_applied_at), as it would be.
  v_kickoff := ((v_today - 3) + time '20:00') at time zone 'Asia/Nicosia';
  insert into public.matches (kind, format, players_per_side, kickoff_at, ends_at, status, result_deadline_at,
                              side_a_score, side_b_score, confirmed_at, confirmed_via, venue_id, levels_applied_at)
  values ('named', '5-a-side', 5, v_kickoff, v_kickoff + interval '1 hour', 'confirmed', v_kickoff + interval '25 hours',
          4, 2, v_kickoff + interval '2 hours', 'agreed', v_north, v_kickoff + interval '2 hours')
  returning id into v_match;
  insert into public.match_sides (match_id, side, team_id, label) values
    (v_match, 'a', v_rovers, 'Nicosia Rovers'), (v_match, 'b', v_united, 'Strovolos United');
  insert into public.match_players (match_id, profile_id, side) values
    (v_match, v_booker, 'a'), (v_match, v_mate, 'a'), (v_match, v_late, 'a');
end;
$$;
