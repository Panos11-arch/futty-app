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
    case 'venue_not_live':
      return "This venue isn't taking bookings on Futty right now.";
    case 'beyond_booking_window':
      return 'That day is too far ahead — standard accounts book up to 7 days ahead, Premium up to 14.';
    case 'invalid_pitches':
      return "This venue doesn't have that many pitches.";
    case 'invalid_time_range':
    case 'slot_not_on_grid':
      return 'Pick a slot that starts and ends on the hour or half hour.';
    case 'outside_opening_hours':
      return "That's outside the venue's opening hours.";
    case 'venue_closed':
      return 'The venue is closed that day — pick another day.';
    case 'slot_blocked':
      return "The venue isn't taking bookings then — pick another time.";
    case 'price_not_set':
      return "This venue hasn't set a price for that format yet.";
    case 'invalid_format':
      return "This venue doesn't offer that format.";
    case 'invalid_players_per_side':
    case 'six_a_side_not_allowed':
      return "6 v 6 isn't available at this venue — book it as 5 v 5.";
    case 'mode_required':
    case 'invalid_payment_mode':
      return 'Choose who pays: you for everyone, each player with you responsible, or each player for their own spot.';
    case 'non_refundable_not_accepted':
      return 'This game starts in less than 6 hours, so it is non-refundable. Accept that to pay.';
    case 'cash_not_allowed':
      return "Cash isn't available when the booker pays for everyone.";
    case 'not_your_share':
      return 'You can only pay your own share.';
    case 'share_not_pending':
      return 'Your share is already paid.';
    case 'booking_mismatch':
      return "That post doesn't match your booking's venue or format.";
    case 'already_invited':
      return "They've already been invited.";
    case 'already_in_booking':
      return "They're already in this game.";
    case 'player_not_found':
      return 'No player with that username.';
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
