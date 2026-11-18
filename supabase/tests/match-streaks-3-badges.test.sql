-- A11 streak badges (match-record decision 1i): Bronze 2 weeks, Silver 4,
-- Gold 8, Platinum 12, Diamond 20, Champion 30. Each is awarded once, to
-- every player who reaches it, Premium or not, by match_jobs_tick's weekly
-- step from Monday 09:00 Cyprus time, which tells the player
-- (streak_badge, which they can turn off).
begin;

create function tests.s_play(p_profile uuid, p_kickoff timestamptz)
returns void language plpgsql as $$
declare
  v_match uuid := tests.form_match(p_kickoff, 'confirmed', 1, 0);
begin
  perform tests.form_player(v_match, p_profile, 'a', true, true);
end;
$$;

-- Plays one match a week for p_weeks weeks from the week of p_from (a
-- Monday), on the Tuesday at 18:00 UTC.
create function tests.s_weeks(p_profile uuid, p_from date, p_weeks integer)
returns void language plpgsql as $$
begin
  for i in 0 .. p_weeks - 1 loop
    perform tests.s_play(p_profile, ((p_from + 7 * i + 1) + time '18:00') at time zone 'UTC');
  end loop;
end;
$$;

create function tests.s_tick(p_now timestamptz)
returns integer language plpgsql as $$
declare
  v integer;
begin
  perform tests.act_as_service_role();
  v := public.streak_badges_tick(p_now);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.s_badges(p_profile uuid)
returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(b.badge order by l.sort), '{}')
  from public.streak_badges b join public.streak_badge_levels l on l.badge = b.badge
  where b.profile_id = p_profile;
$$;

-- The levels.
do $$
begin
  assert (select array_agg(format('%s %s %s', badge, label, weeks) order by sort) from public.streak_badge_levels) = array[
    'bronze Bronze 2', 'silver Silver 4', 'gold Gold 8', 'platinum Platinum 12', 'diamond Diamond 20',
    'champion Champion 30'], 'the six levels';
  assert (select not always_sent from public.notification_types where type = 'streak_badge'), 'streak_badge can be turned off';
end $$;

-- Each threshold, once; Premium and basic players; the weekly gate.
-- January to August 2026. Weeks from Monday 5 January 2026.
do $$
declare
  v_long uuid := tests.create_user('s3-long@futty.test');
  v_premium uuid := tests.create_user('s3-premium@futty.test');
  v_basic uuid := tests.create_user('s3-basic@futty.test');
  v_one uuid := tests.create_user('s3-one@futty.test');
  v_off uuid := tests.create_user('s3-off@futty.test');
  v_n public.notifications;
begin
  perform tests.make_premium(v_long);
  perform tests.make_premium(v_premium);
  perform tests.s_weeks(v_long, '2026-01-05', 30);
  perform tests.s_weeks(v_premium, '2026-01-05', 2);
  perform tests.s_weeks(v_basic, '2026-01-05', 2);
  perform tests.s_weeks(v_one, '2026-01-05', 1);
  perform tests.s_weeks(v_off, '2026-01-05', 2);

  insert into public.push_tokens (profile_id, token, platform) values
    (v_premium, 'ExponentPushToken[s3p]', 'ios'), (v_off, 'ExponentPushToken[s3o]', 'ios');

  -- A switchable type: the player turns it off as the app does.
  perform tests.act_as(v_off);
  insert into public.notification_settings (profile_id, type, enabled) values (v_off, 'streak_badge', false);
  perform tests.act_as_postgres();

  -- Monday 19 January, after two weeks. Nothing before 09:00 Cyprus
  -- (07:00 UTC in winter).
  assert tests.s_tick('2026-01-19 06:59+00') = 0, 'not before Monday 09:00 Cyprus';
  assert tests.s_badges(v_premium) = '{}', 'nothing awarded at 08:59';
  assert tests.s_tick('2026-01-19 07:00+00') >= 4, 'from 09:00';
  assert tests.s_badges(v_long) = '{bronze}', 'two weeks: Bronze';
  assert tests.s_badges(v_premium) = '{bronze}', 'Premium: Bronze';
  assert tests.s_badges(v_basic) = '{bronze}', 'basic players earn badges too';
  assert tests.s_badges(v_one) = '{}', 'one week: nothing yet';
  assert tests.s_badges(v_off) = '{bronze}', 'turning the message off doesn''t stop the badge';

  v_n := tests.last_notification(v_premium, 'streak_badge');
  assert v_n.title = 'Streak badge' and v_n.body = 'You''ve earned the Bronze streak badge',
    format('Premium wording, got %s / %s', v_n.title, v_n.body);
  assert v_n.data @> '{"badge": "bronze", "weeks": 2}', format('data, got %s', v_n.data);
  v_n := tests.last_notification(v_basic, 'streak_badge');
  assert v_n.body = 'You''ve earned the Bronze streak badge. Go Premium to unlock it.',
    format('basic wording, got %s', v_n.body);
  assert tests.notified(v_off, 'streak_badge') = 1, 'the in-app row is still written';
  assert not exists (select 1 from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
                     where n.profile_id = v_off and n.type = 'streak_badge'), 'but nothing is pushed';
  assert exists (select 1 from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
                 where n.profile_id = v_premium and n.type = 'streak_badge'), 'a player who left it on gets a push';

  -- The same week again, later that Monday or that week: nothing.
  assert tests.s_tick('2026-01-19 12:00+00') = 0, 'once a week';
  assert tests.s_tick('2026-01-23 12:00+00') = 0, 'later in the week';

  -- 3 August 2026 (Cyprus UTC+3), after 30 weeks: Silver to Champion at
  -- once, Bronze not again.
  perform tests.s_tick('2026-08-03 06:00+00');
  assert tests.s_badges(v_long) = '{bronze,silver,gold,platinum,diamond,champion}', 'every level up to 30';
  assert tests.notified(v_long, 'streak_badge') = 6, 'one message per badge';
  assert (select count(*) from public.notifications where profile_id = v_long and type = 'streak_badge'
          and body = 'You''ve earned the Champion streak badge') = 1, 'Champion';
  assert tests.notified(v_premium, 'streak_badge') = 1, 'Bronze isn''t awarded twice';

  -- The streak has ended since, but badges stay earned, and a later week
  -- awards nothing again.
  perform tests.s_tick('2026-08-10 06:00+00');
  assert tests.s_badges(v_long) = '{bronze,silver,gold,platinum,diamond,champion}', 'still earned';
  assert tests.notified(v_long, 'streak_badge') = 6, 'and not awarded again';
  assert (select count(*) from public.streak_badges where profile_id = v_long) = 6, 'one row per badge';
end $$;

-- Badges go by the best streak through last Sunday, so a match confirmed
-- after an earlier Monday still earns its badge the next Monday.
do $$
declare
  v_late uuid := tests.create_user('s3-late@futty.test');
  v_match uuid;
begin
  perform tests.s_play(v_late, '2026-09-01 17:00+00');
  v_match := tests.form_match('2026-09-13 17:00+00', 'played');
  perform tests.form_player(v_match, v_late, 'a', true, true);
  perform tests.s_tick('2026-09-14 07:00+00');
  assert tests.s_badges(v_late) = '{}', 'the second week''s result isn''t in yet';
  update public.matches set status = 'confirmed', side_a_score = 2, side_b_score = 1, confirmed_at = now(),
         confirmed_via = 'agreed' where id = v_match;
  perform tests.s_tick('2026-09-21 07:00+00');
  assert tests.s_badges(v_late) = '{bronze}', 'awarded on a later Monday from the best streak';
end $$;

-- match_jobs_tick runs the step.
do $$
begin
  perform tests.act_as_service_role();
  assert public.match_jobs_tick() ? 'streak_badges', 'match_jobs_tick counts streak badges';
  perform tests.act_as_postgres();
end $$;

rollback;
