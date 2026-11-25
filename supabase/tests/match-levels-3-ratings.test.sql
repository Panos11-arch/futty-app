-- S13B: the match rating (from stats, match-s13b-1-ratings) nudges a level
-- after the result move by 0.15 x (rating - 6.5) / 3.5, never more than
-- 0.15 either way; the level stays within 1.0-10.0. The 1-10 vote ratings
-- of A5a are gone from the app (their rows stay in match_ratings, unused).
-- Every level was converted once from 1-7: new = 1 + (old - 1) x 1.5.
begin;

-- A named game 30 hours ago (both windows closed), 1-0 to side a, with
-- players p_a and p_b checked in; the ratings are set to p_ratings (a then
-- b), as final.
create function tests.lv3_game(p_a uuid, p_b uuid, p_rating_a numeric, p_rating_b numeric,
                               p_score_a integer default 1, p_score_b integer default 0)
returns uuid
language plpgsql
as $$
declare
  v_m uuid := tests.form_match(now() - interval '30 hours', 'confirmed', p_score_a, p_score_b,
                               tests.create_team('LV3 A ' || gen_random_uuid()), tests.create_team('LV3 B ' || gen_random_uuid()));
begin
  perform tests.form_player(v_m, p_a, 'a', true, true);
  perform tests.form_player(v_m, p_b, 'b', true, true);
  insert into public.match_player_ratings (match_id, player_id, profile_id, rating) values
    (v_m, tests.player_id(v_m, p_a), p_a, p_rating_a),
    (v_m, tests.player_id(v_m, p_b), p_b, p_rating_b);
  update public.matches set ratings_final_at = now() where id = v_m;
  return v_m;
end;
$$;

-- p_profile's nudge in p_match (the 'ratings' row: after minus before).
create function tests.lv3_nudge(p_profile uuid, p_match uuid)
returns numeric
language sql
as $$
  select level_after - level_before from public.player_level_history
  where profile_id = p_profile and match_id = p_match and reason = 'ratings';
$$;

-- The conversion from 1-7.
do $$
begin
  perform tests.act_as_service_role();
  assert public.match_level_to_ten(1.0) = 1.0, '1.0 stays 1.0';
  assert public.match_level_to_ten(4.0) = 5.5, '4.0 becomes 5.5';
  assert public.match_level_to_ten(7.0) = 10.0, '7.0 becomes 10.0';
  assert public.match_level_to_ten(3.35) = 4.53, '3.35 becomes 4.53 (two decimals)';
  perform tests.act_as_postgres();
end $$;

-- The nudge: a 9.0 moves up, never more than 0.15; a 10.0 the full +0.15;
-- a 3.0 the full -0.15; 6.5 nothing.
do $$
declare
  a uuid := tests.create_user('lv3-a@futty.test');
  b uuid := tests.create_user('lv3-b@futty.test');
  c uuid := tests.create_user('lv3-c@futty.test');
  d uuid := tests.create_user('lv3-d@futty.test');
  m1 uuid;
  m2 uuid;
begin
  perform tests.set_level(a, 5.0);
  perform tests.set_level(b, 5.0);
  perform tests.set_level(c, 5.0);
  perform tests.set_level(d, 5.0);
  m1 := tests.lv3_game(a, b, 9.0, 3.0);
  m2 := tests.lv3_game(c, d, 10.0, 6.5);
  assert tests.apply_levels(m1) = 'applied' and tests.apply_levels(m2) = 'applied', 'applied';
  assert tests.lv3_nudge(a, m1) = 0.11, format('9.0: +0.15 x 2.5 / 3.5 = +0.11, got %s', tests.lv3_nudge(a, m1));
  assert tests.lv3_nudge(a, m1) <= 0.15, 'never more than 0.15';
  assert tests.lv3_nudge(b, m1) = -0.15, format('3.0: -0.15 (at most), got %s', tests.lv3_nudge(b, m1));
  assert tests.lv3_nudge(c, m2) = 0.15, format('10.0: +0.15, got %s', tests.lv3_nudge(c, m2));
  assert tests.lv3_nudge(d, m2) = 0.00, format('6.5: nothing, got %s', tests.lv3_nudge(d, m2));
  -- The level is the result move plus the nudge: 5.30 + 0.11.
  assert tests.level_of(a) = 5.41, format('5.0 + 0.30 + 0.11, got %s', tests.level_of(a));
end $$;

-- Clamped to 1.0 and 10.0.
do $$
declare
  top uuid := tests.create_user('lv3-top@futty.test');
  bottom uuid := tests.create_user('lv3-bottom@futty.test');
  m uuid;
begin
  perform tests.set_level(top, 10.0);
  perform tests.set_level(bottom, 1.0);
  -- The 10.0 player wins with a 10.0 rating; the 1.0 player loses with 3.0.
  m := tests.lv3_game(top, bottom, 10.0, 3.0);
  assert tests.apply_levels(m) = 'applied', 'applied';
  assert tests.level_of(top) = 10.0, format('never above 10.0, got %s', tests.level_of(top));
  assert tests.level_of(bottom) = 1.0, format('never below 1.0, got %s', tests.level_of(bottom));
end $$;

-- Ratings computed from stats feed the nudge when nothing was set: a match
-- not yet final gets its ratings computed first.
do $$
declare
  a uuid := tests.create_user('lv3-s-a@futty.test');
  b uuid := tests.create_user('lv3-s-b@futty.test');
  m uuid := tests.form_match(now() - interval '30 hours', 'confirmed', 1, 0,
                             tests.create_team('LV3 S1'), tests.create_team('LV3 S2'));
begin
  perform tests.set_level(a, 5.0);
  perform tests.set_level(b, 5.0);
  perform tests.form_player(m, a, 'a', true, true);
  perform tests.form_player(m, b, 'b', true, true);
  assert tests.apply_levels(m) = 'applied', 'applied';
  -- a won 1-0: 7.6, nudge 0.15 x 1.1 / 3.5 = 0.05; b lost 0-1: 6.1, -0.02.
  assert tests.s13b_rating(m, a) = 7.6 and tests.lv3_nudge(a, m) = 0.05, format('a: %s', tests.lv3_nudge(a, m));
  assert tests.lv3_nudge(b, m) = -0.02, format('b: %s', tests.lv3_nudge(b, m));
  assert (select ratings_final_at from public.matches where id = m) is not null, 'final';
end $$;

-- Nobody can rate 1-10 from the app any more.
do $$
declare
  s record := tests.s13b_match(2, 2);
begin
  perform tests.s13b_log(s.cap_a, s.match, 1, 0, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2]], array[1]), 'b', tests.s13b_side(s.match, '{}', '{}')));
  assert tests.rate(s.a[2], s.match, s.b[1], 7) like '%permission denied%', 'rate_match_player is gone';
end $$;

rollback;
