-- S20: Book together and Team vs team (pay_book_together migration). From a
-- friend chat, the app preselects the friend (Invite friends) or the
-- friend's team (opposition invite). The preselection is only a hint: the
-- server returns the friend or team only when they are allowed (friends,
-- not blocked, A4; for a team, both are captains), and inviting the friend
-- goes through every existing booking check.
begin;

create function tests.bt_user(p_email text, p_age integer, p_name text, p_username text)
returns uuid
language sql
as $$
  select tests.create_user(p_email, jsonb_build_object(
    'date_of_birth', (tests.cyprus_today() - make_interval(years => p_age) - interval '1 day')::date,
    'full_name', p_name,
    'username', p_username));
$$;

create function tests.bt_value(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as(p_user);
  execute p_sql into v;
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.bt_friends(p_a uuid, p_b uuid)
returns void
language sql
as $$
  insert into public.friendships (requester_id, addressee_id, status, accepted_at) values (p_a, p_b, 'accepted', now());
$$;

create temporary table bt (k text primary key, v uuid) on commit drop;
grant all on bt to authenticated;

do $$
declare
  ana uuid := tests.bt_user('bt-ana@futty.test', 30, 'Ana Booker', 'ana_bt');
  ben uuid := tests.bt_user('bt-ben@futty.test', 25, 'Ben Friend', 'ben_bt');
  cara uuid := tests.bt_user('bt-cara@futty.test', 28, 'Cara Stranger', 'cara_bt');
  dan uuid := tests.bt_user('bt-dan@futty.test', 33, 'Dan Blocked', 'dan_bt');
  mia uuid := tests.bt_user('bt-mia@futty.test', 17, 'Mia Minor', 'mia_bt');
  max uuid := tests.bt_user('bt-max@futty.test', 16, 'Max Minor', 'max_bt');
  nou uuid := tests.bt_user('bt-nou@futty.test', 29, 'No Username', null);
  ana_team uuid := tests.create_team('Ana FC');
  ben_team uuid := tests.create_team('Ben FC');
  cara_team uuid := tests.create_team('Cara FC');
  dan_team uuid := tests.create_team('Dan FC');
  venue uuid := tests.create_venue(p_price => 60);
  booking public.venue_bookings;
begin
  perform tests.join_team(ana_team, ana, 'captain');
  perform tests.join_team(ben_team, ben, 'captain');
  perform tests.join_team(cara_team, cara, 'captain');
  perform tests.join_team(dan_team, dan, 'captain');
  perform tests.bt_friends(ana, ben);
  perform tests.bt_friends(dan, ana);
  perform tests.bt_friends(nou, ana);
  -- Two minor friends; Mia turns 18 later on.
  perform tests.bt_friends(mia, max);
  insert into public.blocked_users (blocker_id, blocked_id) values (dan, ana);

  perform tests.act_as(ana);
  booking := public.book_slot(venue, tests.cyprus_today() + 1, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();

  insert into bt values ('ana', ana), ('ben', ben), ('cara', cara), ('dan', dan), ('mia', mia), ('max', max), ('nou', nou),
    ('ana_team', ana_team), ('ben_team', ben_team), ('cara_team', cara_team), ('dan_team', dan_team), ('booking', booking.id);
end $$;

-- ---- booking_preselect: the friend ----------------------------------------------------
do $$
declare
  ana uuid := (select v from bt where k = 'ana');
  ben uuid := (select v from bt where k = 'ben');
  cara uuid := (select v from bt where k = 'cara');
  dan uuid := (select v from bt where k = 'dan');
  nou uuid := (select v from bt where k = 'nou');
  r jsonb;
begin
  r := tests.bt_value(ana, format('select public.booking_preselect(%L, null)', ben))::jsonb;
  assert r -> 'friend' ->> 'profile_id' = ben::text, 'a friend';
  assert r -> 'friend' ->> 'name' = 'Ben Friend', 'by name';
  assert r -> 'team' = 'null'::jsonb, 'no team asked';

  r := tests.bt_value(ana, format('select public.booking_preselect(%L, null)', cara))::jsonb;
  assert r -> 'friend' = 'null'::jsonb, 'not friends: none';
  r := tests.bt_value(ana, format('select public.booking_preselect(%L, null)', dan))::jsonb;
  assert r -> 'friend' = 'null'::jsonb, 'blocked by them: none';
  r := tests.bt_value(dan, format('select public.booking_preselect(%L, null)', ana))::jsonb;
  assert r -> 'friend' = 'null'::jsonb, 'blocked by me: none';
  r := tests.bt_value(ana, format('select public.booking_preselect(%L, null)', nou))::jsonb;
  assert r -> 'friend' = 'null'::jsonb, 'no username: none';
  r := tests.bt_value(ana, format('select public.booking_preselect(%L, null)', gen_random_uuid()))::jsonb;
  assert r -> 'friend' = 'null'::jsonb, 'nobody: none';
  r := tests.bt_value(ana, format('select public.booking_preselect(%L, null)', ana))::jsonb;
  assert r -> 'friend' = 'null'::jsonb, 'yourself: none';
  r := tests.bt_value(ana, 'select public.booking_preselect(null, null)')::jsonb;
  assert r = '{"friend": null, "team": null}'::jsonb, 'nothing asked';
end $$;

-- ---- booking_preselect: the team (both captains) ----------------------------------------
do $$
declare
  ana uuid := (select v from bt where k = 'ana');
  ben uuid := (select v from bt where k = 'ben');
  cara uuid := (select v from bt where k = 'cara');
  ana_team uuid := (select v from bt where k = 'ana_team');
  ben_team uuid := (select v from bt where k = 'ben_team');
  cara_team uuid := (select v from bt where k = 'cara_team');
  dan_team uuid := (select v from bt where k = 'dan_team');
  r jsonb;
begin
  r := tests.bt_value(ana, format('select public.booking_preselect(null, %L)', ben_team))::jsonb;
  assert r -> 'team' ->> 'id' = ben_team::text, 'a friend''s team';
  assert r -> 'team' ->> 'name' = 'Ben FC', 'by name';
  assert r -> 'team' ? 'city', 'with its city';

  r := tests.bt_value(ana, format('select public.booking_preselect(null, %L)', cara_team))::jsonb;
  assert r -> 'team' = 'null'::jsonb, 'not a friend''s team: none';
  r := tests.bt_value(ana, format('select public.booking_preselect(null, %L)', dan_team))::jsonb;
  assert r -> 'team' = 'null'::jsonb, 'a blocked friend''s team: none';
  r := tests.bt_value(ana, format('select public.booking_preselect(null, %L)', ana_team))::jsonb;
  assert r -> 'team' = 'null'::jsonb, 'my own team: none';
  r := tests.bt_value(ana, format('select public.booking_preselect(null, %L)', gen_random_uuid()))::jsonb;
  assert r -> 'team' = 'null'::jsonb, 'no team: none';

  -- I'm not a captain: none (S13: "when both are captains").
  update public.team_members set role = 'player' where team_id = ana_team and profile_id = ana;
  r := tests.bt_value(ana, format('select public.booking_preselect(null, %L)', ben_team))::jsonb;
  assert r -> 'team' = 'null'::jsonb, 'I am not a captain: none';
  update public.team_members set role = 'captain' where team_id = ana_team and profile_id = ana;

  -- Ben plays for his team but no longer captains it: none.
  update public.team_members set role = 'player' where team_id = ben_team and profile_id = ben;
  r := tests.bt_value(ana, format('select public.booking_preselect(null, %L)', ben_team))::jsonb;
  assert r -> 'team' = 'null'::jsonb, 'the friend is not its captain: none';
  update public.team_members set role = 'captain' where team_id = ben_team and profile_id = ben;
end $$;

-- ---- A4: an adult and a minor --------------------------------------------------------------
do $$
declare
  mia uuid := (select v from bt where k = 'mia');
  max uuid := (select v from bt where k = 'max');
  r jsonb;
begin
  r := tests.bt_value(mia, format('select public.booking_preselect(%L, null)', max))::jsonb;
  assert r -> 'friend' ->> 'profile_id' = max::text, 'two minor friends';
  assert r -> 'friend' ->> 'name' = 'Max', 'a minor by first name (A5)';
  -- Mia turns 18: still friends, but no preselection across the A4 line.
  update public.profiles set date_of_birth = (tests.cyprus_today() - interval '18 years')::date where id = mia;
  r := tests.bt_value(mia, format('select public.booking_preselect(%L, null)', max))::jsonb;
  assert r -> 'friend' = 'null'::jsonb, 'adult and minor: none';
  assert tests.error_as(mia, format('select public.invite_friend_to_booking(%L, %L)', (select v from bt where k = 'booking'), max))
    = 'age_pair_refused', 'adult and minor: no invite';
end $$;

-- ---- invite_friend_to_booking -----------------------------------------------------------------
do $$
declare
  ana uuid := (select v from bt where k = 'ana');
  ben uuid := (select v from bt where k = 'ben');
  cara uuid := (select v from bt where k = 'cara');
  dan uuid := (select v from bt where k = 'dan');
  nou uuid := (select v from bt where k = 'nou');
  booking uuid := (select v from bt where k = 'booking');
begin
  assert tests.error_as(ana, format('select public.invite_friend_to_booking(%L, %L)', booking, cara)) = 'not_friends', 'not friends';
  assert tests.error_as(ana, format('select public.invite_friend_to_booking(%L, %L)', booking, dan)) = 'blocked', 'blocked';
  assert tests.error_as(ana, format('select public.invite_friend_to_booking(%L, %L)', booking, nou)) = 'player_not_found', 'no username';
  assert tests.error_as(ana, format('select public.invite_friend_to_booking(%L, %L)', booking, ana)) = 'not_friends', 'yourself';

  -- Only the booker (the existing check in add_booking_player).
  perform tests.bt_friends(ben, cara);
  assert tests.error_as(ben, format('select public.invite_friend_to_booking(%L, %L)', booking, cara)) = 'not_your_booking',
    'not the booker';

  assert tests.error_as(ana, format('select public.invite_friend_to_booking(%L, %L)', booking, ben)) is null, 'the booker invites a friend';
  assert exists (
    select 1 from public.invites i
    where i.kind = 'booking' and i.booking_id = booking and i.invited_profile_id = ben and i.invited_by = ana and i.status = 'pending'
  ), 'a booking invite, as Invite friends makes';
  assert tests.notified(ben, 'booking_invite') = 1, 'and its push';
  assert tests.error_as(ana, format('select public.invite_friend_to_booking(%L, %L)', booking, ben)) = 'already_invited',
    'the existing booking checks still run';
end $$;

-- ---- Grants --------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public.booking_preselect(uuid, uuid)', 'public.invite_friend_to_booking(uuid, uuid)'] loop
    assert has_function_privilege('authenticated', f, 'execute'), f || ' for signed-in players';
    assert not has_function_privilege('anon', f, 'execute'), f || ' not signed out';
  end loop;
  assert not has_function_privilege('authenticated', 'public.friend_allowed(uuid, uuid)', 'execute'), 'friend_allowed is internal';
  assert has_function_privilege('service_role', 'public.friend_allowed(uuid, uuid)', 'execute'), 'friend_allowed for service_role';
end $$;

rollback;
