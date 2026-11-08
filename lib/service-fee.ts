/** Futty's flat service fee per player, added on top of each player's part
 *  of the pitch price. Must match public.service_fee_cents() in
 *  supabase/legacy/flat-service-fee.sql. Bookings made before the flat fee have
 *  venue_bookings.service_fee_cents_per_player = null and used the old
 *  8.9% folded into the price instead, so no breakdown is shown for them. */
export const SERVICE_FEE_CENTS = 80;

export function formatEuros(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}
