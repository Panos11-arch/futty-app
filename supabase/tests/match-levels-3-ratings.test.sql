-- A5a (docs/specs/match-record.md decision 1f, sections 4.8, 5.4): player
-- ratings 1-10.
--   Only checked-in players rate checked-in players, never themselves, once
--   per player, in a confirmed match that isn't a forfeit, until
--   confirmed_at + 24 hours (closes section 10, question 3).
--   A player's match rating needs 3 or more ratings; with 6 or more the
--   highest and lowest are dropped; a rater who rated 3 or more players in
--   the match and gave every one of them the same score counts 0.25.
--   Ratings move a level by at most 0.1. Individual ratings are never shown.
--   venue_unmark_arrived is refused once the player has rated (check_in_used).
begin;

do $$
declare
  t uuid := tests.create_user('lv3-t@futty.test');
  p2 uuid := tests.create_user('lv3-p2@futty.test');
  p3 uuid := tests.create_user('lv3-p3@futty.test');
  r1 uuid := tests.create_user('lv3-r1@futty.test');
  r2 uuid := tests.create_user('lv3-r2@futty.test');
  r3 uuid := tests.create_user('lv3-r3@futty.test');
  absent uuid := tests.create_user('lv3-absent@futty.test');
  gone uuid := tests.create_user('lv3-gone@futty.test');
  stranger uuid := tests.create_user('lv3-stranger@futty.test');
  m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 2, 1,
                             tests.create_team('LV3 A'), tests.create_team('LV3 B'));
  v_guest uuid;
  v_m uuid;
  v_page jsonb;
begin
  perform tests.form_player(m, t, 'a', true, true);
  perform tests.form_player(m, p2, 'a', true, true);
  perform tests.form_player(m, r1, 'a', true, true);
  perform tests.form_player(m, p3, 'b', true, true);
  perform tests.form_player(m, r2, 'b', true, true);
  perform tests.form_player(m, r3, 'b', true, true);
  perform tests.form_player(m, absent, 'b', true, false);
  perform tests.form_player(m, gone, 'b', true, true, true);
  v_guest := tests.guest_player(m, 'b', 'Guest');

  -- 1. Who may rate whom.
  assert tests.rate(t, m, t, 7) = 'cannot_rate_self', 'yourself';
  assert tests.rate(absent, m, t, 7) = 'not_checked_in', 'rater not checked in';
  assert tests.rate(stranger, m, t, 7) = 'not_checked_in', 'stranger';
  assert tests.rate(gone, m, t, 7) = 'not_checked_in', 'rater left';
  assert tests.rate(r1, m, absent, 7) = 'player_not_eligible', 'rated not checked in';
  assert tests.rate(r1, m, gone, 7) = 'player_not_eligible', 'rated left';
  assert tests.error_as(r1, format('select public.rate_match_player(%L, %L, 7)', m, v_guest)) = 'player_not_eligible', 'guest';
  assert tests.error_as(r1, format('select public.rate_match_player(%L, %L, 7)', m, gen_random_uuid())) = 'player_not_eligible',
    'unknown player';
  assert tests.rate(r1, m, t, 0) = 'invalid_score', '0';
  assert tests.rate(r1, m, t, 11) = 'invalid_score', '11';
  assert tests.error_as(r1, format('select public.rate_match_player(%L, %L, null)', m, tests.player_id(m, t))) = 'invalid_score',
    'null';
  assert tests.error_as(r1, format('select public.rate_match_player(%L, %L, 7)', gen_random_uuid(), tests.player_id(m, t)))
         = 'match_not_found', 'no such match';
  -- Teammates and opponents alike; once each.
  assert tests.rate(r1, m, t, 7) is null, 'a teammate';
  assert tests.rate(r1, m, p3, 6) is null, 'an opponent';
  assert tests.rate(r1, m, t, 8) = 'already_rated', 'twice';
  assert (select score from public.match_ratings where match_id = m and rater_profile_id = r1
          and rated_player_id = tests.player_id(m, t)) = 7, 'first rating kept';

  -- 2. Only a confirmed match that isn't a forfeit.
  foreach v_m in array array[
      tests.form_match(now() - interval '3 hours', 'confirmed', null, null, tests.create_team('LV3 F1'), tests.create_team('LV3 F2'), 'a', 'no_show'),
      tests.form_match(now() - interval '3 hours', 'disputed'),
      tests.form_match(now() - interval '3 hours', 'played'),
      tests.form_match(now() - interval '3 hours', 'no_result')] loop
    perform tests.form_player(v_m, r1, 'a', true, true);
    perform tests.form_player(v_m, t, 'b', true, true);
    assert tests.rate(r1, v_m, t, 7) = 'match_not_confirmed', 'not confirmed';
  end loop;

  -- 3. Within 24 hours of confirmed_at; exactly 24 hours is too late.
  v_m := tests.form_match(now() - interval '26 hours' + interval '1 second', 'confirmed', 1, 0);
  perform tests.form_player(v_m, r1, 'a', true, true);
  perform tests.form_player(v_m, t, 'b', true, true);
  assert tests.rate(r1, v_m, t, 7) is null, 'one second before 24h';
  update public.matches set confirmed_at = now() - interval '24 hours' where id = v_m;
  assert tests.rate(t, v_m, r1, 7) = 'rating_closed', 'at 24h';

  -- 4. Hidden: a rater sees only their own ratings; nobody writes directly.
  assert tests.rate(r2, m, t, 5) is null, 'r2 rates';
  perform tests.act_as(r2);
  assert (select count(*) from public.match_ratings) = 1, 'own ratings only';
  perform tests.act_as(t);
  assert (select count(*) from public.match_ratings) = 0, 'the rated player sees none';
  perform tests.act_as_postgres();
  assert tests.error_as(r3, format('insert into public.match_ratings (match_id, rater_profile_id, rated_player_id, score) values (%L, %L, %L, 10)',
                                   m, r3, tests.player_id(m, t))) like 'permission denied%', 'direct insert';
  assert tests.error_as(r1, format('update public.match_ratings set score = 10 where match_id = %L', m))
         like 'permission denied%', 'direct update';

  -- 5. The match rating needs 3 ratings, and is shown only once the window closes.
  assert tests.rating_of(m, t) = '{"rating": null, "count": 2}', format('2 ratings: none, got %s', tests.rating_of(m, t));
  assert tests.rate(r3, m, t, 9) is null, 'third rating';
  assert tests.rating_of(m, t) = '{"rating": 7.00, "count": 3}', format('(7 + 5 + 9) / 3, got %s', tests.rating_of(m, t));
  perform tests.act_as(p2);
  v_page := public.get_match_ratings(m);
  perform tests.act_as_postgres();
  assert v_page -> 'players' = '[]', format('nothing shown while open: %s', v_page);
  assert (v_page ->> 'ratingsOpen')::boolean, 'open';
  perform tests.act_as(r1);
  v_page := public.get_match_ratings(m);
  perform tests.act_as_postgres();
  assert jsonb_array_length(v_page -> 'myRatings') = 2, format('my ratings: %s', v_page -> 'myRatings');
  update public.matches set confirmed_at = now() - interval '24 hours' where id = m;
  perform tests.act_as(stranger);
  v_page := public.get_match_ratings(m);
  perform tests.act_as_postgres();
  assert v_page -> 'players' = jsonb_build_array(jsonb_build_object('playerId', tests.player_id(m, t), 'profileId', t,
                                                                    'rating', 7.0, 'count', 3)),
    format('t only (p3 has 1 rating): %s', v_page -> 'players');
  assert v_page -> 'myRatings' = '[]', 'stranger rated nobody';
  assert not v_page::text like '%"score"%', 'no individual scores';
  assert tests.error_as(stranger, format('select public.get_match_ratings(%L)',
                                         tests.form_match(now() - interval '3 hours', 'played'))) = 'match_not_found',
    'not visible before confirmation to outsiders';
end $$;

-- 6. Down-weighting: only a rater who gave every player they rated (3 or
-- more) the same score counts 0.25.
do $$
declare
  t uuid := tests.create_user('lv3w-t@futty.test');
  p2 uuid := tests.create_user('lv3w-p2@futty.test');
  p3 uuid := tests.create_user('lv3w-p3@futty.test');
  r1 uuid := tests.create_user('lv3w-r1@futty.test');
  r2 uuid := tests.create_user('lv3w-r2@futty.test');
  r3 uuid := tests.create_user('lv3w-r3@futty.test');
  same uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 1, 1);
  mixed uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 1, 1);
  v_m uuid;
  v_p uuid;
begin
  foreach v_m in array array[same, mixed] loop
    foreach v_p in array array[t, p2, p3, r1, r2, r3] loop
      perform tests.form_player(v_m, v_p, 'a', true, true);
    end loop;
  end loop;

  -- r1 gives everyone 10: (0.25 * 10 + 4 + 4) / 2.25 = 4.67.
  assert tests.rate(r1, same, t, 10) is null and tests.rate(r1, same, p2, 10) is null
         and tests.rate(r1, same, p3, 10) is null, 'r1: 10, 10, 10';
  assert tests.rate(r2, same, t, 4) is null and tests.rate(r3, same, t, 4) is null, 'r2, r3: 4';
  assert tests.rating_of(same, t) = '{"rating": 4.67, "count": 3}',
    format('same-score rater down-weighted, got %s', tests.rating_of(same, t));

  -- r1 repeats 10 for two players but gives the third 5: normal, weight 1.
  -- r2 gives two players the same 4: fewer than 3, weight 1.
  assert tests.rate(r1, mixed, t, 10) is null and tests.rate(r1, mixed, p2, 10) is null
         and tests.rate(r1, mixed, p3, 5) is null, 'r1: 10, 10, 5';
  assert tests.rate(r2, mixed, t, 4) is null and tests.rate(r2, mixed, p2, 4) is null, 'r2: 4, 4';
  assert tests.rate(r3, mixed, t, 4) is null, 'r3: 4';
  assert tests.rating_of(mixed, t) = '{"rating": 6.00, "count": 3}',
    format('repeating some scores keeps weight 1, got %s', tests.rating_of(mixed, t));
end $$;

-- 7. With 6 or more ratings the highest and lowest are dropped.
do $$
declare
  t uuid := tests.create_user('lv3d-t@futty.test');
  u uuid := tests.create_user('lv3d-u@futty.test');
  r uuid[] := array[tests.create_user('lv3d-r1@futty.test'), tests.create_user('lv3d-r2@futty.test'),
                    tests.create_user('lv3d-r3@futty.test'), tests.create_user('lv3d-r4@futty.test'),
                    tests.create_user('lv3d-r5@futty.test'), tests.create_user('lv3d-r6@futty.test')];
  m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 0, 0);
  t_scores integer[] := array[1, 5, 5, 5, 5, 10];
  u_scores integer[] := array[1, 5, 5, 5, 10];
begin
  perform tests.form_player(m, t, 'a', true, true);
  perform tests.form_player(m, u, 'b', true, true);
  for i in 1..6 loop
    perform tests.form_player(m, r[i], case when i % 2 = 0 then 'a' else 'b' end, true, true);
    assert tests.rate(r[i], m, t, t_scores[i]) is null, 'rate t';
    if i <= 5 then
      assert tests.rate(r[i], m, u, u_scores[i]) is null, 'rate u';
    end if;
  end loop;
  assert tests.rating_of(m, t) = '{"rating": 5.00, "count": 6}', format('6: 1 and 10 dropped, got %s', tests.rating_of(m, t));
  assert tests.rating_of(m, u) = '{"rating": 5.20, "count": 5}', format('5: nothing dropped, got %s', tests.rating_of(m, u));
end $$;

-- 8. Ratings move a level by at most 0.1, only in a competitive match.
do $$
declare
  top uuid := tests.create_user('lv3n-top@futty.test');
  low uuid := tests.create_user('lv3n-low@futty.test');
  few uuid := tests.create_user('lv3n-few@futty.test');
  r uuid[] := array[tests.create_user('lv3n-r1@futty.test'), tests.create_user('lv3n-r2@futty.test'),
                    tests.create_user('lv3n-r3@futty.test')];
  m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 2, 2,
                             tests.create_team('LV3N A'), tests.create_team('LV3N B'));
  casual uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 2, 2);
  v_m uuid;
  v_p uuid;
begin
  foreach v_p in array array[top, low, few] || r loop
    perform tests.set_level(v_p, 3.0);
  end loop;
  foreach v_m in array array[m, casual] loop
    perform tests.form_player(v_m, top, 'a', true, true);
    perform tests.form_player(v_m, few, 'a', true, true);
    perform tests.form_player(v_m, low, 'b', true, true);
    for i in 1..3 loop
      perform tests.form_player(v_m, r[i], case when i = 1 then 'a' else 'b' end, true, true);
      -- Each rater rates top 10 and low 1 (two different scores: weight 1).
      assert tests.rate(r[i], v_m, top, 10) is null and tests.rate(r[i], v_m, low, 1) is null, 'rated';
    end loop;
    assert tests.rate(r[1], v_m, few, 10) is null and tests.rate(r[2], v_m, few, 10) is null, 'two ratings only';
    perform tests.age_match(v_m, interval '30 hours');
  end loop;

  assert tests.apply_levels(m) = 'applied', 'applied';
  -- Even sides, a draw: the result moves nothing; the ratings move 0.1 at most.
  assert tests.level_of(top) = 3.10, format('rated 10 by everyone: +0.10, got %s', tests.level_of(top));
  assert tests.level_of(low) = 2.90, format('rated 1 by everyone: -0.10, got %s', tests.level_of(low));
  assert tests.level_of(few) = 3.00, format('fewer than 3 ratings: no nudge, got %s', tests.level_of(few));
  assert (select level_after - level_before from public.player_level_history
          where profile_id = top and match_id = m and reason = 'ratings') = 0.10, 'the ratings row: +0.10';
  assert not exists (select 1 from public.player_level_history where profile_id = few and match_id = m and reason = 'ratings'),
    'no ratings row';
  assert (select max(abs(level_after - level_before)) from public.player_level_history
          where match_id = m and reason = 'ratings') <= 0.1, 'never more than 0.1';

  -- Casual: ratings are kept and shown, but nothing moves.
  assert tests.apply_levels(casual) = 'skipped', 'casual';
  assert tests.level_of(top) = 3.10, 'casual: unchanged';
  assert (tests.rating_of(casual, top) ->> 'count')::integer = 3, 'casual ratings still count for the match';
end $$;

-- 9. venue_unmark_arrived is refused once the player has rated.
do $$
declare
  v_owner uuid := tests.create_user('lv3u-owner@futty.test');
  v_b public.venue_bookings;
  v_m uuid;
  v_p uuid;
  v_q uuid;
  v_r uuid;
begin
  v_b := tests.booking_with_players(tests.create_user('lv3u-booker@futty.test'), tests.create_venue(p_owner => v_owner),
                                    'each_pays_own_spot', 3, tests.next_weekday(3), '12:00', '13:00', 'lv3u');
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'confirmed' where id = v_b.id;
  perform tests.act_as_service_role();
  perform public.create_match_for_booking(v_b.id);
  perform tests.act_as_postgres();
  v_m := (tests.match_of(v_b.id)).id;
  v_p := (tests.player(v_b.id, 1)).profile_id;
  v_q := (tests.player(v_b.id, 2)).profile_id;
  v_r := (tests.player(v_b.id, 3)).profile_id;
  update public.match_players set side = 'a' where match_id = v_m;
  update public.matches set kickoff_at = now() - interval '3 hours', ends_at = now() - interval '2 hours',
                            result_deadline_at = now() + interval '22 hours', status = 'confirmed',
                            side_a_score = 2, side_b_score = 2, confirmed_via = 'agreed', confirmed_at = now() - interval '1 hour'
  where id = v_m;
  insert into public.match_attendance (match_id, profile_id, method, checked_in_by) values (v_m, v_q, 'qr', v_q);
  assert tests.error_as(v_owner, format('select public.venue_mark_arrived(%L, %L)', v_m, v_p)) is null, 'p ticked';
  assert tests.error_as(v_owner, format('select public.venue_mark_arrived(%L, %L)', v_m, v_r)) is null, 'r ticked';
  assert tests.rate(v_p, v_m, v_q, 8) is null, 'the ticked player rates';
  assert tests.error_as(v_owner, format('select public.venue_unmark_arrived(%L, %L)', v_m, v_p)) = 'check_in_used',
    'refused once they rated';
  assert exists (select 1 from public.match_attendance where match_id = v_m and profile_id = v_p), 'tick kept';
  -- Being rated isn't using the check-in: r rated nobody, so it can be undone.
  assert tests.rate(v_q, v_m, v_r, 6) is null, 'r is rated';
  assert tests.error_as(v_owner, format('select public.venue_unmark_arrived(%L, %L)', v_m, v_r)) is null,
    'r only rated by others: can be undone';
end $$;

rollback;
