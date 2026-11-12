-- A4a (docs/specs/match-record.md sections 4.6, 5.3, decisions 1e): goals.
-- set_match_goals replaces the caller's side's goals: only that side's
-- captain (the booker writes both sides of a pickup); only a confirmed,
-- non-forfeit match, for 24 hours after confirmed_at; the number of goals
-- equals the side's score; scorers and assisters are players on that side
-- (guests allowed).
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
  v_cap_a uuid;
  v_sami uuid;
  v_guest uuid;
  v_gone uuid;
  v_away_player uuid;
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
  v_cap_a := tests.player_id(m, cap_a);
  v_sami := tests.player_id(m, sami);
  v_gone := tests.player_id(m, gone);
  v_away_player := tests.player_id(m, away_player);
  v_guest := tests.guest_player(m, 'a', 'Nikos (guest)');

  -- The scorer count must equal the score (2 for Home).
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', v_sami)))) = 'score_mismatch', 'one goal for 2';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', v_sami), jsonb_build_object('scorerPlayerId', v_sami),
                             jsonb_build_object('scorerPlayerId', v_sami)))) = 'score_mismatch', 'three goals for 2';

  -- Exactly 2: Sami (assist: the captain) and the guest.
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', v_sami, 'assistPlayerId', v_cap_a),
                             jsonb_build_object('scorerPlayerId', v_guest)))) is null, 'two goals';
  assert (select count(*) from public.match_goals where match_id = m and side = 'a') = 2, 'two rows';
  assert exists (select 1 from public.match_goals where match_id = m and scorer_player_id = v_sami
                 and assist_player_id = v_cap_a and entered_by = cap_a), 'sami from the captain';

  -- Replacing within the window: an unknown scorer (or own goal) and Sami.
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', null), jsonb_build_object('scorerPlayerId', v_sami)))) is null,
    'replace';
  assert (select count(*) from public.match_goals where match_id = m and side = 'a') = 2, 'still two rows';
  assert (select count(*) from public.match_goals where match_id = m and scorer_player_id is null) = 1, 'unknown scorer';

  -- A player from the other side, or one who left, isn't on the side.
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', v_sami), jsonb_build_object('scorerPlayerId', v_away_player)))) = 'not_in_match',
    'other side scorer';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', v_sami, 'assistPlayerId', v_away_player),
                             jsonb_build_object('scorerPlayerId', v_sami)))) = 'not_in_match', 'other side assist';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', v_gone), jsonb_build_object('scorerPlayerId', v_sami)))) = 'not_in_match',
    'left player';
  -- Assisting yourself, an assist without a scorer, or a bad id.
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', v_sami, 'assistPlayerId', v_sami),
                             jsonb_build_object('scorerPlayerId', v_sami)))) = 'invalid_goals', 'self assist';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('assistPlayerId', v_sami), jsonb_build_object('scorerPlayerId', v_sami)))) = 'invalid_goals',
    'assist without scorer';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', 'x'), jsonb_build_object('scorerPlayerId', v_sami)))) = 'invalid_goals',
    'bad id';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m, '{}')) = 'invalid_goals', 'not an array';
  -- A refused call changed nothing.
  assert (select count(*) from public.match_goals where match_id = m and scorer_player_id is null) = 1, 'unchanged';

  -- Only that side's captain: a player isn't, a stranger isn't in the match,
  -- and Home's captain can't write Away's goals.
  assert tests.error_as(sami, format('select public.set_match_goals(%L, %L)', m, '[]')) = 'not_captain', 'player';
  assert tests.error_as(stranger, format('select public.set_match_goals(%L, %L)', m, '[]')) = 'not_in_match', 'stranger';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L, %L)', m, '[]', 'b')) = 'not_captain', 'other side';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L, %L)', m, '[]', 'c')) = 'invalid_side', 'bad side';
  -- Away's captain writes Away's one goal; naming their own side is fine.
  assert tests.error_as(cap_b, format('select public.set_match_goals(%L, %L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', v_away_player)), 'b')) is null, 'away goal';
  assert (select count(*) from public.match_goals where match_id = m and side = 'b') = 1, 'away row';
  assert (select count(*) from public.match_goals where match_id = m and side = 'a') = 2, 'home rows kept';

  -- 0-0: an empty list.
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m_draw, '[]')) is null, '0-0';

  -- Forfeits and disputed matches have no goals; 24 hours after
  -- confirmation the window is closed.
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m_forfeit, '[]')) = 'match_not_confirmed', 'forfeit';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m_disputed, '[]')) = 'match_not_confirmed', 'disputed';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m_late,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', tests.player_id(m_late, sami))))) = 'scorers_window_closed', 'at 24h';
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', gen_random_uuid(), '[]')) = 'match_not_found', 'no match';

  -- Nobody writes match_goals directly.
  assert tests.error_as(cap_a, format('insert into public.match_goals (match_id, side, entered_by) values (%L, %L, %L)', m, 'a', cap_a))
         like 'permission denied%', 'direct insert';
end $$;

-- Pickup: the booker (side a's captain) enters goals for both Bibs and
-- Non-bibs; a Non-bibs player can't.
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

  -- The booker must say which side.
  assert tests.error_as(booker, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', tests.player_id(m, bib))))) = 'invalid_side', 'side needed';
  assert tests.error_as(booker, format('select public.set_match_goals(%L, %L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', tests.player_id(m, bib))), 'a')) is null, 'bibs';
  assert tests.error_as(booker, format('select public.set_match_goals(%L, %L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', tests.player_id(m, nonbib))), 'b')) is null, 'non-bibs';
  assert tests.error_as(booker, format('select public.set_match_goals(%L, %L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', tests.player_id(m, bib))), 'b')) = 'not_in_match', 'bib for non-bibs';
  assert tests.error_as(nonbib, format('select public.set_match_goals(%L, %L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', tests.player_id(m, nonbib))), 'b')) = 'not_captain', 'non-bibs player';
  assert (select count(*) from public.match_goals where match_id = m) = 2, 'one each';
end $$;

rollback;
