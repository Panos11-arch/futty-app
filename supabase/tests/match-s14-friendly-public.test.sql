-- S14, Friendly games (decided by Panos and Anghelo, 25 November): a game
-- switched to Friendly counts for the player, never against others. It is
-- left out of what ranks players publicly (Team of the Week, tested in
-- match-s14-totw-1-select; the venue leaderboards; the venue page's top
-- players) and still counts for personal progress (own season stats,
-- streaks and, decided by Anghelo on 25 November, streak badges).
begin;

do $$
declare
  v_venue uuid := tests.create_venue();
  a uuid := tests.totw_user('s14f-a@futty.test');
  f uuid := tests.totw_user('s14f-f@futty.test');
  s uuid := tests.totw_user('s14f-s@futty.test');
  v_viewer uuid := tests.create_user('s14f-viewer@futty.test');
  m uuid;
  v_top jsonb;
  v_year integer;
begin
  update public.venues set city = 'Larnaca' where id = v_venue;
  -- A: three competitive games at the venue (7.0). F: three Friendly games
  -- there (9.0, 3 goals each).
  for i in 1 .. 3 loop
    m := tests.totw_match(now() - make_interval(days => i + 1), '5-a-side', v_venue);
    perform tests.totw_play(m, a, 7.0, 1);
    m := tests.totw_match(now() - make_interval(days => i + 1, hours => 3), '5-a-side', v_venue, false);
    perform tests.totw_play(m, f, 9.0, 3);
  end loop;
  v_year := extract(year from (now() - interval '2 days') at time zone 'Asia/Nicosia')::integer;

  -- 1. The venue page's top players: A only.
  perform tests.act_as(v_viewer);
  v_top := public.venue_highlights(v_venue) -> 'top_players';
  assert (select array_agg(x ->> 'profile_id') from jsonb_array_elements(v_top) x) = array[a::text],
    format('Friendly ratings never rank F, got %s', v_top);

  -- 2. The leaderboards: A, not F.
  assert exists (select 1 from public.stats_leaderboards l
                 where l.scope = 'venue' and l.scope_key = v_venue::text and l.profile_id = a and l.season_year = v_year),
    'A on the venue board';
  assert not exists (select 1 from public.stats_leaderboards l where l.profile_id = f), 'F on no board';

  -- 3. F's own season still has them.
  assert (select (appearances, goals) from public.player_season_stats
          where profile_id = f and season_kind = 'all') = (3, 9), 'F''s own stats count his Friendly games';
  perform tests.act_as_postgres();

  -- 4. A streak made partly of Friendly weeks still earns its badge: a
  --    competitive game in the week of 5 January 2026, a Friendly one the
  --    week after: two weeks, Bronze.
  m := tests.totw_match('2026-01-06 18:00+00', '5-a-side', v_venue);
  perform tests.form_player(m, s, 'a', true, true);
  m := tests.totw_match('2026-01-13 18:00+00', '5-a-side', v_venue, false);
  perform tests.form_player(m, s, 'a', true, true);
  perform tests.act_as_service_role();
  perform public.streak_badges_tick('2026-01-19 07:00+00');
  perform tests.act_as_postgres();
  assert exists (select 1 from public.streak_badges where profile_id = s and badge = 'bronze'),
    'Bronze from one competitive and one Friendly week';
end $$;

rollback;
