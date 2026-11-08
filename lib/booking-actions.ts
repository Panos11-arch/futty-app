import { supabase } from '@/lib/supabase';

export type BookSlotParams = {
  venueId: string;
  day: string;
  start: string;
  end: string;
  pitches: number;
  capacity: number;
  format: string;
};

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
    p_pitches: params.pitches,
    p_capacity: params.capacity,
    p_format: params.format,
  });
}

/** Cancels a booking and, if it was paid, refunds it — enforces the
 *  30-minutes-before-kickoff cutoff server-side (supabase/functions/
 *  cancel-booking). The plain cancel_booking RPC is no longer callable
 *  directly by clients, specifically so a cancellation can't happen without
 *  the refund alongside it. */
export async function cancelBooking(bookingId: string) {
  return supabase.functions.invoke<{ cancelled: boolean; refunded: boolean }>('cancel-booking', {
    body: { bookingId },
  });
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
