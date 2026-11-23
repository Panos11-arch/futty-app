-- B1c, part 2c (Booking v2, spec 13 "Cancellations (Booking v2)", decided
-- 20 and 23 November): today's cancellation rules apply per side, and each
-- captain is the booker of his own half. On a half pitch a captain's
-- "Cancel the whole team" cancels his side:
--   * his side's money follows today's rules: "pay for everyone" keeps €1 for
--     each of his side's players in the middle window; "pay for myself"
--     charges him €1 for each of his side's players who paid; only his own
--     guarantee is released;
--   * the booking goes only with its last side;
--   * side B leaves: the invite reopens; within 24 hours of kickoff the
--     24-hour choice applies again;
--   * side A leaves: side B keeps the slot and becomes side A, its captain the
--     booker, and the invite reopens on his behalf (with the 24-hour choice
--     his within 24 hours);
--   * under 6 hours before kickoff no money comes back and nothing reopens:
--     the side is marked as left and the game goes ahead;
--   * after "Pay the whole pitch and play" his two payments are one "pay for
--     everyone" booking: the other half's payment is a cancellation line of
--     its own (other_half_id), €1 for each of its players kept in the middle
--     window and the rest credit (€10 and €35.50 in all on a €40 pitch).
-- Re-created from their latest definitions, with only these changes:
-- cancellation_plan_modes (20261116124400_pay_switching.sql) and
-- cancel_booking_internal_modes (20261115190000_pay_app_rules.sql). Collection
-- per side and the odd-cent ledger row are part 2d.

alter table public.booking_sides add column left_at timestamptz;
alter table public.booking_cancellation_lines
  add column other_half_id uuid references public.booking_other_half_payments (id) on delete cascade;
alter table public.booking_cancellation_lines drop constraint booking_cancellation_lines_one_target;
alter table public.booking_cancellation_lines add constraint booking_cancellation_lines_one_target
  check (num_nonnulls(share_id, guarantee_id, other_half_id) = 1);

insert into public.notification_types (type, always_sent) values ('opposition_left', true)
on conflict (type) do nothing;

-- After a captain cancelled his side of a half pitch that had two.
create or replace function public.booking_side_left(p_booking_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.venue_bookings;
  v_left public.booking_sides;
  v_stays public.booking_sides;
  v_kickoff timestamptz;
  v_name text;
  v_money record;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id for update;
  select * into v_left from public.booking_sides
  where booking_id = p_booking_id and captain_id = p_profile_id and left_at is null order by side limit 1;
  select * into v_stays from public.booking_sides
  where booking_id = p_booking_id and side <> v_left.side and left_at is null;
  if v_left.booking_id is null or v_stays.booking_id is null then
    return;
  end if;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  select coalesce(username, full_name, 'The other captain') into v_name from public.profiles where id = p_profile_id;

  -- Under 6 hours: nothing comes back and nothing reopens; the game goes ahead.
  if now() >= v_kickoff - public.rule_refund_cutoff() then
    update public.booking_sides set left_at = now() where booking_id = p_booking_id and side = v_left.side;
    perform public.send_notification(v_stays.captain_id, 'opposition_left', jsonb_build_object(
      'title', 'The other side cancelled',
      'body', format('%s cancelled their side of %s less than %s before kickoff. Your game goes ahead.',
                     v_name, public.booking_label(v_booking), public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', p_booking_id));
    return;
  end if;

  delete from public.booking_sides where booking_id = p_booking_id and side = v_left.side;
  if v_left.side = 'a' then
    -- Side B keeps the slot: it becomes side A, its captain the booker.
    update public.booking_sides set side = 'a' where booking_id = p_booking_id and side = 'b';
    update public.booking_payment_shares set side = 'a' where booking_id = p_booking_id and side = 'b';
    update public.booking_payment_shares set is_booker = (profile_id = v_stays.captain_id)
    where booking_id = p_booking_id and (is_booker or profile_id = v_stays.captain_id);
    update public.venue_bookings set created_by = v_stays.captain_id where id = p_booking_id;
    v_stays.side := 'a';
  end if;

  if now() >= v_kickoff - public.rule_gipedo_opponent_lead() then
    -- Within 24 hours: the 24-hour choice applies again.
    update public.venue_bookings set no_opponent_at = now(), no_opponent_choice = null where id = p_booking_id;
    select * into v_booking from public.venue_bookings where id = p_booking_id;
    select * into v_money from public.no_opponent_amounts(v_booking, v_stays);
    perform public.send_notification(v_stays.captain_id, 'no_opponent', jsonb_build_object(
      'title', 'No opponent any more',
      'body', format('%s cancelled their side of %s. Pay the whole pitch and play for %s more, or cancel free and '
                     || 'everyone gets their money back. If you don''t choose by %s before kickoff, it''s cancelled free.',
                     v_name, public.booking_label(v_booking), public.money_format_euros(v_money.amount_cents),
                     public.rule_duration_words(public.rule_refund_cutoff())),
      'bookingId', p_booking_id));
  else
    update public.venue_bookings set no_opponent_at = null, no_opponent_choice = null where id = p_booking_id;
  end if;

  perform public.send_notification(v_stays.captain_id, 'opposition_left', jsonb_build_object(
    'title', case when v_left.side = 'a' then 'The slot is yours' else 'Your opponent cancelled' end,
    'body', case when v_left.side = 'a'
                 then format('%s cancelled their half of %s. The slot is yours: invite an opponent.', v_name, public.booking_label(v_booking))
                 else format('%s cancelled their side of %s, so your invite is open again.', v_name, public.booking_label(v_booking)) end,
    'bookingId', p_booking_id));
end;
$$;

-- As in 20261116124400_pay_switching.sql, with the B1c changes marked.
CREATE OR REPLACE FUNCTION public.cancellation_plan_modes(p_booking_id uuid, p_scope text, p_profile_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_cash integer;
  v_cash_back integer;
  v_cash_credit integer;
  v_cash_share public.booking_payment_shares;
  v_cash_window text;
  v_switch_back integer;
  v_switch_new integer;
  v_card_left integer;
  v_credit_left integer;
  v_side public.booking_sides;                 -- B1c: on a half pitch, the side its captain cancels
  v_both boolean := false;                     -- B1c: he captains both sides (he paid the whole pitch)
  v_lone boolean := true;                      -- B1c: no other side left, so the booking goes
  v_team_players integer;                      -- B1c: the players a "pay for everyone" payment covered
  v_other public.booking_other_half_payments;  -- B1c: "Pay the whole pitch and play"
  v_captain_window text;
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

  -- B1c: on a half pitch each captain is the booker of his own half: his
  -- "whole team" is his side (both sides, once he paid the whole pitch).
  if v_booking.booking_kind = 'half' and p_scope = 'whole_team' then
    select * into v_side from public.booking_sides
    where booking_id = p_booking_id and captain_id = p_profile_id and left_at is null
    order by side limit 1;
    if v_side.booking_id is null then
      raise exception 'not_your_booking';
    end if;
    v_both := (select count(*) from public.booking_sides
               where booking_id = p_booking_id and captain_id = p_profile_id and left_at is null) = 2;
    v_lone := v_both or (select count(*) from public.booking_sides
                         where booking_id = p_booking_id and left_at is null) = 1;
  end if;
  if p_scope = 'whole_team' and v_booking.created_by is distinct from p_profile_id and v_side.booking_id is null then
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
    -- B1c: a captain whose side paid for everyone cancels his side.
    if v_booking.booking_kind = 'half' and exists (
         select 1 from public.booking_sides s
         where s.booking_id = p_booking_id and s.captain_id = p_profile_id and s.payment_mode = 'pay_all' and s.left_at is null) then
      raise exception 'use_whole_team';
    end if;
  end if;

  v_late_team := p_at > v_kickoff - public.rule_refund_cutoff();
  v_keep_unit := public.rule_cancel_fee_cents();
  -- €1 for each player a "pay for everyone" payment covered: the booking's,
  -- or on a half pitch the captain's side's (B1c). One for a player's spot.
  v_team_players := case
    when v_side.booking_id is not null then case when v_side.payment_mode = 'pay_all' then v_side.players else 1 end
    when v_booking.booking_kind = 'half' then 1
    when v_booking.payment_mode = 'pay_all' then coalesce(v_booking.booked_capacity, v_booking.capacity)
    else 1 end;

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
      and (v_side.booking_id is null or v_both or s.side = v_side.side)
    order by s.is_booker desc, s.created_at, s.id
  loop
    v_kept := 0;
    v_credit := 0;
    v_refund := 0;
    v_capture := false;
    v_window := null;
    -- P12: what a switch to more players already gave back is not the
    -- player's any more. Its credit came back to the credit that paid for
    -- the share first; the rest came out of the card part (or the cash).
    v_switch_back := case when v_share.switch_credit_issued_at is not null then v_share.switch_credit_back_cents else 0 end;
    v_switch_new := case when v_share.switch_credit_issued_at is not null
                         then v_share.switch_credit_cents - v_share.switch_credit_back_cents else 0 end;
    v_card_left := v_share.amount_cents - case when v_share.payment_method = 'card' then v_switch_new else 0 end;
    v_credit_left := v_share.credit_cents - v_switch_back;

    if v_share.status = 'forfeited' then
      v_card_taken := v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null
        and exists (select 1 from public.money_ledger m
                    where m.kind = 'capture' and m.stripe_id = v_share.stripe_payment_intent_id);
      v_window := 'venue';
      if v_share.amount_cents > 0 and v_share.stripe_payment_intent_id is not null and not v_card_taken then
        -- The card part was never taken: whatever hold is left is released.
        v_paid := v_share.amount_cents;
        v_value := v_paid + v_credit_left;
        v_action := 'release';
      else
        v_paid := case when v_card_taken then v_card_left else 0 end;
        v_value := v_paid + v_credit_left;
        v_action := case when v_value > 0 then 'refund_choice' else 'none' end;
        if v_value = 0 then
          v_window := null;
        end if;
      end if;
      v_refund := v_value;
      v_has_money := v_value > 0;
    else
      v_has_money := v_share.status in ('authorized', 'paid') and v_share.amount_cents + v_share.credit_cents > 0;
      v_value := case when v_has_money then v_card_left + v_credit_left else 0 end;
      v_paid := case when v_has_money then v_card_left else 0 end;

      if not v_has_money then
        v_action := case when v_share.stripe_payment_intent_id is not null and v_share.status = 'pending'
                         then 'release' else 'none' end;
      elsif p_scope = 'venue' then
        v_window := 'venue';
        v_action := case when v_share.status = 'authorized' then 'release' else 'refund_choice' end;
        v_refund := v_value;
      elsif p_scope = 'my_spot' or v_share.is_booker or v_share.profile_id = v_side.captain_id then
        v_window := public.cancellation_window(v_share, v_kickoff, p_at);
        if v_window = 'free' then
          v_action := 'release';
          v_refund := v_value;
        elsif v_window = 'middle' then
          v_kept := least(v_value, v_keep_unit * v_team_players);
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

    -- Ticked cash (decided 13 November, Dimitris; for Panos to confirm)
    -- follows the cancellation rules as if it had been paid by card, beside
    -- the card amounts above, which alone reach Stripe: it goes back where a
    -- card player gets money back (the venue cancelling, a cancel in the
    -- free hour, a whole-team cancel more than 6 hours before kickoff); in
    -- the middle window the €1 is kept over card and cash together and the
    -- rest of the cash becomes credit at the venue; a late cancel keeps it.
    v_cash := coalesce((select sum(m.venue_cents) from public.money_ledger m
                        where m.share_id = v_share.id and m.kind = 'cash_received'), 0)
              - case when v_share.payment_method = 'cash' then v_switch_new else 0 end;
    v_cash_back := 0;
    v_cash_credit := 0;
    if v_cash > 0 then
      if p_scope = 'venue' then
        v_cash_back := v_cash;
      elsif p_scope = 'my_spot' or v_share.is_booker or v_share.profile_id = v_side.captain_id then
        -- The window a card player who paid then would be in; with nothing
        -- paid in the app, the cash is the payment.
        v_cash_share := v_share;
        if v_cash_share.held_at is null and v_cash_share.paid_at is null then
          v_cash_share.held_at := v_cash_share.cash_received_at;
          v_cash_share.capture_due_at := null;
        end if;
        v_cash_window := public.cancellation_window(v_cash_share, v_kickoff, p_at);
        if v_cash_window = 'free' then
          v_cash_back := v_cash;
        elsif v_cash_window = 'middle' then
          v_cash_credit := v_cash - (least(v_value + v_cash,
                                           v_keep_unit * v_team_players)
                                     - v_kept);
          if v_cash_credit > 0 and v_action in ('keep', 'none') then
            v_action := 'keep_and_credit';
          end if;
        end if;
        v_window := coalesce(v_window, v_cash_window);
      elsif not v_late_team then
        v_cash_back := v_cash;
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
      'credit_used_cents', case when v_has_money then v_credit_left else 0 end,
      'value_cents', v_value,
      'kept_cents', v_kept,
      'credit_cents', v_credit,
      'refund_cents', v_refund,
      'needs_capture', v_capture,
      'stripe_intent_id', v_share.stripe_payment_intent_id,
      'cash_cents', v_cash,
      'cash_back_cents', v_cash_back,
      'cash_credit_cents', v_cash_credit
    ));
  end loop;

  -- B1c: a booking can have a guarantee per captain; a captain cancelling
  -- his side releases his own.
  if p_scope <> 'my_spot' then
    for v_guarantee in
      select * from public.booking_guarantees
      where booking_id = p_booking_id and status <> 'cancelled'
        and (v_side.booking_id is null or profile_id = v_side.captain_id)
      order by created_at, id
    loop
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'share_id', null, 'guarantee_id', v_guarantee.id, 'profile_id', v_guarantee.profile_id, 'is_booker', true,
        'window', null, 'action', 'release', 'paid_cents', 0, 'fee_cents', 0, 'credit_used_cents', 0,
        'value_cents', 0, 'kept_cents', 0, 'credit_cents', 0, 'refund_cents', 0, 'needs_capture', false,
        'stripe_intent_id', v_guarantee.stripe_payment_intent_id,
        'cash_cents', 0, 'cash_back_cents', 0, 'cash_credit_cents', 0));
    end loop;
  end if;

  -- B1c: after "Pay the whole pitch and play", his two payments are one
  -- "pay for everyone" booking (decided 23 November): the other half
  -- follows his first payment's window, €1 for each of its players kept in
  -- the middle window and the rest credit at the venue.
  if v_side.booking_id is not null then
    select * into v_other from public.booking_other_half_payments
    where booking_id = p_booking_id and profile_id = p_profile_id and status = 'paid';
    if v_other.id is not null then
      select public.cancellation_window(s, v_kickoff, p_at) into v_captain_window
      from public.booking_payment_shares s where s.booking_id = p_booking_id and s.profile_id = p_profile_id;
      v_kept := case v_captain_window
        when 'free' then 0
        when 'middle' then least(v_other.amount_cents, v_keep_unit * (v_booking.capacity / 2))
        else v_other.amount_cents end;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'share_id', null, 'guarantee_id', null, 'other_half_id', v_other.id, 'profile_id', p_profile_id, 'is_booker', true,
        'window', v_captain_window,
        'action', case
          when v_captain_window = 'free' then 'refund_choice'
          when v_captain_window = 'middle' and v_other.amount_cents > v_kept then 'keep_and_credit'
          else 'keep' end,
        'paid_cents', v_other.amount_cents, 'fee_cents', v_other.fee_cents, 'credit_used_cents', 0,
        'value_cents', v_other.amount_cents, 'kept_cents', v_kept,
        'credit_cents', case when v_captain_window = 'middle' then v_other.amount_cents - v_kept else 0 end,
        'refund_cents', case when v_captain_window = 'free' then v_other.amount_cents else 0 end,
        'needs_capture', false, 'stripe_intent_id', v_other.stripe_payment_intent_id,
        'cash_cents', 0, 'cash_back_cents', 0, 'cash_credit_cents', 0));
    end if;
  end if;

  -- B1c: on a half pitch, his side's players and his own charge.
  if p_scope = 'whole_team' and coalesce(v_side.payment_mode, v_booking.payment_mode) <> 'pay_all' and not v_late_team then
    select count(*) into v_taken from public.booking_payment_shares
    where booking_id = p_booking_id and not is_booker and status = 'paid' and amount_cents > 0
      and (v_side.booking_id is null or (profile_id <> v_side.captain_id and (v_both or side = v_side.side)));
    if v_taken > 0 then
      v_fee := jsonb_build_object('profile_id', coalesce(v_side.captain_id, v_booking.created_by), 'players', v_taken,
                                  'amount_cents', public.rule_cancel_fee_cents() * v_taken);
    end if;
  end if;

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'scope', p_scope,
    'payment_mode', v_booking.payment_mode,
    'kickoff_at', v_kickoff,
    'refunds_stop_at', v_kickoff - public.rule_refund_cutoff(),
    'cancels_booking', p_scope <> 'my_spot' and v_lone,
    'side', v_side.side,
    'lines', v_lines,
    'booker_fee', v_fee,
    'quote', md5(jsonb_build_object('booking_id', p_booking_id, 'scope', p_scope, 'lines', v_lines,
                                    'booker_fee', v_fee)::text)
  );
end;
$function$;

-- As in 20261115190000_pay_app_rules.sql, with the B1c changes marked.
CREATE OR REPLACE FUNCTION public.cancel_booking_internal_modes(p_booking_id uuid, p_scope text, p_profile_id uuid, p_expected_quote text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
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
      stripe_intent_id, reason, work, next_attempt_at, choose_by, cash_cents, cash_back_cents, cash_credit_cents, other_half_id)
    values (
      v_cancellation_id, p_booking_id, (v_line ->> 'share_id')::uuid, (v_line ->> 'guarantee_id')::uuid,
      (v_line ->> 'profile_id')::uuid, v_booking.venue_id, (v_line ->> 'is_booker')::boolean, v_line ->> 'window',
      v_line ->> 'action', (v_line ->> 'paid_cents')::integer, (v_line ->> 'fee_cents')::integer,
      (v_line ->> 'credit_used_cents')::integer, (v_line ->> 'value_cents')::integer, (v_line ->> 'kept_cents')::integer,
      (v_line ->> 'credit_cents')::integer, (v_line ->> 'refund_cents')::integer, (v_line ->> 'needs_capture')::boolean,
      v_line ->> 'stripe_intent_id', p_scope || '_' || (v_line ->> 'action'),
      case when v_work then 'pending' else 'none' end,
      case when v_line ->> 'action' = 'refund_choice' then now() + public.rule_refund_choice()
           when v_work then now() + interval '2 minutes' end,
      case when v_line ->> 'action' = 'refund_choice' then now() + public.rule_refund_choice() end,
      coalesce((v_line ->> 'cash_cents')::integer, 0), coalesce((v_line ->> 'cash_back_cents')::integer, 0),
      coalesce((v_line ->> 'cash_credit_cents')::integer, 0), (v_line ->> 'other_half_id')::uuid)
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
    -- Ticked cash a card player would get back: the venue hands it back
    -- (once; a reversing cash_received row).
    if v_row.cash_back_cents > 0 then
      perform public.reverse_cash_received(v_row.share_id);
    end if;
  end loop;

  -- B1c: on a half pitch a captain's cancel ends his side; the booking goes
  -- only with its last side.
  if (v_plan ->> 'cancels_booking')::boolean then
    update public.venue_bookings set status = 'cancelled' where id = p_booking_id;
  elsif p_scope = 'whole_team' then
    perform public.booking_side_left(p_booking_id, p_profile_id);
  end if;

  if v_plan -> 'booker_fee' <> 'null'::jsonb then
    select coalesce(s.stripe_payment_method_id, g.stripe_payment_method_id) into v_pm
    from public.booking_payment_shares s
    left join public.booking_guarantees g on g.booking_id = s.booking_id and g.profile_id = s.profile_id
    where s.booking_id = p_booking_id and s.profile_id = (v_plan -> 'booker_fee' ->> 'profile_id')::uuid;
    insert into public.booking_cancellation_fees (cancellation_id, booking_id, profile_id, players, amount_cents,
      stripe_customer_id, stripe_payment_method_id, next_attempt_at, stop_at)
    values (v_cancellation_id, p_booking_id, (v_plan -> 'booker_fee' ->> 'profile_id')::uuid,
      (v_plan -> 'booker_fee' ->> 'players')::integer,
      (v_plan -> 'booker_fee' ->> 'amount_cents')::integer,
      (select stripe_customer_id from public.profiles where id = (v_plan -> 'booker_fee' ->> 'profile_id')::uuid), v_pm,
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
    v_who := case when p_scope = 'venue' then v_venue_name
                  when v_booking.booking_kind = 'half' then 'Your captain' else 'The booker' end;
    for v_row in
      select * from public.booking_cancellation_lines
      where cancellation_id = v_cancellation_id and share_id is not null and profile_id <> p_profile_id
    loop
      v_body := format('%s cancelled your game at %s on %s at %s. ', v_who, v_venue_name,
                       to_char(v_booking.booking_day, 'FMDay DD Mon'), to_char(v_booking.start_time, 'HH24:MI'))
        || case v_row.action
             when 'refund_choice' then format('You get %s back. Choose venue credit within ' || public.rule_duration_words(public.rule_refund_choice()) || ', or it goes back to your card.',
                                              public.money_format_euros(v_row.refund_cents))
             when 'release' then case when v_row.refund_cents > 0 then 'Your payment hold was released, so you won''t be charged.'
                                      else 'You weren''t charged.' end
             when 'keep' then 'It was cancelled less than ' || public.rule_duration_words(public.rule_refund_cutoff()) || ' before kickoff, so no money goes back.'
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
$function$;

revoke all on function public.booking_side_left(uuid, uuid) from public, anon, authenticated;
grant execute on function public.booking_side_left(uuid, uuid) to service_role;
