-- A9 (match-record.md section 6.3 step 5, decision 1h): routing, claiming,
-- results, delivery reports, cost and opting out by reply.
begin;

-- WhatsApp is off until Panos switches it on; these tests switch it on.
update public.whatsapp_settings set enabled = true;

create function tests.wa_send(p_profile uuid, p_type text, p_data jsonb)
returns void
language plpgsql
as $$
begin
  perform tests.act_as_service_role();
  perform public.send_notification(p_profile, p_type, p_data);
  perform tests.act_as_postgres();
end;
$$;

create function tests.wa_channels(p_profile uuid, p_type text)
returns text[]
language sql
as $$
  select coalesce(array_agg(d.channel || ':' || d.status order by d.channel, d.id), '{}')
  from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
  where n.profile_id = p_profile and n.type = p_type;
$$;

create function tests.wa_claim()
returns setof record
language plpgsql
as $$
begin
  perform tests.act_as_service_role();
  return query select * from public.whatsapp_deliveries_due(100);
  perform tests.act_as_postgres();
end;
$$;

create function tests.wa_opt_in(p_profile uuid, p_phone text, p_type text, p_channel text)
returns void
language plpgsql
as $$
begin
  perform tests.act_as(p_profile);
  perform public.set_whatsapp_number(p_phone);
  perform public.set_notification_channel(p_type, p_channel);
  perform tests.act_as_postgres();
end;
$$;

do $$
declare
  push_only uuid := tests.create_user('wa2-push@futty.test');
  wa uuid := tests.create_user('wa2-wa@futty.test');
  both_ uuid := tests.create_user('wa2-both@futty.test');
  stopped uuid := tests.create_user('wa2-stopped@futty.test');
  v_data jsonb := jsonb_build_object('title', 'Kick-off in 2 hours', 'body', 'North Arena at 20:00. 6 in, 2 haven''t paid.',
                                     'matchId', gen_random_uuid());
  v_claimed record;
  v_count integer := 0;
  v_id uuid;
begin
  insert into public.push_tokens (profile_id, token, platform) values
    (push_only, 'ExponentPushToken[wa2-1]', 'ios'), (wa, 'ExponentPushToken[wa2-2]', 'ios'),
    (both_, 'ExponentPushToken[wa2-3]', 'ios'), (stopped, 'ExponentPushToken[wa2-4]', 'ios');
  perform tests.wa_opt_in(wa, '+35799000001', 'match_reminder_2h', 'whatsapp');
  perform tests.wa_opt_in(both_, '+35799000002', 'match_reminder_2h', 'both');
  perform tests.wa_opt_in(stopped, '+35799000003', 'match_reminder_2h', 'whatsapp');
  perform tests.act_as(stopped);
  perform public.stop_whatsapp();
  perform tests.act_as_postgres();

  -- 1. Routing.
  perform tests.wa_send(push_only, 'match_reminder_2h', v_data);
  perform tests.wa_send(wa, 'match_reminder_2h', v_data);
  perform tests.wa_send(both_, 'match_reminder_2h', v_data);
  perform tests.wa_send(stopped, 'match_reminder_2h', v_data);
  assert tests.wa_channels(push_only, 'match_reminder_2h') = array['push:queued'], 'no choice: push';
  assert tests.wa_channels(wa, 'match_reminder_2h') = array['whatsapp:queued'], 'WhatsApp only';
  assert tests.wa_channels(both_, 'match_reminder_2h') = array['push:queued', 'whatsapp:queued'], 'both';
  assert tests.wa_channels(stopped, 'match_reminder_2h') = array['push:queued'], 'opted out: push, never lost';
  -- A type with no WhatsApp choice goes by push; a turned-off type sends nothing.
  perform tests.wa_send(wa, 'match_reminder_24h', v_data);
  assert tests.wa_channels(wa, 'match_reminder_24h') = array['push:queued'], 'another type: push';
  insert into public.notification_settings (profile_id, type, enabled) values (wa, 'match_after_game', false);
  perform tests.act_as(wa);
  perform public.set_notification_channel('match_after_game', 'whatsapp');
  perform tests.act_as_postgres();
  perform tests.wa_send(wa, 'match_after_game', '{"title": "How did it go?"}');
  assert tests.wa_channels(wa, 'match_after_game') = '{}', 'turned off: the bell only';
  assert (select count(*) from public.notifications where profile_id = wa) = 3, 'one row per call, always';

  -- 2. Claiming: each WhatsApp message once, with its template and params.
  for v_claimed in select * from tests.wa_claim() as c(delivery_id uuid, notification_id uuid, type text, phone text,
                                                         template_name text, template_language text, params text[]) loop
    v_count := v_count + 1;
    assert v_claimed.template_name = 'futty_game_reminder' and v_claimed.template_language = 'en', 'the template';
    assert v_claimed.params = array['Kick-off in 2 hours', 'North Arena at 20:00. 6 in, 2 haven''t paid.'],
      format('title then body, got %s', v_claimed.params);
    assert v_claimed.phone in ('+35799000001', '+35799000002'), 'the number';
  end loop;
  assert v_count = 2, format('wa and both_, got %s', v_count);
  assert (select count(*) from tests.wa_claim() as c(a uuid, b uuid, c text, d text, e text, f text, g text[])) = 0,
    'claimed once';
  assert (select count(*) from public.notification_deliveries where channel = 'push' and status = 'sending') = 0,
    'pushes are left for notify-send-pushes';

  -- 3. Results.
  select d.id into v_id from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
  where n.profile_id = wa and d.channel = 'whatsapp';
  perform tests.act_as_service_role();
  assert tests.error_of(format('select public.whatsapp_delivery_result(%L, %L, null, null)', v_id, 'sent')) = 'missing_message_id',
    'sent needs Meta''s id';
  assert tests.error_of(format('select public.whatsapp_delivery_result(%L, %L, null, %L)', v_id, 'delivered', 'x'))
         = 'invalid_status', 'only sent or failed here';
  perform public.whatsapp_delivery_result(v_id, 'sent', null, 'wamid.ONE');
  perform public.whatsapp_delivery_result(v_id, 'failed', 'late', 'wamid.TWO');
  perform tests.act_as_postgres();
  assert (select (status, provider_message_id) from public.notification_deliveries where id = v_id) = ('sent'::text, 'wamid.ONE'::text),
    'recorded once, a second answer is ignored';
end $$;

-- 4. Delivery reports and cost.
do $$
declare
  p uuid := tests.create_user('wa2c-p@futty.test');
  uk uuid := tests.create_user('wa2c-uk@futty.test');
  v_id uuid;
  v_uk uuid;
  v_row public.notification_deliveries;
begin
  perform tests.wa_opt_in(p, '+35799000010', 'match_reminder_24h', 'whatsapp');
  perform tests.wa_opt_in(uk, '+447700900123', 'match_reminder_24h', 'whatsapp');
  perform tests.wa_send(p, 'match_reminder_24h', '{"title": "Game tomorrow", "body": "North Arena, tomorrow at 20:00."}');
  perform tests.wa_send(uk, 'match_reminder_24h', '{"title": "Game tomorrow", "body": "North Arena, tomorrow at 20:00."}');
  perform * from tests.wa_claim() as c(a uuid, b uuid, c text, d text, e text, f text, g text[]);
  select d.id into v_id from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
  where n.profile_id = p and d.channel = 'whatsapp';
  select d.id into v_uk from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
  where n.profile_id = uk and d.channel = 'whatsapp';
  -- A made-up price, for the test only (the real table ships empty).
  insert into public.whatsapp_prices (country_code, category, price_micros, valid_from) values ('357', 'utility', 12345, '2026-01-01');

  perform tests.act_as_service_role();
  perform public.whatsapp_delivery_result(v_id, 'sent', null, 'wamid.CY');
  perform public.whatsapp_delivery_result(v_uk, 'sent', null, 'wamid.UK');
  assert public.whatsapp_status_update('wamid.UNKNOWN', 'delivered', now()) = false, 'an unknown id is ignored';
  assert public.whatsapp_status_update('wamid.CY', 'read', '2026-11-18 10:05+02', null, 'utility', true), 'read first';
  assert public.whatsapp_status_update('wamid.CY', 'delivered', '2026-11-18 10:00+02', null, 'utility', true), 'then delivered';
  assert public.whatsapp_status_update('wamid.CY', 'failed', '2026-11-18 10:06+02', 'late failure'), 'a late failure';
  assert public.whatsapp_status_update('wamid.UK', 'delivered', now(), null, 'utility', true), 'no UK price';
  assert tests.error_of('select public.whatsapp_status_update(''wamid.CY'', ''bounced'', now())') = 'invalid_status', 'bounced';
  perform tests.act_as_postgres();

  select * into v_row from public.notification_deliveries where id = v_id;
  assert v_row.status = 'sent' and v_row.error is null, 'a failure never undoes a delivery';
  assert v_row.read_at = '2026-11-18 10:05+02' and v_row.delivered_at = '2026-11-18 10:05+02',
    format('read implies delivered; times kept, got %s %s', v_row.delivered_at, v_row.read_at);
  assert v_row.pricing_category = 'utility' and v_row.cost_micros = 12345, format('priced, got %s', v_row.cost_micros);
  select * into v_row from public.notification_deliveries where id = v_uk;
  assert v_row.pricing_category = 'utility' and v_row.cost_micros is null, 'no price for the country: logged, not priced';

  assert (select (messages, delivered, read, not_priced, cost_micros) from public.whatsapp_costs_by_month
          where type = 'match_reminder_24h' and pricing_category = 'utility'
            and month = date_trunc('month', now() at time zone 'Asia/Nicosia')::date) = (2::bigint, 2::bigint, 1::bigint, 1::bigint, 12345::bigint),
    'the monthly total';
end $$;

-- 5. Quiet hours, kicked-off reminders and opting out by reply.
do $$
declare
  p uuid := tests.create_user('wa2q-p@futty.test');
  r uuid := tests.create_user('wa2q-r@futty.test');
  m uuid := tests.form_match(now() + interval '1 hour', 'scheduled');
  v_now time := (now() at time zone 'Asia/Nicosia')::time;
begin
  perform tests.wa_opt_in(p, '+35799000020', 'match_reminder_2h', 'whatsapp');
  perform tests.wa_opt_in(r, '+35799000021', 'match_after_game', 'whatsapp');
  -- Quiet hours around now: held.
  insert into public.notification_quiet_hours (profile_id, starts_local, ends_local)
  values (p, v_now - interval '1 hour', v_now + interval '1 hour');
  perform tests.wa_send(p, 'match_reminder_2h', jsonb_build_object('title', 'Kick-off in 2 hours', 'body', 'x', 'matchId', m));
  assert tests.wa_channels(p, 'match_reminder_2h') = array['whatsapp:held_quiet_hours'], 'held in quiet hours';
  -- The quiet hours end after kickoff: dropped, not sent.
  update public.notification_deliveries d set send_after = now() - interval '1 minute'
  from public.notifications n where n.id = d.notification_id and n.profile_id = p;
  update public.matches set kickoff_at = now() - interval '5 minutes' where id = m;
  assert (select count(*) from tests.wa_claim() as c(a uuid, b uuid, c text, d text, e text, f text, g text[])) = 0, 'nothing sent';
  assert tests.wa_channels(p, 'match_reminder_2h') = array['whatsapp:dropped'], 'dropped: the game has started';

  -- STOP by reply: queued messages to that number are dropped, and the next
  -- reminder goes by push.
  insert into public.push_tokens (profile_id, token, platform) values (r, 'ExponentPushToken[wa2q]', 'android');
  perform tests.wa_send(r, 'match_after_game', '{"title": "How did it go?"}');
  perform tests.act_as_service_role();
  assert public.whatsapp_inbound_opt_out('35799000021'), 'STOP from 35799000021 (Meta sends no +)';
  assert not public.whatsapp_inbound_opt_out('35799000021'), 'already out';
  perform tests.act_as_postgres();
  assert (select opted_out_by from public.whatsapp_contacts where profile_id = r) = 'reply_stop', 'by reply';
  assert (select count(*) from tests.wa_claim() as c(a uuid, b uuid, c text, d text, e text, f text, g text[])) = 0, 'not sent';
  assert (select d.error from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
          where n.profile_id = r and d.channel = 'whatsapp') = 'opted_out', 'dropped as opted out';
  perform tests.wa_send(r, 'match_after_game', '{"title": "How did it go?"}');
  assert tests.wa_channels(r, 'match_after_game') = array['push:queued', 'whatsapp:dropped'], 'the next one by push';
end $$;

rollback;
