-- The venue's cancel quote shows Stripe's fee the venue will owe
-- (docs/specs/13-payments-bookings.md, "The venue cancels").
--
-- With scope 'venue', cancellation_quote also returns venue_stripe_fee_cents:
-- the sum of Stripe's fees on every card payment this cancel refunds or
-- turns into credit. It reads the fee recorded in money_ledger for each
-- capture, under the same conditions cancellation_venue_payable uses when
-- the cancel is carried out (a 'venue' line with a Stripe intent and a card
-- amount, and no venue_cancelled_stripe_fee payable on that share yet). So
-- the figure is exactly what venue_payables then records. A payment only
-- held has no capture and adds nothing; nor does cash.
--
-- This is the latest definition (20261113223420_pay_dashboard_guards.sql)
-- with only that figure added. The quote hash is computed in
-- cancellation_plan and is unchanged, so cancel-booking still checks the
-- same hash.

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
      where g.booking_id = p_booking_id and g.status = 'held'))
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

revoke all on function public.cancellation_quote(uuid, text) from public, anon;
grant execute on function public.cancellation_quote(uuid, text) to authenticated, service_role;
