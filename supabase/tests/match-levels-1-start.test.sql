-- A5a (docs/specs/match-record.md decision 1f, section 4.8), as changed by
-- S13B (levels on 1.0-10.0): the starting level is the self-rating the
-- player picks, if it is within 1 of the rating the server expects from
-- "How long have you played", "Highest level" and "How often do you play
-- now": expected = 3 + round(7 x points / 3.7). Outside that range
-- set_starting_level refuses (self_rating_out_of_range, with the range in
-- the detail) and writes nothing. Provisional, 0% reliability. Answered
-- once; a default row (never answered, no competitive matches yet) can
-- still be replaced. The answers are visible to their owner only.
begin;

create function tests.start(p_user uuid, p_years text, p_highest text, p_often text, p_position text, p_self integer)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.set_starting_level(%L, %L, %L, %L, %s)',
                                       p_years, p_highest, p_often, p_position, coalesce(p_self::text, 'null')));
$$;

-- The allowed range set_starting_level gives back when it refuses p_self.
create function tests.start_range(p_user uuid, p_years text, p_highest text, p_often text, p_self integer)
returns jsonb
language plpgsql
as $$
declare
  v_detail text;
begin
  perform tests.act_as(p_user);
  begin
    perform public.set_starting_level(p_years, p_highest, p_often, 'mid', p_self);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  perform tests.act_as_postgres();
  return v_detail::jsonb;
end;
$$;

-- The expected ratings (the step's examples).
do $$
begin
  perform tests.act_as_service_role();
  assert public.match_level_expected('under_1', 'kickabout', 'rarely') = 3, 'less than a year, kickabouts, rarely: 3';
  assert public.match_level_expected('1_3', 'kickabout', 'monthly') = 4, '1-3 years, kickabouts, monthly: 4';
  assert public.match_level_expected('3_10', 'amateur', 'weekly') = 6, '3-10 years, amateur, weekly: 6';
  assert public.match_level_expected('over_10', 'semi_pro', 'several_weekly') = 9, 'over 10, semi-pro, several a week: 9';
  assert public.match_level_expected('over_10', 'professional', 'several_weekly') = 10, 'over 10, professional: 10';
  perform tests.act_as_postgres();
end $$;

-- The allowed ranges: expected ±1, never below 1 or above 10.
do $$
declare
  u uuid := tests.create_user('lv1-range@futty.test');
begin
  assert tests.start(u, 'under_1', 'kickabout', 'rarely', 'gk', 10) = 'self_rating_out_of_range', 'expected 3: 10 refused';
  assert tests.start_range(u, 'under_1', 'kickabout', 'rarely', 10) = '{"low": 2, "high": 4}', 'allows 2-4';
  assert tests.start(u, 'under_1', 'kickabout', 'rarely', 'gk', 1) = 'self_rating_out_of_range', 'expected 3: 1 refused';
  assert tests.start_range(u, '1_3', 'kickabout', 'monthly', 9) = '{"low": 3, "high": 5}', 'expected 4: allows 3-5';
  assert tests.start_range(u, '3_10', 'amateur', 'weekly', 1) = '{"low": 5, "high": 7}', 'expected 6: allows 5-7';
  assert tests.start_range(u, 'over_10', 'semi_pro', 'several_weekly', 1) = '{"low": 8, "high": 10}', 'expected 9: allows 8-10';
  assert tests.start_range(u, 'over_10', 'professional', 'several_weekly', 1) = '{"low": 9, "high": 10}',
    'expected 10: allows 9-10';
  -- A refusal writes nothing: the player picks again.
  assert not exists (select 1 from public.player_levels where profile_id = u), 'no level';
  assert not exists (select 1 from public.player_level_answers where profile_id = u), 'no answers';
  assert tests.start(u, 'under_1', 'kickabout', 'rarely', 'gk', 4) is null, 'the top of the range';
  assert tests.level_of(u) = 4.0, format('4.0, got %s', tests.level_of(u));
end $$;

do $$
declare
  v_seven uuid := tests.create_user('lv1-seven@futty.test');
  v_low uuid := tests.create_user('lv1-low@futty.test');
  v_top uuid := tests.create_user('lv1-top@futty.test');
  v_default uuid := tests.create_user('lv1-default@futty.test');
  v_played uuid := tests.create_user('lv1-played@futty.test');
  v_res uuid := tests.create_user('lv1-result@futty.test');
  v_row public.player_levels;
  v_result jsonb;
begin
  -- The pick is the level.
  assert tests.start(v_seven, '3_10', 'amateur', 'weekly', 'mid', 7) is null, 'pick 7';
  assert tests.level_of(v_seven) = 7.0, format('pick 7: 7.0, got %s', tests.level_of(v_seven));
  assert tests.start(v_low, 'under_1', 'kickabout', 'rarely', 'gk', 2) is null, 'low';
  assert tests.level_of(v_low) = 2.0, format('2.0, got %s', tests.level_of(v_low));
  assert tests.start(v_top, 'over_10', 'professional', 'several_weekly', 'fwd', 10) is null, 'top';
  assert tests.level_of(v_top) = 10.0, format('10.0, got %s', tests.level_of(v_top));

  select * into v_row from public.player_levels where profile_id = v_seven;
  assert v_row.provisional and v_row.reliability_pct = 0 and v_row.competitive_matches = 0
         and v_row.source = 'questionnaire', format('provisional, 0%%: %s', row_to_json(v_row));
  assert exists (select 1 from public.player_level_history
                 where profile_id = v_seven and match_id is null and reason = 'start'
                   and level_before is null and level_after = 7.0), 'a start row in the history';

  -- What the app gets back.
  perform tests.act_as(v_res);
  -- Over 10 years, kickabouts, rarely: expected 5, so 4-6.
  v_result := public.set_starting_level('over_10', 'kickabout', 'rarely', 'mid', 6);
  perform tests.act_as_postgres();
  assert v_result = jsonb_build_object('level', 6.00, 'provisional', true, 'reliabilityPct', 0, 'competitiveMatches', 0),
    format('result: %s', v_result);

  -- Once only.
  assert tests.start(v_low, 'over_10', 'professional', 'weekly', 'fwd', 10) = 'level_already_set', 'second time';
  assert tests.level_of(v_low) = 2.0, 'unchanged';

  -- A default level (never answered, no competitive match yet) is replaced.
  insert into public.player_levels (profile_id, level, provisional, reliability_pct, competitive_matches, source)
  values (v_default, 4.0, true, 0, 0, 'default');
  assert tests.start(v_default, '1_3', 'kickabout', 'monthly', 'def', 5) is null, 'default replaced';
  assert tests.level_of(v_default) = 5.0 and (select source from public.player_levels where profile_id = v_default) = 'questionnaire',
    'now from the questions';
  -- ... but not once it has moved in a competitive match.
  insert into public.player_levels (profile_id, level, provisional, reliability_pct, competitive_matches, source)
  values (v_played, 4.3, true, 5, 1, 'default');
  assert tests.start(v_played, '1_3', 'kickabout', 'monthly', 'def', 4) = 'level_already_set', 'played already';

  -- Bad answers.
  assert tests.start(tests.create_user('lv1-bad1@futty.test'), 'forever', 'kickabout', 'rarely', 'gk', 3) = 'invalid_answer', 'years';
  assert tests.start(tests.create_user('lv1-bad2@futty.test'), 'under_1', 'world_cup', 'rarely', 'gk', 3) = 'invalid_answer', 'highest';
  assert tests.start(tests.create_user('lv1-bad3@futty.test'), 'under_1', 'kickabout', 'daily', 'gk', 3) = 'invalid_answer', 'often';
  assert tests.start(tests.create_user('lv1-bad4@futty.test'), 'under_1', 'kickabout', 'rarely', 'striker', 3) = 'invalid_answer', 'position';
  assert tests.start(tests.create_user('lv1-bad5@futty.test'), 'under_1', 'kickabout', 'rarely', 'gk', 11) = 'invalid_answer', 'self 11';
  assert tests.start(tests.create_user('lv1-bad6@futty.test'), 'under_1', 'kickabout', 'rarely', 'gk', 0) = 'invalid_answer', 'self 0';
  assert tests.start(tests.create_user('lv1-bad7@futty.test'), 'under_1', 'kickabout', 'rarely', 'gk', null) = 'invalid_answer', 'self null';
  assert tests.start(tests.create_user('lv1-bad8@futty.test'), null, 'kickabout', 'rarely', 'gk', 3) = 'invalid_answer', 'years null';

  -- The answers: own row only. The level: everyone signed in.
  perform tests.act_as(v_low);
  assert (select count(*) from public.player_level_answers) = 1, 'own answers only';
  assert (select years_played from public.player_level_answers) = 'under_1', 'own answers';
  assert (select count(*) from public.player_levels where profile_id in (v_top, v_seven)) = 2, 'others'' levels readable';
  assert (select count(*) from public.player_level_history where profile_id = v_top) = 1, 'others'' history readable';
  perform tests.act_as_postgres();
  assert tests.start(v_seven, null, null, null, null, null) = 'level_already_set', 'nothing changes';
end $$;

rollback;
