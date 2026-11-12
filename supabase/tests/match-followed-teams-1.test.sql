-- A3b (docs/specs/05-product.md section 2, match-record.md decision 1c):
-- followed-team notifications through send_notification, to followers of
-- that team only (user_follows, target_type 'team'):
--   followed_team_match "X play Y tonight", with the 2h reminder;
--   followed_team_result "Result: X 5–3 Y" when a named match is confirmed
--     (agreed, at the deadline or a forfeit), once;
--   followed_team_opponent_wanted "X want an opponent on Thursday" when a
--     team posts "Need opposition".
-- People in the match get the match's own notifications instead; a
-- follower of both teams gets one; the poster isn't told about their post.
begin;

do $$
declare
  v_home uuid := tests.create_team('Home FC');
  v_away uuid := tests.create_team('Away FC');
  v_other uuid := tests.create_team('Other FC');
  v_venue uuid := tests.create_venue();
  fan_home uuid := tests.create_user('ft1-fan-home@futty.test');
  fan_away uuid := tests.create_user('ft1-fan-away@futty.test');
  fan_both uuid := tests.create_user('ft1-fan-both@futty.test');
  fan_other uuid := tests.create_user('ft1-fan-other@futty.test');
  fan_player uuid := tests.create_user('ft1-fan-player@futty.test');
  player_fan uuid := tests.create_user('ft1-player-fan@futty.test');
  nobody uuid := tests.create_user('ft1-nobody@futty.test');
  k timestamptz := (timestamp '2026-11-20 20:00') at time zone 'Asia/Nicosia';
  k_day timestamptz := (timestamp '2026-11-20 14:30') at time zone 'Asia/Nicosia';
  v_match uuid := tests.form_match(k, 'scheduled', null, null, v_home, v_away, p_venue => v_venue);
  v_day_match uuid := tests.form_match(k_day, 'scheduled', null, null, v_home, v_away, p_venue => v_venue);
  v_pickup uuid := tests.form_match(k, 'scheduled', p_venue => v_venue);
  v_n public.notifications;
  v_venue_name text := (select name from public.venues where id = v_venue);
begin
  update public.matches set created_at = k - interval '3 days' where id in (v_match, v_day_match, v_pickup);
  perform tests.follow_team(fan_home, v_home);
  perform tests.follow_team(fan_away, v_away);
  perform tests.follow_team(fan_both, v_home);
  perform tests.follow_team(fan_both, v_away);
  perform tests.follow_team(fan_other, v_other);
  -- Plays in the match and follows Home FC: gets the reminder, not the fan message.
  perform tests.follow_team(fan_player, v_home);
  perform tests.form_player(v_match, fan_player, 'a', true, false);
  perform tests.form_player(v_match, player_fan, 'b', false, false);
  perform tests.follow_team(player_fan, v_away);

  -- "X play Y tonight": with the 2h reminder, not with the 24h one.
  perform tests.reminders_at(k - interval '24 hours');
  assert tests.notified(fan_home, 'followed_team_match') = 0, 'not at 24h';
  perform tests.reminders_at(k - interval '2 hours' - interval '1 second');
  assert tests.notified(fan_home, 'followed_team_match') = 0, 'not a second before 2h';
  perform tests.reminders_at(k - interval '2 hours');
  perform tests.reminders_at(k - interval '2 hours');
  perform tests.reminders_at(k - interval '1 hour 45 minutes');
  assert tests.notified(fan_home, 'followed_team_match', v_match) = 1, 'home fan, once';
  assert tests.notified(fan_away, 'followed_team_match', v_match) = 1, 'away fan';
  assert tests.notified(fan_both, 'followed_team_match', v_match) = 1, 'fan of both teams: one';
  assert tests.notified(fan_other, 'followed_team_match') = 0, 'fan of another team';
  assert tests.notified(nobody, 'followed_team_match') = 0, 'not a follower';
  assert tests.notified(fan_player, 'followed_team_match') = 0 and tests.notified(player_fan, 'followed_team_match') = 0,
    'people in the match';
  assert tests.notified(fan_player, 'match_reminder_2h', v_match) = 1, 'the player gets their own reminder';
  assert (select count(*) from public.notifications where type = 'followed_team_match' and data ->> 'matchId' = v_pickup::text) = 0,
    'pickup games have no followers';
  v_n := tests.last_notification(fan_home, 'followed_team_match');
  assert v_n.title = 'Home FC' and v_n.body = format('Home FC play Away FC tonight at 20:00, %s.', v_venue_name),
    format('match text: %s / %s', v_n.title, v_n.body);
  assert v_n.data ->> 'teamId' = v_home::text, 'match data';
  v_n := tests.last_notification(fan_away, 'followed_team_match');
  assert v_n.title = 'Away FC' and v_n.body = format('Away FC play Home FC tonight at 20:00, %s.', v_venue_name),
    format('away text: %s / %s', v_n.title, v_n.body);

  -- An afternoon game says "today".
  perform tests.reminders_at(k_day - interval '2 hours');
  assert (select body from public.notifications
          where profile_id = fan_home and type = 'followed_team_match' and data ->> 'matchId' = v_day_match::text)
         = format('Home FC play Away FC today at 14:30, %s.', v_venue_name), 'afternoon text';

  -- "Result: X 5–3 Y" when the result is confirmed, once.
  perform tests.act_as_postgres();
  update public.matches set status = 'confirmed', side_a_score = 5, side_b_score = 3,
                            confirmed_at = now(), confirmed_via = 'agreed'
  where id = v_match;
  update public.matches set updated_at = now(), status = 'confirmed' where id = v_match;
  assert tests.notified(fan_home, 'followed_team_result', v_match) = 1, 'home fan result once';
  assert tests.notified(fan_away, 'followed_team_result', v_match) = 1, 'away fan result';
  assert tests.notified(fan_both, 'followed_team_result', v_match) = 1, 'fan of both: one result';
  assert tests.notified(fan_other, 'followed_team_result') = 0 and tests.notified(nobody, 'followed_team_result') = 0,
    'non-followers';
  assert tests.notified(fan_player, 'followed_team_result') = 0, 'people in the match';
  v_n := tests.last_notification(fan_home, 'followed_team_result');
  assert v_n.title = 'Home FC' and v_n.body = 'Result: Home FC 5–3 Away FC', format('result text: %s / %s', v_n.title, v_n.body);
  v_n := tests.last_notification(fan_away, 'followed_team_result');
  assert v_n.title = 'Away FC' and v_n.body = 'Result: Home FC 5–3 Away FC', 'away result text';

  -- Disputed and no_result send nothing.
  update public.matches set status = 'disputed' where id = v_day_match;
  assert tests.notified(fan_home, 'followed_team_result', v_day_match) = 0, 'disputed';

  -- A pickup result has no followers.
  update public.matches set status = 'confirmed', side_a_score = 1, side_b_score = 1,
                            confirmed_at = now(), confirmed_via = 'agreed' where id = v_pickup;
  assert (select count(*) from public.notifications where type = 'followed_team_result'
          and data ->> 'matchId' = v_pickup::text) = 0, 'pickup result';
end $$;

-- A forfeit, recorded by record_match_forfeit (Gipedo Pano): the result
-- shows who pulled out or didn't show.
do $$
declare
  v_home uuid := tests.create_team('Home FC');
  v_away uuid := tests.create_team('Away FC');
  fan uuid := tests.create_user('ft1b-fan@futty.test');
  v_pulled uuid := tests.form_match(now() + interval '1 day', 'scheduled', null, null, v_home, v_away);
  v_no_show uuid := tests.form_match(now() + interval '2 days', 'scheduled', null, null, v_home, v_away);
begin
  perform tests.follow_team(fan, v_home);
  perform tests.act_as_service_role();
  perform public.record_match_forfeit(v_pulled, 'b', 'pulled_out');
  perform public.record_match_forfeit(v_no_show, 'a', 'no_show');
  perform tests.act_as_postgres();
  assert (select body from public.notifications where profile_id = fan and type = 'followed_team_result'
          and data ->> 'matchId' = v_pulled::text) = 'Result: Home FC v Away FC · Forfeit, Away FC pulled out',
    format('pulled out: %s', (tests.last_notification(fan, 'followed_team_result')).body);
  assert (select body from public.notifications where profile_id = fan and type = 'followed_team_result'
          and data ->> 'matchId' = v_no_show::text) = 'Result: Home FC v Away FC · Forfeit, Home FC didn''t show',
    'no show';
end $$;

-- "X want an opponent on Thursday" when a team posts "Need opposition".
do $$
declare
  v_lions uuid := tests.create_team('Lions');
  v_tigers uuid := tests.create_team('Tigers');
  v_venue uuid := tests.create_venue();
  poster uuid := tests.create_user('ft1c-poster@futty.test');
  fan uuid := tests.create_user('ft1c-fan@futty.test');
  fan_other uuid := tests.create_user('ft1c-fan-other@futty.test');
  nobody uuid := tests.create_user('ft1c-nobody@futty.test');
  v_post uuid;
  v_n public.notifications;
begin
  perform tests.follow_team(fan, v_lions);
  perform tests.follow_team(poster, v_lions);
  perform tests.follow_team(fan_other, v_tigers);

  -- Thursday 19 November 2026, 19:00 in Cyprus.
  insert into public.squad_posts (type, team_id, venue_id, posted_by, format, scheduled_at)
  values ('opposition', v_lions, v_venue, poster, '5-a-side', (timestamp '2026-11-19 19:00') at time zone 'Asia/Nicosia')
  returning id into v_post;
  assert tests.notified(fan, 'followed_team_opponent_wanted') = 1, 'follower told';
  assert tests.notified(poster, 'followed_team_opponent_wanted') = 0, 'not the poster';
  assert tests.notified(fan_other, 'followed_team_opponent_wanted') = 0, 'follower of another team';
  assert tests.notified(nobody, 'followed_team_opponent_wanted') = 0, 'not a follower';
  v_n := tests.last_notification(fan, 'followed_team_opponent_wanted');
  assert v_n.title = 'Lions' and v_n.body = 'Lions want an opponent on Thursday.', format('text: %s / %s', v_n.title, v_n.body);
  assert v_n.data ->> 'postId' = v_post::text and v_n.data ->> 'teamId' = v_lions::text, 'post data';

  -- 23:30 on Thursday is still Thursday in Cyprus (21:30Z).
  insert into public.squad_posts (type, team_id, venue_id, posted_by, format, scheduled_at)
  values ('opposition', v_lions, v_venue, poster, '5-a-side', timestamptz '2026-11-19T21:30:00Z');
  assert (tests.last_notification(fan, 'followed_team_opponent_wanted')).body = 'Lions want an opponent on Thursday.',
    'day in Cyprus time';

  -- A "Need players" post isn't an opponent post.
  insert into public.squad_posts (type, team_id, venue_id, posted_by, format, scheduled_at)
  values ('players', v_lions, v_venue, poster, '5-a-side', now() + interval '2 days');
  assert tests.notified(fan, 'followed_team_opponent_wanted') = 2, 'players post sends nothing';
end $$;

rollback;
