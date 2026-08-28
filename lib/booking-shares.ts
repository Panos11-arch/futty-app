import { supabase } from '@/lib/supabase';

export type BookingShare = {
  id: string;
  profile_id: string;
  username: string | null;
  amount_cents: number;
  is_booker: boolean;
  status: 'pending' | 'paid' | 'refunded' | 'cancelled';
  paid_at: string | null;
};

/** Every player's share of a split booking (supabase/booking-payment-
 *  splits.sql) — the booker sees everyone's, another player sees only their
 *  own row (list_booking_shares raises otherwise). */
export async function listBookingShares(bookingId: string) {
  return supabase.rpc('list_booking_shares', { p_booking_id: bookingId });
}

/** Booker-only: adds another player's share by username — the manual half
 *  of "pulled from whoever's confirmed via Squads, or added manually". */
export async function addBookingPlayer(bookingId: string, username: string) {
  return supabase.rpc('add_booking_player', { p_booking_id: bookingId, p_username: username });
}

/** Creates (or re-fetches) a Stripe PaymentIntent for exactly one share —
 *  see supabase/functions/create-share-payment. Only the share's own owner
 *  can call this for themselves. */
export async function createSharePayment(shareId: string) {
  return supabase.functions.invoke<{ clientSecret: string }>('create-share-payment', {
    body: { shareId },
  });
}
