-- P4a recovery: money that a failure left half-moved is always finished
-- (docs/specs/13-payments-bookings.md, "When money is held and taken",
-- "Server-side checks": every money movement happens once).
--   1. A cancelled booking that still has money on it (a release run that
--      died part-way) is found again by run-payment-jobs until nothing is
--      left: bookings_with_money_to_release.
--   2. A failed capture backs off 1, 5, 15, 60 minutes, then hourly, and the
--      third failure raises an admin alert (admin_alerts).
--   3. A guarantee hold that got no answer from Stripe (network, Stripe
--      down) is not a failed hold: the booker isn't told, it's retried with
--      the same back-off, and Stripe is checked for a hold that went through
--      before every retry, after kickoff too, so none is ever lost.
--   4. The 15-minute payment window also checks a card the booker saved
--      with a SetupIntent at Stripe before cancelling.

-- How long until something that failed is tried again: 1, 5, 15, 60
-- minutes, then hourly. Operational timing, not a money rule.
create or replace function public.money_backoff_at(p_failures integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now() + case
    when p_failures <= 1 then interval '1 minute'
    when p_failures = 2 then interval '5 minutes'
    when p_failures = 3 then interval '15 minutes'
    else interval '60 minutes'
  end;
$$;

-- 1. Cancelled bookings (since P4a) that still have money on them: a share
-- held, taken or with an open intent, or a guarantee hold or intent. A
-- release already on the retry queue (money_releases) is the queue's job
-- and isn't picked up twice. Bookings from before P4a keep the old flow:
-- their refunds predate the ledger and are never redone.
create or replace function public.bookings_with_money_to_release()
returns table (booking_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.venue_bookings b
  where b.status = 'cancelled'
    and b.payment_mode is not null
    and (
      exists (
        select 1 from public.booking_payment_shares s
        where s.booking_id = b.id
          and (s.status in ('authorized', 'paid') or (s.status = 'pending' and s.stripe_payment_intent_id is not null))
          and not exists (select 1 from public.money_releases r
                          where r.status = 'pending' and r.stripe_intent_id = s.stripe_payment_intent_id)
      )
      or exists (
        select 1 from public.booking_guarantees g
        where g.booking_id = b.id
          and g.status <> 'cancelled'
          and (g.status = 'held' or g.stripe_payment_intent_id is not null)
          and not exists (select 1 from public.money_releases r
                          where r.status = 'pending' and r.stripe_intent_id = g.stripe_payment_intent_id)
      )
    )
  order by b.id
  limit 50;
$$;

-- An intent found already cancelled at Stripe: a run that cancelled it
-- died before recording it. If the ledger shows money held on it, the
-- release is recorded with the held amount, once (record_money_movement
-- ignores a repeat). An intent that never held money records nothing.
create or replace function public.record_intent_cancelled(
  p_booking_id uuid,
  p_share_id uuid,
  p_guarantee_id uuid,
  p_intent_id text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_held integer;
begin
  select amount_cents into v_held from public.money_ledger where kind = 'hold' and stripe_id = p_intent_id;
  if v_held is null then
    return false;
  end if;
  return public.record_money_movement(p_booking_id, p_share_id, p_guarantee_id, 'cancel', v_held, p_intent_id, p_intent_id,
                                      p_reason);
end;
$$;

-- 2. Failed captures and the founders' alerts.
alter table public.booking_payment_shares
  add column capture_attempts integer not null default 0,
  add column capture_next_attempt_at timestamptz,
  add column capture_last_error text;

-- Something the founders must look at. Read in the Supabase dashboard for
-- now; nobody else can see it.
create table public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('capture_failing')),
  booking_id uuid,
  share_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index admin_alerts_one_open_idx on public.admin_alerts (kind, share_id) where resolved_at is null;
alter table public.admin_alerts enable row level security;
revoke all on public.admin_alerts from public, anon, authenticated;
grant select on public.admin_alerts to service_role;

-- Job: held shares whose free hour is over, and whose last failed capture
-- has waited its back-off.
create or replace function public.shares_due_for_capture()
returns table (share_id uuid, booking_id uuid, stripe_payment_intent_id text, amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.booking_id, s.stripe_payment_intent_id, s.amount_cents
  from public.booking_payment_shares s
  join public.venue_bookings b on b.id = s.booking_id
  where s.status = 'authorized'
    and s.capture_method = 'manual'
    and s.capture_due_at <= now()
    and (s.capture_next_attempt_at is null or s.capture_next_attempt_at <= now())
    and s.stripe_payment_intent_id is not null
    and b.payment_mode is not null
    and b.status <> 'cancelled'
  order by s.capture_due_at;
$$;

-- Job: taking a held share failed. Tried again after the back-off; the
-- third failure raises one admin alert.
create or replace function public.share_capture_failed(p_share_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_alerted boolean := false;
begin
  update public.booking_payment_shares
  set capture_attempts = capture_attempts + 1,
      capture_last_error = p_error,
      capture_next_attempt_at = public.money_backoff_at(capture_attempts + 1)
  where id = p_share_id and status = 'authorized'
  returning * into v_share;
  if v_share.id is null then
    return jsonb_build_object('result', 'ignored');
  end if;

  if v_share.capture_attempts >= 3 then
    insert into public.admin_alerts (kind, booking_id, share_id, details)
    values ('capture_failing', v_share.booking_id, v_share.id, jsonb_build_object(
      'attempts', v_share.capture_attempts,
      'last_error', p_error,
      'stripe_payment_intent_id', v_share.stripe_payment_intent_id,
      'amount_cents', v_share.amount_cents
    ))
    on conflict (kind, share_id) where resolved_at is null do nothing;
    v_alerted := found;
  end if;
  return jsonb_build_object('result', 'failed', 'attempts', v_share.capture_attempts, 'alerted', v_alerted);
end;
$$;

-- 3. Guarantee holds Stripe didn't answer.
--   api_errors  tries since the last answer from Stripe; while above 0,
--               Stripe is checked for a hold that went through first.
alter table public.booking_guarantees
  add column api_errors integer not null default 0;

-- Job (or the webhook for one guarantee): a guarantee hold to place now
-- (a first try at hold_due_at, a retry 6 hours after a failure, never from
-- kickoff on or on a cancelled booking), or an unanswered try to look up
-- at Stripe (check_only: after kickoff or on a cancelled booking, a hold
-- found there is recorded, and released if the booking was cancelled, but
-- none is placed).
drop function public.guarantees_due_for_hold(uuid);
create function public.guarantees_due_for_hold(p_guarantee_id uuid default null)
returns table (
  guarantee_id uuid,
  booking_id uuid,
  profile_id uuid,
  amount_cents integer,
  stripe_customer_id text,
  stripe_payment_method_id text,
  attempts integer,
  api_errors integer,
  created_at timestamptz,
  check_only boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.booking_id, g.profile_id, g.amount_cents, g.stripe_customer_id, g.stripe_payment_method_id, g.attempts,
         g.api_errors, g.created_at,
         b.status = 'cancelled' or g.status = 'cancelled' or now() >= k.kickoff
  from public.booking_guarantees g
  join public.venue_bookings b on b.id = g.booking_id
  cross join lateral (select public.booking_kickoff_at(b.booking_day, b.start_time) as kickoff) k
  where g.stripe_payment_method_id is not null
    and g.stripe_customer_id is not null
    and (
      (g.status in ('scheduled', 'failed') and b.status <> 'cancelled' and now() < k.kickoff and g.next_attempt_at <= now())
      or (g.api_errors > 0 and g.status <> 'held' and coalesce(g.next_attempt_at, now()) <= now())
    )
    and (p_guarantee_id is null or g.id = p_guarantee_id)
  order by g.next_attempt_at nulls first;
$$;

-- No answer from Stripe: not a failed hold. The booker isn't told; tried
-- again after the back-off, Stripe checked first.
create or replace function public.guarantee_hold_errored(p_guarantee_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
begin
  update public.booking_guarantees
  set api_errors = api_errors + 1,
      last_error = p_error,
      next_attempt_at = public.money_backoff_at(api_errors + 1)
  where id = p_guarantee_id and status <> 'held'
  returning * into v_guarantee;
  if v_guarantee.id is null then
    return jsonb_build_object('result', 'ignored');
  end if;
  return jsonb_build_object('result', 'retry', 'api_errors', v_guarantee.api_errors);
end;
$$;

-- Stripe was checked (after kickoff, or on a cancelled booking) and holds
-- nothing for this guarantee: nothing left to look up.
create or replace function public.guarantee_hold_check_cleared(p_guarantee_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.booking_guarantees set api_errors = 0 where id = p_guarantee_id;
$$;

-- As in pay_modes_timing, and an answer from Stripe clears api_errors.
create or replace function public.guarantee_hold_placed(p_guarantee_id uuid, p_intent_id text, p_amount_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
  v_booking_status text;
  v_release jsonb;
begin
  select * into v_guarantee from public.booking_guarantees where id = p_guarantee_id for update;
  if v_guarantee.id is null then
    raise exception 'guarantee_not_found';
  end if;
  if v_guarantee.status = 'held' and v_guarantee.stripe_payment_intent_id = p_intent_id then
    return jsonb_build_object('result', 'duplicate');
  end if;
  update public.booking_guarantees set api_errors = 0 where id = p_guarantee_id;
  perform public.record_money_movement(v_guarantee.booking_id, null, v_guarantee.id, 'hold', p_amount_cents, p_intent_id,
                                       p_intent_id, 'guarantee_held');
  v_release := jsonb_build_object('result', 'release', 'booking_id', v_guarantee.booking_id, 'guarantee_id', v_guarantee.id);
  select status into v_booking_status from public.venue_bookings where id = v_guarantee.booking_id;
  if v_booking_status = 'cancelled' or v_guarantee.status = 'cancelled' then
    return v_release || jsonb_build_object('reason', 'booking_cancelled');
  end if;
  if v_guarantee.status not in ('scheduled', 'failed') then
    return v_release || jsonb_build_object('reason', 'already_held');
  end if;
  if p_amount_cents is distinct from v_guarantee.amount_cents then
    return v_release || jsonb_build_object('reason', 'amount_mismatch');
  end if;
  update public.booking_guarantees
  set status = 'held', held_at = now(), stripe_payment_intent_id = p_intent_id, attempts = attempts + 1,
      next_attempt_at = null, last_error = null
  where id = p_guarantee_id;
  return jsonb_build_object('result', 'held');
end;
$$;

-- As in pay_modes_timing (a card problem: retried in 6 hours, the booker
-- told once), and an answer from Stripe clears api_errors.
create or replace function public.guarantee_hold_failed(
  p_guarantee_id uuid,
  p_intent_id text,
  p_error text,
  p_needs_action boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
  v_notify boolean;
begin
  select * into v_guarantee from public.booking_guarantees where id = p_guarantee_id for update;
  if v_guarantee.status not in ('scheduled', 'failed') then
    return jsonb_build_object('result', 'ignored');
  end if;
  v_notify := v_guarantee.failure_notified_at is null;

  update public.booking_guarantees
  set status = 'failed',
      attempts = attempts + 1,
      api_errors = 0,
      last_error = p_error,
      stripe_payment_intent_id = coalesce(p_intent_id, stripe_payment_intent_id),
      next_attempt_at = public.money_guarantee_retry_at(now()),
      failure_notified_at = coalesce(failure_notified_at, now())
  where id = p_guarantee_id
  returning * into v_guarantee;

  if v_notify then
    perform public.send_notification(v_guarantee.profile_id, 'guarantee_hold_failed', jsonb_build_object(
      'title', case when p_needs_action then 'Confirm your card' else 'Update your card' end,
      'body', case when p_needs_action
                then 'Your bank needs you to confirm your card for your booking''s guarantee. Your booking stays on. '
                     || 'Open the booking to confirm it.'
                else 'We couldn''t hold your card as the guarantee for your booking. Your booking stays on. '
                     || 'Update your card and we''ll try again.'
              end,
      'bookingId', v_guarantee.booking_id,
      'needsAction', coalesce(p_needs_action, false)
    ));
  end if;

  return jsonb_build_object('result', 'failed', 'attempts', v_guarantee.attempts, 'notified', v_notify);
end;
$$;

-- 4. Job: bookings whose booker hasn't completed payment within 15 minutes,
-- with whatever the booker started: a PaymentIntent, or a SetupIntent
-- saving their card (nothing to charge). The job checks it at Stripe first;
-- a payment or saved card is judged by Stripe's event time.
drop function public.bookings_past_payment_window();
create function public.bookings_past_payment_window()
returns table (
  booking_id uuid,
  booker_share_id uuid,
  booker_intent_id text,
  booker_setup_intent_id text,
  booked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, s.id, s.stripe_payment_intent_id, s.stripe_setup_intent_id, b.created_at
  from public.venue_bookings b
  left join public.booking_payment_shares s on s.booking_id = b.id and s.is_booker
  where b.status = 'pending_payment'
    and b.payment_mode is not null
    and now() > public.money_payment_window_ends_at(b.created_at)
  order by b.created_at;
$$;

revoke all on function public.money_backoff_at(integer) from public, anon, authenticated;
grant execute on function public.money_backoff_at(integer) to service_role;
revoke all on function public.bookings_with_money_to_release() from public, anon, authenticated;
grant execute on function public.bookings_with_money_to_release() to service_role;
revoke all on function public.record_intent_cancelled(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_intent_cancelled(uuid, uuid, uuid, text, text) to service_role;
revoke all on function public.shares_due_for_capture() from public, anon, authenticated;
grant execute on function public.shares_due_for_capture() to service_role;
revoke all on function public.share_capture_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.share_capture_failed(uuid, text) to service_role;
revoke all on function public.guarantees_due_for_hold(uuid) from public, anon, authenticated;
grant execute on function public.guarantees_due_for_hold(uuid) to service_role;
revoke all on function public.guarantee_hold_errored(uuid, text) from public, anon, authenticated;
grant execute on function public.guarantee_hold_errored(uuid, text) to service_role;
revoke all on function public.guarantee_hold_check_cleared(uuid) from public, anon, authenticated;
grant execute on function public.guarantee_hold_check_cleared(uuid) to service_role;
revoke all on function public.guarantee_hold_placed(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.guarantee_hold_placed(uuid, text, integer) to service_role;
revoke all on function public.guarantee_hold_failed(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.guarantee_hold_failed(uuid, text, text, boolean) to service_role;
revoke all on function public.bookings_past_payment_window() from public, anon, authenticated;
grant execute on function public.bookings_past_payment_window() to service_role;
