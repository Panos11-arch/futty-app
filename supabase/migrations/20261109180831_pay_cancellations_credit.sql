-- P4b: venue credit (docs/specs/13-payments-bookings.md, "Venue credit",
-- "Prices and fees"). Credit is spent only at the venue that issued it and
-- never cashed out. It pays the pitch part of a share with no service fee;
-- a shortfall is paid by card plus the normal fee. It expires 12 months
-- after it's issued.
--
-- Credit for a share is reserved when its payment starts
-- (attach_share_intent / attach_share_setup), spent when the share's money
-- is secured (held, taken, or the card saved), and returned when the share
-- is released (cancelled or refunded). Triggers on the share's status do the
-- last two, so every path (webhooks, jobs, cancellations) keeps credit right.

-- Paying a share's pitch part with credit: as much credit as covers it; no
-- service fee when credit covers it all; otherwise the rest by card plus
-- the share's normal fee (p_fee_cents: 80, or 0 for a Premium player; for
-- the booker paying for everyone, 55 per player, their own spot free if
-- they're Premium).
create or replace function public.money_credit_payment(
  p_pitch_cents integer,
  p_fee_cents integer,
  p_credit_available_cents integer,
  out credit_cents integer,
  out fee_cents integer,
  out card_cents integer
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_pitch_cents is null or p_pitch_cents < 0 or p_fee_cents is null or p_fee_cents < 0
     or p_credit_available_cents is null or p_credit_available_cents < 0 then
    raise exception 'invalid_money_input';
  end if;
  credit_cents := least(p_pitch_cents, p_credit_available_cents);
  if credit_cents = p_pitch_cents then
    fee_cents := 0;
    card_cents := 0;
  else
    fee_cents := p_fee_cents;
    card_cents := p_pitch_cents - credit_cents + p_fee_cents;
  end if;
end;
$$;

-- Credit a player can spend at a venue now: not expired, not reserved.
create or replace function public.venue_credit_available_cents(p_profile_id uuid, p_venue_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(remaining_cents), 0)::integer
  from public.venue_credits
  where profile_id = p_profile_id and venue_id = p_venue_id and expires_at > now() and remaining_cents > 0;
$$;

-- Issues credit from a cancelled share and writes the movement: p_amount
-- becomes credit, the venue's part changes by p_venue_cents and Futty's by
-- p_futty_cents (they add up to -p_amount). Expires 12 months after it's
-- issued. A share gets credit from one source once: a repeat returns the
-- credit already issued.
create or replace function public.issue_venue_credit(
  p_profile_id uuid,
  p_venue_id uuid,
  p_amount_cents integer,
  p_source text,
  p_booking_id uuid,
  p_share_id uuid,
  p_venue_cents integer,
  p_futty_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
begin
  if p_amount_cents is null or p_amount_cents < 1 then
    raise exception 'invalid_credit_amount';
  end if;
  select id into v_id from public.venue_credits where source_share_id = p_share_id and source = p_source;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.venue_credits (profile_id, venue_id, amount_cents, remaining_cents, source, source_booking_id,
                                    source_share_id, issued_at, expires_at)
  values (p_profile_id, p_venue_id, p_amount_cents, p_amount_cents, p_source, p_booking_id, p_share_id,
          v_now, v_now + interval '12 months')
  returning id into v_id;
  perform public.record_ledger_entry(p_booking_id, p_share_id, v_id, 'credit_issued', p_amount_cents,
    'credit-issued-' || v_id, p_source, p_venue_cents, p_futty_cents, p_amount_cents);
  return v_id;
end;
$$;

-- Returns the credit set aside for (or spent on) a share to the credit it
-- came from, keeping that credit's expiry. Spent credit goes back from the
-- venue to the player, in the ledger.
create or replace function public.return_share_credit(p_share_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spend public.venue_credit_spends;
  v_returned integer := 0;
begin
  for v_spend in
    select * from public.venue_credit_spends where share_id = p_share_id and status in ('reserved', 'spent') for update
  loop
    update public.venue_credits set remaining_cents = remaining_cents + v_spend.amount_cents where id = v_spend.credit_id;
    update public.venue_credit_spends set status = 'returned', returned_at = now() where id = v_spend.id;
    if v_spend.status = 'spent' then
      perform public.record_ledger_entry(v_spend.booking_id, p_share_id, v_spend.credit_id, 'credit_returned',
        v_spend.amount_cents, 'credit-returned-' || v_spend.id, p_reason, -v_spend.amount_cents, 0, v_spend.amount_cents);
    end if;
    v_returned := v_returned + v_spend.amount_cents;
  end loop;
  return v_returned;
end;
$$;

-- Sets aside p_amount of the player's credit at the share's venue for this
-- share (soonest-expiring first), replacing whatever was set aside before.
-- Refused (credit_changed) if there isn't that much any more.
create or replace function public.reserve_share_credit(p_share_id uuid, p_amount_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_venue uuid;
  v_left integer := p_amount_cents;
  v_credit public.venue_credits;
  v_take integer;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id;
  select venue_id into v_venue from public.venue_bookings where id = v_share.booking_id;
  perform public.return_share_credit(p_share_id, 'payment_replaced');
  for v_credit in
    select * from public.venue_credits
    where profile_id = v_share.profile_id and venue_id = v_venue and expires_at > now() and remaining_cents > 0
    order by expires_at, issued_at, id
    for update
  loop
    exit when v_left = 0;
    v_take := least(v_left, v_credit.remaining_cents);
    update public.venue_credits set remaining_cents = remaining_cents - v_take where id = v_credit.id;
    insert into public.venue_credit_spends (credit_id, share_id, booking_id, amount_cents)
    values (v_credit.id, p_share_id, v_share.booking_id, v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'credit_changed';
  end if;
end;
$$;

-- The share's money is secured: the credit set aside is spent, from the
-- player's credit to the venue.
create or replace function public.spend_share_credit(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spend public.venue_credit_spends;
begin
  for v_spend in
    select * from public.venue_credit_spends where share_id = p_share_id and status = 'reserved' for update
  loop
    update public.venue_credit_spends set status = 'spent', spent_at = now() where id = v_spend.id;
    perform public.record_ledger_entry(v_spend.booking_id, p_share_id, v_spend.credit_id, 'credit_spent',
      v_spend.amount_cents, 'credit-spent-' || v_spend.id, 'share_paid_with_credit', v_spend.amount_cents, 0,
      -v_spend.amount_cents);
  end loop;
end;
$$;

create or replace function public.share_credit_follows_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status in ('authorized', 'paid') then
    perform public.spend_share_credit(new.id);
  elsif new.status in ('cancelled', 'refunded') and old.status not in ('cancelled', 'refunded') then
    perform public.return_share_credit(new.id, 'share_' || new.status);
  end if;
  return new;
end;
$$;

create trigger booking_payment_shares_credit
  after update of status on public.booking_payment_shares
  for each row when (old.status is distinct from new.status)
  execute function public.share_credit_follows_status();

-- Daily job (run-payment-jobs): credit past its expiry is expired, and what
-- was left stays with the venue, in the ledger. Returns how many expired.
-- Credit returned to an expired credit later is expired again next run.
create or replace function public.expire_venue_credits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credit public.venue_credits;
  v_count integer := 0;
  v_n integer;
begin
  for v_credit in
    select * from public.venue_credits where expires_at <= now() and remaining_cents > 0 for update skip locked
  loop
    select count(*) + 1 into v_n from public.money_ledger where credit_id = v_credit.id and kind = 'credit_expired';
    perform public.record_ledger_entry(v_credit.source_booking_id, v_credit.source_share_id, v_credit.id,
      'credit_expired', v_credit.remaining_cents, format('credit-expired-%s-%s', v_credit.id, v_n), 'credit_expired',
      v_credit.remaining_cents, 0, -v_credit.remaining_cents);
    update public.venue_credits set remaining_cents = 0, expired_at = now() where id = v_credit.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- What paying this share now would be (P4a), and, when the player asks
-- (p_use_credit), with their credit at the venue: card payments only. The
-- booker paying for everyone can pay the whole pitch price with credit
-- (decided 10 November): no fee when credit covers it all, otherwise the
-- rest by card plus the normal 55 per player. Credit that covers the whole
-- pitch part leaves nothing to charge, so the card is saved with a
-- SetupIntent (needs_saved_card), as for the each-pays booker.
drop function public.attach_share_setup(uuid, uuid, text, text, text);
drop function public.attach_share_intent(uuid, uuid, text, boolean, text, integer, text, text);
drop function public.plan_share_payment(uuid, uuid, text, boolean);
drop function public.share_payment_plan(public.booking_payment_shares, uuid, text, boolean);

create function public.share_payment_plan(
  p_share public.booking_payment_shares,
  p_profile_id uuid,
  p_method text,
  p_accept_non_refundable boolean,
  p_use_credit boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_amounts record;
  v_paid record;
  v_available integer;
  v_credit integer := 0;
  v_fee integer;
  v_card integer;
  v_non_refundable boolean := false;
  v_needs_card boolean := false;
  v_customer text;
begin
  if p_share.id is null then
    raise exception 'share_not_found';
  end if;
  if p_share.profile_id is distinct from p_profile_id then
    raise exception 'not_your_share';
  end if;
  if p_share.status <> 'pending' then
    raise exception 'share_not_pending';
  end if;
  select * into v_booking from public.venue_bookings where id = p_share.booking_id;
  if v_booking.status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;
  select stripe_customer_id into v_customer from public.profiles where id = p_profile_id;

  if v_booking.payment_mode is null then
    if coalesce(p_use_credit, false) then
      raise exception 'credit_not_allowed_legacy';
    end if;
    return jsonb_build_object(
      'share_id', p_share.id, 'booking_id', p_share.booking_id, 'is_booker', p_share.is_booker,
      'payment_mode', null, 'status', p_share.status, 'payment_method', p_share.payment_method,
      'amount_cents', p_share.amount_cents, 'stripe_payment_intent_id', p_share.stripe_payment_intent_id,
      'stripe_customer_id', v_customer, 'needs_saved_card', false, 'credit_cents', 0);
  end if;

  if p_share.is_booker and v_booking.status = 'pending_payment'
     and now() > public.money_payment_window_ends_at(v_booking.created_at) then
    raise exception 'payment_window_closed';
  end if;

  select * into v_amounts from public.money_share(
    v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, p_share.is_booker,
    exists (select 1 from public.profiles where id = p_profile_id and is_premium), p_method);
  v_fee := v_amounts.fee_cents;
  v_card := v_amounts.card_cents;

  if coalesce(p_use_credit, false) then
    if p_method <> 'card' then
      raise exception 'credit_needs_card';
    end if;
    -- What's free at this venue, plus what this share already set aside.
    v_available := public.venue_credit_available_cents(p_profile_id, v_booking.venue_id)
      + coalesce((select sum(sp.amount_cents) from public.venue_credit_spends sp
                  join public.venue_credits c on c.id = sp.credit_id
                  where sp.share_id = p_share.id and sp.status = 'reserved' and c.expires_at > now()), 0);
    if v_available <= 0 then
      raise exception 'no_credit_at_venue';
    end if;
    select * into v_paid from public.money_credit_payment(v_amounts.pitch_cents, v_amounts.fee_cents, v_available);
    v_credit := v_paid.credit_cents;
    v_fee := v_paid.fee_cents;
    v_card := v_paid.card_cents;
  end if;

  v_non_refundable := public.money_is_non_refundable(now(), public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time));
  if v_non_refundable and not coalesce(p_accept_non_refundable, false) then
    raise exception 'non_refundable_not_accepted';
  end if;

  if v_card = 0 then
    -- TODO(P4c): a Premium cash player who isn't the booker saves a card
    -- the same way. Until then they are refused.
    if not ((p_share.is_booker and v_booking.payment_mode in ('each_pays_responsible', 'each_pays_own_spot'))
            or v_credit > 0) then
      raise exception 'saved_card_required';
    end if;
    v_needs_card := true;
  end if;

  return jsonb_build_object(
    'share_id', p_share.id,
    'booking_id', p_share.booking_id,
    'is_booker', p_share.is_booker,
    'payment_mode', v_booking.payment_mode,
    'status', p_share.status,
    'payment_method', p_method,
    'amount_cents', v_card,
    'pitch_cents', v_amounts.pitch_cents,
    'fee_cents', v_fee,
    'cash_cents', v_amounts.cash_cents,
    'credit_cents', v_credit,
    'capture_method', case when v_non_refundable then 'immediate' else 'manual' end,
    'non_refundable', v_non_refundable,
    'stripe_payment_intent_id', p_share.stripe_payment_intent_id,
    'stripe_customer_id', v_customer,
    'needs_saved_card', v_needs_card
  );
end;
$$;

create function public.plan_share_payment(
  p_share_id uuid,
  p_profile_id uuid,
  p_method text,
  p_accept_non_refundable boolean,
  p_use_credit boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.share_payment_plan(s, p_profile_id, p_method, p_accept_non_refundable, p_use_credit)
  from (select 1) one
  left join public.booking_payment_shares s on s.id = p_share_id;
$$;

-- As in P4a, and the credit the plan uses is set aside for the share in
-- the same write.
create function public.attach_share_intent(
  p_share_id uuid,
  p_profile_id uuid,
  p_method text,
  p_accept_non_refundable boolean,
  p_intent_id text,
  p_intent_amount_cents integer,
  p_intent_capture_method text,
  p_expected_intent_id text,
  p_use_credit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_plan jsonb;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  v_plan := public.share_payment_plan(v_share, p_profile_id, p_method, p_accept_non_refundable, p_use_credit);
  if v_plan ->> 'payment_mode' is null then
    raise exception 'legacy_booking';
  end if;
  if v_share.stripe_payment_intent_id is distinct from p_expected_intent_id
     or (v_plan ->> 'needs_saved_card')::boolean
     or (v_plan ->> 'amount_cents')::integer is distinct from p_intent_amount_cents
     or v_plan ->> 'capture_method' is distinct from p_intent_capture_method then
    raise exception 'share_changed';
  end if;

  perform public.reserve_share_credit(p_share_id, (v_plan ->> 'credit_cents')::integer);
  update public.booking_payment_shares
  set stripe_payment_intent_id = p_intent_id,
      stripe_setup_intent_id = null,
      payment_method = p_method,
      pitch_cents = (v_plan ->> 'pitch_cents')::integer,
      fee_cents = (v_plan ->> 'fee_cents')::integer,
      cash_cents = (v_plan ->> 'cash_cents')::integer,
      credit_cents = (v_plan ->> 'credit_cents')::integer,
      amount_cents = (v_plan ->> 'amount_cents')::integer,
      capture_method = v_plan ->> 'capture_method',
      non_refundable_accepted_at = case when coalesce(p_accept_non_refundable, false) then now() end
  where id = p_share_id;

  return v_plan || jsonb_build_object('stripe_payment_intent_id', p_intent_id);
end;
$$;

-- As in P4a, for a share with nothing to charge by card: a Premium cash
-- booker, or a share whose pitch part credit covers in full.
create function public.attach_share_setup(
  p_share_id uuid,
  p_profile_id uuid,
  p_method text,
  p_setup_intent_id text,
  p_expected_intent_id text,
  p_use_credit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_plan jsonb;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  v_plan := public.share_payment_plan(v_share, p_profile_id, p_method, true, p_use_credit);
  if not coalesce((v_plan ->> 'needs_saved_card')::boolean, false)
     or v_share.stripe_payment_intent_id is distinct from p_expected_intent_id then
    raise exception 'share_changed';
  end if;

  perform public.reserve_share_credit(p_share_id, (v_plan ->> 'credit_cents')::integer);
  update public.booking_payment_shares
  set stripe_payment_intent_id = null,
      stripe_setup_intent_id = p_setup_intent_id,
      payment_method = p_method,
      pitch_cents = (v_plan ->> 'pitch_cents')::integer,
      fee_cents = (v_plan ->> 'fee_cents')::integer,
      cash_cents = (v_plan ->> 'cash_cents')::integer,
      credit_cents = (v_plan ->> 'credit_cents')::integer,
      amount_cents = 0,
      capture_method = null
  where id = p_share_id;

  return v_plan;
end;
$$;

revoke all on function public.money_credit_payment(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.money_credit_payment(integer, integer, integer) to service_role;
revoke all on function public.venue_credit_available_cents(uuid, uuid) from public, anon, authenticated;
grant execute on function public.venue_credit_available_cents(uuid, uuid) to service_role;
revoke all on function public.issue_venue_credit(uuid, uuid, integer, text, uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.issue_venue_credit(uuid, uuid, integer, text, uuid, uuid, integer, integer) to service_role;
revoke all on function public.return_share_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.return_share_credit(uuid, text) to service_role;
revoke all on function public.reserve_share_credit(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_share_credit(uuid, integer) to service_role;
revoke all on function public.spend_share_credit(uuid) from public, anon, authenticated;
grant execute on function public.spend_share_credit(uuid) to service_role;
revoke all on function public.share_credit_follows_status() from public, anon, authenticated;
revoke all on function public.expire_venue_credits() from public, anon, authenticated;
grant execute on function public.expire_venue_credits() to service_role;
revoke all on function public.share_payment_plan(public.booking_payment_shares, uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.share_payment_plan(public.booking_payment_shares, uuid, text, boolean, boolean) to service_role;
revoke all on function public.plan_share_payment(uuid, uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.plan_share_payment(uuid, uuid, text, boolean, boolean) to service_role;
revoke all on function public.attach_share_intent(uuid, uuid, text, boolean, text, integer, text, text, boolean) from public, anon, authenticated;
grant execute on function public.attach_share_intent(uuid, uuid, text, boolean, text, integer, text, text, boolean) to service_role;
revoke all on function public.attach_share_setup(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.attach_share_setup(uuid, uuid, text, text, text, boolean) to service_role;
