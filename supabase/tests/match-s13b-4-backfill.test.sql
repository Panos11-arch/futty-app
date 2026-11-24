-- S13B: past matches get the new rating from what was logged. Every
-- confirmed match that isn't a forfeit: from its score, goals, assists
-- (match_goals.assist_player_id for older matches) and Man of the Match;
-- from the score alone where nothing else was logged (goals are never
-- invented). Disputed, void, no-result and forfeit matches get none. The
-- old 1–10 vote rows stay in match_ratings. Running it twice changes nothing.
begin;

do $$
declare
  -- Confirmed a day and more ago, before S13B: goals with a paired assist.
  m_goals uuid := tests.form_match(now() - interval '3 days', 'confirmed', 3, 2);
  -- Only a score.
  m_score uuid := tests.form_match(now() - interval '3 days', 'confirmed', 1, 0);
  m_forfeit uuid := tests.form_match(now() - interval '3 days', 'confirmed', null, null, null, null, 'b', 'pulled_out');
  m_disputed uuid := tests.form_match(now() - interval '3 days', 'disputed', 2, 1);
  m_void uuid := tests.form_match(now() - interval '3 days', 'void');
  m_no_result uuid := tests.form_match(now() - interval '3 days', 'no_result');
  v_p uuid[] := '{}';
  v uuid;
  v_new record := tests.s13b_match(5, 5);
  v_count integer;
  v_before jsonb;
  m uuid;
  i integer;
begin
  for i in 1 .. 4 loop
    v_p := v_p || tests.create_user(format('s13b4-%s-%s@futty.test', i, gen_random_uuid()));
  end loop;
  foreach m in array array[m_goals, m_score, m_forfeit, m_disputed, m_void, m_no_result] loop
    perform tests.form_player(m, v_p[1], 'a', true, true);
    perform tests.form_player(m, v_p[2], 'a', true, true);
    perform tests.form_player(m, v_p[3], 'b', true, true);
    perform tests.form_player(m, v_p[4], 'b', true, true);
  end loop;
  -- m_goals: player 1 scored twice (one assisted by player 2), player 2 once;
  -- player 3 twice. An old 1–10 vote is kept.
  insert into public.match_goals (match_id, side, sort, scorer_player_id, assist_player_id, entered_by) values
    (m_goals, 'a', 1, tests.player_id(m_goals, v_p[1]), tests.player_id(m_goals, v_p[2]), v_p[1]),
    (m_goals, 'a', 2, tests.player_id(m_goals, v_p[1]), null, v_p[1]),
    (m_goals, 'a', 3, tests.player_id(m_goals, v_p[2]), tests.player_id(m_goals, v_p[1]), v_p[1]),
    (m_goals, 'b', 1, tests.player_id(m_goals, v_p[3]), null, v_p[3]),
    (m_goals, 'b', 2, tests.player_id(m_goals, v_p[3]), null, v_p[3]);
  insert into public.match_ratings (match_id, rater_profile_id, rated_player_id, score)
  values (m_goals, v_p[3], tests.player_id(m_goals, v_p[1]), 8);

  v_count := public.match_backfill_ratings();
  assert v_count >= 2, format('backfilled %s', v_count);

  -- The same rating a new match would get: won 3–2, 2 goals, 1 assist = 9.0.
  assert tests.s13b_rating(m_goals, v_p[1]) = 9.0, format('past 3–2: %s', tests.s13b_rating(m_goals, v_p[1]));
  perform tests.s13b_log(v_new.cap_a, v_new.match, 3, 2, jsonb_build_object(
    'a', tests.s13b_side(v_new.match, array[v_new.a[2], v_new.a[3]], array[2, 1], array[1, 1]),
    'b', tests.s13b_side(v_new.match, array[v_new.b[1]], array[2])));
  assert tests.s13b_rating(v_new.match, v_new.a[2]) = tests.s13b_rating(m_goals, v_p[1]), 'the same as a new match';
  assert tests.s13b_rating(m_goals, v_p[2]) = 8.2, format('1 goal, 1 assist: %s', tests.s13b_rating(m_goals, v_p[2]));

  -- Score only: won 1–0 = 7.6, lost 0–1 = 6.1.
  assert (tests.s13b_rating(m_score, v_p[1]), tests.s13b_rating(m_score, v_p[3])) = (7.6, 6.1), 'from the score alone';

  foreach m in array array[m_forfeit, m_disputed, m_void, m_no_result] loop
    assert not exists (select 1 from public.match_player_ratings where match_id = m), format('no rating for %s', m);
  end loop;
  assert (select ratings_final_at from public.matches where id = m_goals) is not null, 'voting closed: final';
  assert exists (select 1 from public.match_ratings where match_id = m_goals), 'the old vote rows stay';

  -- Twice: the same ratings.
  select jsonb_agg(jsonb_build_object('m', match_id, 'p', player_id, 'r', rating) order by match_id, player_id)
  into v_before from public.match_player_ratings;
  perform public.match_backfill_ratings();
  assert (select jsonb_agg(jsonb_build_object('m', match_id, 'p', player_id, 'r', rating) order by match_id, player_id)
          from public.match_player_ratings) = v_before, 'idempotent';
end $$;

rollback;
