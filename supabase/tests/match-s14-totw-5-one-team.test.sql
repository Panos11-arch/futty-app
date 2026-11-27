-- S14 follow-up (decided by Panos, 26 November; docs/specs/match-record.md
-- decision 1k item 8): within the general teams of one format, a player is
-- in at most one team a week, picked All Cyprus → city → venue. A player
-- already in a higher team is passed over and the next best eligible player
-- fills his place; being passed over is not a skip, so it brings no Premium
-- nudge. League teams and other formats are separate. Two teams at the same
-- level (two cities, two venues) go by more matches that week first, then
-- the area name (an assumption, flagged for Panos on the PR).
begin;

do $$
declare
  -- The week of Monday 2 March 2026.
  v_week date := '2026-03-02';
  va uuid := tests.create_venue();
  vb uuid := tests.create_venue();
  v_high uuid;   -- the busier Limassol venue (5 games)
  v_low uuid;    -- the other (4 games)
  v_plain uuid := tests.create_venue();   -- no city, never busy
  v_league uuid;
  top uuid := tests.totw_user('s14o-top@futty.test');
  a2 uuid := tests.totw_user('s14o-a2@futty.test');
  a3 uuid := tests.totw_user('s14o-a3@futty.test');
  a4 uuid := tests.totw_user('s14o-a4@futty.test');
  a5 uuid := tests.totw_user('s14o-a5@futty.test');
  b1 uuid := tests.totw_user('s14o-b1@futty.test');
  b2 uuid := tests.totw_user('s14o-b2@futty.test');
  b3 uuid := tests.totw_user('s14o-b3@futty.test');
  b4 uuid := tests.totw_user('s14o-b4@futty.test');
  b5 uuid := tests.totw_user('s14o-b5@futty.test');
  x uuid := tests.totw_user('s14o-x@futty.test');
  y uuid := tests.totw_user('s14o-y@futty.test');
  z uuid := tests.totw_user('s14o-z@futty.test');
  np uuid := tests.totw_user('s14o-np@futty.test', false);
  low_np uuid := tests.totw_user('s14o-lownp@futty.test', false);
  m uuid;
  v_all5 public.team_of_the_week;
  v_team public.team_of_the_week;
begin
  -- The busier venue gets the larger id, so the old order (by id) would
  -- have picked the other one first.
  v_high := greatest(va, vb);
  v_low := least(va, vb);
  update public.venues set city = 'Limassol' where id in (va, vb);
  update public.venues set city = null where id = v_plain;
  insert into public.leagues (format, scope, capacity, name) values ('5-a-side', 'city', 8, 'S14O League')
  returning id into v_league;

  -- V_HIGH: 5 general 5-a-side games. TOP and A2-A5 (9.5-9.1), NP (9.6, not
  -- Premium), X (7.0, also at V_LOW) and Y (6.5).
  m := tests.totw_match('2026-03-02 18:00+00', '5-a-side', v_high);
  perform tests.totw_play(m, top, 9.5);
  perform tests.totw_play(m, np, 9.6, 0, 0, 'b');
  m := tests.totw_match('2026-03-03 18:00+00', '5-a-side', v_high);
  perform tests.totw_play(m, a2, 9.4);
  perform tests.totw_play(m, a3, 9.3, 0, 0, 'b');
  m := tests.totw_match('2026-03-04 18:00+00', '5-a-side', v_high);
  perform tests.totw_play(m, a4, 9.2);
  perform tests.totw_play(m, a5, 9.1, 0, 0, 'b');
  m := tests.totw_match('2026-03-05 18:00+00', '5-a-side', v_high);
  perform tests.totw_play(m, x, 7.0);
  m := tests.totw_match('2026-03-06 18:00+00', '5-a-side', v_high);
  perform tests.totw_play(m, y, 6.5);

  -- V_LOW: 4 general 5-a-side games. B1-B5 (8.5-8.1), X (7.0) and Z (6.0).
  m := tests.totw_match('2026-03-02 19:00+00', '5-a-side', v_low);
  perform tests.totw_play(m, b1, 8.5);
  perform tests.totw_play(m, b2, 8.4, 0, 0, 'b');
  m := tests.totw_match('2026-03-03 19:00+00', '5-a-side', v_low);
  perform tests.totw_play(m, b3, 8.3);
  perform tests.totw_play(m, b4, 8.2, 0, 0, 'b');
  m := tests.totw_match('2026-03-04 19:00+00', '5-a-side', v_low);
  perform tests.totw_play(m, b5, 8.1);
  perform tests.totw_play(m, x, 7.0, 0, 0, 'b');
  m := tests.totw_match('2026-03-05 19:00+00', '5-a-side', v_low);
  perform tests.totw_play(m, z, 6.0);

  -- No city, not busy: LOW_NP (not Premium, 5.0) is only ever in the All
  -- Cyprus ranking, below its last pick. TOP's league game and his 7-a-side
  -- game are here too.
  m := tests.totw_match('2026-03-06 19:00+00', '5-a-side', v_plain);
  perform tests.totw_play(m, low_np, 5.0);
  m := tests.totw_match('2026-03-07 18:00+00', '5-a-side', v_plain, true, v_league);
  perform tests.totw_play(m, top, 9.0);
  m := tests.totw_match('2026-03-07 19:00+00', '7-a-side', v_plain);
  perform tests.totw_play(m, top, 9.0);

  perform tests.totw_tick('2026-03-09 07:00+00');

  -- 1. TOP is only in All Cyprus; the next best fill the city and venue teams.
  v_all5 := tests.totw_team(v_week, 'general', 'all', '', '5-a-side');
  assert (select array_agg(profile_id order by profile_id) from public.team_of_the_week_players
          where team_of_the_week_id = v_all5.id) = (select array_agg(p order by p) from unnest(array[top, a2, a3, a4, a5]) p),
    format('All Cyprus 5: TOP and A2-A5 (NP skipped), got %s', tests.totw_lineup(v_all5.id));
  v_team := tests.totw_team(v_week, 'general', 'city', 'limassol', '5-a-side');
  assert (select array_agg(profile_id order by profile_id) from public.team_of_the_week_players
          where team_of_the_week_id = v_team.id) = (select array_agg(p order by p) from unnest(array[b1, b2, b3, b4, b5]) p),
    format('Limassol 5: B1-B5 fill the places of TOP and A2-A5, got %s', tests.totw_lineup(v_team.id));
  assert not exists (select 1 from public.team_of_the_week_players p
                     join public.team_of_the_week t on t.id = p.team_of_the_week_id
                     where t.week_start = v_week and t.kind = 'general' and t.format = '5-a-side'
                       and t.area <> 'all' and p.profile_id in (top, a2, a3, a4, a5)),
    'TOP and A2-A5 are in no city or venue team';

  -- Venues: the busier one (5 games) picks first, so X is there, not at V_LOW.
  v_team := tests.totw_team(v_week, 'general', 'venue', v_high::text, '5-a-side');
  assert (select array_agg(profile_id order by profile_id) from public.team_of_the_week_players
          where team_of_the_week_id = v_team.id) = (select array_agg(p order by p) from unnest(array[x, y]) p),
    format('the busier venue: X and Y, got %s', tests.totw_lineup(v_team.id));
  v_team := tests.totw_team(v_week, 'general', 'venue', v_low::text, '5-a-side');
  assert tests.totw_lineup(v_team.id) = array['fwd:' || z],
    format('the other venue: Z only (X and B1-B5 are already in a team), got %s', tests.totw_lineup(v_team.id));
  assert (select count(*) from public.team_of_the_week_players p
          join public.team_of_the_week t on t.id = p.team_of_the_week_id
          where t.week_start = v_week and t.kind = 'general' and t.format = '5-a-side' and p.profile_id = x) = 1,
    'X is in one general 5-a-side team';

  -- 2. League teams and other formats are separate.
  assert exists (select 1 from public.team_of_the_week_players
                 where team_of_the_week_id = (tests.totw_team(v_week, 'league', 'league', v_league::text, '5-a-side')).id
                   and profile_id = top), 'TOP is also in his league''s team';
  assert exists (select 1 from public.team_of_the_week_players
                 where team_of_the_week_id = (tests.totw_team(v_week, 'general', 'all', '', '7-a-side')).id
                   and profile_id = top), 'and in the All Cyprus 7-a-side team';

  -- 3. Passed over is not skipped: no skip row, no nudge; one pick note.
  assert not exists (select 1 from public.team_of_the_week_skips where profile_id in (top, a2, b1, x)),
    'a player passed over for a higher team is never skipped';
  assert tests.notified(top, 'premium_offers') = 0 and tests.notified(b1, 'premium_offers') = 0
         and tests.notified(x, 'premium_offers') = 0, 'no Premium nudge for being in a higher team';
  assert tests.notified(top, 'team_of_the_week') = 1, 'TOP: one pick notification';
  assert (select body from public.notifications where profile_id = top and type = 'team_of_the_week')
         = 'You''re in the All Cyprus 5-a-side Team of the Week.', 'naming All Cyprus 5-a-side';
  assert (select data ->> 'teamOfTheWeekId' from public.notifications where profile_id = top and type = 'team_of_the_week')
         = v_all5.id::text, 'opening it';

  -- 4. The non-Premium skip rules still work: NP (9.6) is skipped (one row,
  --    one nudge) and the next best Premium player is picked; LOW_NP (5.0,
  --    below the last pick) is not skipped.
  assert (select count(*) from public.team_of_the_week_skips where profile_id = np) = 1, 'NP: one skip row';
  assert tests.notified(np, 'premium_offers') = 1, 'NP: one nudge';
  assert not exists (select 1 from public.team_of_the_week_players where profile_id = np), 'NP is in no team';
  assert not exists (select 1 from public.team_of_the_week_skips where profile_id = low_np), 'LOW_NP is not skipped';
  assert tests.notified(low_np, 'premium_offers') = 0, 'LOW_NP: no nudge';
end $$;

-- 5. Two cities: the one with more matches that week picks first (then the
--    area name). Larnaca sorts first by name, but Paphos has more games.
do $$
declare
  v_week date := '2026-03-09';
  v_paphos uuid := tests.create_venue();
  v_larnaca uuid := tests.create_venue();
  h1 uuid := tests.totw_user('s14o-h1@futty.test');
  h2 uuid := tests.totw_user('s14o-h2@futty.test');
  h3 uuid := tests.totw_user('s14o-h3@futty.test');
  h4 uuid := tests.totw_user('s14o-h4@futty.test');
  h5 uuid := tests.totw_user('s14o-h5@futty.test');
  w uuid := tests.totw_user('s14o-w@futty.test');
  l2 uuid := tests.totw_user('s14o-l2@futty.test');
  m uuid;
  v_team public.team_of_the_week;
begin
  update public.venues set city = 'Paphos' where id = v_paphos;
  update public.venues set city = 'Larnaca' where id = v_larnaca;

  m := tests.totw_match('2026-03-09 18:00+00', '5-a-side', v_paphos);
  perform tests.totw_play(m, h1, 9.5);
  perform tests.totw_play(m, h2, 9.4, 0, 0, 'b');
  m := tests.totw_match('2026-03-10 18:00+00', '5-a-side', v_paphos);
  perform tests.totw_play(m, h3, 9.3);
  perform tests.totw_play(m, h4, 9.2, 0, 0, 'b');
  m := tests.totw_match('2026-03-11 18:00+00', '5-a-side', v_paphos);
  perform tests.totw_play(m, h5, 9.1);
  perform tests.totw_play(m, w, 8.0, 0, 0, 'b');
  m := tests.totw_match('2026-03-12 18:00+00', '5-a-side', v_larnaca);
  perform tests.totw_play(m, w, 8.0);
  perform tests.totw_play(m, l2, 7.0, 0, 0, 'b');

  perform tests.totw_tick('2026-03-16 07:00+00');

  v_team := tests.totw_team(v_week, 'general', 'city', 'paphos', '5-a-side');
  assert tests.totw_lineup(v_team.id) = array['fwd:' || w],
    format('Paphos (3 games) picks W, got %s', tests.totw_lineup(v_team.id));
  v_team := tests.totw_team(v_week, 'general', 'city', 'larnaca', '5-a-side');
  assert tests.totw_lineup(v_team.id) = array['fwd:' || l2],
    format('Larnaca (1 game): W is already in Paphos, so L2, got %s', tests.totw_lineup(v_team.id));
end $$;

rollback;
