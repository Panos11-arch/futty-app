-- B1c fix (QA 24 November, third pass part 2, P1): on a half pitch both
-- sides can cancel, one after the other. Spec 13, "Cancellations (Booking
-- v2)": today's rules apply per side, and the booking goes only with its last
-- side. Each side's cancel writes a whole_team row, but
-- booking_cancellations_once_idx (20261109180827) allowed one such row per
-- booking, so the second side got "duplicate key" and the booking stayed.
--
-- Now:
--   * each side cancels once: booking_sides gets a stable id (it stays when
--     side B is relabelled side A after side A leaves), recorded on the
--     cancellation as side_id, unique;
--   * the booking itself is cancelled once: ends_booking (the plan's
--     cancels_booking; true for every row written before B1c) is unique per
--     booking, under the old index's name.
--
-- Re-created from their latest definitions (diffs in the PR):
--   cancel_booking_internal_modes  20261123200000_pay_b1c_cancel_per_side.sql
--   my_cancellation_outcome        20261124150000_pay_cancel_hold_amounts.sql

alter table public.booking_sides add column id uuid not null default gen_random_uuid();
alter table public.booking_sides add constraint booking_sides_id_key unique (id);

-- The side a whole_team cancel ended (null for a whole pitch, a venue cancel,
-- my_spot, and rows written before this migration).
alter table public.booking_cancellations add column side_id uuid;
alter table public.booking_cancellations add column ends_booking boolean not null
  generated always as (scope <> 'my_spot' and coalesce((plan ->> 'cancels_booking')::boolean, true)) stored;

drop index public.booking_cancellations_once_idx;
create unique index booking_cancellations_once_idx on public.booking_cancellations (booking_id) where ends_booking;
create unique index booking_cancellations_side_once_idx on public.booking_cancellations (side_id) where side_id is not null;

-- As in 20261123200000_pay_b1c_cancel_per_side.sql, with the B1c fix marked.
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
  v_side_id uuid;                              -- B1c fix: the side this cancel ends
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

  -- B1c fix: on a half pitch a captain's cancel is his side's (the plan's
  -- side, still in the game: the booking row is locked above, so it can't be
  -- relabelled in between). Each side cancels once; the booking once.
  if p_scope = 'whole_team' and v_plan ->> 'side' is not null then
    select id into v_side_id from public.booking_sides
    where booking_id = p_booking_id and side = v_plan ->> 'side' and left_at is null;
  end if;

  insert into public.booking_cancellations (booking_id, scope, cancelled_by, quote, plan, side_id)
  values (p_booking_id, p_scope, p_profile_id, v_plan ->> 'quote', v_plan, v_side_id)
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


-- As in 20261124150000_pay_cancel_hold_amounts.sql, with the B1c fix marked:
-- the caller's own side of the cancellation (whole team or venue) of a
-- cancelled booking: his lines and the guarantee hold it released. Null when
-- the booking isn't cancelled that way or the caller had no money in it.
create or replace function public.my_cancellation_outcome(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cancellation public.booking_cancellations;
  v_lines jsonb;
  v_guarantee integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select c.* into v_cancellation from public.booking_cancellations c
  join public.venue_bookings b on b.id = c.booking_id
  where c.booking_id = p_booking_id and c.scope <> 'my_spot' and b.status = 'cancelled'
    -- B1c fix: on a half pitch each side cancels on its own; his is the one
    -- with his money in it, not just the last.
    and exists (select 1 from public.booking_cancellation_lines l
                where l.cancellation_id = c.id and l.profile_id = auth.uid())
  order by c.cancelled_at desc limit 1;
  if v_cancellation.id is null then
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'share_id', l.share_id, 'guarantee_id', l.guarantee_id, 'profile_id', l.profile_id, 'is_booker', l.is_booker,
           'window', l."window", 'action', l.action, 'paid_cents', l.paid_cents, 'fee_cents', l.fee_cents,
           'credit_used_cents', l.credit_used_cents, 'value_cents', l.value_cents, 'kept_cents', l.kept_cents,
           'credit_cents', l.credit_cents, 'refund_cents', l.refund_cents, 'needs_capture', l.needs_capture,
           'stripe_intent_id', l.stripe_intent_id) order by l.id), '[]'::jsonb)
  into v_lines
  from public.booking_cancellation_lines l
  where l.cancellation_id = v_cancellation.id and l.profile_id = auth.uid() and l.share_id is not null;
  -- A guarantee that was actually held (it has a hold at Stripe) and released.
  select coalesce(sum(g.amount_cents), 0)::integer into v_guarantee
  from public.booking_cancellation_lines l
  join public.booking_guarantees g on g.id = l.guarantee_id
  where l.cancellation_id = v_cancellation.id and l.profile_id = auth.uid()
    and l.action = 'release' and l.stripe_intent_id is not null;
  if jsonb_array_length(v_lines) = 0 and v_guarantee = 0 then
    return null;
  end if;
  return jsonb_build_object('scope', v_cancellation.scope, 'lines', v_lines, 'guarantee_cents', v_guarantee);
end;
$$;

revoke all on function public.my_cancellation_outcome(uuid) from public, anon;
grant execute on function public.my_cancellation_outcome(uuid) to authenticated, service_role;
