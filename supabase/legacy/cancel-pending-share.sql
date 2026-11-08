-- Lets a player clean up their OWN still-'pending' booking_payment_shares
-- row (item 1 of the payment-authorization-bug batch): if joining a squad
-- post succeeds but the payment step that's supposed to follow it fails or
-- is cancelled, the client rolls the join back via leave_squad_post AND
-- this — leave_squad_post only ever touched squad_post_joiners, never the
-- share auto_add_booking_share_on_join created alongside it, so without
-- this a failed/cancelled payment left an orphaned 'pending' share behind
-- with nothing pointing at it.
--
-- Deliberately status = 'pending' only — a share that's already
-- 'authorized' or 'paid' represents a real Stripe PaymentIntent and can
-- never be deleted this way, only voided/refunded through the real payment
-- lifecycle (supabase/functions/cancel-unpaid-bookings).
--
-- Run AFTER supabase/legacy/booking-payment-splits.sql. Run in the Supabase
-- dashboard: SQL Editor > New query > Run. Safe to re-run.

create or replace function public.cancel_pending_share(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.booking_payment_shares
  where booking_id = p_booking_id
    and profile_id = auth.uid()
    and status = 'pending';
end;
$$;

grant execute on function public.cancel_pending_share(uuid) to authenticated;
