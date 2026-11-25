-- S14 notifications (docs/specs/match-record.md decision 1k, items 6 and 7,
-- as Panos approved on 25 November): at most ONE pick notification and ONE
-- Premium nudge per player per week, however many teams he is in or would
-- have been in. Each names his best team: by scope All Cyprus → league →
-- city → venue, then the format he played most that week, then (an S14
-- assumption) his higher rating in it, then the smaller format.
--   * pick (team_of_the_week): "You're in the <area> <format> Team of the
--     Week.", opening that team (teamOfTheWeekId);
--   * nudge (premium_offers): "You'd have made the <area> <format> Team of
--     the Week (<rating>). Get Futty Premium to be eligible.", with that
--     team's rating; a push only if "Premium and offers" is on (off by
--     default, Apple guideline 4.5.4). Other types stay on by default.
begin;

-- Pushes queued for p_profile's notifications of p_type.
create function tests.pushes14(p_profile uuid, p_type text)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id
  where n.profile_id = p_profile and n.type = p_type and d.channel = 'push';
$$;

-- p_profile's only notification of p_type for the week p_week.
create function tests.note14(p_profile uuid, p_type text, p_week date)
returns public.notifications
language sql
security definer
set search_path = ''
as $$
  select * from public.notifications n
  where n.profile_id = p_profile and n.type = p_type and n.data ->> 'weekStart' = p_week::text;
$$;

do $$
declare
  v_week date := '2026-03-02';
  v1 uuid := tests.create_venue();
  v2 uuid := tests.create_venue();
  v_league uuid;
  np uuid := tests.totw_user('s14n-np@futty.test', false);
  p1 uuid := tests.totw_user('s14n-p1@futty.test');
  p2 uuid := tests.totw_user('s14n-p2@futty.test');
  p3 uuid := tests.totw_user('s14n-p3@futty.test');
  p4 uuid := tests.totw_user('s14n-p4@futty.test');
  p5 uuid := tests.totw_user('s14n-p5@futty.test');
  s7 uuid := tests.totw_user('s14n-s7@futty.test');
  low uuid := tests.totw_user('s14n-low@futty.test', false);
  lc uuid := tests.totw_user('s14n-lc@futty.test');
  t1 uuid := tests.totw_user('s14n-t1@futty.test');
  t2 uuid := tests.totw_user('s14n-t2@futty.test');
  t3 uuid := tests.totw_user('s14n-t3@futty.test');
  m uuid;
  v_note public.notifications;
  v_all5 uuid;
begin
  update public.venues set city = 'Paphos' where id = v1;
  update public.venues set city = 'Larnaca' where id = v2;
  insert into public.leagues (format, scope, capacity, name) values ('5-a-side', 'city', 8, 'S14N League')
  returning id into v_league;
  insert into public.push_tokens (profile_id, token, platform) values
    (np, 'ExponentPushToken[s14np]', 'ios'), (p1, 'ExponentPushToken[s14p1]', 'ios');

  -- V1 (Paphos, busy: five games). NP (non-Premium) would top 5-a-side
  -- (9.5) and 7-a-side (9.0); LOW (non-Premium, 5.0) would not be picked anyway.
  m := tests.totw_match('2026-03-02 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, np, 9.5);
  perform tests.totw_play(m, p1, 9.0, 0, 0, 'b');
  m := tests.totw_match('2026-03-03 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, p2, 8.5);
  perform tests.totw_play(m, p3, 8.0, 0, 0, 'b');
  m := tests.totw_match('2026-03-04 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, p4, 7.5);
  perform tests.totw_play(m, low, 5.0, 0, 0, 'b');
  m := tests.totw_match('2026-03-05 18:00+00', '5-a-side', v1);
  perform tests.totw_play(m, p5, 7.0);
  m := tests.totw_match('2026-03-06 18:00+00', '7-a-side', v1);
  perform tests.totw_play(m, np, 9.0);
  perform tests.totw_play(m, s7, 8.0, 0, 0, 'b');

  -- V2 (Larnaca, not busy): LC (6.0) in a general game and a league game.
  -- All Cyprus 5-a-side is full before him, so he is in the Larnaca and the
  -- league teams only.
  m := tests.totw_match('2026-03-03 19:00+00', '5-a-side', v2);
  perform tests.totw_play(m, lc, 6.0);
  m := tests.totw_match('2026-03-04 19:00+00', '5-a-side', v2, true, v_league);
  perform tests.totw_play(m, lc, 6.0);

  -- Format tie-breaks, in All Cyprus only (no venue):
  --   T1: 2 games of 9-a-side (7.0) and 1 of 11-a-side (9.0): 9-a-side, more games;
  --   T2: 1 game of each (7.0 and 8.0): 11-a-side, the higher rating;
  --   T3: 1 game of 6-a-side and 1 of 11-a-side, both 7.0: 6-a-side, the smaller format.
  m := tests.totw_match('2026-03-02 20:00+00', '9-a-side');
  perform tests.totw_play(m, t1, 7.0);
  perform tests.totw_play(m, t2, 7.0, 0, 0, 'b');
  m := tests.totw_match('2026-03-03 20:00+00', '9-a-side');
  perform tests.totw_play(m, t1, 7.0);
  m := tests.totw_match('2026-03-04 20:00+00', '11-a-side');
  perform tests.totw_play(m, t1, 9.0);
  perform tests.totw_play(m, t2, 8.0, 0, 0, 'b');
  perform tests.totw_play(m, t3, 7.0);
  m := tests.totw_match('2026-03-05 20:00+00', '6-a-side');
  perform tests.totw_play(m, t3, 7.0);

  -- All Cyprus 5, 6, 7, 9 and 11; Paphos 5 and 7; V1 5 and 7; Larnaca 5; the league 5.
  assert tests.totw_tick('2026-03-09 07:00+00') = 11,
    format('eleven teams, got %s', (select count(*) from public.team_of_the_week where week_start = v_week));
  v_all5 := (tests.totw_team(v_week, 'general', 'all', '', '5-a-side')).id;

  -- 1. P1 is in the All Cyprus, Paphos and V1 5-a-side teams: one pick,
  --    naming All Cyprus and opening that team.
  assert tests.notified(p1, 'team_of_the_week') = 1, format('P1: one, got %s', tests.notified(p1, 'team_of_the_week'));
  v_note := tests.note14(p1, 'team_of_the_week', v_week);
  assert v_note.title = 'Team of the Week'
         and v_note.body = 'You''re in the All Cyprus 5-a-side Team of the Week.', format('P1''s words, got %s', v_note.body);
  assert v_note.data ->> 'teamOfTheWeekId' = v_all5::text, 'opens the All Cyprus 5-a-side team';
  assert tests.notified(s7, 'team_of_the_week') = 1
         and (tests.note14(s7, 'team_of_the_week', v_week)).body = 'You''re in the All Cyprus 7-a-side Team of the Week.',
    'S7: one, All Cyprus 7-a-side';
  assert tests.notified(np, 'team_of_the_week') = 0, 'NP is not picked';
  assert tests.pushes14(p1, 'team_of_the_week') = 1, 'P1''s one pick is pushed (on by default)';

  -- 2. A league team beats a city team.
  assert tests.notified(lc, 'team_of_the_week') = 1, 'LC: one';
  v_note := tests.note14(lc, 'team_of_the_week', v_week);
  assert v_note.body = 'You''re in the S14N League 5-a-side Team of the Week.', format('LC: the league, got %s', v_note.body);
  assert v_note.data ->> 'teamOfTheWeekId' = (tests.totw_team(v_week, 'league', 'league', v_league::text, '5-a-side')).id::text,
    'opens the league team';

  -- 3. The format: most games, then the higher rating, then the smaller format.
  assert (tests.note14(t1, 'team_of_the_week', v_week)).body = 'You''re in the All Cyprus 9-a-side Team of the Week.',
    'T1: 9-a-side (two games)';
  assert (tests.note14(t2, 'team_of_the_week', v_week)).body = 'You''re in the All Cyprus 11-a-side Team of the Week.',
    'T2: 11-a-side (8.0 over 7.0)';
  assert (tests.note14(t3, 'team_of_the_week', v_week)).body = 'You''re in the All Cyprus 6-a-side Team of the Week.',
    'T3: 6-a-side (the smaller format)';

  -- 4. NP is skipped in six teams: one nudge, the best team (All Cyprus;
  --    one game each, 9.5 in 5-a-side over 9.0 in 7-a-side), its rating.
  assert tests.notified(np, 'premium_offers') = 1, format('one nudge, got %s', tests.notified(np, 'premium_offers'));
  v_note := tests.note14(np, 'premium_offers', v_week);
  assert v_note.title = 'Team of the Week'
         and v_note.body = 'You''d have made the All Cyprus 5-a-side Team of the Week (9.5). Get Futty Premium to be eligible.',
    format('the words, got %s', v_note.body);
  assert v_note.data ->> 'kind' = 'team_of_the_week_skipped' and v_note.data ->> 'teamOfTheWeekId' = v_all5::text,
    'the data';
  assert (select count(*) from public.team_of_the_week_skips where profile_id = np) = 1, 'one skip row';
  assert tests.notified(low, 'premium_offers') = 0, 'LOW would not have been picked: not skipped';
  assert tests.pushes14(np, 'premium_offers') = 0, 'no push: Premium and offers is off';

  -- 5. Running the pick again sends nothing new.
  delete from public.team_of_the_week where week_start = v_week;
  delete from public.team_of_the_week_runs where week_start = v_week;
  assert tests.totw_tick('2026-03-09 07:00+00') = 11, 'picked again';
  assert tests.notified(p1, 'team_of_the_week') = 1 and tests.notified(lc, 'team_of_the_week') = 1, 'no second pick';
  assert tests.notified(np, 'premium_offers') = 1, 'no second nudge';

  -- 6. Switched on, the next week's nudge is a push too.
  perform tests.act_as(np);
  insert into public.notification_settings (profile_id, type, enabled) values (np, 'premium_offers', true);
  perform tests.act_as_postgres();
  m := tests.totw_match('2026-03-10 18:00+00', '5-a-side', null);
  perform tests.totw_play(m, np, 8.0);
  assert tests.totw_tick('2026-03-16 07:00+00') = 1, 'the week of 9 March: All Cyprus only';
  assert tests.notified(np, 'premium_offers') = 2, 'a new week: one more';
  assert tests.pushes14(np, 'premium_offers') = 1, 'pushed';
  assert (tests.note14(np, 'premium_offers', '2026-03-09')).body
         = 'You''d have made the All Cyprus 5-a-side Team of the Week (8.0). Get Futty Premium to be eligible.',
    'a whole rating keeps its decimal';
end $$;

rollback;
