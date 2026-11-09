-- P4a: when money is held and taken (docs/specs/13-payments-bookings.md).
-- The state changes Stripe reports (through the verified webhook) and the
-- scheduled job (run-payment-jobs) make. All service_role only; each one
-- writes its money movement to money_ledger, once.

-- Internal: the booker's card is saved; the guarantee is scheduled for
-- hold_due_at. Returns the guarantee and whether it's due now.
create or replace function public.guarantee_card_saved(p_booking_id uuid, p_profile_id uuid, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
begin
  if p_payment_method_id is null then
    return jsonb_build_object('guarantee_id', null, 'guarantee_due', false);
  end if;
  update public.booking_guarantees g
  set stripe_payment_method_id = p_payment_method_id,
      stripe_customer_id = (select stripe_customer_id from public.profiles where id = p_profile_id),
      status = 'scheduled',
      next_attempt_at = g.hold_due_at
  where g.booking_id = p_booking_id and g.profile_id = p_profile_id and g.status = 'awaiting_card'
  returning * into v_guarantee;
  return jsonb_build_object('guarantee_id', v_guarantee.id, 'guarantee_due', coalesce(v_guarantee.hold_due_at <= now(), false));
end;
$$;

-- Internal: the booker has paid (or settled) their share. The pitch is
-- theirs, and in responsible mode their card is saved for the guarantee.
create or replace function public.booker_share_settled(p_share public.booking_payment_shares, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not p_share.is_booker then
    return jsonb_build_object('guarantee_id', null, 'guarantee_due', false);
  end if;
  update public.venue_bookings set status = 'confirmed' where id = p_share.booking_id and status = 'pending_payment';
  return public.guarantee_card_saved(p_share.booking_id, p_share.profile_id, p_payment_method_id);
end;
$$;

-- Webhook, payment_intent.amount_capturable_updated: the card is held. The
-- share is taken 60 minutes from now. 'legacy' / 'unknown' tell the webhook
-- to fall back to the old handling.
create or replace function public.share_payment_held(p_intent_id text, p_amount_cents integer, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_mode text;
begin
  select * into v_share from public.booking_payment_shares where stripe_payment_intent_id = p_intent_id for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  select payment_mode into v_mode from public.venue_bookings where id = v_share.booking_id;
  if v_mode is null then
    return jsonb_build_object('result', 'legacy');
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    raise exception 'amount_mismatch';
  end if;
  if v_share.status <> 'pending' then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;

  update public.booking_payment_shares
  set status = 'authorized', held_at = now(), capture_due_at = public.money_capture_due_at(now())
  where id = v_share.id
  returning * into v_share;
  perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', v_share.amount_cents, p_intent_id, 'share_held');

  return jsonb_build_object('result', 'held', 'share_id', v_share.id, 'booking_id', v_share.booking_id)
         || public.booker_share_settled(v_share, p_payment_method_id);
end;
$$;

-- Webhook, payment_intent.succeeded: the money was taken. For a share paid
-- less than 6 hours before kickoff that's straight away; for a held share
-- it's the job's capture (which also records it, so this is then a no-op).
create or replace function public.share_payment_captured(p_intent_id text, p_amount_cents integer, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_mode text;
  v_was text;
begin
  select * into v_share from public.booking_payment_shares where stripe_payment_intent_id = p_intent_id for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  select payment_mode into v_mode from public.venue_bookings where id = v_share.booking_id;
  if v_mode is null then
    return jsonb_build_object('result', 'legacy');
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    raise exception 'amount_mismatch';
  end if;
  if v_share.status not in ('pending', 'authorized') then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;

  v_was := v_share.status;
  update public.booking_payment_shares set status = 'paid', paid_at = now() where id = v_share.id
  returning * into v_share;
  perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'capture', v_share.amount_cents, p_intent_id,
    case when v_was = 'pending' then 'share_taken_at_once' else 'share_taken' end);

  return jsonb_build_object('result', 'captured', 'share_id', v_share.id, 'booking_id', v_share.booking_id)
         || case when v_was = 'pending' then public.booker_share_settled(v_share, p_payment_method_id)
                 else jsonb_build_object('guarantee_id', null, 'guarantee_due', false) end;
end;
$$;

-- Webhook, setup_intent.succeeded for a share with nothing to pay by card
-- (a Premium responsible booker paying cash): the card is saved, the share
-- is settled and the guarantee scheduled.
create or replace function public.share_card_saved(p_share_id uuid, p_setup_intent_id text, p_payment_method_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
begin
  update public.booking_payment_shares
  set status = 'paid', paid_at = now()
  where id = p_share_id and status = 'pending' and amount_cents = 0
  returning * into v_share;
  if v_share.id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  return jsonb_build_object('result', 'saved', 'share_id', v_share.id, 'setup_intent_id', p_setup_intent_id)
         || public.booker_share_settled(v_share, p_payment_method_id);
end;
$$;

-- Job: held shares whose 60 minutes are up.
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
    and s.stripe_payment_intent_id is not null
    and b.payment_mode is not null
    and b.status <> 'cancelled'
  order by s.capture_due_at;
$$;

-- Job: Stripe captured a held share.
create or replace function public.share_captured(p_share_id uuid, p_amount_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
begin
  update public.booking_payment_shares
  set status = 'paid', paid_at = now()
  where id = p_share_id and status = 'authorized'
  returning * into v_share;
  if v_share.id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    raise exception 'amount_mismatch';
  end if;
  perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'capture', v_share.amount_cents,
                                       v_share.stripe_payment_intent_id, 'share_taken');
  return jsonb_build_object('result', 'captured', 'share_id', v_share.id);
end;
$$;

-- Job (or the webhook for one guarantee): guarantee holds to place now, a
-- first try at hold_due_at, a retry 6 hours after each failure. A
-- cancelled booking's guarantee is never placed.
create or replace function public.guarantees_due_for_hold(p_guarantee_id uuid default null)
returns table (
  guarantee_id uuid,
  booking_id uuid,
  profile_id uuid,
  amount_cents integer,
  stripe_customer_id text,
  stripe_payment_method_id text,
  attempts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.booking_id, g.profile_id, g.amount_cents, g.stripe_customer_id, g.stripe_payment_method_id, g.attempts
  from public.booking_guarantees g
  join public.venue_bookings b on b.id = g.booking_id
  where g.status in ('scheduled', 'failed')
    and g.next_attempt_at <= now()
    and g.stripe_payment_method_id is not null
    and g.stripe_customer_id is not null
    and b.status <> 'cancelled'
    and (p_guarantee_id is null or g.id = p_guarantee_id)
  order by g.next_attempt_at;
$$;

create or replace function public.guarantee_hold_placed(p_guarantee_id uuid, p_intent_id text, p_amount_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantee public.booking_guarantees;
begin
  select * into v_guarantee from public.booking_guarantees where id = p_guarantee_id for update;
  if p_amount_cents is distinct from v_guarantee.amount_cents then
    raise exception 'amount_mismatch';
  end if;
  if v_guarantee.status = 'held' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  update public.booking_guarantees
  set status = 'held', held_at = now(), stripe_payment_intent_id = p_intent_id, attempts = attempts + 1,
      next_attempt_at = null, last_error = null
  where id = p_guarantee_id;
  perform public.record_money_movement(v_guarantee.booking_id, null, v_guarantee.id, 'hold', p_amount_cents, p_intent_id,
                                       'guarantee_held');
  return jsonb_build_object('result', 'held');
end;
$$;

-- A failed hold: retried in 6 hours. The booker is told on the first
-- failure only (decided 9 November). The booking is never touched.
create or replace function public.guarantee_hold_failed(p_guarantee_id uuid, p_intent_id text, p_error text)
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
      last_error = p_error,
      stripe_payment_intent_id = coalesce(p_intent_id, stripe_payment_intent_id),
      next_attempt_at = public.money_guarantee_retry_at(now()),
      failure_notified_at = coalesce(failure_notified_at, now())
  where id = p_guarantee_id
  returning * into v_guarantee;

  if v_notify then
    perform public.send_notification(v_guarantee.profile_id, 'guarantee_hold_failed', jsonb_build_object(
      'title', 'Update your card',
      'body', 'We couldn''t hold your card as the guarantee for your booking. Your booking stays on. '
              || 'Update your card and we''ll try again.',
      'bookingId', v_guarantee.booking_id
    ));
  end if;

  return jsonb_build_object('result', 'failed', 'attempts', v_guarantee.attempts, 'notified', v_notify);
end;
$$;

-- cancel-booking: every bit of money on a cancelled booking still to
-- release or refund. 'booking' = a booking from before split payments,
-- paid as one intent.
create or replace function public.booking_money_to_release(p_booking_id uuid)
returns table (kind text, id uuid, status text, stripe_payment_intent_id text, amount_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select 'share', s.id, s.status, s.stripe_payment_intent_id, s.amount_cents
  from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.status in ('pending', 'authorized', 'paid')
  union all
  select 'guarantee', g.id, g.status, g.stripe_payment_intent_id, g.amount_cents
  from public.booking_guarantees g
  where g.booking_id = p_booking_id and g.status <> 'cancelled'
  union all
  select 'booking', b.id, b.status, b.stripe_payment_intent_id, b.amount_cents
  from public.venue_bookings b
  where b.id = p_booking_id and b.stripe_payment_intent_id is not null and b.amount_cents > 0
    and not exists (select 1 from public.booking_payment_shares s where s.booking_id = b.id);
$$;

create or replace function public.share_released(p_share_id uuid, p_new_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_new_status not in ('cancelled', 'refunded') then
    raise exception 'invalid_status';
  end if;
  update public.booking_payment_shares
  set status = p_new_status
  where id = p_share_id and status in ('pending', 'authorized', 'paid');
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.guarantee_released(p_guarantee_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.booking_guarantees
  set status = 'cancelled', next_attempt_at = null
  where id = p_guarantee_id and status <> 'cancelled';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.guarantee_card_saved(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.guarantee_card_saved(uuid, uuid, text) to service_role;
revoke all on function public.booker_share_settled(public.booking_payment_shares, text) from public, anon, authenticated;
grant execute on function public.booker_share_settled(public.booking_payment_shares, text) to service_role;
revoke all on function public.share_payment_held(text, integer, text) from public, anon, authenticated;
grant execute on function public.share_payment_held(text, integer, text) to service_role;
revoke all on function public.share_payment_captured(text, integer, text) from public, anon, authenticated;
grant execute on function public.share_payment_captured(text, integer, text) to service_role;
revoke all on function public.share_card_saved(uuid, text, text) from public, anon, authenticated;
grant execute on function public.share_card_saved(uuid, text, text) to service_role;
revoke all on function public.shares_due_for_capture() from public, anon, authenticated;
grant execute on function public.shares_due_for_capture() to service_role;
revoke all on function public.share_captured(uuid, integer) from public, anon, authenticated;
grant execute on function public.share_captured(uuid, integer) to service_role;
revoke all on function public.guarantees_due_for_hold(uuid) from public, anon, authenticated;
grant execute on function public.guarantees_due_for_hold(uuid) to service_role;
revoke all on function public.guarantee_hold_placed(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.guarantee_hold_placed(uuid, text, integer) to service_role;
revoke all on function public.guarantee_hold_failed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.guarantee_hold_failed(uuid, text, text) to service_role;
revoke all on function public.booking_money_to_release(uuid) from public, anon, authenticated;
grant execute on function public.booking_money_to_release(uuid) to service_role;
revoke all on function public.share_released(uuid, text) from public, anon, authenticated;
grant execute on function public.share_released(uuid, text) to service_role;
revoke all on function public.guarantee_released(uuid) from public, anon, authenticated;
grant execute on function public.guarantee_released(uuid) to service_role;
