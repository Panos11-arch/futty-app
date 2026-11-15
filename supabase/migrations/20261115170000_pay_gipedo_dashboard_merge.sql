-- P8 and P6 both changed four functions, and P6's migrations run later
-- (20261113220547+), so on master they undid P8's Gipedo Pano changes:
--   - P8 renamed cancellation_plan, cancel_booking_internal and
--     booking_detail to *_modes and put a Gipedo Pano wrapper in front of
--     each; P6 then replaced the wrappers with full copies of the old
--     functions plus its own changes (counter bookings refused, ticked cash
--     in cancellations), so the wrappers were gone and *_modes was unused.
--   - add_booking_share_internal: P8 made a player who joins a Gipedo Pano
--     booking play covered; P6's copy, with the counter check, dropped that.
-- This puts P6's versions in as the *_modes functions, restores P8's
-- wrappers on top, and gives add_booking_share_internal both changes. No
-- rule changes: each function now does exactly what P6 and P8 each meant.
-- CREATE OR REPLACE keeps every grant.


-- 1. P6's versions become the inner functions P8's wrappers call.

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

    -- Ticked cash (decided 13 November, Dimitris; for Panos to confirm)
    -- follows the cancellation rules as if it had been paid by card, beside
    -- the card amounts above, which alone reach Stripe: it goes back where a
    -- card player gets money back (the venue cancelling, a cancel in the
    -- free hour, a whole-team cancel more than 6 hours before kickoff); in
    -- the middle window the €1 is kept over card and cash together and the
    -- rest of the cash becomes credit at the venue; a late cancel keeps it.
    v_cash := coalesce((select sum(m.venue_cents) from public.money_ledger m
                        where m.share_id = v_share.id and m.kind = 'cash_received'), 0);
    v_cash_back := 0;
    v_cash_credit := 0;
    if v_cash > 0 then
      if p_scope = 'venue' then
        v_cash_back := v_cash;
      elsif p_scope = 'my_spot' or v_share.is_booker then
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
                                           v_keep_unit * case when v_booking.payment_mode = 'pay_all'
                                                              then v_booking.capacity else 1 end)
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
      'credit_used_cents', case when v_has_money then v_share.credit_cents else 0 end,
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

  if p_scope <> 'my_spot' then
    select * into v_guarantee from public.booking_guarantees where booking_id = p_booking_id and status <> 'cancelled';
    if v_guarantee.id is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'share_id', null, 'guarantee_id', v_guarantee.id, 'profile_id', v_guarantee.profile_id, 'is_booker', true,
        'window', null, 'action', 'release', 'paid_cents', 0, 'fee_cents', 0, 'credit_used_cents', 0,
        'value_cents', 0, 'kept_cents', 0, 'credit_cents', 0, 'refund_cents', 0, 'needs_capture', false,
        'stripe_intent_id', v_guarantee.stripe_payment_intent_id,
        'cash_cents', 0, 'cash_back_cents', 0, 'cash_credit_cents', 0));
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
$function$;

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
      stripe_intent_id, reason, work, next_attempt_at, choose_by, cash_cents, cash_back_cents, cash_credit_cents)
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
      case when v_line ->> 'action' = 'refund_choice' then now() + interval '48 hours' end,
      coalesce((v_line ->> 'cash_cents')::integer, 0), coalesce((v_line ->> 'cash_back_cents')::integer, 0),
      coalesce((v_line ->> 'cash_credit_cents')::integer, 0))
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
$function$;

CREATE OR REPLACE FUNCTION public.booking_detail_modes(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_booking public.venue_bookings;
  v_venue public.venues;
  v_me public.booking_payment_shares;
  v_is_booker boolean;
  v_kickoff timestamptz;
  v_refunds_stop timestamptz;
  v_active boolean;
  v_free_until timestamptz;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if v_booking.id is null
     or not (v_booking.created_by = v_uid
             or exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.profile_id = v_uid)) then
    raise exception 'booking_not_found';
  end if;
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
  select * into v_venue from public.venues where id = v_booking.venue_id;
  select * into v_me from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid
  order by (status not in ('cancelled', 'refunded')) desc, created_at desc
  limit 1;
  v_is_booker := v_booking.created_by = v_uid;
  v_kickoff := public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time);
  v_refunds_stop := v_kickoff - interval '6 hours';
  v_active := v_booking.status <> 'cancelled' and now() < v_kickoff;

  if v_me.status = 'authorized' and v_me.capture_due_at > now() then
    v_free_until := v_me.capture_due_at;
  end if;
  if v_active then
    if v_free_until is not null and v_free_until < v_refunds_stop then
      v_next := jsonb_build_object('kind', 'free_hour_ends', 'at', v_free_until);
    elsif now() < v_refunds_stop then
      v_next := jsonb_build_object('kind', 'refunds_stop', 'at', v_refunds_stop);
    end if;
  end if;

  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', v_booking.id, 'status', v_booking.status, 'booking_day', v_booking.booking_day,
      'start_time', v_booking.start_time, 'end_time', v_booking.end_time, 'format', v_booking.format,
      'capacity', v_booking.capacity,
      'players_per_side', v_booking.capacity / 2,
      'payment_mode', v_booking.payment_mode,
      'kickoff_at', v_kickoff,
      'ends_at', public.booking_ends_at(v_booking.booking_day, v_booking.end_time),
      'refunds_stop_at', v_refunds_stop,
      'payment_window_ends_at', case when v_booking.status = 'pending_payment'
                                     then public.booking_payment_window_ends_at(v_booking) end),
    'venue', jsonb_build_object(
      'id', v_venue.id, 'name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address,
      'google_maps_link', v_venue.google_maps_link,
      'photo_path', (select p.storage_path from public.venue_photos p where p.venue_id = v_venue.id
                     order by p.pitch_id nulls first, p.sort_order, p.storage_path limit 1)),
    'is_booker', v_is_booker,
    'me', case when v_me.id is null then null else jsonb_build_object(
      'share_id', v_me.id, 'status', v_me.status, 'payment_method', v_me.payment_method,
      'amount_cents', v_me.amount_cents, 'pitch_cents', v_me.pitch_cents, 'fee_cents', v_me.fee_cents,
      'cash_cents', v_me.cash_cents, 'free_until', v_free_until) end,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'profile_id', s.profile_id,
               'name', public.profile_display_name(s.profile_id),
               'username', p.username,
               'is_booker', s.is_booker,
               'is_me', s.profile_id = v_uid,
               'state', case
                          when s.status = 'covered' then 'covered'
                          when s.status = 'pending' then 'unpaid'
                          when s.payment_method = 'cash' and s.cash_received_at is not null then 'cash_paid'
                          when s.payment_method = 'cash' then 'cash'
                          else 'in_app' end,
               'amount_cents', case when v_is_booker or s.profile_id = v_uid then s.amount_cents end,
               'cash_cents', case when v_is_booker or s.profile_id = v_uid then s.cash_cents end)
             order by s.is_booker desc, s.created_at, s.id)
      from public.booking_payment_shares s
      left join public.profiles p on p.id = s.profile_id
      where s.booking_id = p_booking_id and s.status not in ('cancelled', 'refunded')), '[]'::jsonb),
    'next_cutoff', v_next,
    'can_cancel', jsonb_build_object(
      'my_spot', v_active and v_me.id is not null and v_me.status not in ('cancelled', 'refunded')
                 and not (v_me.is_booker and v_booking.payment_mode = 'pay_all'),
      'whole_team', v_active and v_is_booker)
  );
end;
$function$;

-- 2. P8's wrappers, as P8 last defined them.

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
begin
  if p_scope in ('my_spot', 'whole_team') and exists (
       select 1 from public.venue_bookings b
       where b.id = p_booking_id and b.payment_mode = 'gipedo_pano' and b.status <> 'cancelled'
         and (b.created_by = p_profile_id
              or exists (select 1 from public.booking_payment_shares s
                         where s.booking_id = b.id and s.profile_id = p_profile_id and s.gipedo_side is not null
                           and s.status in ('pending', 'authorized'))))
  then
    raise exception 'use_gipedo_pull_out';
  end if;
  return public.cancellation_plan_modes(p_booking_id, p_scope, p_profile_id, p_at);
end;
$$;

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
begin
  if p_scope in ('whole_team', 'venue') then
    perform 1 from public.venue_bookings where id = p_booking_id for update;
    perform 1 from public.gipedo_settlements where booking_id = p_booking_id and status = 'due' for update;
    if exists (select 1 from public.gipedo_settlements g
               where g.booking_id = p_booking_id and g.status = 'due' and g.claimed_at is not null) then
      raise exception 'payment_in_progress';
    end if;
    update public.gipedo_settlements
    set status = 'cancelled', outcome = 'cancelled', done_at = now()
    where booking_id = p_booking_id and status = 'due' and reason in ('play_normal', 'pull_out_fee');
  end if;
  return public.cancel_booking_internal_modes(p_booking_id, p_scope, p_profile_id, p_expected_quote);
end;
$$;

create or replace function public.booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_detail jsonb := public.booking_detail_modes(p_booking_id);
  v_booking public.venue_bookings;
  v_post public.squad_posts;
  v_mine public.booking_payment_shares;
  v_opponent public.booking_payment_shares;
  v_booker_hold public.booking_payment_shares;
  v_settlement public.gipedo_settlements;
  v_pull jsonb;
  v_roster jsonb;
begin
  select * into v_booking from public.venue_bookings where id = p_booking_id;
  if not exists (select 1 from public.booking_payment_shares s where s.booking_id = p_booking_id and s.gipedo_side is not null) then
    return v_detail || jsonb_build_object('gipedo', null);
  end if;
  select * into v_post from public.squad_posts
  where venue_booking_id = p_booking_id and type = 'opposition' order by created_at desc limit 1;
  select * into v_mine from public.booking_payment_shares
  where booking_id = p_booking_id and profile_id = v_uid and gipedo_side is not null;
  select * into v_opponent from public.booking_payment_shares s
  where s.booking_id = p_booking_id and s.gipedo_side = 'b' and s.status in ('pending', 'authorized')
    and not exists (select 1 from public.gipedo_settlements g where g.share_id = s.id and g.reason = 'pull_out_fee');
  select * into v_booker_hold from public.booking_payment_shares
  where booking_id = p_booking_id and is_booker and gipedo_side = 'a';
  select * into v_settlement from public.gipedo_settlements where share_id = v_mine.id;
  v_pull := public.gipedo_pull_out_quote(p_booking_id, v_uid);
  -- A captain's card that is only held shows as held, not paid; one whose
  -- hold expired as unpaid.
  select coalesce(jsonb_agg(case when s.gipedo_side is not null and s.status = 'authorized'
                                 then r.e || jsonb_build_object('state', 'held')
                                 when s.gipedo_side is not null and s.status = 'expired'
                                 then r.e || jsonb_build_object('state', 'unpaid')
                                 else r.e end order by r.ord), '[]'::jsonb)
    into v_roster
  from jsonb_array_elements(v_detail -> 'roster') with ordinality as r(e, ord)
  left join public.booking_payment_shares s on s.id = (r.e ->> 'share_id')::uuid;

  return v_detail
    || jsonb_build_object('roster', v_roster)
    || jsonb_build_object('can_cancel', case when v_mine.id is not null and v_booking.payment_mode = 'gipedo_pano'
                                             then jsonb_build_object('my_spot', false, 'whole_team', false)
                                             else v_detail -> 'can_cancel' end)
    || jsonb_build_object('gipedo', jsonb_build_object(
      'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = v_booking.team_id),
      'opponent', jsonb_build_object(
        'state', case when v_opponent.status = 'authorized' then 'held' when v_opponent.id is not null then 'offered' else 'none' end,
        'team', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t
                 where t.id = v_post.matched_team_id and v_opponent.id is not null)),
      'my_side', v_mine.gipedo_side,
      'pull_out', v_pull - 'share_id' - 'side',
      'choice_due', v_booking.created_by = v_uid and v_booking.payment_mode = 'gipedo_pano'
                    and v_booking.status = 'confirmed' and v_booking.gipedo_no_opponent_at is not null
                    and v_booking.gipedo_choice is null
                    and now() < public.booking_kickoff_at(v_booking.booking_day, v_booking.start_time) - interval '6 hours',
      'choice', v_booking.gipedo_choice,
      'play_normal_cents', case when v_booking.created_by = v_uid then v_booker_hold.amount_cents end,
      'settlement', case when v_settlement.id is null then null else jsonb_build_object(
        'reason', v_settlement.reason, 'capture_cents', v_settlement.capture_cents, 'status', v_settlement.status) end));
end;
$$;

-- 3. Both changes: covered for Gipedo Pano (P8), counter bookings refused (P6).

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
  -- A walk-in or phone booking is never an app booking.
  if v_booking.booking_type = 'counter' then
    raise exception 'counter_booking';
  end if;
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
       case when v_booking.payment_mode in ('pay_all', 'gipedo_pano') then 'covered' else 'pending' end)
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
