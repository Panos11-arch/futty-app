-- A11 streaks: who reads what (match-record decision 1i).
--   * a player reads only their own streak (get_my_streak);
--   * badges are readable by everyone signed in (shown on profiles), never
--     by anon, and never written by the app;
--   * get_player_streak_badges says whether a player's badges show in
--     colour: only while they are Premium; earned badges stay when Premium
--     ends;
--   * the internal functions are service_role only.
begin;

create function tests.s_play(p_profile uuid, p_kickoff timestamptz)
returns void language plpgsql as $$
declare
  v_match uuid := tests.form_match(p_kickoff, 'confirmed', 1, 0);
begin
  perform tests.form_player(v_match, p_profile, 'a', true, true);
end;
$$;

do $$
declare
  v_me uuid := tests.create_user('s4-me@futty.test');
  v_other uuid := tests.create_user('s4-other@futty.test');
  v_streak jsonb;
  v_badges jsonb;
  v_fn text;
begin
  -- I played last week and this week; the other player has Bronze and Silver.
  perform tests.s_play(v_me, now() - interval '7 days');
  perform tests.s_play(v_me, now() - interval '1 minute');
  insert into public.streak_badges (profile_id, badge, awarded_at) values
    (v_me, 'bronze', now()), (v_other, 'bronze', now() - interval '20 days'), (v_other, 'silver', now());

  perform tests.act_as(v_me);
  v_streak := public.get_my_streak();
  assert (v_streak ->> 'current')::integer >= 1 and (v_streak ->> 'best')::integer >= 1, format('my streak, got %s', v_streak);
  assert v_streak -> 'isPremium' = 'false', 'not Premium';
  assert jsonb_array_length(v_streak -> 'badges') = 6, 'all six levels';
  assert v_streak -> 'badges' -> 0 @> '{"badge": "bronze", "label": "Bronze", "weeks": 2, "earned": true}',
    format('Bronze earned, got %s', v_streak -> 'badges' -> 0);
  assert v_streak -> 'badges' -> 1 @> '{"badge": "silver", "weeks": 4, "earned": false, "awardedAt": null}',
    'Silver not earned';
  assert v_streak -> 'badges' -> 5 @> '{"badge": "champion", "weeks": 30}', 'in order';

  -- Badges are readable by anyone signed in; the app can't write them.
  assert (select count(*) from public.streak_badges where profile_id = v_other) = 2, 'another player''s badges';
  assert (select count(*) from public.streak_badge_levels) = 6, 'the levels';
  assert tests.error_of(format($q$ insert into public.streak_badges (profile_id, badge) values (%L, 'gold') $q$, v_me))
    like 'permission denied%', 'no inserts';
  assert tests.error_of(format($q$ update public.streak_badges set awarded_at = now() where profile_id = %L $q$, v_me))
    like 'permission denied%', 'no updates';
  assert tests.error_of(format($q$ delete from public.streak_badges where profile_id = %L $q$, v_me))
    like 'permission denied%', 'no deletes';
  assert tests.error_of('select * from public.streak_badge_runs') like 'permission denied%', 'runs: service_role only';

  -- Another player's badges, greyed while they aren't Premium.
  v_badges := public.get_player_streak_badges(v_other);
  assert v_badges -> 'inColour' = 'false', 'basic: greyed';
  assert jsonb_array_length(v_badges -> 'badges') = 2, 'earned badges only';
  assert v_badges -> 'badges' -> 0 @> '{"badge": "bronze", "label": "Bronze", "weeks": 2}', 'in order';
  perform tests.act_as_postgres();
  perform tests.make_premium(v_other);
  perform tests.act_as(v_me);
  assert public.get_player_streak_badges(v_other) -> 'inColour' = 'true', 'Premium: in colour';
  perform tests.act_as_postgres();
  update public.profiles set is_premium = false where id = v_other;
  perform tests.act_as(v_me);
  v_badges := public.get_player_streak_badges(v_other);
  assert v_badges -> 'inColour' = 'false' and jsonb_array_length(v_badges -> 'badges') = 2,
    'Premium ended: badges stay, greyed again';
  assert public.get_player_streak_badges(gen_random_uuid()) = '{"inColour": false, "badges": []}',
    'an unknown player has nothing';

  -- Internal functions are refused.
  foreach v_fn in array array[
    format('select * from public.player_streak(%L, now())', v_other),
    format('select * from public.player_streak_weeks(%L, now())', v_other),
    'select public.streak_badges_tick(now())'
  ] loop
    assert tests.error_of(v_fn) like 'permission denied%', format('%s: refused', v_fn);
  end loop;
  perform tests.act_as_postgres();

  -- My streak, as the other player: their own (none), never mine.
  perform tests.act_as(v_other);
  v_streak := public.get_my_streak();
  assert v_streak ->> 'current' = '0' and v_streak ->> 'best' = '0', 'only the caller''s streak';
  perform tests.act_as_postgres();

  -- Signed out.
  perform tests.act_as_anon();
  assert tests.error_of('select public.get_my_streak()') like 'permission denied%', 'anon: no streak';
  assert tests.error_of(format('select public.get_player_streak_badges(%L)', v_other)) like 'permission denied%',
    'anon: no badges';
  assert tests.error_of('select * from public.streak_badges') like 'permission denied%', 'anon: no table';
  perform tests.act_as_postgres();
end $$;

-- RLS on the new tables; search_path pinned on the new functions.
do $$
begin
  assert (select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace
          and relname in ('streak_badge_levels', 'streak_badges', 'streak_badge_runs')
          having count(*) = 3), 'RLS on all three tables';
  assert not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and (p.proname like '%streak%' or p.proname = 'match_jobs_tick')
      and not coalesce('search_path=""' = any (p.proconfig), false)), 'search_path = '''' on every function';
end $$;

rollback;
