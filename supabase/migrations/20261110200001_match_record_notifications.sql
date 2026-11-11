-- A2: contract 4, send_notification (docs/specs/match-record.md section 6.3,
-- decisions 4, 6, 1a.6, 1a.7). Replaces the P3 stub: same signature, same
-- title/body handling, and now push.
--
--   1. refuses a type that isn't in notification_types (unknown_notification_type);
--   2. always writes one notifications row (the in-app bell);
--   3. stops there for a type the player turned off, unless it's always sent;
--   4. otherwise queues one push per push token of the player. During the
--      player's quiet hours (Cyprus time) the push is held until they end
--      (send_after).
--
-- Pushes are sent by the notify-send-pushes Edge Function: it claims the
-- due deliveries with push_deliveries_due (each one once: status sending)
-- and records each outcome with push_delivery_result. A push that fails
-- never fails the caller of send_notification. Nothing else pushes on a
-- notifications insert (no trigger or webhook on that table), so each
-- send_notification is pushed exactly once per token.
-- WhatsApp (A9) will be a second channel on notification_deliveries.

create or replace function public.send_notification(p_profile_id uuid, p_type text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_always_sent boolean;
  v_notification_id uuid;
  v_quiet public.notification_quiet_hours;
  v_local timestamp := now() at time zone 'Asia/Nicosia';
  v_now_local time := (now() at time zone 'Asia/Nicosia')::time;
  v_quiet_ends timestamp;
  v_send_after timestamptz;
begin
  select t.always_sent into v_always_sent from public.notification_types t where t.type = p_type;
  if not found then
    raise exception 'unknown_notification_type';
  end if;

  insert into public.notifications (profile_id, type, title, body, data)
  values (
    p_profile_id, p_type,
    coalesce(p_data ->> 'title', initcap(replace(p_type, '_', ' '))),
    coalesce(p_data ->> 'body', ''),
    coalesce(p_data, '{}'::jsonb) - 'title' - 'body'
  )
  returning id into v_notification_id;

  if not v_always_sent and exists (
    select 1 from public.notification_settings s
    where s.profile_id = p_profile_id and s.type = p_type and not s.enabled
  ) then
    return;
  end if;

  -- Quiet hours, in Cyprus wall-clock time; they may wrap past midnight
  -- (22:00-07:00). Inside them, the push is due when they end.
  select * into v_quiet from public.notification_quiet_hours q where q.profile_id = p_profile_id;
  if found then
    if v_quiet.starts_local < v_quiet.ends_local then
      if v_now_local >= v_quiet.starts_local and v_now_local < v_quiet.ends_local then
        v_quiet_ends := v_local::date + v_quiet.ends_local;
      end if;
    elsif v_now_local >= v_quiet.starts_local then
      v_quiet_ends := (v_local::date + 1) + v_quiet.ends_local;
    elsif v_now_local < v_quiet.ends_local then
      v_quiet_ends := v_local::date + v_quiet.ends_local;
    end if;
    if v_quiet_ends is not null then
      v_send_after := v_quiet_ends at time zone 'Asia/Nicosia';
    end if;
  end if;

  insert into public.notification_deliveries (notification_id, push_token_id, channel, status, send_after)
  select v_notification_id, t.id, 'push',
         case when v_send_after is null then 'queued' else 'held_quiet_hours' end,
         v_send_after
  from public.push_tokens t
  where t.profile_id = p_profile_id;
end;
$$;

-- The pushes due now, claimed for sending (status sending), at most
-- p_limit, oldest first: queued ones, and held ones whose quiet hours have
-- ended. A held match reminder (24h, 2h) whose game has kicked off by then
-- is dropped instead (decision 1a.6). Rows are locked and skipped when
-- another run holds them, so two runs never claim the same push.
create or replace function public.push_deliveries_due(p_limit integer default 100)
returns table (delivery_id uuid, notification_id uuid, type text, token text, title text, body text, data jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.notification_deliveries d
  set status = 'dropped'
  from public.notifications n, public.matches m
  where n.id = d.notification_id
    and d.status = 'held_quiet_hours'
    and d.send_after <= now()
    and n.type in ('match_reminder_24h', 'match_reminder_2h')
    and m.id = case
                 when (n.data ->> 'matchId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then (n.data ->> 'matchId')::uuid
               end
    and m.kickoff_at <= now();

  return query
  with due as (
    select d.id
    from public.notification_deliveries d
    where d.channel = 'push'
      and (d.status = 'queued' or (d.status = 'held_quiet_hours' and d.send_after <= now()))
    order by coalesce(d.send_after, d.created_at), d.id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.notification_deliveries d
  set status = 'sending', claimed_at = now()
  from due, public.push_tokens t, public.notifications n
  where d.id = due.id and t.id = d.push_token_id and n.id = d.notification_id
  returning d.id, n.id, n.type, t.token, n.title, n.body, n.data;
end;
$$;

-- What happened to a claimed push: sent, or failed with Expo's error. Only
-- a push being sent changes; anything else is left as it is.
create or replace function public.push_delivery_result(p_delivery_id uuid, p_status text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed') then
    raise exception 'invalid_status';
  end if;
  update public.notification_deliveries
  set status = p_status,
      sent_at = case when p_status = 'sent' then now() end,
      error = case when p_status = 'failed' then p_error end
  where id = p_delivery_id and status = 'sending';
end;
$$;

revoke all on function public.send_notification(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_notification(uuid, text, jsonb) to service_role;
revoke all on function public.push_deliveries_due(integer) from public, anon, authenticated;
grant execute on function public.push_deliveries_due(integer) to service_role;
revoke all on function public.push_delivery_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.push_delivery_result(uuid, text, text) to service_role;
