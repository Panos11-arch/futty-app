import { supabase } from '@/lib/supabase';

export type BookSlotParams = {
  venueId: string;
  day: string;
  start: string;
  end: string;
  format: string;
  /** 5, or 6 for 6 v 6 on a 5-a-side pitch where the venue allows it. The
   *  server derives how many players that is; the app never sends a count. */
  playersPerSide?: 5 | 6;
  /** Who pays (spec 13, "Booking modes"). Always chosen by the booker: the
   *  server refuses a booking without one (mode_required). */
  mode: PaymentMode;
};

export type PaymentMode = 'pay_all' | 'each_pays_responsible' | 'each_pays_own_spot';

/** Wraps book_slot (supabase/legacy/booking-payments.sql), the only writable path
 *  into venue_bookings — RLS blocks a direct insert/update so the capacity
 *  check and ownership check run atomically on the server. Reserves the slot
 *  as 'pending_payment' (priced venue) or 'confirmed' immediately (free
 *  venue) — app/booking-payment.tsx then collects each player's share via
 *  create-share-payment. */
export async function bookSlot(params: BookSlotParams) {
  return supabase.rpc('book_slot', {
    p_venue_id: params.venueId,
    p_day: params.day,
    p_start: params.start,
    p_end: params.end,
    // The server picks the pitches for the format (pick_pitches) and stores
    // how many it used; p_pitches is only checked to be 1 or more and no
    // more than the venue has, so the app no longer guesses a count.
    p_pitches: 1,
    p_format: params.format,
    p_players_per_side: params.playersPerSide ?? 5,
    p_mode: params.mode,
  });
}

export type CancelScope = 'my_spot' | 'whole_team' | 'venue';

/** One player's money in a cancellation, as the server computed it (amounts
 *  in cents; the app only displays them). */
export type CancellationLine = {
  share_id: string | null;
  guarantee_id: string | null;
  profile_id: string;
  is_booker: boolean;
  window: 'free' | 'middle' | 'late' | 'other' | 'venue' | null;
  action: 'none' | 'release' | 'keep' | 'keep_and_credit' | 'refund_choice';
  /** The card part of the share (0 when paid with credit only, or unpaid). */
  paid_cents: number;
  fee_cents: number;
  /** The credit that paid for the share: it goes back to that credit. */
  credit_used_cents: number;
  value_cents: number;
  kept_cents: number;
  credit_cents: number;
  refund_cents: number;
  needs_capture: boolean;
  /** The share's card payment at Stripe, or the guarantee's hold. */
  stripe_intent_id: string | null;
};

/** What cancelling would do (public.cancellation_quote). Show it before the
 *  player confirms; confirming sends back its `quote`. */
export type CancellationQuote = {
  booking_id: string;
  scope: CancelScope;
  kickoff_at: string;
  refunds_stop_at: string;
  cancels_booking: boolean;
  lines: CancellationLine[];
  /** The booker's charge for cancelling the whole team (100 per other player
   *  whose payment was taken), or null. */
  booker_fee: { profile_id: string; players: number; amount_cents: number } | null;
  /** The booker's guarantee hold has actually been placed (before that it
   *  is only a saved card). Always false for my_spot. */
  guarantee_hold_placed: boolean;
  quote: string;
};

/** What happens to everyone's money if the signed-in player cancels: their
 *  own spot, the whole team (the booker), or the booking (venue staff).
 *  Nothing is changed. */
export async function getCancellationQuote(bookingId: string, scope: CancelScope) {
  return supabase.rpc('cancellation_quote', { p_booking_id: bookingId, p_scope: scope });
}

export type CancelResult = {
  cancelled: boolean;
  /** Bookings made before P4a: the old answer. */
  refunded?: boolean;
  pending?: boolean;
  /** The booker's whole-team charge. 'requires_action': show 3-D Secure
   *  with clientSecret; the cancellation stands either way. */
  fee?: { amountCents: number; status: string; clientSecret?: string | null } | null;
};

/** Cancels exactly what the confirmed quote said (supabase/functions/
 *  cancel-booking); the server refuses with quote_changed if that's no longer
 *  what would happen, and the app shows the new quote. The plain
 *  cancel_booking RPC isn't callable by clients, so a cancellation can't
 *  happen without its money alongside it. With no options: a booking made
 *  before P4a, cancelled under the old rules. */
export async function cancelBooking(bookingId: string, confirmed?: { scope: CancelScope; quote: string }) {
  return supabase.functions.invoke<CancelResult>('cancel-booking', {
    body: confirmed ? { bookingId, scope: confirmed.scope, quote: confirmed.quote } : { bookingId },
  });
}

/** After the booker or the venue cancelled: the player takes their share
 *  back as venue credit, or by card refund (5-10 working days). They have 48
 *  hours; with no choice it goes back to their card. `lineId` is the
 *  cancellationLineId in their "Game cancelled" notification. */
export async function chooseCancellationRefund(lineId: string, choice: 'card' | 'credit') {
  return supabase.functions.invoke<{ choice: 'card' | 'credit'; refundCents?: number; creditCents?: number }>(
    'choose-cancellation-refund',
    { body: { lineId, choice } },
  );
}

/** Wraps log_booking_result (supabase/legacy/booking-results.sql) — self-reported,
 *  since a plain booking has no opponent team to agree the score with. */
export async function logBookingResult(params: {
  bookingId: string;
  goalsFor: number;
  goalsAgainst: number;
}) {
  return supabase.rpc('log_booking_result', {
    p_booking_id: params.bookingId,
    p_goals_for: params.goalsFor,
    p_goals_against: params.goalsAgainst,
  });
}
