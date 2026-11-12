-- cancellation_quote says whether the booker's guarantee hold has actually
-- been placed (docs/specs/13-payments-bookings.md, "When money is held and
-- taken" step 3: the hold is placed 3 days before kickoff, or at booking if
-- the match is sooner). Until then the guarantee is only a saved card, so the
-- booking screen mustn't say "your guarantee hold is released" (P5b review).
--
-- guarantee_hold_placed is added beside the plan, not inside its lines, so
-- the lines and the quote hash cancel-booking checks are unchanged.
create or replace function public.cancellation_quote(p_booking_id uuid, p_scope text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.plan || jsonb_build_object(
    'guarantee_hold_placed',
    p_scope <> 'my_spot' and exists (
      select 1 from public.booking_guarantees g
      where g.booking_id = p_booking_id and g.status = 'held'))
  from (select public.cancellation_plan(p_booking_id, p_scope, auth.uid(), now()) as plan) s;
$$;

revoke all on function public.cancellation_quote(uuid, text) from public, anon;
grant execute on function public.cancellation_quote(uuid, text) to authenticated, service_role;
