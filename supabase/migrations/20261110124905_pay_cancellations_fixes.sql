-- P4b review fixes and the 10 November decisions Q1-Q3
-- (docs/specs/13-payments-bookings.md, "Cancellations and refunds" and
-- "Venue credit"):
--   Q3  credit money stays with the venue: issuing, spending, returning and
--       expiring credit are records of what the venue holds for a player and
--       move no money. Only real money moves between the venue and Futty
--       (kind 'transfer'): the €1 Futty keeps from the venue's part, or
--       Futty's fee becoming credit. money_balance is venue + Futty + Stripe
--       + refunds = taken again; credit is reported beside it.
--   Q2  credit that paid for a share keeps its original expiry when it comes
--       back, in every case; only the card-paid part becomes new 12-month
--       credit. The €1 kept in the middle window comes from the card-paid
--       part first.
--   Q1  when the venue cancels, a player who earlier cancelled late (and so
--       forfeited their share) gets it back too: refund or credit, their
--       choice within 48 hours, and the venue owes Stripe's fee. Futty's €1
--       from a middle-window cancellation stays with Futty.
--   and: a held payment the release job cancelled gives its credit back;
--   the 48-hour refund is claimed in the database before Stripe is called;
--   a kept share whose card part is never taken still gives back the credit
--   above the €1; a share paid fully with credit is judged non-refundable
--   when its card is saved; the cancellation read policy names its table.

-- ---------------------------------------------------------------------------
-- Q3: the ledger.
alter table public.money_ledger drop constraint money_ledger_kind_check;
alter table public.money_ledger add constraint money_ledger_kind_check check (kind in (
  'hold', 'capture', 'cancel', 'refund', 'credit_issued', 'credit_returned', 'credit_spent', 'credit_expired',
  'venue_payable', 'transfer'));

-- credit_* rows are records only: credit_cents moves, money doesn't.
-- venue_payable and transfer move money between the venue and Futty.
alter table public.money_ledger drop constraint money_ledger_split_check;
alter table public.money_ledger add constraint money_ledger_split_check check (
  (kind in ('hold', 'cancel') and stripe_intent_id is not null and stripe_id = stripe_intent_id and ref is null
     and venue_cents = 0 and futty_cents = 0 and stripe_fee_cents = 0 and credit_cents = 0)
  or (kind = 'capture' and stripe_intent_id is not null and stripe_id = stripe_intent_id and ref is null
     and venue_cents >= 0 and stripe_fee_cents >= 0 and credit_cents = 0
     and venue_cents + futty_cents + stripe_fee_cents = amount_cents)
  or (kind = 'refund' and stripe_intent_id is not null and stripe_id is not null and ref is null
     and venue_cents <= 0 and stripe_fee_cents = 0 and credit_cents = 0 and venue_cents + futty_cents = -amount_cents)
  or (kind in ('credit_issued', 'credit_returned') and ref is not null and stripe_id is null
     and credit_cents = amount_cents and venue_cents = 0 and futty_cents = 0 and stripe_fee_cents = 0)
  or (kind in ('credit_spent', 'credit_expired') and ref is not null and stripe_id is null
     and credit_cents = -amount_cents and venue_cents = 0 and futty_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'venue_payable' and ref is not null and stripe_id is null
     and venue_cents = -amount_cents and futty_cents = amount_cents and credit_cents = 0 and stripe_fee_cents = 0)
  or (kind = 'transfer' and ref is not null and stripe_id is null and amount_cents > 0
     and venue_cents + futty_cents = 0 and abs(futty_cents) = amount_cents and credit_cents = 0 and stripe_fee_cents = 0)
);

-- The books for one booking: venue + Futty + Stripe + refunds = taken.
-- credit_cents is the change in credit the venue holds for players (issued
-- and returned minus spent and expired); that money is inside venue_cents.
create or replace function public.money_balance(p_booking_id uuid)
returns table (taken_cents integer, refunded_cents integer, venue_cents integer, futty_cents integer,
               stripe_fee_cents integer, credit_cents integer, balanced boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.taken, t.refunded, t.venue, t.futty, t.stripe, t.credit,
         t.venue + t.futty + t.stripe + t.refunded = t.taken
  from (
    select coalesce(sum(amount_cents) filter (where kind = 'capture'), 0)::integer as taken,
           coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::integer as refunded,
           coalesce(sum(l.venue_cents), 0)::integer as venue,
           coalesce(sum(l.futty_cents), 0)::integer as futty,
           coalesce(sum(l.stripe_fee_cents), 0)::integer as stripe,
           coalesce(sum(l.credit_cents), 0)::integer as credit
    from public.money_ledger l
    where l.booking_id = p_booking_id
  ) t;
$$;

-- Money moving between the venue and Futty, no Stripe call: p_futty_cents
-- to Futty from the venue (negative: to the venue from Futty). Once per
-- p_ref; nothing for 0.
create or replace function public.record_money_transfer(
  p_booking_id uuid,
  p_share_id uuid,
  p_futty_cents integer,
  p_ref text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_futty_cents is null or p_futty_cents = 0 then
    return false;
  end if;
  return public.record_ledger_entry(p_booking_id, p_share_id, null, 'transfer', abs(p_futty_cents), p_ref, p_reason,
                                    -p_futty_cents, p_futty_cents, 0);
end;
$$;

-- New credit, 12 months from now, recorded once. The money is already with
-- the venue (the caller records any transfer to it). A share gets credit
-- from one source once: a repeat returns the credit already issued.
drop function public.issue_venue_credit(uuid, uuid, integer, text, uuid, uuid, integer, integer);
create function public.issue_venue_credit(
  p_profile_id uuid,
  p_venue_id uuid,
  p_amount_cents integer,
  p_source text,
  p_booking_id uuid,
  p_share_id uuid
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
    'credit-issued-' || v_id, p_source, 0, 0, p_amount_cents);
  return v_id;
end;
$$;

-- Gives back up to p_amount of the credit set aside for (or spent on) a
-- share, to the credits it came from, each keeping its own expiry (Q2): the
-- latest-expiring first, so what a cancellation keeps is the credit that
-- would have expired soonest. Returns what was given back.
create or replace function public.return_share_credit_part(p_share_id uuid, p_amount_cents integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spend public.venue_credit_spends;
  v_left integer := greatest(coalesce(p_amount_cents, 0), 0);
  v_take integer;
  v_id uuid;
begin
  for v_spend in
    select sp.* from public.venue_credit_spends sp
    join public.venue_credits c on c.id = sp.credit_id
    where sp.share_id = p_share_id and sp.status in ('reserved', 'spent')
    order by c.expires_at desc, c.issued_at desc, sp.id
    for update of sp
  loop
    exit when v_left = 0;
    v_take := least(v_left, v_spend.amount_cents);
    if v_take = v_spend.amount_cents then
      update public.venue_credit_spends set status = 'returned', returned_at = now() where id = v_spend.id;
      v_id := v_spend.id;
    else
      -- Part of it: the rest stays spent (or set aside).
      update public.venue_credit_spends set amount_cents = amount_cents - v_take where id = v_spend.id;
      insert into public.venue_credit_spends (credit_id, share_id, booking_id, amount_cents, status, created_at,
                                              spent_at, returned_at)
      values (v_spend.credit_id, p_share_id, v_spend.booking_id, v_take, 'returned', v_spend.created_at,
              v_spend.spent_at, now())
      returning id into v_id;
    end if;
    update public.venue_credits set remaining_cents = remaining_cents + v_take where id = v_spend.credit_id;
    if v_spend.status = 'spent' then
      perform public.record_ledger_entry(v_spend.booking_id, p_share_id, v_spend.credit_id, 'credit_returned', v_take,
        'credit-returned-' || v_id, p_reason, 0, 0, v_take);
    end if;
    v_left := v_left - v_take;
  end loop;
  return greatest(coalesce(p_amount_cents, 0), 0) - v_left;
end;
$$;

-- All the credit set aside for (or spent on) a share goes back.
create or replace function public.return_share_credit(p_share_id uuid, p_reason text)
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.return_share_credit_part(p_share_id,
    (select coalesce(sum(amount_cents), 0)::integer from public.venue_credit_spends
     where share_id = p_share_id and status in ('reserved', 'spent')),
    p_reason);
$$;

-- The share's money is secured: the credit set aside is spent. A record
-- only: the money is already with the venue (Q3).
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
      v_spend.amount_cents, 'credit-spent-' || v_spend.id, 'share_paid_with_credit', 0, 0, -v_spend.amount_cents);
  end loop;
end;
$$;

-- Credit past its expiry is expired; the money stays with the venue, where
-- it already is (a record only). Returns how many expired.
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
      0, 0, -v_credit.remaining_cents);
    update public.venue_credits set remaining_cents = 0, expired_at = now() where id = v_credit.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Q2 + Q3: money kept in the middle window. The €1 (kept_cents) comes from
-- the card-paid part first, then from the credit that paid for the share.
-- What's left of the card part becomes new 12-month credit; what's left of
-- the credit goes back to the credits it came from, keeping their expiry.
-- Futty keeps the €1 less its fee already counted, from the venue's part.
create or replace function public.cancellation_issue_credit(p_line public.booking_cancellation_lines, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kept_card integer := least(p_line.kept_cents, p_line.paid_cents);
  v_kept_credit integer := p_line.kept_cents - least(p_line.kept_cents, p_line.paid_cents);
  v_new integer;
  v_back integer;
begin
  if p_line."window" <> 'middle' then
    return;
  end if;
  v_new := p_line.paid_cents - v_kept_card;
  v_back := p_line.credit_used_cents - v_kept_credit;
  if v_new > 0 then
    perform public.issue_venue_credit(p_line.profile_id, p_line.venue_id, v_new,
      case p_scope when 'my_spot' then 'player_cancelled' when 'whole_team' then 'booking_cancelled' else 'venue_cancelled' end,
      p_line.booking_id, p_line.share_id);
  end if;
  if v_back > 0 then
    perform public.return_share_credit_part(p_line.share_id, v_back, 'cancelled_credit_back');
  end if;
  perform public.record_money_transfer(p_line.booking_id, p_line.share_id, p_line.kept_cents - p_line.fee_cents,
    'cancel-kept-' || p_line.id, p_line.reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Q1: cancellation_plan, as in pay_cancellations_plan, and when the venue
-- cancels, a share forfeited by a late cancellation is given back too:
-- money taken (card, and credit that paid for it) as a refund-or-credit
-- choice; a card part never taken is released.
create or replace function public.cancellation_plan(
  p_booking_id uuid,
  p_scope text,
  p_profile_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_kickoff timestamptz;
  v_own public.booking_payment_shares;
  v_share public.booking_payment_shares;
  v_guarantee public.booking_guarantees;
  v_late_team boolean;
  v_lines jsonb := '[]'::jsonb;
  v_has_money boolean;
  v_value integer;
  v_paid integer;
  v_card_taken boolean;
  v_window text;
  v_action text;
  v_kept integer;
  v_credit integer;
  v_refund integer;
  v_capture boolean;
  v_keep_unit integer;
  v_taken integer;
  v_fee jsonb := null;
begin
  if p_profile_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_scope is null or p_scope not in ('my_spot', 'whole_team', 'venue') then
    raise exception 'invalid_scope';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'not_found';
  end if;
  if v_booking.payment_mode is null then
    raise exception 'legacy_booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'already_cancelled';
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if p_at >= v_kickoff then
    raise exception 'booking_started';
  end if;

  if p_scope = 'whole_team' and v_booking.created_by is distinct from p_profile_id then
    raise exception 'not_your_booking';
  end if;
  if p_scope = 'venue' and not exists (
    select 1 from public.venues where id = v_booking.venue_id and owner_profile_id = p_profile_id
  ) then
    raise exception 'not_your_venue';
  end if;
  if p_scope = 'my_spot' then
    select * into v_own from public.booking_payment_shares
    where booking_id = p_booking_id and profile_id = p_profile_id
      and status in ('pending', 'authorized', 'paid', 'covered');
    if v_own.id is null then
      raise exception 'not_in_booking';
    end if;
    if v_own.is_booker and v_booking.payment_mode = 'pay_all' then
      raise exception 'use_whole_team';
    end if;
  end if;

  v_late_team := p_at > v_kickoff - interval '6 hours';
  v_keep_unit := 100;

  for v_share in
    select s.* from public.booking_payment_shares s
    where s.booking_id = p_booking_id
      and (s.status in ('pending', 'authorized', 'paid', 'covered')
           -- Q1: forfeited by a late cancellation of the player's own spot
           -- (not the €1 of a middle-window one).
           or (p_scope = 'venue' and s.status = 'forfeited'
               and exists (select 1 from public.booking_cancellation_lines l
                           where l.share_id = s.id and l."window" = 'late')))
      and (p_scope <> 'my_spot' or s.id = v_own.id)
    order by s.is_booker desc, s.created_at, s.id
  loop
    v_kept := 0;
    v_credit := 0;
    v_refund := 0;
    v_capture := false;
    v_window := null;

    if v_share.status = 'forfeited' then
      v_card_taken := v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null
        and exists (select 1 from public.money_ledger m
                    where m.kind = 'capture' and m.stripe_id = v_share.stripe_payment_intent_id);
      v_window := 'venue';
      if v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null and not v_card_taken then
        -- The card part was never taken: whatever hold is left is released.
        v_paid := v_share.amount_cents;
        v_value := v_paid + v_share.credit_cents;
        v_action := 'release';
      else
        v_paid := case when v_card_taken then v_share.amount_cents else 0 end;
        v_value := v_paid + v_share.credit_cents;
        v_action := case when v_value > 0 then 'refund_choice' else 'none' end;
        if v_value = 0 then
          v_window := null;
        end if;
      end if;
      v_refund := v_value;
      v_has_money := v_value > 0;
    else
      v_has_money := v_share.status in ('authorized', 'paid') and v_share.amount_cents + v_share.credit_cents > 0;
      v_value := case when v_has_money then v_share.amount_cents + v_share.credit_cents else 0 end;
      v_paid := case when v_has_money then v_share.amount_cents else 0 end;

      if not v_has_money then
        v_action := case when v_share.stripe_payment_intent_id is not null and v_share.status = 'pending'
                         then 'release' else 'none' end;
      elsif p_scope = 'venue' then
        v_window := 'venue';
        v_action := case when v_share.status = 'authorized' then 'release' else 'refund_choice' end;
        v_refund := v_value;
      elsif p_scope = 'my_spot' or v_share.is_booker then
        v_window := public.cancellation_window(v_share, v_kickoff, p_at);
        if v_window = 'free' then
          v_action := 'release';
          v_refund := v_value;
        elsif v_window = 'middle' then
          v_kept := least(v_value, v_keep_unit * case when v_booking.payment_mode = 'pay_all' then v_booking.capacity else 1 end);
          v_credit := v_value - v_kept;
          v_action := case when v_credit > 0 then 'keep_and_credit' else 'keep' end;
          v_capture := v_share.status = 'authorized';
        else
          v_action := 'keep';
          v_kept := v_value;
          v_capture := v_share.status = 'authorized';
        end if;
      else
        v_window := 'other';
        if v_late_team then
          v_action := 'keep';
          v_kept := v_value;
          v_capture := v_share.status = 'authorized';
        elsif v_share.status = 'authorized' then
          v_action := 'release';
          v_refund := v_value;
        else
          v_action := 'refund_choice';
          v_refund := v_value;
        end if;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'share_id', v_share.id,
      'guarantee_id', null,
      'profile_id', v_share.profile_id,
      'is_booker', v_share.is_booker,
      'window', v_window,
      'action', v_action,
      'paid_cents', v_paid,
      'fee_cents', case when v_paid > 0 then coalesce(v_share.fee_cents, 0) else 0 end,
      'credit_used_cents', case when v_has_money then v_share.credit_cents else 0 end,
      'value_cents', v_value,
      'kept_cents', v_kept,
      'credit_cents', v_credit,
      'refund_cents', v_refund,
      'needs_capture', v_capture,
      'stripe_intent_id', v_share.stripe_payment_intent_id
    ));
  end loop;

  if p_scope <> 'my_spot' then
    select * into v_guarantee from public.booking_guarantees where booking_id = p_booking_id and status <> 'cancelled';
    if v_guarantee.id is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'share_id', null, 'guarantee_id', v_guarantee.id, 'profile_id', v_guarantee.profile_id, 'is_booker', true,
        'window', null, 'action', 'release', 'paid_cents', 0, 'fee_cents', 0, 'credit_used_cents', 0,
        'value_cents', 0, 'kept_cents', 0, 'credit_cents', 0, 'refund_cents', 0, 'needs_capture', false,
        'stripe_intent_id', v_guarantee.stripe_payment_intent_id));
    end if;
  end if;

  if p_scope = 'whole_team' and v_booking.payment_mode <> 'pay_all' and not v_late_team then
    select count(*) into v_taken from public.booking_payment_shares
    where booking_id = p_booking_id and not is_booker and status = 'paid' and amount_cents > 0;
    if v_taken > 0 then
      v_fee := jsonb_build_object('profile_id', v_booking.created_by, 'players', v_taken, 'amount_cents', 100 * v_taken);
    end if;
  end if;

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'scope', p_scope,
    'payment_mode', v_booking.payment_mode,
    'kickoff_at', v_kickoff,
    'refunds_stop_at', v_kickoff - interval '6 hours',
    'cancels_booking', p_scope <> 'my_spot',
    'lines', v_lines,
    'booker_fee', v_fee,
    'quote', md5(jsonb_build_object('booking_id', p_booking_id, 'scope', p_scope, 'lines', v_lines,
                                    'booker_fee', v_fee)::text)
  );
end;
$$;

-- As in pay_cancellations_apply; when the venue cancels, an earlier
-- cancellation's capture still waiting on a share it now gives back is
-- superseded (the new line releases or refunds whatever Stripe has).
create or replace function public.cancel_booking_internal(
  p_booking_id uuid,
  p_scope text,
  p_profile_id uuid,
  p_expected_quote text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_venue_name text;
  v_plan jsonb;
  v_line jsonb;
  v_row public.booking_cancellation_lines;
  v_cancellation_id uuid;
  v_fee_id uuid;
  v_status text;
  v_work boolean;
  v_pm text;
  v_who text;
  v_body text;
  v_profile uuid;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  if v_booking.id is not null and v_booking.payment_mode is null then
    return jsonb_build_object('legacy', true);
  end if;
  perform 1 from public.booking_payment_shares where booking_id = p_booking_id for update;
  perform 1 from public.booking_guarantees where booking_id = p_booking_id for update;
  perform 1 from public.booking_cancellation_lines where booking_id = p_booking_id and work = 'pending' for update;

  v_plan := public.cancellation_plan(p_booking_id, p_scope, p_profile_id, now());
  if p_expected_quote is null then
    raise exception 'quote_required';
  end if;
  if v_plan ->> 'quote' is distinct from p_expected_quote then
    raise exception 'quote_changed';
  end if;

  insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan)
  values (p_booking_id, p_scope, p_profile_id, v_plan ->> 'quote', v_plan)
  returning id into v_cancellation_id;

  for v_line in select * from jsonb_array_elements(v_plan -> 'lines') loop
    v_work := case v_line ->> 'action'
      when 'release' then v_line ->> 'stripe_intent_id' is not null
      when 'keep' then (v_line ->> 'needs_capture')::boolean
      when 'keep_and_credit' then (v_line ->> 'needs_capture')::boolean
      when 'refund_choice' then true
      else false end;

    if p_scope = 'venue' and v_line ->> 'share_id' is not null then
      update public.booking_cancellation_lines
      set work = 'done', outcome = 'superseded', done_at = now()
      where share_id = (v_line ->> 'share_id')::uuid and work = 'pending' and action in ('keep', 'keep_and_credit');
    end if;

    insert into public.booking_cancellation_lines (
      cancellation_id, booking_id, share_id, guarantee_id, profile_id, venue_id, is_booker, "window", action,
      paid_cents, fee_cents, credit_used_cents, value_cents, kept_cents, credit_cents, refund_cents, needs_capture,
      stripe_intent_id, reason, work, next_attempt_at, choose_by)
    values (
      v_cancellation_id, p_booking_id, (v_line ->> 'share_id')::uuid, (v_line ->> 'guarantee_id')::uuid,
      (v_line ->> 'profile_id')::uuid, v_booking.venue_id, (v_line ->> 'is_booker')::boolean, v_line ->> 'window',
      v_line ->> 'action', (v_line ->> 'paid_cents')::integer, (v_line ->> 'fee_cents')::integer,
      (v_line ->> 'credit_used_cents')::integer, (v_line ->> 'value_cents')::integer, (v_line ->> 'kept_cents')::integer,
      (v_line ->> 'credit_cents')::integer, (v_line ->> 'refund_cents')::integer, (v_line ->> 'needs_capture')::boolean,
      v_line ->> 'stripe_intent_id', p_scope || '_' || (v_line ->> 'action'),
      case when v_work then 'pending' else 'none' end,
      case when v_line ->> 'action' = 'refund_choice' then now() + interval '48 hours'
           when v_work then now() + interval '2 minutes' end,
      case when v_line ->> 'action' = 'refund_choice' then now() + interval '48 hours' end)
    returning * into v_row;

    if v_row.guarantee_id is not null then
      update public.booking_guarantees set status = 'cancelled', next_attempt_at = null where id = v_row.guarantee_id;
      continue;
    end if;

    v_status := case v_row.action
      when 'none' then 'cancelled' when 'release' then 'cancelled' when 'keep' then 'forfeited'
      when 'keep_and_credit' then 'credited' when 'refund_choice' then 'refund_due' end;
    update public.booking_payment_shares set status = v_status where id = v_row.share_id;
    if not v_row.needs_capture then
      perform public.cancellation_issue_credit(v_row, p_scope);
    end if;
  end loop;

  if p_scope <> 'my_spot' then
    update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  end if;

  if v_plan -> 'booker_fee' <> 'null'::jsonb then
    select coalesce(s.stripe_payment_method_id, g.stripe_payment_method_id) into v_pm
    from public.booking_payment_shares s
    left join public.booking_guarantees g on g.booking_id = s.booking_id
    where s.booking_id = p_booking_id and s.is_booker;
    insert into public.booking_cancellation_fees (cancellation_id, booking_id, profile_id, players, amount_cents,
      stripe_customer_id, stripe_payment_method_id, next_attempt_at, stop_at)
    values (v_cancellation_id, p_booking_id, v_booking.created_by, (v_plan -> 'booker_fee' ->> 'players')::integer,
      (v_plan -> 'booker_fee' ->> 'amount_cents')::integer,
      (select stripe_customer_id from public.profiles where id = v_booking.created_by), v_pm,
      now() + interval '2 minutes', (v_plan ->> 'kickoff_at')::timestamptz)
    returning id into v_fee_id;
  end if;

  select name into v_venue_name from public.venues where id = v_booking.venue_id;
  if p_scope = 'my_spot' then
    for v_profile in
      select distinct profile_id from public.booking_payment_shares
      where booking_id = p_booking_id and profile_id <> p_profile_id
        and status in ('pending', 'authorized', 'paid', 'covered')
    loop
      perform public.send_notification(v_profile, 'booking_spot_released', jsonb_build_object(
        'title', 'A spot opened up',
        'body', format('A player dropped out of your game at %s on %s at %s. Invite someone to fill the spot.',
                       v_venue_name, to_char(v_booking.booking_day, 'FMDay DD Mon'), to_char(v_booking.start_time, 'HH24:MI')),
        'bookingId', p_booking_id
      ));
    end loop;
  else
    v_who := case when p_scope = 'venue' then v_venue_name else 'The booker' end;
    for v_row in
      select * from public.booking_cancellation_lines
      where cancellation_id = v_cancellation_id and share_id is not null and profile_id <> p_profile_id
    loop
      v_body := format('%s cancelled your game at %s on %s at %s. ', v_who, v_venue_name,
                       to_char(v_booking.booking_day, 'FMDay DD Mon'), to_char(v_booking.start_time, 'HH24:MI'))
        || case v_row.action
             when 'refund_choice' then format('You get %s back. Choose venue credit within 48 hours, or it goes back to your card.',
                                              public.money_format_euros(v_row.refund_cents))
             when 'release' then case when v_row.refund_cents > 0 then 'Your payment hold was released, so you won''t be charged.'
                                      else 'You weren''t charged.' end
             when 'keep' then 'It was cancelled less than 6 hours before kickoff, so no money goes back.'
             else 'You weren''t charged.'
           end;
      perform public.send_notification(v_row.profile_id, 'booking_cancelled', jsonb_build_object(
        'title', 'Game cancelled',
        'body', v_body,
        'bookingId', p_booking_id,
        'cancellationLineId', v_row.id,
        'action', v_row.action,
        'refundCents', v_row.refund_cents
      ));
    end loop;
  end if;

  return v_plan || jsonb_build_object('cancellation_id', v_cancellation_id, 'fee_id', v_fee_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Medium 4: a kept share whose held card part can never be taken (Stripe
-- cancelled the hold). The €1 applies only to money actually paid, here the
-- credit that paid for the share: in the middle window up to the €1 of it
-- is kept and the rest goes back to the credits it came from (keeping their
-- expiry); late, all of it is kept. The line is finished, not retried.
create or replace function public.cancellation_line_not_taken(p_line_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.booking_cancellation_lines;
  v_kept integer;
  v_back integer := 0;
begin
  select * into v_line from public.booking_cancellation_lines where id = p_line_id for update;
  if v_line.id is null or v_line.action not in ('keep', 'keep_and_credit') or not v_line.needs_capture then
    raise exception 'line_not_found';
  end if;
  if v_line.work <> 'pending' then
    return false;
  end if;
  if v_line."window" = 'middle' then
    v_kept := least(v_line.credit_used_cents, v_line.kept_cents);
    v_back := public.return_share_credit_part(v_line.share_id, v_line.credit_used_cents - v_kept, 'card_not_taken');
    -- Futty's €1 comes out of the credit money the venue holds.
    perform public.record_money_transfer(v_line.booking_id, v_line.share_id, v_kept,
      'cancel-kept-' || v_line.id, v_line.reason);
  else
    v_kept := v_line.credit_used_cents;
  end if;
  update public.booking_cancellation_lines
  set paid_cents = 0, fee_cents = 0, value_cents = v_line.credit_used_cents, kept_cents = v_kept,
      credit_cents = v_back, refund_cents = 0,
      work = 'done', outcome = 'not_taken', done_at = now(), last_error = null
  where id = p_line_id;
  return true;
end;
$$;

-- Medium 3: the job (or a card choice) claims a refund before it calls
-- Stripe. Locks the line and checks again that no credit was chosen and
-- the 48 hours are over (or the player chose card); the claim records card
-- as the choice, so a credit choice afterwards is refused.
create or replace function public.cancellation_claim_refund(p_line_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.booking_cancellation_lines;
begin
  select * into v_line from public.booking_cancellation_lines where id = p_line_id for update;
  if v_line.id is null or v_line.action <> 'refund_choice' or v_line.work <> 'pending'
     or v_line.choice = 'credit'
     or (v_line.choice is null and now() < v_line.choose_by) then
    return false;
  end if;
  update public.booking_cancellation_lines set choice = 'card', chosen_at = coalesce(chosen_at, now())
  where id = p_line_id;
  return true;
end;
$$;

-- Q2 + Q3: the player chooses credit. The whole card payment becomes new
-- credit, and Futty's fee goes to the venue with it, because the credit
-- money is the venue's to hold. Credit that paid for the share goes back to
-- where it came from. Otherwise as in pay_cancellations_work.
create or replace function public.choose_cancellation_refund(p_line_id uuid, p_profile_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.booking_cancellation_lines;
  v_scope text;
begin
  select * into v_line from public.booking_cancellation_lines where id = p_line_id for update;
  if v_line.id is null or v_line.action <> 'refund_choice' then
    raise exception 'refund_not_found';
  end if;
  if p_choice is null or p_choice not in ('card', 'credit') then
    raise exception 'invalid_choice';
  end if;
  if v_line.profile_id is distinct from p_profile_id then
    raise exception 'not_your_refund';
  end if;
  if v_line.choice is not null or v_line.work = 'done' then
    raise exception 'already_chosen';
  end if;
  if now() >= v_line.choose_by then
    raise exception 'choice_closed';
  end if;

  if p_choice = 'card' then
    update public.booking_cancellation_lines set choice = 'card', chosen_at = now(), next_attempt_at = now()
    where id = p_line_id;
    return jsonb_build_object('result', 'refund', 'line_id', p_line_id, 'refund_cents', v_line.refund_cents);
  end if;

  select scope into v_scope from public.booking_cancellations where id = v_line.cancellation_id;
  update public.booking_payment_shares set status = 'credited' where id = v_line.share_id and status = 'refund_due';
  perform public.return_share_credit(v_line.share_id, 'chose_credit');
  if v_line.paid_cents > 0 then
    perform public.issue_venue_credit(v_line.profile_id, v_line.venue_id, v_line.paid_cents,
      case v_scope when 'venue' then 'venue_cancelled' else 'booking_cancelled' end,
      v_line.booking_id, v_line.share_id);
    perform public.record_money_transfer(v_line.booking_id, v_line.share_id, -v_line.fee_cents,
      'chose-credit-fee-' || v_line.id, 'chose_credit');
  end if;
  perform public.cancellation_venue_payable(v_line);
  update public.booking_cancellation_lines
  set choice = 'credit', chosen_at = now(), work = 'done', outcome = 'credited', done_at = now()
  where id = p_line_id;
  return jsonb_build_object('result', 'credited', 'line_id', p_line_id, 'credit_cents', v_line.refund_cents);
end;
$$;

-- ---------------------------------------------------------------------------
-- Credit set aside for an unfinished payment: what's given back, and the
-- share priced again without credit. The SetupIntent id stays on the share
-- (High 1): the next one is keyed on it, so a new attempt gets a new one.
create or replace function public.share_drop_credit(p_share_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
  v_amounts record;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id;
  perform public.return_share_credit(p_share_id, p_reason);
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  select * into v_amounts from public.money_share(
    v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, v_share.is_booker,
    exists (select 1 from public.profiles where id = v_share.profile_id and is_premium), v_share.payment_method);
  update public.booking_payment_shares
  set credit_cents = 0,
      pitch_cents = v_amounts.pitch_cents,
      fee_cents = v_amounts.fee_cents,
      cash_cents = v_amounts.cash_cents,
      amount_cents = v_amounts.card_cents
  where id = p_share_id;
end;
$$;

-- The share's payment p_intent_id was cancelled or never finished: the
-- credit it set aside goes back. Medium 2: with p_hold_released (the job
-- cancelled the intent, or found it cancelled), a hold that landed just
-- before is undone the way the webhook's release path does: the share is
-- unpaid again, the credit already spent goes back, and the player is asked
-- to pay again.
drop function public.release_share_credit_reservation(uuid, text);
create function public.release_share_credit_reservation(
  p_share_id uuid,
  p_intent_id text,
  p_hold_released boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null
     or p_intent_id is distinct from coalesce(v_share.stripe_payment_intent_id, v_share.stripe_setup_intent_id) then
    return false;
  end if;

  if v_share.status = 'pending' then
    if not exists (select 1 from public.venue_credit_spends where share_id = p_share_id and status = 'reserved') then
      return false;
    end if;
  elsif v_share.status = 'authorized' and coalesce(p_hold_released, false)
        and v_share.stripe_payment_intent_id = p_intent_id and v_share.credit_cents > 0 then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'cancel', v_share.amount_cents,
                                         p_intent_id, p_intent_id, 'payment_not_completed');
    update public.booking_payment_shares set status = 'pending', held_at = null, capture_due_at = null
    where id = p_share_id;
    perform public.send_notification(v_share.profile_id, 'match_payment_due', jsonb_build_object(
      'title', 'Pay again to keep your spot',
      'body', 'Your payment wasn''t completed in time, so your card wasn''t charged and your credit is back. '
              || 'Pay again to keep your spot.',
      'bookingId', v_share.booking_id
    ));
  else
    return false;
  end if;

  perform public.share_drop_credit(p_share_id, 'payment_not_completed');
  return true;
end;
$$;

-- Medium 5: as in pay_modes_timing, and a share paid fully with credit is
-- judged non-refundable when its card is saved (Stripe's event time), as a
-- card payment is when it's held: one saved less than 6 hours before
-- kickoff without the notice accepted is refused, its credit goes back, and
-- the player is asked to pay again.
create or replace function public.share_card_saved(
  p_share_id uuid,
  p_setup_intent_id text,
  p_payment_method_id text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking public.venue_bookings;
begin
  select * into v_share from public.booking_payment_shares
  where id = p_share_id and status = 'pending' and amount_cents = 0 and stripe_setup_intent_id = p_setup_intent_id
  for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.money_payment_window_ends_at(v_booking.created_at) then
    perform public.expire_unpaid_booking(v_booking.id);
    return jsonb_build_object('result', 'expired', 'booking_id', v_booking.id, 'share_id', v_share.id);
  end if;

  if v_share.credit_cents > 0 and v_share.non_refundable_accepted_at is null
     and public.money_is_non_refundable(p_at, public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time)) then
    perform public.share_drop_credit(v_share.id, 'non_refundable_not_accepted');
    perform public.send_notification(v_share.profile_id, 'match_payment_due', jsonb_build_object(
      'title', 'Pay again to keep your spot',
      'body', 'Your game starts in less than 6 hours, so it''s non-refundable. Your credit wasn''t used: '
              || 'accept the notice and pay again.',
      'bookingId', v_share.booking_id
    ));
    return jsonb_build_object('result', 'refused', 'reason', 'non_refundable_not_accepted', 'share_id', v_share.id);
  end if;

  update public.booking_payment_shares
  set status = 'paid', paid_at = p_at, stripe_payment_method_id = p_payment_method_id
  where id = v_share.id
  returning * into v_share;
  return jsonb_build_object('result', 'saved', 'share_id', v_share.id, 'setup_intent_id', p_setup_intent_id)
         || public.booker_share_settled(v_share, p_payment_method_id);
end;
$$;

-- As in pay_cancellations_credit, and the player's acceptance of the
-- non-refundable notice is checked and recorded, as for a card payment.
drop function public.attach_share_setup(uuid, uuid, text, text, text, boolean);
create function public.attach_share_setup(
  p_share_id uuid,
  p_profile_id uuid,
  p_method text,
  p_setup_intent_id text,
  p_expected_intent_id text,
  p_use_credit boolean default false,
  p_accept_non_refundable boolean default false
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
      capture_method = null,
      non_refundable_accepted_at = case when coalesce(p_accept_non_refundable, false) then now() end
  where id = p_share_id;

  return v_plan;
end;
$$;

-- High 1: the plan also names the share's last SetupIntent, so
-- create-share-payment can reuse one still open or key a new one on it.
create or replace function public.plan_share_payment(
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
         || jsonb_build_object('stripe_setup_intent_id', s.stripe_setup_intent_id)
  from (select 1) one
  left join public.booking_payment_shares s on s.id = p_share_id;
$$;

-- ---------------------------------------------------------------------------
-- Low: the read policy compared the line's own id; it names its table now,
-- so every player with a line in the cancellation can read it.
drop policy "Players read cancellations of their bookings" on public.booking_cancellations;
create policy "Players read cancellations of their bookings" on public.booking_cancellations
  for select to authenticated using (
    cancelled_by = auth.uid()
    or exists (select 1 from public.booking_cancellation_lines l
               where l.cancellation_id = booking_cancellations.id and l.profile_id = auth.uid())
  );

revoke all on function public.money_balance(uuid) from public, anon, authenticated;
grant execute on function public.money_balance(uuid) to service_role;
revoke all on function public.record_money_transfer(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_money_transfer(uuid, uuid, integer, text, text) to service_role;
revoke all on function public.issue_venue_credit(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_venue_credit(uuid, uuid, integer, text, uuid, uuid) to service_role;
revoke all on function public.return_share_credit_part(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.return_share_credit_part(uuid, integer, text) to service_role;
revoke all on function public.return_share_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.return_share_credit(uuid, text) to service_role;
revoke all on function public.spend_share_credit(uuid) from public, anon, authenticated;
grant execute on function public.spend_share_credit(uuid) to service_role;
revoke all on function public.expire_venue_credits() from public, anon, authenticated;
grant execute on function public.expire_venue_credits() to service_role;
revoke all on function public.cancellation_issue_credit(public.booking_cancellation_lines, text) from public, anon, authenticated;
grant execute on function public.cancellation_issue_credit(public.booking_cancellation_lines, text) to service_role;
revoke all on function public.cancellation_plan(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cancellation_plan(uuid, text, uuid, timestamptz) to service_role;
revoke all on function public.cancel_booking_internal(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_booking_internal(uuid, text, uuid, text) to service_role;
revoke all on function public.cancellation_line_not_taken(uuid) from public, anon, authenticated;
grant execute on function public.cancellation_line_not_taken(uuid) to service_role;
revoke all on function public.cancellation_claim_refund(uuid) from public, anon, authenticated;
grant execute on function public.cancellation_claim_refund(uuid) to service_role;
revoke all on function public.choose_cancellation_refund(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.choose_cancellation_refund(uuid, uuid, text) to service_role;
revoke all on function public.share_drop_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.share_drop_credit(uuid, text) to service_role;
revoke all on function public.release_share_credit_reservation(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.release_share_credit_reservation(uuid, text, boolean) to service_role;
revoke all on function public.share_card_saved(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.share_card_saved(uuid, text, text, timestamptz) to service_role;
revoke all on function public.attach_share_setup(uuid, uuid, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.attach_share_setup(uuid, uuid, text, text, text, boolean, boolean) to service_role;
revoke all on function public.plan_share_payment(uuid, uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.plan_share_payment(uuid, uuid, text, boolean, boolean) to service_role;
