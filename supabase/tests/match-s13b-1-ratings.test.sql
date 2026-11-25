-- S13B: a rating per player per match from stats, the same formula for every
-- player (no positions): 6.5; win +0.6, draw +0.2, loss −0.3; goal +0.8;
-- assist +0.5; clean sheet +0.5; each goal conceded −0.1 (at most −1.0);
-- Man of the Match +0.3 (ties share it); limited to 3.0–10.0, one decimal.
-- Weights come from app_rules. Only players who checked in (1b.2).
begin;

-- Worked example: won 3–2 with 2 goals and 1 assist = 9.0
-- (6.5 + 0.6 + 1.6 + 0.5 − 0.2). His teammates and the losers too.
do $$
declare
  s record := tests.s13b_match(5, 5);
begin
  perform tests.s13b_log(s.cap_a, s.match, 3, 2, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2], s.a[3]], array[2, 1], array[1, 0]),
    'b', tests.s13b_side(s.match, array[s.b[1]], array[2])));
  assert tests.s13b_rating(s.match, s.a[2]) = 9.0, format('2 goals, 1 assist, won 3–2: %s', tests.s13b_rating(s.match, s.a[2]));
  assert tests.s13b_rating(s.match, s.a[3]) = 7.7, format('1 goal, won 3–2: %s', tests.s13b_rating(s.match, s.a[3]));
  assert tests.s13b_rating(s.match, s.a[4]) = 6.9, format('nothing, won 3–2: %s', tests.s13b_rating(s.match, s.a[4]));
  assert tests.s13b_rating(s.match, s.b[1]) = 7.5, format('2 goals, lost 2–3: %s', tests.s13b_rating(s.match, s.b[1]));
  assert tests.s13b_rating(s.match, s.b[2]) = 5.9, format('nothing, lost 2–3: %s', tests.s13b_rating(s.match, s.b[2]));
  assert (select count(*) from public.match_player_ratings where match_id = s.match) = 10, 'every player who checked in';
end $$;

-- Worked example: won 1–0, no goal or assist = 7.6 (6.5 + 0.6 + 0.5).
-- Worked example: lost 0–8 = 5.4 (6.5 − 0.3 − 0.8).
do $$
declare
  s record := tests.s13b_match(5, 5);
  t record := tests.s13b_match(5, 5);
begin
  perform tests.s13b_log(s.cap_a, s.match, 1, 0, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2]], array[1]), 'b', tests.s13b_side(s.match, '{}', '{}')));
  assert tests.s13b_rating(s.match, s.a[3]) = 7.6, format('won 1–0: %s', tests.s13b_rating(s.match, s.a[3]));

  perform tests.s13b_log(t.cap_a, t.match, 0, 8, jsonb_build_object(
    'a', tests.s13b_side(t.match, '{}', '{}'), 'b', tests.s13b_side(t.match, array[t.b[1]], array[8])));
  assert tests.s13b_rating(t.match, t.a[2]) = 5.4, format('lost 0–8: %s', tests.s13b_rating(t.match, t.a[2]));
end $$;

-- Goals conceded never take more than 1.0: lost 0–15 = 5.2.
do $$
declare
  s record := tests.s13b_match(5, 5);
begin
  perform tests.s13b_log(s.cap_a, s.match, 0, 15, jsonb_build_object(
    'a', tests.s13b_side(s.match, '{}', '{}'), 'b', tests.s13b_side(s.match, array[s.b[1]], array[15])));
  assert tests.s13b_rating(s.match, s.a[2]) = 5.2, format('lost 0–15: %s', tests.s13b_rating(s.match, s.a[2]));
end $$;

-- Worked example: a 2–2 draw, 1 assist, Man of the Match = 7.3
-- (6.5 + 0.2 + 0.5 − 0.2 + 0.3). Before voting closes, 7.0.
do $$
declare
  s record := tests.s13b_match(5, 5);
  v uuid;
begin
  perform tests.s13b_log(s.cap_a, s.match, 2, 2, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[3]], array[2]),
    'b', tests.s13b_side(s.match, array[s.b[1]], array[2])));
  -- The assist, as a correction within 24 hours.
  perform tests.act_as(s.cap_a);
  perform public.set_match_stats(s.match, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[3], s.a[2]], array[2, 0], array[0, 1])));
  perform tests.act_as_postgres();
  assert tests.s13b_rating(s.match, s.a[2]) = 7.0, format('draw, 1 assist, before voting closes: %s',
                                                          tests.s13b_rating(s.match, s.a[2]));
  -- Three votes for him.
  foreach v in array array[s.a[1], s.b[1], s.b[2]] loop
    perform tests.act_as(v);
    perform public.cast_motm_vote(s.match, tests.player_id(s.match, s.a[2]));
  end loop;
  perform tests.act_as_postgres();
  perform tests.age_match(s.match, interval '25 hours');
  perform tests.act_as_service_role();
  assert public.match_ratings_tick() >= 1, 'final ratings once voting closed';
  perform tests.act_as_postgres();
  assert tests.s13b_rating(s.match, s.a[2]) = 7.3, format('draw, 1 assist, Man of the Match: %s',
                                                          tests.s13b_rating(s.match, s.a[2]));
  assert (select ratings_final_at from public.matches where id = s.match) is not null, 'final';
end $$;

-- Man of the Match ties share the +0.3.
do $$
declare
  s record := tests.s13b_match(5, 5);
begin
  perform tests.s13b_log(s.cap_a, s.match, 0, 0, jsonb_build_object(
    'a', tests.s13b_side(s.match, '{}', '{}'), 'b', tests.s13b_side(s.match, '{}', '{}')));
  perform tests.act_as(s.a[1]);
  perform public.cast_motm_vote(s.match, tests.player_id(s.match, s.a[2]));
  perform tests.act_as(s.b[1]);
  perform public.cast_motm_vote(s.match, tests.player_id(s.match, s.b[2]));
  perform tests.act_as_postgres();
  perform tests.age_match(s.match, interval '25 hours');
  perform public.match_ratings_tick();
  -- 0–0: 6.5 + 0.2 + 0.5 = 7.2; the two tied +0.3.
  assert (tests.s13b_rating(s.match, s.a[2]), tests.s13b_rating(s.match, s.b[2]), tests.s13b_rating(s.match, s.a[3]))
         = (7.5, 7.5, 7.2), 'both tied players get +0.3, nobody else';
end $$;

-- A rating above 10 is capped at 10.0: won 6–0 with 5 goals and 1 assist
-- = 6.5 + 0.6 + 4.0 + 0.5 + 0.5 = 12.1.
do $$
declare
  s record := tests.s13b_match(5, 5);
begin
  perform tests.s13b_log(s.cap_a, s.match, 6, 0, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2], s.a[3]], array[5, 1], array[1, 0]), 'b', tests.s13b_side(s.match, '{}', '{}')));
  assert tests.s13b_rating(s.match, s.a[2]) = 10.0, format('capped: %s', tests.s13b_rating(s.match, s.a[2]));
end $$;

-- A goalkeeper and a forward with the same stats get the same rating.
do $$
declare
  s record := tests.s13b_match(5, 5);
begin
  update public.match_players set position = 'gk' where id = tests.player_id(s.match, s.a[2]);
  update public.match_players set position = 'fw' where id = tests.player_id(s.match, s.a[3]);
  perform tests.s13b_log(s.cap_a, s.match, 2, 1, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2], s.a[3]], array[1, 1]), 'b', tests.s13b_side(s.match, array[s.b[1]], array[1])));
  assert tests.s13b_rating(s.match, s.a[2]) = tests.s13b_rating(s.match, s.a[3]),
    format('keeper %s, forward %s', tests.s13b_rating(s.match, s.a[2]), tests.s13b_rating(s.match, s.a[3]));
  assert tests.s13b_rating(s.match, s.a[2]) = 7.8, 'both 6.5 + 0.6 + 0.8 − 0.1';
end $$;

-- Every weight comes from app_rules, and a correction recomputes.
do $$
declare
  s record := tests.s13b_match(5, 5);
begin
  update public.app_rules set rating_goal = 1.0 where id;
  perform tests.s13b_log(s.cap_a, s.match, 1, 0, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2]], array[1]), 'b', tests.s13b_side(s.match, '{}', '{}')));
  assert tests.s13b_rating(s.match, s.a[2]) = 8.6, format('a goal worth 1.0: %s', tests.s13b_rating(s.match, s.a[2]));
  perform tests.act_as(s.cap_a);
  perform public.set_match_stats(s.match, jsonb_build_object('a', tests.s13b_side(s.match, array[s.a[3]], array[1])));
  perform tests.act_as_postgres();
  assert (tests.s13b_rating(s.match, s.a[2]), tests.s13b_rating(s.match, s.a[3])) = (7.6, 8.6),
    'the correction moves the goal and the ratings follow';
  update public.app_rules set rating_goal = 0.8 where id;
end $$;

-- Only players who checked in get a rating (1b.2); guests and players who
-- left never do; a forfeit has none. The captain marks v_late "Didn't play"
-- (decision 1l), so he isn't ticked in.
do $$
declare
  s record := tests.s13b_match(3, 3);
  v_late uuid := tests.create_user('s13b-late-' || gen_random_uuid() || '@futty.test');
  v_left uuid := tests.create_user('s13b-left-' || gen_random_uuid() || '@futty.test');
  v_guest uuid;
  f uuid := tests.form_match(now() - interval '3 hours', 'confirmed', null, null, null, null, 'b', 'pulled_out');
begin
  perform tests.form_player(s.match, v_late, 'a', true, false);
  perform tests.form_player(s.match, v_left, 'a', true, true, true);
  v_guest := tests.guest_player(s.match, 'a', 'Guest');
  perform tests.s13b_log(s.cap_a, s.match, 1, 0, jsonb_build_object(
    'a', jsonb_build_object('players', jsonb_build_array(
           jsonb_build_object('playerId', v_guest, 'goals', 1),
           jsonb_build_object('playerId', tests.player_id(s.match, v_late), 'goals', 0, 'played', false)), 'ownGoals', 0),
    'b', tests.s13b_side(s.match, '{}', '{}')));
  assert tests.s13b_rating(s.match, v_late) is null, 'didn''t check in: no rating';
  assert (select count(*) from public.match_player_ratings where match_id = s.match) = 6, 'only the six who checked in';
  perform tests.form_player(f, v_late, 'a', true, true);
  assert public.match_compute_ratings(f) = 0, 'a forfeit has no ratings';
end $$;

-- Ratings are shown through match_rating_shown (season averages, Team of the
-- Week) and on the match page, to everyone who can see the match.
do $$
declare
  s record := tests.s13b_match(5, 5);
  v_page jsonb;
begin
  perform tests.s13b_log(s.cap_a, s.match, 3, 2, jsonb_build_object(
    'a', tests.s13b_side(s.match, array[s.a[2], s.a[3]], array[2, 1], array[1, 0]),
    'b', tests.s13b_side(s.match, array[s.b[1]], array[2])));
  assert public.match_rating_shown(s.match, tests.player_id(s.match, s.a[2])) = 9.0, 'shown at once';
  assert (select rating from public.match_stat_players where match_id = s.match and profile_id = s.a[2]) = 9.0,
    'the stats views read it';
  assert (select assists from public.match_stat_players where match_id = s.match and profile_id = s.a[2]) = 1,
    'assists from match_assists';
  v_page := tests.page_as(s.b[3], s.match);
  assert jsonb_array_length(v_page -> 'ratings') = 10, 'every rating on the match page';
  assert (v_page -> 'ratings' -> 0 ->> 'rating')::numeric = 9.0, 'best first';
  assert (v_page -> 'assists' -> 0 ->> 'assists')::integer = 1, 'assists on the match page';
end $$;

rollback;
