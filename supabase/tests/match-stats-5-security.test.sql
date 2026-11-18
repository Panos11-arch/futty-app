-- A7a security (docs/specs/match-record.md section 7, decision 1g):
-- signed-in players read the stats views and the teams of the week; signed-out
-- users read nothing; nobody but service_role writes or runs the pick; the
-- internal views and helpers are service_role only; no view shows an
-- individual rating or vote.
begin;

do $$
declare
  v_user uuid := tests.create_user('a7s5@futty.test');
  v_view text;
  v_error text;
begin
  -- Signed in: the views and tables read fine.
  perform tests.act_as(v_user);
  foreach v_view in array array['player_season_stats', 'team_season_stats', 'team_recent_matches', 'stats_leaderboards',
                                'team_of_the_week', 'team_of_the_week_players'] loop
    assert tests.error_of(format('select count(*) from public.%I', v_view)) is null, format('%s readable', v_view);
  end loop;
  assert public.stats_min_appearances() = 5, 'the minimum is readable';
  assert tests.error_of(format('select public.match_rating_shown(%L, %L)', gen_random_uuid(), gen_random_uuid())) is null,
    'match_rating_shown callable (it shows only what the match page shows)';

  -- Internal views, the run log and the pick are service_role only.
  foreach v_view in array array['match_stat_players', 'match_stat_teams', 'team_of_the_week_runs'] loop
    v_error := tests.error_of(format('select count(*) from public.%I', v_view));
    assert v_error like 'permission denied%', format('%s: got %s', v_view, v_error);
  end loop;
  assert tests.error_of('select public.team_of_the_week_tick()') like 'permission denied%', 'tick';
  assert tests.error_of(format('select public.team_of_the_week_save(%L, %L, null, %L, null, %L, %L)',
                               '2026-11-09', 'city', 'x', 'x', '{}')) like 'permission denied%', 'save';
  assert tests.error_of('select public.match_jobs_tick()') like 'permission denied%', 'jobs tick';

  -- No writes.
  v_error := tests.error_of(format('insert into public.team_of_the_week (week_start, scope, city_key, name, matches) values (%L, %L, %L, %L, 1)',
                                   '2026-11-09', 'city', 'x', 'x'));
  assert v_error like 'permission denied%', format('insert a team: %s', v_error);
  v_error := tests.error_of('delete from public.team_of_the_week_players');
  assert v_error like 'permission denied%', format('delete players: %s', v_error);

  -- Signed out: nothing.
  perform tests.act_as_anon();
  foreach v_view in array array['player_season_stats', 'team_season_stats', 'team_recent_matches', 'stats_leaderboards',
                                'team_of_the_week', 'team_of_the_week_players'] loop
    assert tests.error_of(format('select count(*) from public.%I', v_view)) like 'permission denied%',
      format('%s hidden from anon', v_view);
  end loop;
  assert tests.error_of(format('select public.match_rating_shown(%L, %L)', gen_random_uuid(), gen_random_uuid()))
         like 'permission denied%', 'match_rating_shown hidden from anon';
  perform tests.act_as_postgres();

  -- No column of a public view is a single rating, score or vote.
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('player_season_stats', 'team_season_stats', 'team_recent_matches', 'stats_leaderboards')
      and column_name in ('score', 'rating', 'rater_profile_id', 'voter_profile_id', 'votes')), 'aggregates only';

  -- Security definer functions set search_path = ''.
  assert (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('match_rating_shown', 'team_of_the_week_save', 'team_of_the_week_tick', 'match_jobs_tick')),
    'security definer with search_path = ''''';

  -- The new notification type exists and can be turned off.
  assert (select not always_sent from public.notification_types where type = 'team_of_the_week'), 'team_of_the_week';
end $$;

rollback;
