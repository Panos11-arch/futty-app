-- S14b power ranking security: computed on the server, read-only to
-- players. Signed-in players read the ranking, the breakdown and the
-- history table; nobody but service_role runs the job, the replay or the
-- helpers; nobody writes. Signed-out users read nothing. Security definer
-- functions set search_path = ''.
begin;

do $$
declare
  v_user uuid := tests.create_user('pr5@futty.test');
  a uuid := tests.create_team('PR5 A');
  b uuid := tests.create_team('PR5 B');
  v_error text;
  v_fn text;
begin
  perform tests.pr_match(a, b, 1, 0, now() - interval '5 days');
  perform tests.pr_tick();

  -- Signed in: reads.
  perform tests.act_as(v_user);
  assert tests.error_of('select * from public.get_power_ranking(''5-a-side'')') is null, 'ranking readable';
  assert tests.error_of(format('select * from public.get_power_ranking_history(%L, ''5-a-side'')', a)) is null,
    'breakdown readable';
  assert (select count(*) from public.get_power_ranking_history(a, '5-a-side')) = 1, 'the breakdown row';
  assert (select count(*) from public.power_ranking_history where team_id = a) = 1, 'history table readable';
  v_error := tests.error_of('select * from public.get_power_ranking(''8-a-side'')');
  assert v_error = 'invalid_format', format('unknown format: %s', v_error);

  -- Signed in: no writes, no jobs.
  v_error := tests.error_of('update public.power_ranking_history set points_after = 5000');
  assert v_error like 'permission denied%', format('update history: %s', v_error);
  v_error := tests.error_of('delete from public.power_ranking_history');
  assert v_error like 'permission denied%', format('delete history: %s', v_error);
  v_error := tests.error_of(format(
    'insert into public.power_ranking_history (format, source, game_id, kickoff_at, team_id, opponent_team_id, category, '
    'goals_for, goals_against, result, w, expected, k, points_before, points_after, change) '
    'values (''5-a-side'', ''match'', gen_random_uuid(), now(), %L, %L, ''league'', 9, 0, ''W'', 1, 0.5, 40, 1000, 9000, 8000)',
    a, b));
  assert v_error like 'permission denied%', format('insert history: %s', v_error);
  v_error := tests.error_of('select count(*) from public.power_ranking_dirty');
  assert v_error like 'permission denied%', format('queue hidden: %s', v_error);
  v_error := tests.error_of('update public.app_rules set power_ranking_k_league = 400');
  assert v_error like 'permission denied%', format('rules: %s', v_error);
  foreach v_fn in array array[
    'select public.power_ranking_tick()',
    'select public.power_ranking_replay(''5-a-side'', ''-infinity'')',
    'select * from public.power_ranking_games(''5-a-side'', ''-infinity'', now())',
    'select * from public.power_ranking_list(''5-a-side'', now())',
    'select public.power_ranking_change(1000, 1000, 1, 40)',
    'select public.power_ranking_expected(1000, 1000)',
    'select public.power_ranking_k(''league'')',
    'select public.power_ranking_fixture_kickoff(current_date, null, now())',
    'select public.match_jobs_tick()'
  ] loop
    v_error := tests.error_of(v_fn);
    assert v_error like 'permission denied%', format('%s: %s', v_fn, v_error);
  end loop;
  perform tests.act_as_postgres();

  -- Signed out: nothing.
  perform tests.act_as_anon();
  v_error := tests.error_of('select * from public.get_power_ranking(''5-a-side'')');
  assert v_error like 'permission denied%', format('anon ranking: %s', v_error);
  v_error := tests.error_of('select count(*) from public.power_ranking_history');
  assert v_error like 'permission denied%', format('anon history: %s', v_error);
  perform tests.act_as_postgres();

  -- RLS on both tables; every function security definer with search_path = ''.
  assert (select bool_and(relrowsecurity) from pg_class
          where oid in ('public.power_ranking_history'::regclass, 'public.power_ranking_dirty'::regclass)), 'RLS on';
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '%power_ranking%')
      and (not p.prosecdef or p.proconfig is null or not 'search_path=""' = any (p.proconfig))
  ), 'security definer, search_path = ''''';
end $$;

rollback;
