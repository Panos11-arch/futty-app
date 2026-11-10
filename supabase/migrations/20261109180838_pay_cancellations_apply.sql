-- P4b: a cancellation, applied (docs/specs/13-payments-bookings.md,
-- "Cancellations and refunds"). cancel_booking_internal runs the same
-- cancellation_plan as the quote, refuses unless the caller confirmed that
-- exact quote, and in one transaction:
--   - writes the cancellation and one line per share (and guarantee);
--   - moves every share to its new state ('cancelled' when its money goes
--     back, 'credited' / 'forfeited' when it's kept, 'refund_due' while the
--     player chooses card or credit), which releases the spot;
--   - issues credit for money already taken, and records it in the ledger;
--   - cancels the booking (whole team, venue), which releases its pitches;
--   - records the booker's extra charge;
--   - tells the other players.
-- What still needs Stripe (cancel a hold, take a hold first, refund) is
-- left on the line as pending work: cancel-booking does it at once, and
-- run-payment-jobs retries whatever is left (pay_cancellations_work).

-- €6.80 from 680, for notification text. Integer maths only.
create or replace function public.money_format_euros(p_cents integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select '€' || (p_cents / 100)::text || '.' || lpad((p_cents % 100)::text, 2, '0');
$$;

-- Money kept in the middle window: the venue's part of the share goes,
-- Futty keeps what's kept (less its fee already counted), the rest becomes
-- credit at the venue. Once per line.
create or replace function public.cancellation_issue_credit(p_line public.booking_cancellation_lines, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_cents integer := -(p_line.value_cents - p_line.fee_cents);
  v_futty_cents integer := p_line.kept_cents - p_line.fee_cents;
begin
  if p_line."window" <> 'middle' then
    return;
  end if;
  if p_line.credit_cents > 0 then
    perform public.issue_venue_credit(p_line.profile_id, p_line.venue_id, p_line.credit_cents,
      case p_scope when 'my_spot' then 'player_cancelled' when 'whole_team' then 'booking_cancelled' else 'venue_cancelled' end,
      p_line.booking_id, p_line.share_id, v_venue_cents, v_futty_cents);
  elsif v_venue_cents <> 0 then
    perform public.record_ledger_entry(p_line.booking_id, p_line.share_id, null, 'credit_issued', 0,
      'cancel-kept-' || p_line.id, p_line.reason, v_venue_cents, v_futty_cents, 0);
  end if;
end;
$$;

-- Cancel-booking, with the verified caller and the quote they confirmed.
-- Bookings from before P4a answer {legacy: true} and keep the old flow
-- (cancel_booking_for).
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
      -- cancel-booking does the Stripe work now; the job takes over after
      -- 2 minutes. A refund waits 48 hours for the player's choice.
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

  -- Tell the others.
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

-- Money kept after a cancellation is never given back by the P4a webhooks
-- or jobs: a repeated hold or capture event for a credited, forfeited or
-- refund_due share is recorded and changes nothing. Otherwise as in
-- pay_modes_timing.
create or replace function public.share_payment_held(
  p_share_id uuid,
  p_intent_id text,
  p_amount_cents integer,
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
  v_kickoff timestamptz;
  v_release jsonb;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if v_booking.payment_mode is null then
    return jsonb_build_object('result', 'legacy');
  end if;
  v_release := jsonb_build_object('result', 'release', 'booking_id', v_share.booking_id, 'share_id', v_share.id);

  if v_share.stripe_payment_intent_id is distinct from p_intent_id then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                         p_intent_id, 'replaced_intent_held');
    return v_release || jsonb_build_object('reason', 'replaced_intent');
  end if;
  if v_share.status in ('credited', 'forfeited', 'refund_due') then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;
  if v_booking.status = 'cancelled' or v_share.status in ('cancelled', 'refunded') then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                         p_intent_id, 'share_held');
    return v_release || jsonb_build_object('reason', 'booking_cancelled');
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                         p_intent_id, 'amount_mismatch_held');
    return v_release || jsonb_build_object('reason', 'amount_mismatch');
  end if;
  if v_share.status <> 'pending' then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;

  perform public.record_money_movement(v_share.booking_id, v_share.id, null, 'hold', p_amount_cents, p_intent_id,
                                       p_intent_id, 'share_held');

  if v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.money_payment_window_ends_at(v_booking.created_at) then
    perform public.expire_unpaid_booking(v_booking.id);
    return jsonb_build_object('result', 'expired', 'booking_id', v_booking.id, 'share_id', v_share.id);
  end if;

  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  if public.money_is_non_refundable(p_at, v_kickoff) and v_share.non_refundable_accepted_at is null then
    perform public.send_notification(v_share.profile_id, 'match_payment_due', jsonb_build_object(
      'title', 'Pay again to keep your spot',
      'body', 'Your game starts in less than 6 hours, so it''s non-refundable. Your card wasn''t charged: '
              || 'accept the notice and pay again.',
      'bookingId', v_share.booking_id
    ));
    return v_release || jsonb_build_object('reason', 'non_refundable_not_accepted');
  end if;

  update public.booking_payment_shares
  set status = 'authorized', held_at = p_at, capture_due_at = public.money_capture_due_at(p_at, v_kickoff),
      stripe_payment_method_id = p_payment_method_id
  where id = v_share.id
  returning * into v_share;

  return jsonb_build_object('result', 'held', 'share_id', v_share.id, 'booking_id', v_share.booking_id)
         || public.booker_share_settled(v_share, p_payment_method_id);
end;
$$;

create or replace function public.share_payment_captured(
  p_share_id uuid,
  p_intent_id text,
  p_amount_cents integer,
  p_payment_method_id text,
  p_fee_cents integer,
  p_stripe_fee_cents integer,
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
  v_refund jsonb;
  v_was text;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  select * into v_booking from public.venue_bookings where id = v_share.booking_id;
  if v_booking.payment_mode is null then
    return jsonb_build_object('result', 'legacy');
  end if;
  v_refund := jsonb_build_object('result', 'refund', 'booking_id', v_share.booking_id, 'share_id', v_share.id);

  if v_share.stripe_payment_intent_id is distinct from p_intent_id then
    perform public.record_intent_capture(v_share.booking_id, v_share.id, null, p_intent_id, p_amount_cents,
                                         p_fee_cents, p_stripe_fee_cents, 'replaced_intent_taken');
    return v_refund || jsonb_build_object('reason', 'replaced_intent');
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    perform public.record_intent_capture(v_share.booking_id, v_share.id, null, p_intent_id, p_amount_cents,
                                         p_fee_cents, p_stripe_fee_cents, 'amount_mismatch_taken');
    return v_refund || jsonb_build_object('reason', 'amount_mismatch');
  end if;

  v_was := v_share.status;
  perform public.record_intent_capture(v_share.booking_id, v_share.id, null, p_intent_id, p_amount_cents,
    v_share.fee_cents, p_stripe_fee_cents, case when v_was = 'pending' then 'share_taken_at_once' else 'share_taken' end);

  if v_was in ('credited', 'forfeited', 'refund_due') then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;
  if v_booking.status = 'cancelled' or v_was in ('cancelled', 'refunded') then
    return v_refund || jsonb_build_object('reason', 'booking_cancelled');
  end if;
  if v_was not in ('pending', 'authorized') then
    return jsonb_build_object('result', 'duplicate', 'share_id', v_share.id);
  end if;

  if v_was = 'pending' and v_share.is_booker and v_booking.status = 'pending_payment'
     and p_at > public.money_payment_window_ends_at(v_booking.created_at) then
    perform public.expire_unpaid_booking(v_booking.id);
    return jsonb_build_object('result', 'expired', 'booking_id', v_booking.id, 'share_id', v_share.id);
  end if;

  update public.booking_payment_shares
  set status = 'paid', paid_at = p_at, stripe_payment_method_id = coalesce(stripe_payment_method_id, p_payment_method_id)
  where id = v_share.id
  returning * into v_share;

  return jsonb_build_object('result', 'captured', 'share_id', v_share.id, 'booking_id', v_share.booking_id)
         || case when v_was = 'pending' then public.booker_share_settled(v_share, p_payment_method_id)
                 else jsonb_build_object('guarantee_id', null, 'guarantee_due', false) end;
end;
$$;

create or replace function public.share_captured(p_share_id uuid, p_amount_cents integer, p_stripe_fee_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.booking_payment_shares;
  v_booking_status text;
begin
  select * into v_share from public.booking_payment_shares where id = p_share_id for update;
  if v_share.id is null or v_share.stripe_payment_intent_id is null then
    raise exception 'share_not_found';
  end if;
  if p_amount_cents is distinct from v_share.amount_cents then
    raise exception 'amount_mismatch';
  end if;
  perform public.record_intent_capture(v_share.booking_id, v_share.id, null, v_share.stripe_payment_intent_id,
                                       p_amount_cents, v_share.fee_cents, p_stripe_fee_cents, 'share_taken');
  if v_share.status in ('credited', 'forfeited', 'refund_due') then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select status into v_booking_status from public.venue_bookings where id = v_share.booking_id;
  if v_booking_status = 'cancelled' or v_share.status in ('cancelled', 'refunded') then
    return jsonb_build_object('result', 'refund', 'booking_id', v_share.booking_id, 'share_id', v_share.id,
                              'reason', 'booking_cancelled');
  end if;
  if v_share.status <> 'authorized' then
    return jsonb_build_object('result', 'duplicate');
  end if;
  update public.booking_payment_shares set status = 'paid', paid_at = now() where id = p_share_id;
  return jsonb_build_object('result', 'captured', 'share_id', v_share.id);
end;
$$;

-- A spot whose share was cancelled, credited, forfeited or refunded is
-- free again (spec 13: cancelling releases the spot). Otherwise as in
-- pay_modes_booking.
create or replace function public.add_booking_share_internal(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_total_needed integer;
  v_share_cents integer;
  v_current_count integer;
  v_share record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.amount_cents = 0 or v_booking.status = 'cancelled' then
    return;
  end if;

  v_total_needed := public.booking_total_shares_needed(p_booking_id);

  select count(*) into v_current_count
  from public.booking_payment_shares
  where booking_id = p_booking_id and status not in ('cancelled', 'refunded', 'credited', 'forfeited', 'refund_due');

  if v_current_count >= v_total_needed then
    return;
  end if;

  if v_booking.payment_mode is not null then
    select * into v_share from public.money_share(
      v_booking.amount_cents, v_booking.capacity, v_booking.payment_mode, false,
      exists (select 1 from public.profiles where id = p_profile_id and is_premium), 'card');
    insert into public.booking_payment_shares
      (booking_id, profile_id, amount_cents, pitch_cents, fee_cents, cash_cents, is_booker, status)
    values
      (p_booking_id, p_profile_id, v_share.card_cents, v_share.pitch_cents, v_share.fee_cents, v_share.cash_cents, false,
       case when v_booking.payment_mode = 'pay_all' then 'covered' else 'pending' end)
    on conflict (booking_id, profile_id) do nothing;
    return;
  end if;

  v_share_cents := v_booking.amount_cents / v_total_needed
                   + coalesce(v_booking.service_fee_cents_per_player, 0);

  insert into public.booking_payment_shares (booking_id, profile_id, amount_cents, is_booker, status)
  values (p_booking_id, p_profile_id, v_share_cents, false, 'pending')
  on conflict (booking_id, profile_id) do nothing;
end;
$$;

revoke all on function public.money_format_euros(integer) from public, anon, authenticated;
grant execute on function public.money_format_euros(integer) to service_role;
revoke all on function public.cancellation_issue_credit(public.booking_cancellation_lines, text) from public, anon, authenticated;
grant execute on function public.cancellation_issue_credit(public.booking_cancellation_lines, text) to service_role;
revoke all on function public.cancel_booking_internal(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_booking_internal(uuid, text, uuid, text) to service_role;
