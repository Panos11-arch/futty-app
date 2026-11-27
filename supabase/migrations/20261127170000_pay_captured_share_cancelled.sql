-- Money taken late on a cancelled share of a live booking.
-- (docs/specs/13-payments-bookings.md, "When money is held and taken".)
--
-- share_payment_captured (latest definition:
-- 20261110165054_pay_cancellations_hold_cancelled) answers
-- 'booking_cancelled' when the booking is cancelled OR when the share is
-- cancelled or refunded. stripe-webhook (modes.ts, follow) then refunds this
-- payment AND runs releaseBookingMoney on the whole booking. So a share
-- cancelled on a game that's still on (a side B lapse, a player's own spot)
-- whose immediate charge (paid less than 6 hours before kickoff) arrives
-- afterwards refunded everyone and released the guarantee.
--
-- The same fix as share_payment_held in 20261113130016_pay_gipedo_review_fixes:
-- the function is renamed and wrapped. The reason stays 'booking_cancelled'
-- only when the booking is cancelled; otherwise it becomes 'share_cancelled',
-- and stripe-webhook refunds only this payment (releaseOrQueue). No change to
-- the webhook, to amounts or to the ledger: the wrapped function still records
-- the capture exactly as before.

alter function public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz)
  rename to share_payment_captured_modes;

create function public.share_payment_captured(
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
  v_result jsonb;
begin
  -- The booking first, as every payment webhook locks it (booking, then share).
  perform 1 from public.venue_bookings
  where id = (select booking_id from public.booking_payment_shares where id = p_share_id) for update;
  v_result := public.share_payment_captured_modes(p_share_id, p_intent_id, p_amount_cents, p_payment_method_id,
                                                  p_fee_cents, p_stripe_fee_cents, p_at);
  if v_result ->> 'reason' = 'booking_cancelled' and not exists (
       select 1 from public.venue_bookings b
       join public.booking_payment_shares s on s.booking_id = b.id
       where s.id = p_share_id and b.status = 'cancelled') then
    return v_result || jsonb_build_object('reason', 'share_cancelled');
  end if;
  return v_result;
end;
$$;

revoke all on function public.share_payment_captured_modes(uuid, text, integer, text, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.share_payment_captured_modes(uuid, text, integer, text, integer, integer, timestamptz)
  to service_role;
revoke all on function public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.share_payment_captured(uuid, text, integer, text, integer, integer, timestamptz)
  to service_role;
