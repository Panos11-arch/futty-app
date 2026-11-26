-- S9: the Leagues screen (docs/specs/15-design.md, image 12).
-- 1. competition_pins: a player's pinned competitions, owner only. A league
--    pin names the competition by (scope, format), never a season or a
--    division row, so it survives into the next season. target_type is
--    'league' for now; S10A widens it for tournaments.
begin;

-- 1. Pins: the owner pins, sees and unpins their own; nobody else can.
do $$
declare
  v_me uuid := tests.create_user('s9-pin-me@futty.test');
  v_other uuid := tests.create_user('s9-pin-other@futty.test');
begin
  perform tests.act_as(v_me);
  -- The app sends only what it pins; the row is the caller's.
  insert into public.competition_pins (target_type, scope, format) values ('league', 'limassol', '5-a-side');
  assert (select profile_id from public.competition_pins) = v_me, 'I see my pin, as mine';
  assert tests.error_of($q$ insert into public.competition_pins (target_type, scope, format) values ('league', 'limassol', '5-a-side') $q$)
         like '%duplicate key%', 'one pin per competition';

  -- Refused shapes.
  assert tests.error_of($q$ insert into public.competition_pins (target_type, scope, format) values ('league', 'limassol', '8-a-side') $q$)
         like '%check constraint%', 'only the five formats';
  assert tests.error_of($q$ insert into public.competition_pins (target_type, scope, format) values ('league', 'Limassol ', '7-a-side') $q$)
         like '%check constraint%', 'scope must be normalised (lower case, trimmed)';
  assert tests.error_of($q$ insert into public.competition_pins (target_type, scope, format) values ('league', '', '7-a-side') $q$)
         like '%check constraint%', 'scope cannot be empty';
  assert tests.error_of($q$ insert into public.competition_pins (target_type, scope, format) values ('tournament', 'limassol', '5-a-side') $q$)
         like '%check constraint%', 'no tournament pins until S10A';

  perform tests.act_as(v_other);
  assert (select count(*) from public.competition_pins) = 0, 'another player sees none of my pins';
  assert tests.error_of(format($q$ insert into public.competition_pins (profile_id, target_type, scope, format) values (%L, 'league', 'nicosia', '5-a-side') $q$, v_me))
         like '%row-level security%', 'cannot pin for someone else';
  delete from public.competition_pins where profile_id = v_me;
  assert tests.error_of(format($q$ update public.competition_pins set format = '7-a-side' where profile_id = %L $q$, v_me))
         like 'permission denied%', 'nobody updates a pin';

  perform tests.act_as(v_me);
  assert (select count(*) from public.competition_pins) = 1, 'another player cannot delete my pin';
  delete from public.competition_pins where scope = 'limassol' and format = '5-a-side';
  assert (select count(*) from public.competition_pins) = 0, 'I can unpin';

  perform tests.act_as_anon();
  assert tests.error_of($q$ select * from public.competition_pins $q$) like 'permission denied%', 'anon cannot read pins';
  assert tests.error_of($q$ insert into public.competition_pins (target_type, scope, format) values ('league', 'limassol', '5-a-side') $q$)
         like 'permission denied%', 'anon cannot pin';
  perform tests.act_as_postgres();
end $$;

-- 2. A pin made during one season is still there when the next season starts.
do $$
declare
  v_me uuid := tests.create_user('s9-pin-season@futty.test');
  v_league uuid;
begin
  insert into public.leagues (format, scope, name, stage, capacity)
  values ('7-a-side', 'S9 Town', 'S9 Town 7s', 'season', 8) returning id into v_league;

  perform tests.act_as(v_me);
  insert into public.competition_pins (target_type, scope, format) values ('league', 's9 town', '7-a-side');
  perform tests.act_as_postgres();

  -- The season ends and a new one starts: a new league row, same competition.
  delete from public.leagues where id = v_league;
  insert into public.leagues (format, scope, name, stage, capacity)
  values ('7-a-side', 'S9 Town', 'S9 Town 7s', 'signup', 8);

  perform tests.act_as(v_me);
  assert exists (select 1 from public.competition_pins where scope = 's9 town' and format = '7-a-side'),
         'the pin survives the new season';
  perform tests.act_as_postgres();
end $$;

rollback;
