-- A4a (docs/specs/match-record.md sections 4.6, 5.3, decisions 1e), as
-- changed by S13B: goals and assists after the result is confirmed are
-- corrected with set_match_stats (per player: goals, assists, own goals).
-- Only that side's captain (the booker writes both sides of a pickup); only
-- a confirmed, non-forfeit match, for 24 hours after confirmed_at; the
-- side's goals plus own goals equal its score; every player is on that side
-- and still in the match (guests allowed). set_match_goals is no longer the
-- app's.
begin;

do $$
declare
  v_home uuid := tests.create_team('A4 Home');
  v_away uuid := tests.create_team('A4 Away');
  cap_a uuid := tests.create_user('a4g-cap-a@futty.test');
  cap_b uuid := tests.create_user('a4g-cap-b@futty.test');
  sami uuid := tests.create_user('a4g-sami@futty.test');
  away_player uuid := tests.create_user('a4g-away@futty.test');
  gone uuid := tests.create_user('a4g-gone@futty.test');
  stranger uuid := tests.create_user('a4g-stranger@futty.test');
  -- Confirmed one hour ago (form_match confirms 2 hours after kickoff): 2-1.
  m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 2, 1, v_home, v_away);
  -- Confirmed exactly 24 hours ago: the window has just closed.
  m_late uuid := tests.form_match(now() - interval '26 hours', 'confirmed', 1, 0, v_home, v_away);
  m_forfeit uuid := tests.form_match(now() - interval '3 hours', 'confirmed', null, null, v_home, v_away, 'b', 'pulled_out');
  m_disputed uuid := tests.form_match(now() - interval '3 hours', 'disputed', null, null, v_home, v_away);
  m_draw uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 0, 0, v_home, v_away);
  v_m uuid;
  v_guest uuid;
begin
  perform tests.join_team(v_home, cap_a, 'captain');
  perform tests.join_team(v_home, sami);
  perform tests.join_team(v_away, cap_b, 'captain');
  perform tests.join_team(v_away, away_player);
  foreach v_m in array array[m, m_late, m_forfeit, m_disputed, m_draw] loop
    perform tests.form_player(v_m, cap_a, 'a', true, true);
    perform tests.form_player(v_m, sami, 'a', true, true);
    perform tests.form_player(v_m, gone, 'a', true, false, true);
    perform tests.form_player(v_m, cap_b, 'b', true, true);
    perform tests.form_player(v_m, away_player, 'b', true, true);
  end loop;
  v_guest := tests.guest_player(m, 'a', 'Nikos (guest)');

  -- The goals must add up to the score (2 for Home).
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', tests.s13b_side(m, array[sami], array[1])))) = 'score_mismatch', 'one goal for 2';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', tests.s13b_side(m, array[sami], array[3])))) = 'score_mismatch', 'three goals for 2';

  -- Exactly 2: Sami (one assist: the captain) and the guest.
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', jsonb_build_object('players', jsonb_build_array(
             jsonb_build_object('playerId', tests.player_id(m, sami), 'goals', 1),
             jsonb_build_object('playerId', tests.player_id(m, cap_a), 'goals', 0, 'assists', 1),
             jsonb_build_object('playerId', v_guest, 'goals', 1)))))) is null, 'two goals';
  assert (select count(*) from public.match_goals where match_id = m and side = 'a') = 2, 'two rows';
  assert (select assists from public.match_assists where match_id = m and player_id = tests.player_id(m, cap_a)) = 1,
    'the captain''s assist';

  -- Replacing within the window: an own goal and Sami.
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', tests.s13b_side(m, array[sami], array[1], null, 1)))) is null, 'replace';
  assert (select count(*) from public.match_goals where match_id = m and side = 'a') = 2, 'still two rows';
  assert (select count(*) from public.match_goals where match_id = m and scorer_player_id is null) = 1, 'own goal';
  assert not exists (select 1 from public.match_assists where match_id = m and side = 'a'), 'assists replaced too';

  -- A player from the other side, or one who left, isn't on the side.
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', tests.s13b_side(m, array[sami, away_player], array[1, 1])))) = 'not_your_player',
    'other side scorer';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', tests.s13b_side(m, array[sami, away_player], array[2, 0], array[0, 1])))) = 'not_your_player',
    'other side assist';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', tests.s13b_side(m, array[sami, gone], array[1, 1])))) = 'not_your_player', 'left player';
  -- A bad id, the same player twice, a negative count.
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           '{"a": {"players": [{"playerId": "x", "goals": 2}]}}')) = 'invalid_stats', 'bad id';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', tests.s13b_side(m, array[sami, sami], array[1, 1])))) = 'invalid_stats', 'twice';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('a', tests.s13b_side(m, array[sami], array[-1], null, 3)))) = 'invalid_stats', 'negative';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m, '[]')) = 'invalid_stats', 'not an object';
  -- A refused call changed nothing.
  assert (select count(*) from public.match_goals where match_id = m and scorer_player_id is null) = 1, 'unchanged';

  -- Only that side's captain: a player isn't, a stranger isn't in the match,
  -- and Home's captain can't write Away's goals.
  assert tests.error_as(sami, format('select public.set_match_stats(%L, %L)', m, '{"a": {}}')) = 'not_captain', 'player';
  assert tests.error_as(stranger, format('select public.set_match_stats(%L, %L)', m, '{"a": {}}')) = 'not_in_match', 'stranger';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('b', tests.s13b_side(m, array[away_player], array[1])))) = 'not_your_player', 'other side';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m, '{"c": {}}')) = 'invalid_stats', 'bad side';
  -- Away's captain writes Away's one goal.
  assert tests.error_as(cap_b, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('b', tests.s13b_side(m, array[away_player], array[1])))) is null, 'away goal';
  assert (select count(*) from public.match_goals where match_id = m and side = 'b') = 1, 'away row';
  assert (select count(*) from public.match_goals where match_id = m and side = 'a') = 2, 'home rows kept';

  -- 0-0: nothing to log.
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m_draw,
           jsonb_build_object('a', tests.s13b_side(m_draw, '{}', '{}')))) is null, '0-0';

  -- Forfeits and disputed matches have no goals; 24 hours after
  -- confirmation the window is closed.
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m_forfeit, '{"a": {}}')) = 'match_not_confirmed', 'forfeit';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m_disputed, '{"a": {}}')) = 'match_not_confirmed', 'disputed';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', m_late,
           jsonb_build_object('a', tests.s13b_side(m_late, array[sami], array[1])))) = 'scorers_window_closed', 'at 24h';
  assert tests.error_as(cap_a, format('select public.set_match_stats(%L, %L)', gen_random_uuid(), '{"a": {}}')) = 'match_not_found', 'no match';

  -- Nobody writes match_goals or match_assists directly.
  assert tests.error_as(cap_a, format('insert into public.match_goals (match_id, side, entered_by) values (%L, %L, %L)', m, 'a', cap_a))
         like 'permission denied%', 'direct insert';
  assert tests.error_as(cap_a, format('insert into public.match_assists (match_id, side, player_id, assists, entered_by) values (%L, %L, %L, 1, %L)',
                                      m, 'a', tests.player_id(m, sami), cap_a)) like 'permission denied%', 'direct assist';
end $$;

-- Pickup: the booker (side a's captain) corrects both Bibs and Non-bibs; a
-- Non-bibs player can't.
do $$
declare
  booker uuid := tests.create_user('a4g2-booker@futty.test');
  bib uuid := tests.create_user('a4g2-bib@futty.test');
  nonbib uuid := tests.create_user('a4g2-nonbib@futty.test');
  m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 1, 1);
begin
  update public.match_sides set captain_profile_id = booker where match_id = m and side = 'a';
  perform tests.form_player(m, booker, 'a', true, true);
  perform tests.form_player(m, bib, 'a', true, true);
  perform tests.form_player(m, nonbib, 'b', true, true);

  assert tests.error_as(booker, format('select public.set_match_stats(%L, %L)', m, jsonb_build_object(
           'a', tests.s13b_side(m, array[bib], array[1]), 'b', tests.s13b_side(m, array[nonbib], array[1])))) is null,
    'both sides';
  assert tests.error_as(booker, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('b', tests.s13b_side(m, array[bib], array[1])))) = 'not_your_player', 'bib for non-bibs';
  assert tests.error_as(nonbib, format('select public.set_match_stats(%L, %L)', m,
           jsonb_build_object('b', tests.s13b_side(m, array[nonbib], array[1])))) = 'not_captain', 'non-bibs player';
  assert (select count(*) from public.match_goals where match_id = m) = 2, 'one each';
end $$;

rollback;
