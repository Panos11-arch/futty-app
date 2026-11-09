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
set city = 'Nicosia', position = v.position, preferred_foot = 'right'
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
