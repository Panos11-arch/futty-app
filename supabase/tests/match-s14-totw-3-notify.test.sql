-- S14 notifications (docs/specs/match-record.md decision 1k, items 6 and 7):
--   * every player picked gets team_of_the_week, as before;
--   * a skipped player (would have been picked, isn't Premium) gets ONE
--     in-app notification per week and scope (team kind + area, whatever
--     the format): "You'd have made Team of the Week (<rating>). Get Futty
--     Premium to be eligible.", type premium_offers, which opens Premium;
--   * it is a push only if they switched on "Premium and offers", which is
--     off by default (Apple guideline 4.5.4). Other types stay on by default.
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

do $$
declare
  v1 uuid := tests.create_venue();
  np uuid := tests.totw_user('s14n-np@futty.test', false);
  p1 uuid := tests.totw_user('s14n-p1@futty.test');
  p2 uuid := tests.totw_user('s14n-p2@futty.test');
  p3 uuid := tests.totw_user('s14n-p3@futty.test');
  p4 uuid := tests.totw_user('s14n-p4@futty.test');
  p5 uuid := tests.totw_user('s14n-p5@futty.test');
  s7 uuid := tests.totw_user('s14n-s7@futty.test');
  low uuid := tests.totw_user('s14n-low@futty.test', false);
  m uuid;
  v_note public.notifications;
begin
  update public.venues set city = 'Paphos' where id = v1;
  insert into public.push_tokens (profile_id, token, platform) values
    (np, 'ExponentPushToken[s14np]', 'ios'), (p1, 'ExponentPushToken[s14p1]', 'ios');

  -- Week of 2 March 2026 at V1 (busy: five games). NP (9.5 in 5-a-side,
  -- 9.0 in 7-a-side) would top both; LOW (non-Premium, 5.0) would not be picked anyway.
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

  -- Six teams: All Cyprus, Paphos and V1, each in 5- and 7-a-side.
  assert tests.totw_tick('2026-03-09 07:00+00') = 6, 'six teams';

  -- 1. Picks are told, once per team they're in.
  assert tests.notified(p1, 'team_of_the_week') = 3, 'P1: All Cyprus, Paphos and V1 5-a-side';
  assert tests.notified(s7, 'team_of_the_week') = 3, 'S7: the three 7-a-side teams';
  assert (tests.last_notification(p1, 'team_of_the_week')).body = 'You''re in Futty''s team of the week.', 'the words';
  assert tests.notified(np, 'team_of_the_week') = 0, 'NP is not picked';

  -- 2. NP is skipped in six teams but told once per scope: three.
  assert tests.notified(np, 'premium_offers') = 3,
    format('one each for All Cyprus, Paphos and V1 (5- and 7-a-side together), got %s', tests.notified(np, 'premium_offers'));
  select * into v_note from public.notifications n where n.profile_id = np and n.type = 'premium_offers'
  order by n.data ->> 'teamOfTheWeekId' limit 1;
  assert v_note.body = 'You''d have made Team of the Week (9.5). Get Futty Premium to be eligible.',
    format('the words, with the 5-a-side rating, got %s', v_note.body);
  assert v_note.data ->> 'kind' = 'team_of_the_week_skipped' and v_note.data ->> 'weekStart' = '2026-03-02', 'the data';
  assert (select count(*) from public.team_of_the_week_skips where profile_id = np) = 3, 'three skips recorded';
  assert tests.notified(low, 'premium_offers') = 0, 'LOW would not have been picked: not skipped';

  -- 3. No push without the setting (off by default); the in-app row is there.
  assert tests.pushes14(np, 'premium_offers') = 0, 'no push: Premium and offers is off';
  assert tests.pushes14(p1, 'team_of_the_week') = 3, 'other types still push with no setting row';

  -- 4. At most one per week and scope, even if the pick runs again.
  delete from public.team_of_the_week where week_start = '2026-03-02';
  delete from public.team_of_the_week_runs where week_start = '2026-03-02';
  assert tests.totw_tick('2026-03-09 07:00+00') = 6, 'picked again';
  assert tests.notified(np, 'premium_offers') = 3, 'still three';

  -- 5. Switched on, the next week's nudge is a push too.
  perform tests.act_as(np);
  insert into public.notification_settings (profile_id, type, enabled) values (np, 'premium_offers', true);
  perform tests.act_as_postgres();
  m := tests.totw_match('2026-03-10 18:00+00', '5-a-side', null);
  perform tests.totw_play(m, np, 8.0);
  assert tests.totw_tick('2026-03-16 07:00+00') = 1, 'the week of 9 March: All Cyprus only';
  assert tests.notified(np, 'premium_offers') = 4, 'a new week: one more';
  assert tests.pushes14(np, 'premium_offers') = 1, 'pushed';
  assert exists (select 1 from public.notifications n
                 where n.profile_id = np and n.type = 'premium_offers' and n.data ->> 'weekStart' = '2026-03-09'
                   and n.body = 'You''d have made Team of the Week (8.0). Get Futty Premium to be eligible.'),
    'a whole rating keeps its decimal';
end $$;

rollback;
