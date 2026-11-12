-- A4a (docs/specs/match-record.md sections 4.6, 4.9, decisions 1e): the
-- match page (get_match_page) and who can read it. Match members read it at
-- any time (lineups before kickoff); everyone signed in reads it once the
-- match is confirmed; nobody else learns the match exists. Plus grants on
-- the new tables and functions.
begin;

do $$
declare
  v_home uuid := tests.create_team('A4P Home');
  v_away uuid := tests.create_team('A4P Away');
  v_venue uuid := tests.create_venue();
  cap_a uuid := tests.create_user('a4p-cap-a@futty.test');
  cap_b uuid := tests.create_user('a4p-cap-b@futty.test');
  sami uuid := tests.create_user('a4p-sami@futty.test');
  stranger uuid := tests.create_user('a4p-stranger@futty.test');
  k timestamptz := now() + interval '1 day';
  m uuid := tests.form_match(k, 'scheduled', null, null, v_home, v_away, p_venue => v_venue);
  v_guest uuid;
  v_page jsonb;
begin
  perform tests.join_team(v_home, cap_a, 'captain');
  perform tests.join_team(v_away, cap_b, 'captain');
  update public.profiles set full_name = 'Anna Captain' where id = cap_a;
  update public.profiles set full_name = 'Sami S' where id = sami;
  perform tests.form_player(m, cap_a, 'a', true, true);
  perform tests.form_player(m, sami, 'a', true, true);
  perform tests.form_player(m, cap_b, 'b', true, true);
  v_guest := tests.guest_player(m, 'a', 'Nikos');

  assert tests.error_as(cap_a, format('select public.set_match_lineup(%L, %L, %L, %L)', m, 'a', '2-2',
           jsonb_build_object('gk', tests.player_id(m, sami), 'f1', v_guest, 'f2', tests.player_id(m, cap_a)))) is null, 'lineup';

  -- Before kickoff: members see the lineup; a stranger can't see the match.
  v_page := tests.page_as(cap_b, m);
  assert v_page ->> 'status' = 'scheduled' and v_page ->> 'kind' = 'named', 'status';
  assert v_page -> 'venue' ->> 'id' = v_venue::text and v_page -> 'venue' ->> 'name' is not null, 'venue';
  assert (v_page ->> 'kickoffAt')::timestamptz = k, 'kickoff';
  assert v_page ->> 'kickoffLocal' = to_char(k at time zone 'Asia/Nicosia', 'YYYY-MM-DD"T"HH24:MI:SS'), 'kickoff local';
  assert v_page -> 'sides' -> 0 ->> 'label' = 'A4P Home' and v_page -> 'sides' -> 1 ->> 'label' = 'A4P Away', 'sides';
  assert v_page -> 'sides' -> 0 -> 'score' = 'null', 'no score yet';
  assert v_page -> 'goals' = '[]' and v_page -> 'motm' = '[]', 'nothing yet';
  assert jsonb_array_length(v_page -> 'lineups') = 1, 'one lineup';
  assert v_page -> 'lineups' -> 0 ->> 'formation' = '2-2', 'formation';
  assert (select array_agg(e ->> 'key' order by ord) from jsonb_array_elements(v_page -> 'lineups' -> 0 -> 'positions')
            with ordinality t(e, ord)) = array['gk', 'f1', 'f2'], 'positions in formation order';
  assert v_page -> 'lineups' -> 0 -> 'positions' -> 0 ->> 'name' = 'Sami S', 'keeper name';
  assert v_page -> 'lineups' -> 0 -> 'positions' -> 1 ->> 'guestName' = 'Nikos'
         and v_page -> 'lineups' -> 0 -> 'positions' -> 1 ->> 'name' = 'Nikos'
         and v_page -> 'lineups' -> 0 -> 'positions' -> 1 -> 'profileId' = 'null', 'guest';
  assert tests.error_as(stranger, format('select public.get_match_page(%L)', m)) = 'match_not_found', 'stranger before';
  perform tests.act_as(stranger);
  assert (select count(*) from public.match_lineups where match_id = m) = 0, 'stranger reads no lineup';
  perform tests.act_as_postgres();
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.get_match_page(%L)', m)) like 'permission denied%', 'anon';
  perform tests.act_as_postgres();

  -- Played and confirmed 3-1 an hour ago; goals entered.
  update public.matches
  set kickoff_at = now() - interval '3 hours', ends_at = now() - interval '2 hours',
      result_deadline_at = now() + interval '22 hours', status = 'confirmed', side_a_score = 3, side_b_score = 1,
      confirmed_at = now() - interval '1 hour', confirmed_via = 'agreed'
  where id = m;
  assert tests.error_as(cap_a, format('select public.set_match_goals(%L, %L)', m,
           jsonb_build_array(jsonb_build_object('scorerPlayerId', tests.player_id(m, sami), 'assistPlayerId', v_guest),
                             jsonb_build_object('scorerPlayerId', v_guest),
                             jsonb_build_object('scorerPlayerId', null)))) is null, 'goals';

  -- Everyone signed in reads it now.
  v_page := tests.page_as(stranger, m);
  assert v_page ->> 'status' = 'confirmed', 'confirmed';
  assert (v_page -> 'sides' -> 0 ->> 'score')::int = 3 and (v_page -> 'sides' -> 1 ->> 'score')::int = 1, 'score';
  assert jsonb_array_length(v_page -> 'goals') = 3, 'three goals';
  assert v_page -> 'goals' -> 0 ->> 'side' = 'a'
         and v_page -> 'goals' -> 0 -> 'scorer' ->> 'name' = 'Sami S'
         and v_page -> 'goals' -> 0 -> 'assist' ->> 'guestName' = 'Nikos', 'first goal in order';
  assert v_page -> 'goals' -> 1 -> 'scorer' ->> 'name' = 'Nikos' and v_page -> 'goals' -> 1 -> 'assist' = 'null', 'guest goal';
  assert v_page -> 'goals' -> 2 -> 'scorer' = 'null', 'unknown scorer';
  assert (v_page ->> 'scorersOpenUntil')::timestamptz = now() + interval '23 hours', 'scorers window';
  assert (v_page ->> 'motmVotingClosesAt')::timestamptz = now() + interval '23 hours', 'voting window';
  assert jsonb_array_length(v_page -> 'lineups') = 1, 'lineup on the page afterwards';
  perform tests.act_as(stranger);
  assert (select count(*) from public.match_goals where match_id = m) = 3, 'goals readable once confirmed';
  assert (select count(*) from public.match_lineups where match_id = m) = 1, 'lineups readable once confirmed';
  perform tests.act_as_postgres();
  assert tests.error_as(stranger, format('select public.get_match_page(%L)', gen_random_uuid())) = 'match_not_found', 'no match';
end $$;

-- A forfeit's page: no score, no goals, no man of the match.
do $$
declare
  stranger uuid := tests.create_user('a4p2-stranger@futty.test');
  m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', null, null, tests.create_team('F1'), tests.create_team('F2'), 'b', 'no_show');
  v_page jsonb;
begin
  v_page := tests.page_as(stranger, m);
  assert v_page -> 'forfeit' = jsonb_build_object('side', 'b', 'reason', 'no_show'), format('forfeit: %s', v_page -> 'forfeit');
  assert v_page -> 'sides' -> 0 -> 'score' = 'null', 'no score';
  assert not (v_page ->> 'motmOpen')::boolean and v_page -> 'motmVotingClosesAt' = 'null', 'no vote';
end $$;

-- Grants: the presets are readable; internal helpers aren't callable from the app.
do $$
declare
  me uuid := tests.create_user('a4p3-me@futty.test');
begin
  perform tests.act_as(me);
  assert (select count(*) from public.match_formation_presets) > 0, 'presets readable';
  perform tests.act_as_postgres();
  assert tests.error_as(me, 'insert into public.match_formation_presets values (5, ''4'', 9)') like 'permission denied%', 'presets read-only';
  assert tests.error_as(me, format('select public.match_side_writer(%L, %L)', gen_random_uuid(), me)) like 'permission denied%',
    'match_side_writer';
  assert tests.error_as(me, format('select public.match_player_json(%L)', gen_random_uuid())) like 'permission denied%',
    'match_player_json';
  assert tests.error_as(me, format('select public.match_motm_notify(%L, null)', gen_random_uuid())) like 'permission denied%',
    'match_motm_notify';
end $$;

rollback;
