import { supabase } from '@/lib/supabase';

export type BookingShare = {
  id: string;
  profile_id: string;
  username: string | null;
  amount_cents: number;
  is_booker: boolean;
  /** 'authorized' = card held, not yet charged (item 6's authorize-then-
   *  capture flow) — 'paid' now specifically means captured/charged. */
  status: 'pending' | 'authorized' | 'paid' | 'refunded' | 'cancelled';
  paid_at: string | null;
};

/** Every player's share of a split booking (supabase/legacy/booking-payment-
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

/** How the player pays their share. Only choices: the amounts are the
 *  server's (create-share-payment prices the share itself). */
export type SharePaymentOptions = {
  method?: 'card' | 'cash';
  /** The player accepted "This booking is non-refundable" (kickoff is less
   *  than 6 hours away). The server checks it again. */
  acceptNonRefundable?: boolean;
  /** Pay the pitch part with the player's credit at this venue. */
  useCredit?: boolean;
};

/** What create-share-payment returns: a PaymentIntent to confirm, or a
 *  SetupIntent when there's nothing to charge and only a card to save. */
export type SharePaymentResponse = {
  clientSecret?: string | null;
  setupIntentClientSecret?: string | null;
  customerId?: string;
  amountCents?: number;
  cashCents?: number;
  creditCents?: number;
  nonRefundable?: boolean;
  paid?: boolean;
};

/** Creates (or re-fetches) the Stripe payment for exactly one share —
 *  see supabase/functions/create-share-payment. Only the share's own owner
 *  can call this for themselves. */
export async function createSharePayment(shareId: string, options?: SharePaymentOptions) {
  return supabase.functions.invoke<SharePaymentResponse>('create-share-payment', {
    body: options ? { shareId, ...options } : { shareId },
  });
}
