-- A5a (docs/specs/match-record.md decision 1f, section 4.8): the starting
-- level from the five sign-up questions. 1.0 plus points per answer, capped
-- to 1.0-6.0, rounded to 0.1; provisional, 0% reliability. Answered once;
-- a default row (never answered, no competitive matches yet) can still be
-- replaced. The answers are visible to their owner only.
begin;

create function tests.start(p_user uuid, p_years text, p_highest text, p_often text, p_position text, p_self integer)
returns text
language sql
as $$
  select tests.error_as(p_user, format('select public.set_starting_level(%L, %L, %L, %L, %s)',
                                       p_years, p_highest, p_often, p_position, coalesce(p_self::text, 'null')));
$$;

do $$
declare
  v_low uuid := tests.create_user('lv1-low@futty.test');
  v_top uuid := tests.create_user('lv1-top@futty.test');
  v_mid uuid := tests.create_user('lv1-mid@futty.test');
  v_semi uuid := tests.create_user('lv1-semi@futty.test');
  v_default uuid := tests.create_user('lv1-default@futty.test');
  v_played uuid := tests.create_user('lv1-played@futty.test');
  v_res uuid := tests.create_user('lv1-result@futty.test');
  v_row public.player_levels;
  v_result jsonb;
begin
  -- Exact levels.
  assert tests.start(v_low, 'under_1', 'kickabout', 'rarely', 'gk', 1) is null, 'low';
  assert tests.level_of(v_low) = 1.0, format('1.0 + nothing = 1.0, got %s', tests.level_of(v_low));
  assert tests.start(v_top, 'over_10', 'professional', 'several_weekly', 'fwd', 10) is null, 'top';
  assert tests.level_of(v_top) = 6.0, format('6.2 capped to 6.0, got %s', tests.level_of(v_top));
  assert tests.start(v_mid, '3_10', 'amateur', 'weekly', 'mid', 6) is null, 'mid';
  assert tests.level_of(v_mid) = 3.6, format('1 + 0.6 + 0.7 + 0.5 + 0.83 = 3.6, got %s', tests.level_of(v_mid));
  assert tests.start(v_semi, '1_3', 'semi_pro', 'monthly', 'def', 4) is null, 'semi';
  assert tests.level_of(v_semi) = 3.5, format('1 + 0.3 + 1.5 + 0.2 + 0.5 = 3.5, got %s', tests.level_of(v_semi));

  select * into v_row from public.player_levels where profile_id = v_mid;
  assert v_row.provisional and v_row.reliability_pct = 0 and v_row.competitive_matches = 0
         and v_row.source = 'questionnaire', format('provisional, 0%%: %s', row_to_json(v_row));
  assert exists (select 1 from public.player_level_history
                 where profile_id = v_mid and match_id is null and reason = 'start'
                   and level_before is null and level_after = 3.6), 'a start row in the history';

  -- What the app gets back.
  perform tests.act_as(v_semi);
  assert (select count(*) from public.player_levels where profile_id = v_semi) = 1, 'readable';
  perform tests.act_as_postgres();
  perform tests.act_as(v_res);
  v_result := public.set_starting_level('over_10', 'kickabout', 'rarely', 'mid', 1);
  perform tests.act_as_postgres();
  assert v_result = jsonb_build_object('level', 1.8, 'provisional', true, 'reliabilityPct', 0, 'competitiveMatches', 0),
    format('result: %s', v_result);

  -- Once only.
  assert tests.start(v_low, 'over_10', 'professional', 'weekly', 'fwd', 10) = 'level_already_set', 'second time';
  assert tests.level_of(v_low) = 1.0, 'unchanged';

  -- A default level (never answered, no competitive match yet) is replaced.
  insert into public.player_levels (profile_id, level, provisional, reliability_pct, competitive_matches, source)
  values (v_default, 3.0, true, 0, 0, 'default');
  assert tests.start(v_default, '1_3', 'semi_pro', 'monthly', 'def', 4) is null, 'default replaced';
  assert tests.level_of(v_default) = 3.5 and (select source from public.player_levels where profile_id = v_default) = 'questionnaire',
    'now from the questions';
  -- ... but not once it has moved in a competitive match.
  insert into public.player_levels (profile_id, level, provisional, reliability_pct, competitive_matches, source)
  values (v_played, 3.2, true, 5, 1, 'default');
  assert tests.start(v_played, '1_3', 'semi_pro', 'monthly', 'def', 4) = 'level_already_set', 'played already';

  -- Bad answers.
  assert tests.start(tests.create_user('lv1-bad1@futty.test'), 'forever', 'kickabout', 'rarely', 'gk', 5) = 'invalid_answer', 'years';
  assert tests.start(tests.create_user('lv1-bad2@futty.test'), 'under_1', 'world_cup', 'rarely', 'gk', 5) = 'invalid_answer', 'highest';
  assert tests.start(tests.create_user('lv1-bad3@futty.test'), 'under_1', 'kickabout', 'daily', 'gk', 5) = 'invalid_answer', 'often';
  assert tests.start(tests.create_user('lv1-bad4@futty.test'), 'under_1', 'kickabout', 'rarely', 'striker', 5) = 'invalid_answer', 'position';
  assert tests.start(tests.create_user('lv1-bad5@futty.test'), 'under_1', 'kickabout', 'rarely', 'gk', 11) = 'invalid_answer', 'self 11';
  assert tests.start(tests.create_user('lv1-bad6@futty.test'), 'under_1', 'kickabout', 'rarely', 'gk', 0) = 'invalid_answer', 'self 0';
  assert tests.start(tests.create_user('lv1-bad7@futty.test'), 'under_1', 'kickabout', 'rarely', 'gk', null) = 'invalid_answer', 'self null';
  assert tests.start(tests.create_user('lv1-bad8@futty.test'), null, 'kickabout', 'rarely', 'gk', 5) = 'invalid_answer', 'years null';

  -- The answers: own row only. The level: everyone signed in.
  perform tests.act_as(v_low);
  assert (select count(*) from public.player_level_answers) = 1, 'own answers only';
  assert (select years_played from public.player_level_answers) = 'under_1', 'own answers';
  assert (select count(*) from public.player_levels where profile_id in (v_top, v_mid)) = 2, 'others'' levels readable';
  assert (select count(*) from public.player_level_history where profile_id = v_top) = 1, 'others'' history readable';
  perform tests.act_as_postgres();
  assert tests.start(v_mid, null, null, null, null, null) = 'level_already_set', 'nothing changes';
end $$;

rollback;
