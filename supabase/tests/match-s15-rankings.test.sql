-- S15 Rankings (20261126240000_match_s15_rankings.sql): the format the tab
-- opens on (my_most_played_format), a team's place in each format's power
-- ranking (get_team_power_ranking, from S14b's power_ranking_standing), and
-- a minor in a Team of the Week named by first name only to everyone else.
begin;

-- A confirmed pickup game in p_format at p_kickoff with p_profile checked in.
create function tests.s15_game(p_profile uuid, p_format text, p_kickoff timestamptz)
returns uuid
language plpgsql
as $$
declare
  v_match uuid := tests.form_match(p_kickoff, 'confirmed', 2, 1);
begin
  update public.matches set format = p_format where id = v_match;
  perform tests.form_player(v_match, p_profile, 'a', true, true);
  return v_match;
end;
$$;

-- my_most_played_format as p_user.
create function tests.s15_most_played(p_user uuid)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as(p_user);
  v := public.my_most_played_format();
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- 1. The most played format.
do $$
declare
  me uuid := tests.create_user('s15-me@futty.test');
  other uuid := tests.create_user('s15-other@futty.test');
  tied uuid := tests.create_user('s15-tied@futty.test');
  fresh uuid := tests.create_user('s15-fresh@futty.test');
  i integer;
begin
  -- Me: two 7-a-side games, one 5-a-side.
  perform tests.s15_game(me, '7-a-side', '2026-03-02 20:00 Asia/Nicosia');
  perform tests.s15_game(me, '7-a-side', '2026-03-09 20:00 Asia/Nicosia');
  perform tests.s15_game(me, '5-a-side', '2026-03-16 20:00 Asia/Nicosia');
  -- Someone else: three 11-a-side games (never counted for me).
  for i in 1..3 loop
    perform tests.s15_game(other, '11-a-side', format('2026-04-0%s 20:00 Asia/Nicosia', i)::timestamptz);
  end loop;
  -- A tie between 9-a-side and 6-a-side: the smaller format.
  perform tests.s15_game(tied, '9-a-side', '2026-03-02 20:00 Asia/Nicosia');
  perform tests.s15_game(tied, '6-a-side', '2026-03-03 20:00 Asia/Nicosia');

  assert tests.s15_most_played(me) = '7-a-side', format('most played: %s', tests.s15_most_played(me));
  assert tests.s15_most_played(other) = '11-a-side', 'another player: their own games only';
  assert tests.s15_most_played(tied) = '6-a-side', format('tie: smaller format (%s)', tests.s15_most_played(tied));
  assert tests.s15_most_played(fresh) is null, 'no games: null';

  -- Signed out: refused.
  perform tests.act_as_anon();
  assert tests.error_of('select public.my_most_played_format()') like 'permission denied%', 'anon refused';
  perform tests.act_as_postgres();
end $$;

-- 2. A team's place in each format.
do $$
declare
  v_now timestamptz := '2026-06-11 12:00 Asia/Nicosia';
  a uuid := tests.create_team('S15 A');
  b uuid := tests.create_team('S15 B');
  c uuid := tests.create_team('S15 C');
  d uuid := tests.create_team('S15 D');
  me uuid := tests.create_user('s15-viewer@futty.test');
  v record;
  v_formats text[];
  i integer;
begin
  -- 6-a-side: A beats B three times; 9-a-side: A beats C three times;
  -- 5-a-side: A beats D twice (not listed: fewer than 3 games).
  for i in 1..3 loop
    perform tests.pr_match(a, b, 2, 0, format('2026-06-0%s 20:00 Asia/Nicosia', i)::timestamptz, '6-a-side');
    perform tests.pr_match(a, c, 2, 0, format('2026-06-0%s 21:00 Asia/Nicosia', i)::timestamptz, '9-a-side');
  end loop;
  perform tests.pr_match(a, d, 1, 0, '2026-06-01 19:00 Asia/Nicosia', '5-a-side');
  perform tests.pr_match(a, d, 1, 0, '2026-06-02 19:00 Asia/Nicosia', '5-a-side');
  perform tests.pr_tick(v_now);

  select array_agg(r.format order by array_position(array['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'], r.format))
    into v_formats from public.team_power_ranking(a, v_now) r;
  assert v_formats = array['6-a-side', '9-a-side'], format('A listed in: %s', v_formats);

  select * into v from public.team_power_ranking(a, v_now) r where r.format = '6-a-side';
  assert v.rank = 1 and v.matches = 3 and v.points = tests.pr_points(a, '6-a-side'), format('A 6-a-side: %s', v);
  select * into v from public.team_power_ranking(b, v_now) r where r.format = '6-a-side';
  assert v.rank = 2, format('B second: %s', v);
  assert (select count(*) from public.team_power_ranking(d, v_now)) = 0, 'D: two games, listed nowhere';

  -- The same as the list S14b shows.
  assert (select r.rank from public.team_power_ranking(a, v_now) r where r.format = '9-a-side')
       = (select l.rank from public.power_ranking_list('9-a-side', v_now) l where l.team_id = a), 'matches the list';

  -- Inactive (60 days without a game): hidden, as in the list.
  assert (select count(*) from public.team_power_ranking(a, v_now + interval '61 days')) = 0, 'inactive: hidden';

  -- Signed in: get_team_power_ranking reads it at now() (these games are
  -- months old by now, so nothing is listed; the call itself is allowed).
  perform tests.act_as(me);
  assert tests.error_of(format('select * from public.get_team_power_ranking(%L)', a)) is null, 'signed in reads';
  assert tests.error_of(format('select * from public.team_power_ranking(%L, now())', a)) like 'permission denied%',
    'the internal function is service_role only';
  perform tests.act_as_anon();
  assert tests.error_of(format('select * from public.get_team_power_ranking(%L)', a)) like 'permission denied%',
    'anon refused';
  perform tests.act_as_postgres();
end $$;

-- 3. A minor in a Team of the Week: the names the screen reads
-- (get_public_profiles for the team's players) give everyone else their
-- first name only; the minor sees their own full name.
do $$
declare
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
  minor uuid := tests.create_user('s15-minor@futty.test');
  viewer uuid := tests.create_user('s15-adult@futty.test');
  v_team uuid;
  v_ids uuid[];
  v_name text;
  v_username text;
begin
  update public.profiles set first_name = 'Eleni', full_name = 'Eleni Constantinou', username = 'eleni16',
                             date_of_birth = (v_today - interval '16 years')::date
  where id = minor;
  update public.profiles set date_of_birth = '1990-05-01' where id = viewer;

  insert into public.team_of_the_week (week_start, kind, area, area_key, area_name, format, matches)
  values ('2026-11-16', 'general', 'all', '', 'All Cyprus', '5-a-side', 4)
  returning id into v_team;
  insert into public.team_of_the_week_players (team_of_the_week_id, profile_id, slot, sort, games, goals, assists,
                                               clean_sheets, average_rating, player_of_the_week)
  values (v_team, minor, 'fwd', 1, 2, 4, 1, 0, 8.9, true);

  perform tests.act_as(viewer);
  select array_agg(p.profile_id) into v_ids from public.team_of_the_week_players p where p.team_of_the_week_id = v_team;
  select p.full_name, p.username into v_name, v_username from public.get_public_profiles(v_ids) p where p.id = minor;
  assert v_name = 'Eleni' and v_username is null, format('a minor to an adult: %s / %s', v_name, v_username);

  perform tests.act_as(minor);
  select p.full_name into v_name from public.get_public_profiles(array[minor]) p;
  assert v_name = 'Eleni Constantinou', format('the minor sees their own name: %s', v_name);
  perform tests.act_as_postgres();
end $$;

rollback;
