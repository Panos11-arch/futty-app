-- S8 Profile tab (image 19): my_profile_summary, my_profile_season and
-- my_profile_recent (20261126125309_match_profile_summary.sql). Each reads
-- only the caller (auth.uid()). Followers and following leave out blocked
-- pairs (either way), adult and minor pairs and deleted accounts (as S7's
-- community_player_visible). Season and recent games come from
-- match_stat_players: checked-in players in confirmed matches, Friendly
-- games included, S13B assists included. TOTW counts distinct weeks.
begin;

-- p_user's call of p_sql, as a signed-in player.
create function tests.s8_as(p_user uuid, p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  execute p_sql into v;
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- The start of this year in Cyprus, as an instant.
create function tests.s8_year_start()
returns timestamptz
language sql
stable
as $$
  select date_trunc('year', now() at time zone 'Asia/Nicosia') at time zone 'Asia/Nicosia';
$$;

-- A follow, as the app writes it.
create function tests.s8_follow(p_follower uuid, p_type text, p_target uuid)
returns void
language sql
as $$
  insert into public.user_follows (follower_id, target_type, target_id) values (p_follower, p_type, p_target);
$$;

-- One Team of the Week holding p_profile.
create function tests.s8_totw(p_week date, p_area text, p_area_key text, p_format text, p_profile uuid)
returns void
language plpgsql
as $$
declare
  v_team uuid;
begin
  insert into public.team_of_the_week (week_start, kind, area, area_key, area_name, format, matches)
  values (p_week, 'general', p_area, p_area_key, p_area, p_format, 4)
  returning id into v_team;
  insert into public.team_of_the_week_players (team_of_the_week_id, profile_id, slot, sort, games, goals, assists,
                                               clean_sheets, average_rating)
  values (v_team, p_profile, 'fwd', 1, 1, 1, 0, 0, 7.0);
end;
$$;

-- 1. Followers and following.
do $$
declare
  me uuid := tests.create_user('s8-me@futty.test');
  fan1 uuid := tests.create_user('s8-fan1@futty.test');
  fan2 uuid := tests.create_user('s8-fan2@futty.test');
  blocked_by_me uuid := tests.create_user('s8-blocked-by-me@futty.test');
  blocker uuid := tests.create_user('s8-blocker@futty.test');
  minor uuid := tests.create_user('s8-minor@futty.test');
  other uuid := tests.create_user('s8-other@futty.test');
  team uuid := tests.create_team('S8 Followed');
  v jsonb;
begin
  update public.profiles set date_of_birth = (now() at time zone 'Asia/Nicosia')::date - interval '15 years'
  where id = minor;
  update public.profiles set date_of_birth = '1995-05-05' where id in (me, fan1, fan2, blocked_by_me, blocker, other);

  -- Followers: fan1 and fan2 count; a player I blocked, a player who blocked
  -- me and a minor don't.
  perform tests.s8_follow(fan1, 'player', me);
  perform tests.s8_follow(fan2, 'player', me);
  perform tests.s8_follow(blocked_by_me, 'player', me);
  perform tests.s8_follow(blocker, 'player', me);
  perform tests.s8_follow(fan1, 'player', other);
  insert into public.blocked_users (blocker_id, blocked_id) values (me, blocked_by_me), (blocker, me);

  -- Following: fan1 and a team count; the blocked players and the minor don't.
  perform tests.s8_follow(me, 'player', fan1);
  perform tests.s8_follow(me, 'team', team);
  perform tests.s8_follow(me, 'player', blocked_by_me);
  perform tests.s8_follow(me, 'player', blocker);
  -- Adult/minor follows made before S7's age guard (user_follows_age_guard
  -- refuses new ones): the counts still leave them out.
  alter table public.user_follows disable trigger user_follows_age_guard;
  perform tests.s8_follow(minor, 'player', me);
  perform tests.s8_follow(me, 'player', minor);
  alter table public.user_follows enable trigger user_follows_age_guard;

  v := tests.s8_as(me, 'select public.my_profile_summary()');
  assert (v->>'followers')::int = 2, format('2 followers (blocked either way and adult/minor left out), got %s', v);
  assert (v->>'following')::int = 2, format('2 following (a player and a team), got %s', v);
  assert v->'level' = 'null'::jsonb and v->'levelChangeMonth' = 'null'::jsonb, format('no level yet, got %s', v);

  -- Another caller reads only their own numbers.
  v := tests.s8_as(other, 'select public.my_profile_summary()');
  assert (v->>'followers')::int = 1 and (v->>'following')::int = 0, format('other: 1 follower, got %s', v);

  -- The minor sees the adult they follow left out the same way.
  v := tests.s8_as(minor, 'select public.my_profile_summary()');
  assert (v->>'following')::int = 0, format('minor: an adult is not counted, got %s', v);
end $$;

-- 2. Level and this month's change (Cyprus month).
do $$
declare
  me uuid := tests.create_user('s8-level@futty.test');
  v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Nicosia') at time zone 'Asia/Nicosia';
  v jsonb;
begin
  perform tests.set_level(me, 6.4, 8);
  -- One minute before this month starts in Cyprus.
  insert into public.player_level_history (profile_id, reason, level_before, level_after, created_at) values
    (me, 'start', 5.0, 6.2, v_month - interval '1 minute');
  v := tests.s8_as(me, 'select public.my_profile_summary()');
  assert (v->>'level')::numeric = 6.4 and (v->>'provisional')::boolean = false, format('level 6.4, got %s', v);
  assert v->'levelChangeMonth' = 'null'::jsonb, format('no change this month yet, got %s', v);

  -- 00:30 on the 1st in Cyprus is still the previous day in UTC: it counts.
  insert into public.player_level_history (profile_id, reason, level_before, level_after, created_at) values
    (me, 'start', 6.2, 6.3, v_month + interval '30 minutes'),
    (me, 'start', 6.3, 6.4, v_month + interval '2 hours');
  v := tests.s8_as(me, 'select public.my_profile_summary()');
  assert (v->>'levelChangeMonth')::numeric = 0.2, format('+0.2 this month, got %s', v);
end $$;

-- 3. Season tiles.
do $$
declare
  me uuid := tests.create_user('s8-season@futty.test');
  mate uuid := tests.create_user('s8-season-mate@futty.test');
  stranger uuid := tests.create_user('s8-season-stranger@futty.test');
  y timestamptz := tests.s8_year_start();
  m1 uuid := tests.form_match(y + interval '30 minutes', 'confirmed', 3, 1);   -- 00:30 on 1 January, Cyprus
  m2 uuid := tests.form_match(y + interval '2 days', 'confirmed', 1, 1);       -- a Friendly draw
  m3 uuid := tests.form_match(y + interval '3 days', 'confirmed', 0, 2);       -- 7-a-side loss
  m4 uuid := tests.form_match(y + interval '4 days', 'confirmed', 4, 0);       -- not checked in
  m5 uuid := tests.form_match(y - interval '1 hour', 'confirmed', 2, 0);       -- last year
  m6 uuid := tests.form_match(y + interval '5 days', 'disputed', 2, 0);        -- not confirmed
  v jsonb;
  v_week date := date_trunc('week', y + interval '7 days')::date;
begin
  update public.matches set competitive = false where id = m2;
  update public.matches set format = '7-a-side', players_per_side = 7 where id = m3;
  perform tests.form_player(m1, me, 'a', true, true);
  perform tests.form_player(m1, mate, 'a', true, true);
  perform tests.form_player(m2, me, 'a', true, true);
  perform tests.form_player(m3, me, 'a', true, true);
  perform tests.form_player(m4, me, 'a', true, false);
  perform tests.form_player(m5, me, 'a', true, true);
  perform tests.form_player(m6, me, 'a', true, true);
  insert into public.match_goals (match_id, side, sort, scorer_player_id, assist_player_id, entered_by) values
    (m1, 'a', 1, tests.player_id(m1, me), tests.player_id(m1, mate), me),
    (m1, 'a', 2, tests.player_id(m1, mate), tests.player_id(m1, me), me),
    (m2, 'a', 1, tests.player_id(m2, me), null, me);
  insert into public.motm_votes (match_id, voter_profile_id, nominee_player_id)
  values (m1, mate, tests.player_id(m1, me));

  -- TOTW: three teams in one week count once; a second week makes two.
  perform tests.s8_totw(v_week, 'all', '', '5-a-side', me);
  perform tests.s8_totw(v_week, 'city', 'limassol', '5-a-side', me);
  perform tests.s8_totw(v_week, 'all', '', '7-a-side', me);
  perform tests.s8_totw(v_week + 7, 'all', '', '5-a-side', me);
  perform tests.s8_totw(v_week - 7 * 60, 'all', '', '5-a-side', me);  -- an earlier year

  v := tests.s8_as(me, 'select public.my_profile_season()');
  assert (v->>'games')::int = 3, format('3 games (m1, the Friendly m2, m3), got %s', v);
  assert (v->>'wins')::int = 1, format('1 win, got %s', v);
  assert (v->>'goals')::int = 2, format('2 goals, one in a Friendly, got %s', v);
  assert (v->>'assists')::int = 1, format('1 assist, got %s', v);
  assert (v->>'motm')::int = 1, format('1 MOTM, got %s', v);
  assert (v->>'totw')::int = 2, format('picked in 2 weeks (3 teams in one week = 1), got %s', v);
  assert v->'formats' = '["5-a-side", "7-a-side"]'::jsonb, format('formats played, got %s', v);

  -- A Friendly game alone still counts.
  v := tests.s8_as(me, format('select public.my_profile_season(%L)', '5-a-side'));
  assert (v->>'games')::int = 2 and (v->>'goals')::int = 2, format('5-a-side: m1 and the Friendly, got %s', v);
  assert (v->>'totw')::int = 2, format('5-a-side TOTW weeks, got %s', v);

  v := tests.s8_as(me, format('select public.my_profile_season(%L)', '7-a-side'));
  assert (v->>'games')::int = 1 and (v->>'wins')::int = 0, format('7-a-side: one loss, got %s', v);
  assert (v->>'totw')::int = 1, format('7-a-side TOTW: one week, got %s', v);
  assert v->'formats' = '["5-a-side", "7-a-side"]'::jsonb, 'the picker still lists every format';

  -- A player with no games: zeros, no rating, no formats.
  v := tests.s8_as(stranger, 'select public.my_profile_season()');
  assert (v->>'games')::int = 0 and v->'avgRating' = 'null'::jsonb and v->'formats' = '[]'::jsonb,
    format('empty season, got %s', v);
end $$;

-- 4. Recent games, with an assist logged through S13B.
do $$
declare
  r record;
  g record;
  v jsonb;
  v_rows integer;
begin
  select * into r from tests.s13b_match(2, 2);
  -- Side a 2-0: a[1] scores twice, a[2] gets an assist without a scorer pairing.
  v := tests.s13b_log(r.cap_a, r.match, 2, 0, jsonb_build_object(
         'a', tests.s13b_side(r.match, r.a, array[2, 0], array[0, 1]),
         'b', tests.s13b_side(r.match, '{}'::uuid[], '{}'::integer[])));
  assert exists (select 1 from public.match_assists x
                 where x.match_id = r.match and x.player_id = tests.player_id(r.match, r.a[2]) and x.assists = 1),
    format('the S13B flow stored the assist in match_assists (log said %s)', v);
  update public.matches set status = 'confirmed', confirmed_at = now() - interval '1 hour', confirmed_via = 'agreed',
                            side_a_score = 2, side_b_score = 0
  where id = r.match;

  perform tests.act_as(r.a[2]);
  select count(*) into v_rows from public.my_profile_recent();
  select * into g from public.my_profile_recent() limit 1;
  v := public.my_profile_season();
  perform tests.act_as_postgres();
  assert v_rows = 1, format('one recent game, got %s', v_rows);
  assert g.assists = 1 and g.goals = 0, format('the S13B assist shows, got G%s A%s', g.goals, g.assists);
  assert g.result = 'W' and g.goals_for = 2 and g.goals_against = 0 and g.format = '5-a-side',
    format('result W 2-0 5-a-side, got %s %s-%s %s', g.result, g.goals_for, g.goals_against, g.format);
  assert (v->>'assists')::int = 1, format('the S13B assist counts in the season tiles, got %s', v);
end $$;

-- 5. Recent games: newest first, own rows only, limit capped at 20.
do $$
declare
  me uuid := tests.create_user('s8-recent@futty.test');
  other uuid := tests.create_user('s8-recent-other@futty.test');
  m uuid;
  i integer;
  v_rows integer;
  v_first timestamptz;
begin
  for i in 1 .. 22 loop
    m := tests.form_match(now() - make_interval(days => i), 'confirmed', 1, 0);
    perform tests.form_player(m, me, 'a', true, true);
  end loop;

  perform tests.act_as(me);
  select count(*) into v_rows from public.my_profile_recent(100);
  assert v_rows = 20, format('capped at 20, got %s', v_rows);
  select count(*) into v_rows from public.my_profile_recent();
  assert v_rows = 3, format('3 by default, got %s', v_rows);
  select kickoff_at into v_first from public.my_profile_recent(1);
  assert v_first > now() - interval '2 days', 'newest first';
  perform tests.act_as(other);
  select count(*) into v_rows from public.my_profile_recent(20);
  assert v_rows = 0, format('another player sees none of mine, got %s', v_rows);
  perform tests.act_as_postgres();
end $$;

-- 6. Signed out: refused.
do $$
begin
  perform tests.act_as_anon();
  begin
    perform public.my_profile_summary();
    raise exception 'anon called my_profile_summary';
  exception when insufficient_privilege then null;
  end;
  perform tests.act_as_postgres();
end $$;

do $$
begin
  assert not has_function_privilege('anon', 'public.my_profile_season(text)', 'execute'), 'anon: no season';
  assert not has_function_privilege('anon', 'public.my_profile_recent(integer)', 'execute'), 'anon: no recent';
  assert has_function_privilege('authenticated', 'public.my_profile_summary()', 'execute'), 'signed in: summary';
  assert (select p.prosecdef and p.proconfig @> array['search_path=""']
          from pg_proc p where p.oid = 'public.my_profile_season(text)'::regprocedure),
    'security definer with an empty search_path';
end $$;

rollback;
