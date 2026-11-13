-- A2 (docs/specs/match-record.md section 6.3, decisions 4, 6, 1a.6, 1a.7):
-- send_notification, contract 4. One in-app row always; one push per push
-- token unless the player turned the type off (never for an always-sent
-- type); held in quiet hours and sent when they end, except a match
-- reminder whose game has started by then, which is dropped. Unknown types
-- (including spot_released) are refused. push_deliveries_due hands each
-- push out once, so one send_notification call is exactly one push.
begin;

create function tests.mr_send(p_profile uuid, p_type text, p_data jsonb default '{}')
returns text
language plpgsql
as $$
declare
  v_error text;
begin
  perform tests.act_as_service_role();
  v_error := tests.error_of(format('select public.send_notification(%L, %L, %L)', p_profile, p_type, p_data));
  perform tests.act_as_postgres();
  return v_error;
end;
$$;

create function tests.mr_claim()
returns text[]
language plpgsql
as $$
declare
  v_tokens text[];
begin
  perform tests.act_as_service_role();
  select coalesce(array_agg(d.token order by d.token), '{}') into v_tokens from public.push_deliveries_due(100) d;
  perform tests.act_as_postgres();
  return v_tokens;
end;
$$;

create function tests.mr_add_token(p_profile uuid, p_token text)
returns void
language sql
as $$
  insert into public.push_tokens (profile_id, token, platform) values (p_profile, p_token, 'ios');
$$;

create function tests.mr_quiet(p_profile uuid, p_starts time, p_ends time)
returns void
language sql
as $$
  insert into public.notification_quiet_hours (profile_id, starts_local, ends_local) values (p_profile, p_starts, p_ends)
  on conflict (profile_id) do update set starts_local = excluded.starts_local, ends_local = excluded.ends_local;
$$;

create function tests.mr_deliveries(p_profile uuid, p_type text)
returns table (status text, send_after timestamptz)
language sql
as $$
  select d.status, d.send_after from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id
  where n.profile_id = p_profile and n.type = p_type order by d.created_at, d.id;
$$;

-- 1. One row and one push per token; title and body in their own columns.
do $$
declare
  v_player uuid := tests.create_user('mr5-player@futty.test');
  v_no_tokens uuid := tests.create_user('mr5-no-tokens@futty.test');
  v_row public.notifications;
begin
  perform tests.mr_add_token(v_player, 'ExponentPushToken[phone]');
  perform tests.mr_add_token(v_player, 'ExponentPushToken[tablet]');
  assert tests.mr_send(v_player, 'match_result_submitted',
    jsonb_build_object('title', 'Check the score', 'body', 'Bibs 5–3 Non-bibs', 'matchId', 'm1')) is null, 'sent';
  assert (select count(*) from public.notifications where profile_id = v_player) = 1, 'one in-app row';
  select * into v_row from public.notifications where profile_id = v_player;
  assert v_row.title = 'Check the score' and v_row.body = 'Bibs 5–3 Non-bibs', 'title and body';
  assert v_row.data = '{"matchId": "m1"}'::jsonb, format('title and body leave data, got %s', v_row.data);
  assert (select count(*) from tests.mr_deliveries(v_player, 'match_result_submitted') where status = 'queued') = 2,
    'one push per token';
  assert (select count(*) from public.notification_deliveries d join public.push_tokens t on t.id = d.push_token_id
          where t.profile_id = v_player and d.channel = 'push') = 2, 'each delivery names its token';

  assert tests.mr_send(v_no_tokens, 'booking_cancelled', '{"title": "Booking cancelled"}') is null, 'no tokens: fine';
  assert (select count(*) from public.notifications where profile_id = v_no_tokens) = 1, 'the in-app row is still written';
end $$;

-- 2. Exactly one push for one call: claimed once, never twice.
do $$
declare
  v_player uuid := tests.create_user('mr5-once@futty.test');
  v_first text[];
  v_second text[];
begin
  perform tests.mr_add_token(v_player, 'ExponentPushToken[once]');
  -- Earlier tests' deliveries are claimed (and forgotten) first.
  perform tests.mr_claim();
  perform tests.mr_send(v_player, 'match_result_confirmed', '{"title": "Result confirmed"}');
  v_first := tests.mr_claim();
  v_second := tests.mr_claim();
  assert v_first = array['ExponentPushToken[once]'], format('one push, got %s', v_first);
  assert v_second = '{}', format('never handed out twice, got %s', v_second);
  assert (select status from tests.mr_deliveries(v_player, 'match_result_confirmed')) = 'sending', 'claimed';
end $$;

-- 3. Turned off: row written, no push. Always-sent types ignore it.
do $$
declare
  v_player uuid := tests.create_user('mr5-opt-out@futty.test');
begin
  perform tests.mr_add_token(v_player, 'ExponentPushToken[opt-out]');
  insert into public.notification_settings (profile_id, type, enabled) values (v_player, 'match_result_submitted', false);
  perform tests.mr_send(v_player, 'match_result_submitted', '{"title": "Check the score"}');
  assert (select count(*) from public.notifications where profile_id = v_player and type = 'match_result_submitted') = 1,
    'the row is still written';
  assert (select count(*) from tests.mr_deliveries(v_player, 'match_result_submitted')) = 0, 'no push';

  -- A settings row for an always-sent type can't exist; even if one did, it's ignored.
  alter table public.notification_settings disable trigger user;
  insert into public.notification_settings (profile_id, type, enabled) values (v_player, 'debt_created', false);
  alter table public.notification_settings enable trigger user;
  perform tests.mr_send(v_player, 'debt_created', '{"title": "You owe €6.00"}');
  assert (select count(*) from tests.mr_deliveries(v_player, 'debt_created')) = 1, 'an always-sent type is never skipped';

  -- Turned back on.
  update public.notification_settings set enabled = true where profile_id = v_player and type = 'match_result_submitted';
  perform tests.mr_send(v_player, 'match_result_submitted', '{"title": "Check the score"}');
  assert (select count(*) from tests.mr_deliveries(v_player, 'match_result_submitted')) = 1, 'enabled again: pushed';
end $$;

-- 4. Quiet hours (Cyprus time): held, and due when they end.
do $$
declare
  v_local timestamp := now() at time zone 'Asia/Nicosia';
  v_quiet uuid := tests.create_user('mr5-quiet@futty.test');
  v_wrap uuid := tests.create_user('mr5-wrap@futty.test');
  v_awake uuid := tests.create_user('mr5-awake@futty.test');
  v_row record;
begin
  perform tests.mr_add_token(v_quiet, 'ExponentPushToken[quiet]');
  perform tests.mr_add_token(v_wrap, 'ExponentPushToken[wrap]');
  perform tests.mr_add_token(v_awake, 'ExponentPushToken[awake]');
  perform tests.mr_claim();

  -- Quiet from an hour ago until an hour from now.
  perform tests.mr_quiet(v_quiet, (v_local - interval '1 hour')::time, (v_local + interval '1 hour')::time);
  -- Quiet for 23 hours, wrapping past midnight: from an hour ago until two hours ago.
  perform tests.mr_quiet(v_wrap, (v_local - interval '1 hour')::time, (v_local - interval '2 hours')::time);
  -- Quiet later today only.
  perform tests.mr_quiet(v_awake, (v_local + interval '1 hour')::time, (v_local + interval '2 hours')::time);

  perform tests.mr_send(v_quiet, 'booking_cancelled', '{"title": "Booking cancelled"}');
  perform tests.mr_send(v_wrap, 'squad_post', '{"title": "New post"}');
  perform tests.mr_send(v_awake, 'squad_post', '{"title": "New post"}');

  select * into v_row from tests.mr_deliveries(v_quiet, 'booking_cancelled');
  assert v_row.status = 'held_quiet_hours', 'held in quiet hours, even for an always-sent type';
  assert v_row.send_after = now() + interval '1 hour', format('due when quiet hours end, got %s', v_row.send_after);
  assert (select count(*) from public.notifications where profile_id = v_quiet) = 1, 'the in-app row is written now';
  select * into v_row from tests.mr_deliveries(v_wrap, 'squad_post');
  assert v_row.status = 'held_quiet_hours', 'quiet hours that wrap past midnight hold too';
  assert v_row.send_after = now() + interval '22 hours', format('due at the end, tomorrow, got %s', v_row.send_after);
  assert (select status from tests.mr_deliveries(v_awake, 'squad_post')) = 'queued', 'outside quiet hours: sent now';

  assert tests.mr_claim() = array['ExponentPushToken[awake]'], 'only the queued push is due now';

  -- Exactly when the quiet hours end, the held push is due.
  update public.notification_deliveries d set send_after = now()
  from public.notifications n where n.id = d.notification_id and n.profile_id = v_quiet;
  assert tests.mr_claim() = array['ExponentPushToken[quiet]'], 'sent when quiet hours end';
  assert (select status from tests.mr_deliveries(v_quiet, 'booking_cancelled')) = 'sending', 'claimed';
end $$;

-- 5. A held match reminder is dropped if the game has started by then.
do $$
declare
  v_local timestamp := now() at time zone 'Asia/Nicosia';
  v_player uuid := tests.create_user('mr5-reminder@futty.test');
  v_started uuid := gen_random_uuid();
  v_later uuid := gen_random_uuid();
  v_venue uuid := tests.create_venue();
begin
  insert into public.matches (id, venue_id, kind, format, players_per_side, kickoff_at, ends_at, result_deadline_at)
  values (v_started, v_venue, 'pickup', '5-a-side', 5, now() - interval '1 minute', now() + interval '1 hour', now() + interval '25 hours'),
         (v_later, v_venue, 'pickup', '5-a-side', 5, now() + interval '1 hour', now() + interval '2 hours', now() + interval '26 hours');
  perform tests.mr_add_token(v_player, 'ExponentPushToken[reminder]');
  perform tests.mr_claim();
  perform tests.mr_quiet(v_player, (v_local - interval '1 hour')::time, (v_local + interval '1 hour')::time);

  perform tests.mr_send(v_player, 'match_reminder_2h', jsonb_build_object('title', 'Kickoff in 2 hours', 'matchId', v_started));
  perform tests.mr_send(v_player, 'match_reminder_24h', jsonb_build_object('title', 'Game tomorrow', 'matchId', v_started));
  perform tests.mr_send(v_player, 'match_reminder_2h', jsonb_build_object('title', 'Kickoff in 2 hours', 'matchId', v_later));
  perform tests.mr_send(v_player, 'squad_post', '{"title": "New post"}');
  assert (select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
          where n.profile_id = v_player and d.status = 'held_quiet_hours') = 4, 'all held';

  -- The quiet hours have ended.
  update public.notification_deliveries d set send_after = now() - interval '1 minute'
  from public.notifications n where n.id = d.notification_id and n.profile_id = v_player;
  assert array_length(tests.mr_claim(), 1) = 2, 'the later game''s reminder and the post are sent';
  assert (select array_agg(d.status order by d.status) from public.notification_deliveries d
          join public.notifications n on n.id = d.notification_id
          where n.profile_id = v_player and n.data ->> 'matchId' = v_started::text) = array['dropped', 'dropped'],
    'both reminders for a game that has started are dropped';
  assert (select d.status from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
          where n.profile_id = v_player and n.data ->> 'matchId' = v_later::text) = 'sending',
    'a reminder for a game that hasn''t started is sent';
  assert (select count(*) from public.notifications where profile_id = v_player) = 4, 'every in-app row stays';
end $$;

-- 6. Results of a push.
do $$
declare
  v_player uuid := tests.create_user('mr5-result@futty.test');
  v_ok uuid;
  v_bad uuid;
  v_error text;
begin
  perform tests.mr_add_token(v_player, 'ExponentPushToken[a]');
  perform tests.mr_add_token(v_player, 'ExponentPushToken[b]');
  perform tests.mr_claim();
  perform tests.mr_send(v_player, 'squad_post', '{"title": "New post"}');
  perform tests.act_as_service_role();
  select delivery_id into v_ok from public.push_deliveries_due(1);
  select delivery_id into v_bad from public.push_deliveries_due(1);
  perform public.push_delivery_result(v_ok, 'sent', null);
  perform public.push_delivery_result(v_bad, 'failed', 'DeviceNotRegistered');
  v_error := tests.error_of(format('select public.push_delivery_result(%L, %L, null)', v_ok, 'queued'));
  perform tests.act_as_postgres();
  assert v_ok <> v_bad, 'one each';
  assert (select status from public.notification_deliveries where id = v_ok) = 'sent', 'sent';
  assert (select sent_at from public.notification_deliveries where id = v_ok) = now(), 'sent_at';
  assert (select status || ':' || error from public.notification_deliveries where id = v_bad) = 'failed:DeviceNotRegistered',
    'failure and its error recorded';
  assert v_error = 'invalid_status', format('only sent or failed, got %s', v_error);
end $$;

-- 7. Types: unknown and spot_released refused; every type in contract 4 works.
do $$
declare
  v_player uuid := tests.create_user('mr5-types@futty.test');
  v_type text;
begin
  assert tests.mr_send(v_player, 'spot_released', '{}') = 'unknown_notification_type', 'spot_released isn''t allowed';
  assert tests.mr_send(v_player, 'nope', '{}') = 'unknown_notification_type', 'unknown type refused';
  assert not exists (select 1 from public.notifications where profile_id = v_player), 'nothing written';

  foreach v_type in array array[
    'fixture_message', 'squad_post', 'booking_slot', 'booking_cancelled', 'fixture_agreed', 'match_payment_due',
    'team_invite', 'booking_invite', 'venue_closed_new_bookings', 'guarantee_hold_failed', 'booking_spot_released',
    'cancellation_fee_failed', 'short_game_warning', 'top_up_charged', 'debt_created', 'debt_settled',
    'cash_unpaid_prompt', 'booking_cancelled_by_venue', 'venue_condition_warning', 'gipedo_result_needed',
    'match_result_submitted', 'match_result_confirmed', 'match_result_disputed', 'match_reminder_24h',
    'match_reminder_2h', 'match_after_game', 'motm_vote_open', 'followed_team_match', 'followed_team_result',
    'followed_team_opponent_wanted', 'guarantee_charged', 'gipedo_opponent_left', 'gipedo_no_opponent',
    'gipedo_pulled_out', 'gipedo_settled'
  ] loop
    assert tests.mr_send(v_player, v_type, '{}') is null, format('%s is allowed', v_type);
  end loop;
  assert (select count(*) from public.notification_types) = 35, 'exactly the 35 types of contract 4';
  assert (select array_agg(type order by type) from public.notification_types where always_sent) = array[
    'booking_cancelled', 'booking_cancelled_by_venue', 'booking_spot_released', 'cancellation_fee_failed',
    'cash_unpaid_prompt', 'debt_created', 'debt_settled', 'gipedo_no_opponent', 'gipedo_opponent_left', 'gipedo_pulled_out',
    'gipedo_result_needed', 'gipedo_settled', 'guarantee_charged', 'guarantee_hold_failed',
    'match_payment_due', 'short_game_warning', 'top_up_charged', 'venue_closed_new_bookings', 'venue_condition_warning'],
    'the always-sent types';

  -- A row with an unknown type can't be written directly either.
  assert tests.error_of(format('insert into public.notifications (profile_id, type, title, body) values (%L, %L, %L, %L)',
    v_player, 'spot_released', 't', 'b')) like '%notifications_type_fkey%', 'notifications.type must be a known type';
end $$;

-- 8. Settings: a player manages only their own; always-sent types can't be turned off.
do $$
declare
  v_player uuid := tests.create_user('mr5-settings@futty.test');
  v_other uuid := tests.create_user('mr5-settings-other@futty.test');
  v_error text;
begin
  insert into public.notification_settings (profile_id, type, enabled) values (v_other, 'squad_post', false);
  perform tests.mr_quiet(v_other, '22:00', '07:00');

  perform tests.act_as(v_player);
  assert tests.error_of(format('insert into public.notification_settings (profile_id, type, enabled) values (%L, %L, false)',
    v_player, 'match_reminder_2h')) is null, 'a player turns off a type';
  v_error := tests.error_of(format('insert into public.notification_settings (profile_id, type, enabled) values (%L, %L, false)',
    v_player, 'booking_cancelled'));
  assert v_error = 'always_sent_type', format('an always-sent type can''t be turned off, got %s', v_error);
  v_error := tests.error_of(format('insert into public.notification_settings (profile_id, type, enabled) values (%L, %L, false)',
    v_other, 'match_reminder_2h'));
  assert v_error like '%row-level security%', format('not for someone else, got %s', v_error);
  assert tests.error_of(format('insert into public.notification_quiet_hours (profile_id, starts_local, ends_local) values (%L, %L, %L)',
    v_player, '23:00', '07:00')) is null, 'a player sets quiet hours';
  assert (select count(*) from public.notification_settings) = 1, 'sees only their own settings';
  assert (select count(*) from public.notification_quiet_hours) = 1, 'and their own quiet hours';
  update public.notification_settings set enabled = true where profile_id = v_other;
  delete from public.notification_quiet_hours where profile_id = v_other;
  assert (select count(*) from public.notification_types) = 35, 'everyone signed in reads the types';
  v_error := tests.error_of('select count(*) from public.notification_deliveries');
  assert v_error like 'permission denied%', format('deliveries are service_role only, got %s', v_error);
  v_error := tests.error_of(format('insert into public.notification_types values (%L, false)', 'mine'));
  assert v_error like 'permission denied%', 'types are written by migrations only';
  perform tests.act_as_postgres();
  assert (select enabled from public.notification_settings where profile_id = v_other) = false, 'others'' settings untouched';
  assert exists (select 1 from public.notification_quiet_hours where profile_id = v_other), 'others'' quiet hours untouched';

  -- The functions behind it are service_role only.
  perform tests.act_as(v_player);
  assert tests.error_of(format('select public.send_notification(%L, %L, %L)', v_player, 'squad_post', '{}')) like 'permission denied%',
    'the app can''t send notifications';
  assert tests.error_of('select * from public.push_deliveries_due(10)') like 'permission denied%', 'nor claim pushes';
  assert tests.error_of(format('select public.push_delivery_result(%L, %L, null)', gen_random_uuid(), 'sent')) like 'permission denied%',
    'nor record them';
  perform tests.act_as_postgres();
end $$;

select 'match record 5 (send_notification, pushes, quiet hours) passed' as result;

rollback;
