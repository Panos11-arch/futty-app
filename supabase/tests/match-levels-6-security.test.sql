-- A5a security: signed-out users can't call anything; the level maths and
-- the job are service_role only; no app role writes the level or rating
-- tables; levels are readable by everyone signed in, the sign-up answers and
-- ratings by their owner only.
begin;

do $$
declare
  v_user uuid := tests.create_user('lv6-user@futty.test');
  v_other uuid := tests.create_user('lv6-other@futty.test');
  v_m uuid := tests.form_match(now() - interval '3 hours', 'confirmed', 1, 0);
  v_sql text;
begin
  perform tests.form_player(v_m, v_user, 'a', true, true);
  perform tests.form_player(v_m, v_other, 'b', true, true);
  perform tests.set_level(v_other, 4.0);
  insert into public.player_level_answers (profile_id, years_played, highest_level, play_frequency, position, self_rating)
  values (v_other, '3_10', 'amateur', 'weekly', 'mid', 6);

  -- Signed out: nothing.
  foreach v_sql in array array[
    'select public.set_starting_level(''under_1'', ''kickabout'', ''rarely'', ''gk'', 5)',
    format('select public.set_match_competitive(%L, true)', v_m),
    format('select public.rate_match_player(%L, %L, 5)', v_m, tests.player_id(v_m, v_other)),
    format('select public.get_match_ratings(%L)', v_m),
    format('select public.balance_match_teams(%L)', v_m),
    'select * from public.player_levels',
    'select * from public.player_level_history',
    'select * from public.player_level_answers',
    'select * from public.match_ratings'] loop
    perform tests.act_as_anon();
    assert tests.error_of(v_sql) like 'permission denied%', 'anon: ' || v_sql;
    perform tests.act_as_postgres();
  end loop;

  -- Internal: service_role only.
  foreach v_sql in array array[
    format('select public.apply_match_levels(%L)', v_m),
    'select public.match_levels_tick()',
    format('select public.match_rating_for(%L, %L)', v_m, tests.player_id(v_m, v_other)),
    format('select public.match_rater_weight(%L, %L)', v_m, v_user),
    'select public.match_level_expected(''under_1'', ''kickabout'', ''rarely'')'] loop
    assert tests.error_as(v_user, v_sql) like 'permission denied%', 'internal: ' || v_sql;
  end loop;

  -- No direct writes, even to your own rows.
  foreach v_sql in array array[
    format('insert into public.player_levels (profile_id, level, provisional, reliability_pct, competitive_matches, source) values (%L, 7, false, 100, 50, ''questionnaire'')', v_user),
    format('update public.player_levels set level = 7 where profile_id = %L', v_other),
    format('delete from public.player_levels where profile_id = %L', v_other),
    format('insert into public.player_level_history (profile_id, reason, level_after) values (%L, ''start'', 7)', v_user),
    format('insert into public.player_level_answers (profile_id, years_played, highest_level, play_frequency, position, self_rating) values (%L, ''over_10'', ''professional'', ''several_weekly'', ''fwd'', 10)', v_user),
    format('update public.player_level_answers set self_rating = 10 where profile_id = %L', v_other),
    format('insert into public.match_ratings (match_id, rater_profile_id, rated_player_id, score) values (%L, %L, %L, 10)', v_m, v_user, tests.player_id(v_m, v_other)),
    format('update public.matches set levels_applied_at = now() where id = %L', v_m)] loop
    assert tests.error_as(v_user, v_sql) like 'permission denied%', 'direct write: ' || v_sql;
  end loop;
  assert tests.level_of(v_other) = 4.0, 'unchanged';

  -- Reads.
  perform tests.act_as(v_user);
  assert (select level from public.player_levels where profile_id = v_other) = 4.0, 'levels: everyone signed in';
  assert not exists (select 1 from public.player_level_answers where profile_id = v_other), 'answers: own only';
  perform tests.act_as_postgres();
end $$;

rollback;
