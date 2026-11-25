-- S13B (decision 1l, decided by Anghelo 25 November): the captain confirms
-- who played while logging. Every player on the sides he writes counts as
-- played unless he marks them "Didn't play" (played: false in p_stats). On
-- save the server ticks each played player in (method 'captain', as
-- captain_mark_attendance) and removes only captain ticks for players who
-- didn't play. A QR or venue check-in can't be removed
-- (cannot_remove_check_in), nor a player who has voted for Man of the Match
-- (check_in_used). Ticks change only until result_deadline_at
-- (check_in_closed). A player who didn't play can't score or assist
-- (player_did_not_play). Ratings and no-shows follow attendance.
-- Known limit: in a two-captain match a side's players are ticked only when
-- their own captain logs.
begin;

-- s13b_match with nobody checked in yet.
create function tests.pl_match(p_a integer, p_b integer, p_pickup boolean default true,
                               out match uuid, out cap_a uuid, out cap_b uuid, out a uuid[], out b uuid[])
language plpgsql
as $$
declare
  g record := tests.s13b_match(p_a, p_b, p_pickup);
begin
  match := g.match; cap_a := g.cap_a; cap_b := g.cap_b; a := g.a; b := g.b;
  delete from public.match_attendance where match_attendance.match_id = g.match;
end;
$$;

-- One side's stats listing every player of p_profiles: p_goals each, and
-- played false for those in p_out.
create function tests.pl_side(p_match uuid, p_profiles uuid[], p_goals integer[], p_out uuid[] default '{}',
                              p_own integer default 0)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'players', coalesce(jsonb_agg(jsonb_build_object(
                 'playerId', tests.player_id(p_match, x.profile),
                 'goals', x.goals,
                 'assists', 0,
                 'played', not (x.profile = any (p_out))) order by x.n), '[]'),
    'ownGoals', p_own)
  from unnest(p_profiles, p_goals) with ordinality x(profile, goals, n);
$$;

create function tests.pl_method(p_match uuid, p_profile uuid)
returns text
language sql
stable
as $$
  select method from public.match_attendance where match_id = p_match and profile_id = p_profile;
$$;

create function tests.pl_correct_error(p_user uuid, p_match uuid, p_stats jsonb)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.set_match_stats(%L, %L)', p_match, p_stats));
$$;

-- 1. By default everyone played: ticked in by the captain, everyone rated.
do $$
declare
  g record := tests.pl_match(3, 2);
begin
  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(g.match, g.a, array[2, 0, 0]),
    'b', tests.s13b_side(g.match, g.b, array[1, 0])));
  assert (select status from public.matches where id = g.match) = 'confirmed', 'confirmed';
  assert (select count(*) from public.match_attendance where match_id = g.match and method = 'captain'
            and checked_in_by = g.cap_a) = 5, 'all five ticked in by the captain';
  assert (select count(*) from public.match_player_ratings where match_id = g.match) = 5, 'all five rated';
end $$;

-- 2. "Didn't play": no tick, no rating, a no-show once the deadline passes;
-- they can't score; a correction within the window flips it back.
do $$
declare
  g record := tests.pl_match(3, 2);
  v_out uuid;
begin
  v_out := g.a[3];
  assert tests.s13b_log_error(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[1, 0, 1], array[v_out]),
    'b', tests.pl_side(g.match, g.b, array[1, 0]))) = 'player_did_not_play', 'a goal for a player who didn''t play';

  perform tests.s13b_log(g.cap_a, g.match, 2, 1, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[2, 0, 0], array[v_out]),
    'b', tests.pl_side(g.match, g.b, array[1, 0])));
  assert tests.pl_method(g.match, v_out) is null, 'not ticked in';
  assert tests.s13b_rating(g.match, v_out) is null, 'no rating';
  assert (select count(*) from public.match_player_ratings where match_id = g.match) = 4, 'the other four rated';
  assert public.match_attendance_state(g.match, v_out) = 'missing', 'missing until the deadline, not a no-show yet';

  -- A correction within the window: he played after all; another didn't.
  perform tests.act_as(g.cap_a);
  perform public.set_match_stats(g.match, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[2, 0, 0], array[g.a[2]])));
  perform tests.act_as_postgres();
  assert tests.pl_method(g.match, v_out) = 'captain', 'ticked in now';
  assert tests.s13b_rating(g.match, v_out) is not null, 'rated now';
  assert tests.pl_method(g.match, g.a[2]) is null and tests.s13b_rating(g.match, g.a[2]) is null,
    'the other one: tick and rating removed';

  -- Past the deadline: a no-show, and the ticks can't change any more.
  update public.matches set result_deadline_at = now() - interval '1 second' where id = g.match;
  assert public.match_attendance_state(g.match, g.a[2]) = 'no_show', 'didn''t play: a no-show at the deadline';
  assert tests.pl_correct_error(g.cap_a, g.match, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[2, 0, 0]))) = 'check_in_closed', 'after the deadline: no new tick';
  assert tests.pl_correct_error(g.cap_a, g.match, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[2, 0, 0], array[g.a[3]]))) = 'check_in_closed', 'nor a tick removed';
  assert tests.pl_correct_error(g.cap_a, g.match, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[1, 0, 1], array[g.a[2]]))) is null,
    'unchanged ticks: stats can still be corrected';
  assert tests.pl_correct_error(g.cap_a, g.match, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[1, 1, 0], array[g.a[2]]))) = 'player_did_not_play',
    'a player without a check-in can''t score after the deadline';
end $$;

-- 3. A QR or venue check-in stays; a player who voted stays.
do $$
declare
  g record := tests.pl_match(3, 1);
begin
  insert into public.match_attendance (match_id, profile_id, checked_in_at, method, checked_in_by)
  values (g.match, g.a[2], now() - interval '2 hours', 'qr', g.a[2]),
         (g.match, g.a[3], now() - interval '2 hours', 'venue', g.cap_a);
  assert tests.s13b_log_error(g.cap_a, g.match, 1, 0, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[1, 0, 0], array[g.a[2]]),
    'b', tests.pl_side(g.match, g.b, array[0]))) = 'cannot_remove_check_in', 'a QR check-in';
  assert tests.s13b_log_error(g.cap_a, g.match, 1, 0, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[1, 0, 0], array[g.a[3]]),
    'b', tests.pl_side(g.match, g.b, array[0]))) = 'cannot_remove_check_in', 'a venue check-in';
  assert tests.pl_method(g.match, g.a[2]) = 'qr' and tests.pl_method(g.match, g.a[3]) = 'venue', 'both kept';

  perform tests.s13b_log(g.cap_a, g.match, 1, 0, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[1, 0, 0]),
    'b', tests.pl_side(g.match, g.b, array[0])));
  assert tests.pl_method(g.match, g.a[2]) = 'qr', 'a QR check-in is not turned into a captain tick';
  -- b[1] votes, then the captain says he didn't play.
  insert into public.motm_votes (match_id, voter_profile_id, nominee_player_id)
  values (g.match, g.b[1], tests.player_id(g.match, g.cap_a));
  assert tests.pl_correct_error(g.cap_a, g.match, jsonb_build_object(
    'b', tests.pl_side(g.match, g.b, array[0], array[g.b[1]]))) = 'check_in_used', 'he has voted';
  assert tests.pl_method(g.match, g.b[1]) = 'captain', 'his tick stays';
end $$;

-- 4. Two captains: each ticks his own side only. Known limit: if side b's
-- captain never logs, the deadline confirms side a's score and side b's
-- players without a check-in get no rating.
do $$
declare
  g record := tests.pl_match(2, 2, false);
begin
  assert tests.s13b_log_error(g.cap_a, g.match, 1, 0, jsonb_build_object(
    'a', jsonb_build_object('players', jsonb_build_array(
           jsonb_build_object('playerId', tests.player_id(g.match, g.a[1]), 'goals', 1, 'assists', 0),
           jsonb_build_object('playerId', tests.player_id(g.match, g.b[2]), 'goals', 0, 'assists', 0, 'played', false)),
         'ownGoals', 0))) = 'not_your_player', 'can''t mark a player of the other side';

  perform tests.s13b_log(g.cap_a, g.match, 1, 0, jsonb_build_object(
    'a', tests.pl_side(g.match, g.a, array[1, 0])));
  assert (select count(*) from public.match_attendance where match_id = g.match) = 2, 'side a ticked, side b not';

  update public.matches set result_deadline_at = now() - interval '1 second' where id = g.match;
  perform tests.act_as_service_role();
  perform public.match_jobs_tick();
  perform tests.act_as_postgres();
  assert (select status from public.matches where id = g.match) = 'confirmed', 'side a''s score confirmed at the deadline';
  assert tests.s13b_rating(g.match, g.a[1]) is not null and tests.s13b_rating(g.match, g.a[2]) is not null,
    'side a rated';
  assert tests.s13b_rating(g.match, g.b[1]) is null and tests.s13b_rating(g.match, g.b[2]) is null,
    'side b, never ticked: no rating';
end $$;

select 'match S13B 6 (the captain confirms who played) passed' as result;

rollback;
