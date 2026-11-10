-- P4b: what a cancellation does to every player's money
-- (docs/specs/13-payments-bookings.md, "Cancellations and refunds", and the
-- 10 November decisions). ONE computation, cancellation_plan: the quote the
-- app shows (cancellation_quote) and the cancellation itself
-- (cancel_booking_internal) both run it, and the cancellation is refused
-- unless the player confirmed exactly the quote it computes now, so the
-- screen can never promise something different from what happens.
--
-- Scopes:
--   my_spot     a player cancels their own spot (the booker too, in an
--               each-pays booking); the booking stays on
--   whole_team  the booker cancels the booking
--   venue       the venue's staff cancel the booking
--
-- A player's own share (my_spot, or the booker's own share in whole_team):
--   free    within the free hour (60 minutes after paying, or 6 hours
--           before kickoff if sooner), when paid more than 6 hours before
--           kickoff: everything back (the hold is cancelled);
--   middle  from the end of the free hour until 6 hours before kickoff: 100
--           kept per player (per player in the booking when the booker paid
--           for everyone), the rest becomes credit at that venue;
--   late    less than 6 hours before kickoff, or the share was paid less
--           than 6 hours before kickoff: nothing back.
-- The other players when the booker cancels the team: a payment only held
-- is released; a payment taken goes back in full, card or credit, their
-- choice within 48 hours; less than 6 hours before kickoff nothing goes
-- back. The booker pays 100 for each other player whose payment was taken,
-- when the team is cancelled more than 6 hours before kickoff.
-- The venue cancels: every share goes back in full (a hold released, a
-- payment taken refunded or credited, the player's choice).

-- Which window a player's own share is in at p_at. Exactly 6 hours before
-- kickoff is not "less than 6 hours" (as money_is_non_refundable).
create or replace function public.cancellation_window(
  p_share public.booking_payment_shares,
  p_kickoff timestamptz,
  p_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paid_at timestamptz := coalesce(p_share.held_at, p_share.paid_at);
begin
  -- Paid less than 6 hours before kickoff: taken at once, no free hour, ever.
  if p_share.capture_method = 'immediate'
     or (v_paid_at is not null and public.money_is_non_refundable(v_paid_at, p_kickoff)) then
    return 'late';
  end if;
  if p_at > p_kickoff - interval '6 hours' then
    return 'late';
  end if;
  if p_at < coalesce(p_share.capture_due_at, public.money_capture_due_at(v_paid_at, p_kickoff)) then
    return 'free';
  end if;
  return 'middle';
end;
$$;

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
  -- 100 per player kept in the middle window: for the booker who paid for
  -- everyone, per player in the booking.
  v_keep_unit := 100;

  for v_share in
    select * from public.booking_payment_shares
    where booking_id = p_booking_id
      and status in ('pending', 'authorized', 'paid', 'covered')
      and (p_scope <> 'my_spot' or id = v_own.id)
    order by is_booker desc, created_at, id
  loop
    v_has_money := v_share.status in ('authorized', 'paid') and v_share.amount_cents + v_share.credit_cents > 0;
    v_value := case when v_has_money then v_share.amount_cents + v_share.credit_cents else 0 end;
    v_kept := 0;
    v_credit := 0;
    v_refund := 0;
    v_capture := false;
    v_window := null;

    if not v_has_money then
      -- An open intent nobody paid is cancelled so it can't be paid later.
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

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'share_id', v_share.id,
      'guarantee_id', null,
      'profile_id', v_share.profile_id,
      'is_booker', v_share.is_booker,
      'window', v_window,
      'action', v_action,
      'paid_cents', case when v_has_money then v_share.amount_cents else 0 end,
      'fee_cents', case when v_has_money then coalesce(v_share.fee_cents, 0) else 0 end,
      'credit_used_cents', case when v_has_money then v_share.credit_cents else 0 end,
      'value_cents', v_value,
      'kept_cents', v_kept,
      'credit_cents', v_credit,
      'refund_cents', v_refund,
      'needs_capture', v_capture,
      'stripe_intent_id', v_share.stripe_payment_intent_id
    ));
  end loop;

  -- The booker's guarantee goes when the booking does.
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

  -- The booker's extra charge: 100 per other player whose payment was taken.
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

-- The app: what cancelling would do for the signed-in player, before they
-- confirm. Writes nothing. The confirmation sends back its quote.
create or replace function public.cancellation_quote(p_booking_id uuid, p_scope text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.cancellation_plan(p_booking_id, p_scope, auth.uid(), now());
$$;

revoke all on function public.cancellation_window(public.booking_payment_shares, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.cancellation_window(public.booking_payment_shares, timestamptz, timestamptz) to service_role;
revoke all on function public.cancellation_plan(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cancellation_plan(uuid, text, uuid, timestamptz) to service_role;
revoke all on function public.cancellation_quote(uuid, text) from public, anon;
grant execute on function public.cancellation_quote(uuid, text) to authenticated, service_role;
