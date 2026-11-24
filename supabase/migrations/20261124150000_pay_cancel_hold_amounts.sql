-- QA 24 November (spec 13 "Cancellations and refunds"):
--   T5. cancellation_quote also returns guarantee_hold_cents: the amount of
--       each held guarantee the cancellation releases, so the cancel sheet
--       names the captain's guarantee hold with the server's amount.
--   T4. my_cancellation_outcome: once a booking is cancelled, what happened
--       to the caller's own money (his lines of the cancellation that ended
--       the booking, and the guarantee hold it released), so the cancelled
--       booking shows the refund or release from the server.
-- cancellation_quote is copied from 20261117090300_pay_venue_cancel_stripe_fee.sql
-- with only the guarantee_hold_cents field added; its grants are unchanged.

-- As in 20261117090300_pay_venue_cancel_stripe_fee.sql, plus guarantee_hold_cents.
create or replace function public.cancellation_quote(p_booking_id uuid, p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_booking public.venue_bookings;
begin
  -- A walk-in or phone booking is never an app booking. Only its own staff
  -- (and the staff member who added it) are told so; anyone else gets the
  -- error they'd get for someone else's app booking, so it can't be probed.
  select * into v_booking from public.venue_bookings b where b.id = p_booking_id;
  if v_booking.booking_type = 'counter' then
    if auth.uid() is null then
      raise exception 'not_authenticated';
    end if;
    if p_scope is null or p_scope not in ('my_spot', 'whole_team', 'venue') then
      raise exception 'invalid_scope';
    end if;
    if v_booking.created_by = auth.uid() or public.is_venue_staff(v_booking.venue_id) then
      raise exception 'counter_booking';
    end if;
    raise exception '%', case p_scope when 'whole_team' then 'not_your_booking'
                                      when 'venue' then 'not_your_venue'
                                      else 'not_in_booking' end;
  end if;
  v_plan := public.cancellation_plan(p_booking_id, p_scope, auth.uid(), now());
  return v_plan || jsonb_build_object(
    'guarantee_hold_placed',
    p_scope <> 'my_spot' and exists (
      select 1 from public.booking_guarantees g
      where g.booking_id = p_booking_id and g.status = 'held'),
    -- QA 24 November (T5): the amount of each held guarantee this releases,
    -- so the sheet names the captain's guarantee hold with the server's amount.
    'guarantee_hold_cents',
    case when p_scope = 'my_spot' then 0 else coalesce((
      select sum(g.amount_cents)::integer from public.booking_guarantees g
      where g.booking_id = p_booking_id and g.status = 'held'
        and g.id in (select (l ->> 'guarantee_id')::uuid from jsonb_array_elements(v_plan -> 'lines') l
                     where l ->> 'action' = 'release' and l ->> 'guarantee_id' is not null)), 0) end)
  || case when p_scope = 'venue' then jsonb_build_object(
       'venue_stripe_fee_cents', coalesce((
         -- One capture fee per line, as cancellation_venue_payable reads it.
         select sum((select m.stripe_fee_cents from public.money_ledger m
                     where m.kind = 'capture' and m.stripe_id = l ->> 'stripe_intent_id'
                     limit 1))
         from jsonb_array_elements(v_plan -> 'lines') l
         where l ->> 'window' = 'venue'
           and l ->> 'stripe_intent_id' is not null
           and l ->> 'share_id' is not null
           and (l ->> 'paid_cents')::integer > 0
           and not exists (select 1 from public.venue_payables vp
                           where vp.share_id = (l ->> 'share_id')::uuid
                             and vp.reason = 'venue_cancelled_stripe_fee')), 0)::integer)
     else '{}'::jsonb end;
end;
$$;

-- The caller's own side of the cancellation that ended the booking (whole
-- team or venue): his lines and the guarantee hold it released. Null when the
-- booking isn't cancelled that way or the caller had no money in it.
create function public.my_cancellation_outcome(p_booking_id uuid)
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
