-- A7a (docs/specs/match-record.md section 7, decision 1g): a named team's
-- season stats (team_season_stats) and recent matches (team_recent_matches).
--   A team counts every confirmed match it played, whoever checked in (1b.3).
--   A forfeit is a 3-0 win for the other side (1g.3): it counts in goals for
--   and against and clean sheets.
begin;

do $$
declare
  t uuid := tests.create_team('A7S2 Lions');
  o uuid := tests.create_team('A7S2 Others');
  p uuid := tests.create_user('a7s2-p@futty.test');
  r1 uuid := tests.create_user('a7s2-r1@futty.test');
  r2 uuid := tests.create_user('a7s2-r2@futty.test');
  r3 uuid := tests.create_user('a7s2-r3@futty.test');
  reader uuid := tests.create_user('a7s2-reader@futty.test');
  v_venue uuid := tests.create_venue();
  t1 uuid := tests.form_match('2026-02-01 18:00+00', 'confirmed', 2, 0, t, o, p_venue => v_venue);
  t2 uuid := tests.form_match('2026-02-08 18:00+00', 'confirmed', 3, 1, t, o);
  -- t3: the Lions are side b and win 1-0.
  t3 uuid := tests.form_match('2026-02-15 18:00+00', 'confirmed', 0, 1, o, t);
  t4 uuid := tests.form_match('2026-02-22 18:00+00', 'confirmed', 1, 1, t, o);
  t5 uuid := tests.form_match('2026-03-01 18:00+00', 'confirmed', 4, 2, t, o);
  -- t6: the others forfeit (a 3-0 win and a clean sheet).
  t6 uuid := tests.form_match('2026-03-08 18:00+00', 'confirmed', null, null, t, o, 'b', 'no_show');
  t7 uuid := tests.form_match('2026-03-15 18:00+00', 'confirmed', 0, 2, t, o);
  -- t8: the Lions forfeit (a 0-3 loss).
  t8 uuid := tests.form_match('2026-03-22 18:00+00', 'confirmed', null, null, t, o, 'a', 'pulled_out');
  -- Not counted: disputed, no result, another year's.
  t9 uuid := tests.form_match('2026-03-29 18:00+00', 'disputed', 5, 0, t, o);
  t10 uuid := tests.form_match('2026-04-05 18:00+00', 'no_result', null, null, t, o);
  t11 uuid := tests.form_match('2025-04-05 18:00+00', 'confirmed', 1, 0, t, o);
  v public.team_season_stats;
  v_rows jsonb;
  v_rater uuid;
begin
  -- t1: p (Lions) is man of the match, voted by three opponents. S13B
  -- ratings: p won 2-0 = 6.5 + 0.6 + 0.5 clean sheet + 0.3 = 7.9; the
  -- opponents lost 0-2 = 6.5 − 0.3 − 0.2 = 6.0.
  perform tests.form_player(t1, p, 'a', true, true);
  foreach v_rater in array array[r1, r2, r3] loop
    perform tests.form_player(t1, v_rater, 'b', true, true);
    insert into public.motm_votes (match_id, voter_profile_id, nominee_player_id)
    values (t1, v_rater, tests.player_id(t1, p));
  end loop;
  perform public.match_compute_ratings(t1);

  perform tests.act_as(reader);
  select * into v from public.team_season_stats where team_id = t and season_kind = 'year' and season_year = 2026;
  perform tests.act_as_postgres();

  assert v.played = 8, format('8 matches (no player checked in for most: team form counts them), got %s', v.played);
  assert (v.won, v.drawn, v.lost) = (5, 1, 2), format('W5 D1 L2, got %s %s %s', v.won, v.drawn, v.lost);
  assert v.win_pct = 63, format('5 of 8 = 62.5%% rounds to 63, got %s', v.win_pct);
  assert v.goals_for = 14 and v.goals_against = 9,
    format('11 + 3 (t6) for, 6 + 3 (t8) against, got %s, %s', v.goals_for, v.goals_against);
  assert v.clean_sheets = 3, format('clean sheets in t1, t3 and the t6 forfeit, got %s', v.clean_sheets);
  assert v.longest_win_run = 3, format('t1 to t3, got %s', v.longest_win_run);
  assert v.motm = 1 and v.average_rating = 7.90, format('p''s award and rating, got %s, %s', v.motm, v.average_rating);

  perform tests.act_as(reader);
  select * into v from public.team_season_stats where team_id = o and season_kind = 'year' and season_year = 2026;
  perform tests.act_as_postgres();
  assert (v.played, v.won, v.drawn, v.lost) = (8, 2, 1, 5), format('the others: W2 D1 L5, got %s', v);
  assert v.longest_win_run = 2 and v.motm = 0 and v.average_rating = 6.00, format('the others: t7, t8 in a row, got %s', v);

  perform tests.act_as(reader);
  select * into v from public.team_season_stats where team_id = t and season_kind = 'all';
  perform tests.act_as_postgres();
  assert v.played = 9 and v.longest_win_run = 4, format('all time adds the 2025 win, just before t1 to t3, got %s', v);

  -- A team that has never won has a longest run of 0.
  perform tests.act_as(reader);
  select * into v from public.team_season_stats where team_id = o and season_kind = 'year' and season_year = 2025;
  perform tests.act_as_postgres();
  assert v.played = 1 and v.longest_win_run = 0, format('o in 2025, got %s', v);

  -- Recent matches, from the team's side, confirmed only.
  perform tests.act_as(reader);
  select jsonb_agg(jsonb_build_object('match', r.match_id, 'for', r.goals_for, 'against', r.goals_against,
                                      'result', r.result, 'opponent', r.opponent_label) order by r.kickoff_at)
  into v_rows
  from public.team_recent_matches r where r.team_id = t;
  perform tests.act_as_postgres();
  assert jsonb_array_length(v_rows) = 9, format('9 confirmed matches, got %s', jsonb_array_length(v_rows));
  assert v_rows -> 3 = jsonb_build_object('match', t3, 'for', 1, 'against', 0, 'result', 'W', 'opponent', 'A7S2 Others'),
    format('t3 (after the 2025 match, t1, t2) from the Lions'' side b, got %s', v_rows -> 3);
  assert v_rows -> 8 ->> 'result' = 'L_forfeit' and v_rows -> 8 -> 'for' = 'null', format('t8, got %s', v_rows -> 8);
  assert not v_rows::text like '%' || t9 || '%' and not v_rows::text like '%' || t10 || '%', 'no disputed or no-result matches';
  perform tests.act_as(reader);
  assert (select venue_name from public.team_recent_matches where match_id = t1 and team_id = t)
         = (select name from public.venues where id = v_venue), 'with the venue''s name';
  perform tests.act_as_postgres();
end $$;

rollback;
