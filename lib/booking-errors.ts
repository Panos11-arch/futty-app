import type { PostgrestError } from '@supabase/supabase-js';

/** Maps the plain-text exceptions raised by book_slot/cancel_booking/
 *  log_booking_result (supabase/legacy/booking-payments.sql, booking-results.sql)
 *  to what the button should say. Takes a plain string rather than an error
 *  object, since callers going through an Edge Function (create-booking-
 *  payment, cancel-booking) need to extract the real message via
 *  lib/edge-functions.ts's describeFunctionError first — supabase.functions.
 *  invoke() doesn't surface it directly the way a plain RPC error does. */
export function describeBookingErrorMessage(message: string) {
  switch (message) {
    case 'slot_full':
      return 'That slot just filled up — pick another one.';
    case 'slot_in_past':
      return "That time has already passed — pick a slot later than now.";
    case 'duplicate_booking':
      return 'You already have a booking at this venue, day and time.';
    case 'venue_not_found':
      return 'This venue no longer exists.';
    case 'not_authenticated':
      return 'Sign in again to book.';
    case 'not_found':
      return 'That booking is already gone.';
    case 'not_your_booking':
      return "That's not your booking.";
    case 'already_cancelled':
      return 'That booking is already cancelled.';
    case 'too_late_to_cancel':
      return "Too close to kickoff to cancel — cancellations close 30 minutes before the game.";
    case 'booking_cancelled':
      return "You can't log a result for a cancelled booking.";
    case 'already_logged':
      return "You've already logged a result for this booking.";
    case 'too_early':
      return "That game hasn't finished yet.";
    case 'invalid_score':
      return 'Enter a valid score for both sides.';
    default:
      return message;
  }
}

/** For the plain RPC paths (book_slot, log_booking_result) that still return
 *  a PostgrestError directly, message included. */
export function describeBookingError(error: PostgrestError) {
  return describeBookingErrorMessage(error.message);
}
