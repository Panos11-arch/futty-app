-- A9: WhatsApp as a second reminder channel (05 section 13; match-record.md
-- section 6.3 step 5, decision 1h).
--
-- Players opt in with their WhatsApp number, then choose push, WhatsApp or
-- both for each reminder type that can go by WhatsApp. send_notification
-- keeps its signature: it still writes one notifications row and, unless the
-- type is turned off, queues deliveries, now on the channels the player
-- chose. A player who chose WhatsApp but has no active number gets push, so
-- a reminder is never lost. Quiet hours hold WhatsApp messages exactly as
-- they hold pushes, and a held match reminder whose game has kicked off is
-- dropped on both channels.
--
-- The notify-send-whatsapp Edge Function sends the due messages through the
-- WhatsApp Business Platform (Meta Cloud API) with Meta-approved templates,
-- claiming them with whatsapp_deliveries_due and recording each answer with
-- whatsapp_delivery_result. The whatsapp-webhook Edge Function records what
-- Meta reports afterwards (delivered, read, failed and the pricing category)
-- with whatsapp_status_update, and opts a number out when its owner replies
-- STOP (whatsapp_inbound_opt_out).
--
-- Cost: every message's pricing category is logged. Its cost is filled in
-- from whatsapp_prices, which is left empty: the Cyprus price is to be
-- checked before WhatsApp is switched on for everyone (05 section 13), and
-- this migration doesn't invent one. Costs are integer micro-euros
-- (1/1,000,000 of a euro), because a message costs a fraction of a cent.

-- WhatsApp is off until the business account, the number and the templates
-- are approved and the Cyprus price is checked. While off, players can't
-- choose it and everything goes by push. Panos switches it on with
--   update public.whatsapp_settings set enabled = true;
create table public.whatsapp_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.whatsapp_settings default values;

-- Which notification types can go by WhatsApp, and with which approved
-- template. `params` names what fills the template's {{1}}, {{2}}, ...: the
-- notification's 'title' or 'body'.
create table public.whatsapp_notification_types (
  type text primary key references public.notification_types (type),
  template_name text not null,
  template_language text not null default 'en',
  params text[] not null default '{}',
  check (params <@ array['title', 'body'])
);

insert into public.whatsapp_notification_types (type, template_name, params) values
  ('match_reminder_24h', 'futty_game_reminder', array['title', 'body']),
  ('match_reminder_2h', 'futty_game_reminder', array['title', 'body']),
  ('match_after_game', 'futty_after_game', '{}');

-- A player's WhatsApp number (E.164, digits only after the +). Active while
-- opted in and not opted out.
create table public.whatsapp_contacts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  opted_in_at timestamptz not null default now(),
  opted_out_at timestamptz,
  opted_out_by text check (opted_out_by in ('player', 'reply_stop')),
  updated_at timestamptz not null default now(),
  check ((opted_out_at is null) = (opted_out_by is null))
);
create unique index whatsapp_contacts_phone_active on public.whatsapp_contacts (phone_e164) where opted_out_at is null;

-- The channel a player chose for a WhatsApp-capable type. No row = push.
create table public.notification_channels (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null references public.whatsapp_notification_types (type),
  channel text not null check (channel in ('push', 'whatsapp', 'both')),
  updated_at timestamptz not null default now(),
  primary key (profile_id, type)
);

-- Meta's price per message, by country calling code and pricing category,
-- in micro-euros. Empty until the founders check the Cyprus price.
create table public.whatsapp_prices (
  country_code text not null check (country_code ~ '^[1-9][0-9]{0,2}$'),
  category text not null,
  price_micros integer not null check (price_micros >= 0),
  valid_from date not null,
  primary key (country_code, category, valid_from)
);

-- WhatsApp deliveries live alongside pushes.
alter table public.notification_deliveries alter column push_token_id drop not null;
alter table public.notification_deliveries
  add column phone_e164 text,
  add column provider_message_id text,
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column pricing_category text,
  add column billable boolean,
  add column cost_micros integer check (cost_micros >= 0),
  add constraint notification_deliveries_channel_target check (
    (channel = 'push' and push_token_id is not null and phone_e164 is null)
    or (channel = 'whatsapp' and push_token_id is null and phone_e164 is not null));
create unique index notification_deliveries_provider_message on public.notification_deliveries (provider_message_id)
  where provider_message_id is not null;

alter table public.whatsapp_settings enable row level security;
alter table public.whatsapp_notification_types enable row level security;
alter table public.whatsapp_contacts enable row level security;
alter table public.notification_channels enable row level security;
alter table public.whatsapp_prices enable row level security;

create policy "Signed-in users read whether WhatsApp is on" on public.whatsapp_settings
  for select to authenticated using (true);
create policy "Signed-in users read the WhatsApp types" on public.whatsapp_notification_types
  for select to authenticated using (true);
create policy "A player reads their own WhatsApp number" on public.whatsapp_contacts
  for select to authenticated using (profile_id = auth.uid());
create policy "A player reads their own channels" on public.notification_channels
  for select to authenticated using (profile_id = auth.uid());

revoke all on public.whatsapp_settings, public.whatsapp_notification_types, public.whatsapp_contacts,
  public.notification_channels, public.whatsapp_prices from public, anon, authenticated;
grant select on public.whatsapp_settings, public.whatsapp_notification_types, public.whatsapp_contacts,
  public.notification_channels to authenticated;
grant all on public.whatsapp_settings, public.whatsapp_notification_types, public.whatsapp_contacts,
  public.notification_channels, public.whatsapp_prices to service_role;

-- Whether WhatsApp is switched on.
create or replace function public.whatsapp_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enabled from public.whatsapp_settings s), false);
$$;

-- The app's calls. Writes go through these, never straight to the tables.

-- Opts the caller in with a number in E.164 (+35799123456). Spaces, dashes
-- and brackets are ignored. A number another player has active is refused.
create or replace function public.set_whatsapp_number(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.whatsapp_enabled() then
    raise exception 'whatsapp_unavailable';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid_phone';
  end if;
  if exists (select 1 from public.whatsapp_contacts c
             where c.phone_e164 = v_phone and c.opted_out_at is null and c.profile_id <> v_uid) then
    raise exception 'phone_in_use';
  end if;
  insert into public.whatsapp_contacts (profile_id, phone_e164)
  values (v_uid, v_phone)
  on conflict (profile_id) do update
  set phone_e164 = excluded.phone_e164, opted_in_at = now(), opted_out_at = null, opted_out_by = null, updated_at = now();
  return jsonb_build_object('phone', v_phone, 'active', true);
end;
$$;

-- Opts the caller out. Their channel choices are kept, but nothing goes by
-- WhatsApp (they get push) until they opt in again.
create or replace function public.stop_whatsapp()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  update public.whatsapp_contacts
  set opted_out_at = now(), opted_out_by = 'player', updated_at = now()
  where profile_id = v_uid and opted_out_at is null;
end;
$$;

-- The caller's channel for one WhatsApp-capable type. Choosing WhatsApp
-- needs an active number first (whatsapp_not_set_up).
create or replace function public.set_notification_channel(p_type text, p_channel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.whatsapp_notification_types w where w.type = p_type) then
    raise exception 'not_a_whatsapp_type';
  end if;
  if p_channel is null or p_channel not in ('push', 'whatsapp', 'both') then
    raise exception 'invalid_channel';
  end if;
  if p_channel <> 'push' and not public.whatsapp_enabled() then
    raise exception 'whatsapp_unavailable';
  end if;
  if p_channel <> 'push' and not exists (
    select 1 from public.whatsapp_contacts c where c.profile_id = v_uid and c.opted_out_at is null
  ) then
    raise exception 'whatsapp_not_set_up';
  end if;
  insert into public.notification_channels (profile_id, type, channel)
  values (v_uid, p_type, p_channel)
  on conflict (profile_id, type) do update set channel = excluded.channel, updated_at = now();
end;
$$;

-- Contract 4, from 20261110200001_match_record_notifications.sql, now with
-- the channel each player chose (step 4 of section 6.3; decision 1h).
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
  v_channel text := 'push';
  v_phone text;
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
  -- (22:00-07:00). Inside them, a delivery is due when they end.
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

  -- The chosen channel, for a WhatsApp-capable type with an active number.
  select c.channel, w.phone_e164 into v_channel, v_phone
  from public.notification_channels c
  join public.whatsapp_contacts w on w.profile_id = c.profile_id and w.opted_out_at is null
  where c.profile_id = p_profile_id and c.type = p_type
    and exists (select 1 from public.whatsapp_notification_types t where t.type = p_type)
    and public.whatsapp_enabled();
  if not found then
    v_channel := 'push';
  end if;

  if v_channel in ('push', 'both') then
    insert into public.notification_deliveries (notification_id, push_token_id, channel, status, send_after)
    select v_notification_id, t.id, 'push',
           case when v_send_after is null then 'queued' else 'held_quiet_hours' end,
           v_send_after
    from public.push_tokens t
    where t.profile_id = p_profile_id;
  end if;

  if v_channel in ('whatsapp', 'both') then
    insert into public.notification_deliveries (notification_id, channel, phone_e164, status, send_after)
    values (v_notification_id, 'whatsapp', v_phone,
            case when v_send_after is null then 'queued' else 'held_quiet_hours' end,
            v_send_after);
  end if;
end;
$$;

-- The WhatsApp messages due now, claimed for sending, like
-- push_deliveries_due: queued ones and held ones whose quiet hours ended,
-- oldest first, each handed out once. A held match reminder whose game has
-- kicked off is dropped first. A number opted out since it was queued is
-- dropped too.
create or replace function public.whatsapp_deliveries_due(p_limit integer default 100)
returns table (delivery_id uuid, notification_id uuid, type text, phone text, template_name text,
               template_language text, params text[])
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
    and d.channel = 'whatsapp'
    and d.status = 'held_quiet_hours'
    and d.send_after <= now()
    and n.type in ('match_reminder_24h', 'match_reminder_2h')
    and m.id = case
                 when (n.data ->> 'matchId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then (n.data ->> 'matchId')::uuid
               end
    and m.kickoff_at <= now();

  update public.notification_deliveries d
  set status = 'dropped', error = 'opted_out'
  from public.notifications n
  where n.id = d.notification_id
    and d.channel = 'whatsapp'
    and d.status in ('queued', 'held_quiet_hours')
    and not exists (select 1 from public.whatsapp_contacts c
                    where c.profile_id = n.profile_id and c.phone_e164 = d.phone_e164 and c.opted_out_at is null);

  return query
  with due as (
    select d.id
    from public.notification_deliveries d
    where d.channel = 'whatsapp'
      and (d.status = 'queued' or (d.status = 'held_quiet_hours' and d.send_after <= now()))
    order by coalesce(d.send_after, d.created_at), d.id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.notification_deliveries d
  set status = 'sending', claimed_at = now()
  from due, public.notifications n, public.whatsapp_notification_types w
  where d.id = due.id and n.id = d.notification_id and w.type = n.type
  returning d.id, n.id, n.type, d.phone_e164, w.template_name, w.template_language,
            array(select case p when 'title' then n.title else n.body end from unnest(w.params) with ordinality as x(p, i)
                  order by i);
end;
$$;

-- What Meta answered when the message was sent: sent (with its message id)
-- or failed (with the error). Only a message being sent changes.
create or replace function public.whatsapp_delivery_result(p_delivery_id uuid, p_status text, p_error text,
                                                           p_provider_message_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed') then
    raise exception 'invalid_status';
  end if;
  if p_status = 'sent' and p_provider_message_id is null then
    raise exception 'missing_message_id';
  end if;
  update public.notification_deliveries
  set status = p_status,
      sent_at = case when p_status = 'sent' then now() end,
      error = case when p_status = 'failed' then p_error end,
      provider_message_id = p_provider_message_id
  where id = p_delivery_id and channel = 'whatsapp' and status = 'sending';
end;
$$;

-- What Meta reported later (webhook): delivered, read or failed, and the
-- pricing category. The cost comes from whatsapp_prices for the number's
-- country, when a price is set; otherwise it stays empty. An unknown message
-- id is ignored (returns false). Statuses can arrive out of order, so a
-- read message stays read and a failure never undoes a delivery.
create or replace function public.whatsapp_status_update(p_provider_message_id text, p_status text, p_at timestamptz,
                                                         p_error text default null,
                                                         p_pricing_category text default null,
                                                         p_billable boolean default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.notification_deliveries;
  v_price integer;
begin
  if p_status is null or p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'invalid_status';
  end if;
  select * into v_row from public.notification_deliveries
  where provider_message_id = p_provider_message_id and channel = 'whatsapp'
  for update;
  if not found then
    return false;
  end if;

  if p_pricing_category is not null then
    select p.price_micros into v_price
    from public.whatsapp_prices p
    where p.category = p_pricing_category
      and v_row.phone_e164 like '+' || p.country_code || '%'
      and p.valid_from <= (coalesce(p_at, now()) at time zone 'Asia/Nicosia')::date
    order by length(p.country_code) desc, p.valid_from desc
    limit 1;
  end if;

  update public.notification_deliveries
  set delivered_at = case when p_status in ('delivered', 'read') then coalesce(delivered_at, p_at) else delivered_at end,
      read_at = case when p_status = 'read' then coalesce(read_at, p_at) else read_at end,
      status = case when p_status = 'failed' and delivered_at is null then 'failed' else status end,
      error = case when p_status = 'failed' and delivered_at is null then coalesce(p_error, 'failed') else error end,
      pricing_category = coalesce(p_pricing_category, pricing_category),
      billable = coalesce(p_billable, billable),
      cost_micros = case
                      when coalesce(p_billable, billable) is false then 0
                      when v_price is not null then v_price
                      else cost_micros
                    end
  where id = v_row.id;
  return true;
end;
$$;

-- A reply of STOP (or the Greek ΣΤΟΠ) opts the number out, whoever it
-- belongs to. Returns whether a number was opted out.
create or replace function public.whatsapp_inbound_opt_out(p_phone text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  update public.whatsapp_contacts
  set opted_out_at = now(), opted_out_by = 'reply_stop', updated_at = now()
  where phone_e164 = v_phone and opted_out_at is null;
  return found;
end;
$$;

-- The founders' running total: WhatsApp messages and their cost per month
-- (Cyprus time), by type and pricing category. Service role only.
create view public.whatsapp_costs_by_month as
select
  date_trunc('month', d.created_at at time zone 'Asia/Nicosia')::date as month,
  n.type,
  d.pricing_category,
  count(*) as messages,
  count(*) filter (where d.status in ('sent') or d.delivered_at is not null) as sent,
  count(*) filter (where d.delivered_at is not null) as delivered,
  count(*) filter (where d.read_at is not null) as read,
  count(*) filter (where d.status = 'failed') as failed,
  count(*) filter (where d.cost_micros is null and d.billable is not false and d.provider_message_id is not null)
    as not_priced,
  coalesce(sum(d.cost_micros), 0) as cost_micros
from public.notification_deliveries d
join public.notifications n on n.id = d.notification_id
where d.channel = 'whatsapp'
group by 1, 2, 3;

revoke all on public.whatsapp_costs_by_month from public, anon, authenticated;
grant select on public.whatsapp_costs_by_month to service_role;

revoke all on function public.whatsapp_enabled() from public, anon;
grant execute on function public.whatsapp_enabled() to authenticated, service_role;
revoke all on function public.set_whatsapp_number(text) from public, anon;
grant execute on function public.set_whatsapp_number(text) to authenticated, service_role;
revoke all on function public.stop_whatsapp() from public, anon;
grant execute on function public.stop_whatsapp() to authenticated, service_role;
revoke all on function public.set_notification_channel(text, text) from public, anon;
grant execute on function public.set_notification_channel(text, text) to authenticated, service_role;

revoke all on function public.send_notification(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_notification(uuid, text, jsonb) to service_role;
revoke all on function public.whatsapp_deliveries_due(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_deliveries_due(integer) to service_role;
revoke all on function public.whatsapp_delivery_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_delivery_result(uuid, text, text, text) to service_role;
revoke all on function public.whatsapp_status_update(text, text, timestamptz, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.whatsapp_status_update(text, text, timestamptz, text, text, boolean) to service_role;
revoke all on function public.whatsapp_inbound_opt_out(text) from public, anon, authenticated;
grant execute on function public.whatsapp_inbound_opt_out(text) to service_role;
