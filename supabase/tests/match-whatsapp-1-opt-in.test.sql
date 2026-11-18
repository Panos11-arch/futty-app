-- A9 (05 section 13; match-record.md decision 1h): opting in to WhatsApp and
-- choosing a channel per reminder type.
--   set_whatsapp_number takes an E.164 number (spaces, dashes and brackets
--   ignored) and refuses one another player has active; stop_whatsapp opts
--   out; set_notification_channel takes push, whatsapp or both for a
--   WhatsApp-capable type, and WhatsApp needs an active number. Players read
--   only their own number and channels and write them only through these.
begin;

-- WhatsApp is off until Panos switches it on; these tests switch it on.
update public.whatsapp_settings set enabled = true;

do $$
declare
  p uuid := tests.create_user('wa1-p@futty.test');
  q uuid := tests.create_user('wa1-q@futty.test');
  v jsonb;
begin
  -- 1. Numbers.
  perform tests.act_as(p);
  assert tests.error_of('select public.set_whatsapp_number(''99123456'')') = 'invalid_phone', 'needs the country code';
  assert tests.error_of('select public.set_whatsapp_number(''+357 99abc'')') = 'invalid_phone', 'digits only';
  assert tests.error_of('select public.set_whatsapp_number(null)') = 'invalid_phone', 'null';
  v := public.set_whatsapp_number('+357 (99) 123-456');
  assert v = '{"phone": "+35799123456", "active": true}', format('normalised, got %s', v);
  assert (select phone_e164 from public.whatsapp_contacts) = '+35799123456', 'reads their own';
  -- Choosing WhatsApp.
  assert tests.error_of('select public.set_notification_channel(''match_reminder_2h'', ''whatsapp'')') is null, '2h by WhatsApp';
  assert tests.error_of('select public.set_notification_channel(''match_after_game'', ''both'')') is null, 'after game: both';
  assert tests.error_of('select public.set_notification_channel(''booking_cancelled'', ''whatsapp'')') = 'not_a_whatsapp_type',
    'only WhatsApp-capable types';
  assert tests.error_of('select public.set_notification_channel(''match_reminder_2h'', ''sms'')') = 'invalid_channel', 'sms';
  assert tests.error_of('select public.set_notification_channel(''match_reminder_2h'', null)') = 'invalid_channel', 'null';
  assert (select count(*) from public.notification_channels) = 2, 'their two choices';
  perform tests.act_as_postgres();

  -- 2. Someone else can't take an active number, or choose WhatsApp without one.
  perform tests.act_as(q);
  assert tests.error_of('select public.set_whatsapp_number(''+35799123456'')') = 'phone_in_use', 'p''s number';
  assert tests.error_of('select public.set_notification_channel(''match_reminder_2h'', ''whatsapp'')') = 'whatsapp_not_set_up',
    'no number yet';
  assert tests.error_of('select public.set_notification_channel(''match_reminder_2h'', ''push'')') is null, 'push is fine';
  assert (select count(*) from public.whatsapp_contacts) = 0, 'q sees nobody else''s number';
  assert (select count(*) from public.notification_channels) = 1, 'q sees only their own channel';
  perform tests.act_as_postgres();

  -- 3. Opting out frees the number and keeps the choices.
  perform tests.act_as(p);
  perform public.stop_whatsapp();
  assert (select opted_out_by from public.whatsapp_contacts) = 'player', 'opted out by the player';
  assert tests.error_of('select public.set_notification_channel(''match_reminder_24h'', ''whatsapp'')') = 'whatsapp_not_set_up',
    'opted out: no new WhatsApp choices';
  perform tests.act_as_postgres();
  perform tests.act_as(q);
  assert tests.error_of('select public.set_whatsapp_number(''+35799123456'')') is null, 'free now';
  perform tests.act_as_postgres();
  perform tests.act_as(p);
  assert tests.error_of('select public.set_whatsapp_number(''+35799123456'')') = 'phone_in_use', 'and now q''s';
  assert public.set_whatsapp_number('+35799000111') ->> 'phone' = '+35799000111', 'another number opts p back in';
  assert (select opted_out_at from public.whatsapp_contacts) is null, 'active again';
  perform tests.act_as_postgres();
end $$;

-- 4. Off (the default until launch): nobody can opt in or choose WhatsApp,
-- and choices already made go back to push.
do $$
declare
  p uuid := tests.create_user('wa1o-p@futty.test');
begin
  insert into public.push_tokens (profile_id, token, platform) values (p, 'ExponentPushToken[wa1o]', 'ios');
  perform tests.act_as(p);
  perform public.set_whatsapp_number('+35799555555');
  perform public.set_notification_channel('match_reminder_2h', 'whatsapp');
  perform tests.act_as_postgres();
  update public.whatsapp_settings set enabled = false;
  perform tests.act_as(p);
  assert not public.whatsapp_enabled(), 'off';
  assert tests.error_of('select public.set_whatsapp_number(''+35799555556'')') = 'whatsapp_unavailable', 'no opting in';
  assert tests.error_of('select public.set_notification_channel(''match_reminder_24h'', ''both'')') = 'whatsapp_unavailable',
    'no choosing WhatsApp';
  assert tests.error_of('select public.set_notification_channel(''match_reminder_24h'', ''push'')') is null, 'push is fine';
  perform tests.act_as_service_role();
  perform public.send_notification(p, 'match_reminder_2h', '{"title": "Kick-off in 2 hours"}');
  perform tests.act_as_postgres();
  assert (select array_agg(d.channel) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
          where n.profile_id = p) = array['push'], 'off: push only';
  update public.whatsapp_settings set enabled = true;
end $$;

-- 5. Security: no direct writes, nothing for signed-out users, signed-in
-- users read the WhatsApp types.
do $$
declare
  p uuid := tests.create_user('wa1s-p@futty.test');
  v_error text;
begin
  perform tests.act_as(p);
  v_error := tests.error_of(format('insert into public.whatsapp_contacts (profile_id, phone_e164) values (%L, %L)', p, '+35799999999'));
  assert v_error like 'permission denied%', format('direct insert: %s', v_error);
  v_error := tests.error_of(format('insert into public.notification_channels (profile_id, type, channel) values (%L, %L, %L)',
                                   p, 'match_reminder_2h', 'whatsapp'));
  assert v_error like 'permission denied%', format('direct channel: %s', v_error);
  assert (select count(*) from public.whatsapp_notification_types) = 3, 'the three WhatsApp types';
  assert tests.error_of('select count(*) from public.whatsapp_prices') like 'permission denied%', 'prices are internal';
  assert tests.error_of('update public.whatsapp_settings set enabled = false') like 'permission denied%', 'only Panos switches it';
  assert tests.error_of('select count(*) from public.whatsapp_costs_by_month') like 'permission denied%', 'costs are internal';
  assert tests.error_of('select public.whatsapp_deliveries_due()') like 'permission denied%', 'claiming is internal';
  assert tests.error_of('select public.whatsapp_inbound_opt_out(''+35799999999'')') like 'permission denied%', 'opt-out by reply is internal';
  perform tests.act_as_anon();
  assert tests.error_of('select public.set_whatsapp_number(''+35799999999'')') like 'permission denied%', 'anon';
  assert tests.error_of('select count(*) from public.whatsapp_notification_types') like 'permission denied%', 'anon types';
  perform tests.act_as_postgres();

  assert (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('set_whatsapp_number', 'stop_whatsapp', 'set_notification_channel', 'send_notification',
                              'whatsapp_deliveries_due', 'whatsapp_delivery_result', 'whatsapp_status_update',
                              'whatsapp_inbound_opt_out')),
    'security definer with search_path = ''''';
end $$;

rollback;
