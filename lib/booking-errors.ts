import type { PostgrestError } from '@supabase/supabase-js';

import { daysText, hoursText, minutesText, ruleText } from '@/lib/rules';

/** Maps the plain-text exceptions raised by book_slot/cancel_booking/
 *  log_booking_result (supabase/legacy/booking-payments.sql, booking-results.sql)
 *  to what the button should say. Takes a plain string rather than an error
 *  object, since callers going through an Edge Function (create-booking-
 *  payment, cancel-booking) need to extract the real message via
 *  lib/edge-functions.ts's describeFunctionError first — supabase.functions.
 *  invoke() doesn't surface it directly the way a plain RPC error does.
 *  Every number in a message comes from spec 13's rules (lib/rules.ts); with
 *  none loaded yet the message is the same without the number. `detail` is
 *  the error's detail where the server sends one (pitch_not_free: the
 *  pitch's name). */
export function describeBookingErrorMessage(message: string, detail?: string | null) {
  switch (message) {
    // Booking v2 (spec 13 "Choosing a pitch", "How each side pays").
    case 'pitch_not_free':
      return `${detail || 'That pitch'} is no longer free. Pick another.`;
    case 'invalid_pitch_choice':
      return "That pitch can't be booked for this game. Pick another.";
    case 'just_my_spot_removed':
      return 'Choose Pay for everyone or Pay for myself.';
    // B1d: Losers pay (spec 13 "Losers pay (Gipedo Pano in Booking v2)").
    case 'losers_pay_half_pitch_only':
      return 'Losers pay is for a half pitch.';
    case 'losers_pay_needs_way_to_pay':
      return 'Choose Pay for everyone or Pay for myself.';
    case 'losers_pay_too_far_ahead':
      return ruleText(
        (r) => `Losers pay can be booked at most ${daysText(r.gipedo_max_days)} ahead.`,
        'Losers pay can only be booked a few days ahead.',
      );
    case 'losers_pay_too_soon':
      return ruleText(
        (r) => `Losers pay must be booked at least ${hoursText(r.gipedo_opponent_hours)} before kickoff.`,
        'Losers pay must be booked further ahead.',
      );
    case 'accept_losers_pay':
      return 'This game is Losers pay. Accept Losers pay to play it.';
    case 'captain_pulls_out_side':
      return 'As captain, you pull your whole team out instead.';
    case 'losers_pay_play_whole_not_available':
      // Decided 24 November: on Losers pay the holds pay for the whole pitch.
      return 'On Losers pay your holds pay for the whole pitch: tap Play the whole pitch.';
    case 'not_losers_pay':
      return "This game isn't Losers pay.";
    case 'use_losers_pay_leave':
      return 'This is a Losers pay game: use Leave this game on the booking.';
    case 'use_losers_pay_pull_out':
      return 'This is a Losers pay game: use Pull your team out on the booking.';
    case 'already_settled':
      return "You've already left this game.";
    case 'cash_whole_pitch_only':
      return 'Cash is for a whole pitch only.';
    case 'half_pitch_not_available':
      return "Half pitches aren't available yet. Book the whole pitch.";
    // Booking v2 after paying (B3): the opposition, publishing.
    case 'opposition_found':
      return 'Opposition found. Another captain accepted first.';
    case 'opposition_closed':
      return ruleText(
        (r) => `Invites close ${hoursText(r.gipedo_opponent_hours)} before kickoff.`,
        'Invites are closed for this game.',
      );
    case 'not_invited':
      return "You weren't invited to this game.";
    case 'not_half_pitch':
      return 'Only a half pitch has an opposition.';
    case 'booking_not_confirmed':
      return 'Your booking is still being confirmed. Try again in a minute.';
    case 'side_not_paid':
      return 'Pay for your side first, then publish.';
    case 'booking_full':
      return 'Every spot is taken.';
    case 'not_your_post':
      return "That's not your post.";
    case 'post_not_found':
      return 'That post is already gone.';
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
      return ruleText(
        (r) =>
          `That day is too far ahead — standard accounts book up to ${daysText(r.window_standard_days)} ahead, Premium up to ${r.window_premium_days}.`,
        'That day is too far ahead for your account.',
      );
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
      return 'Choose who pays: you for everyone, each player with you responsible, each player for their own spot, or Gipedo Pano.';
    // Gipedo Pano (P8; spec 13, "Gipedo Pano").
    case 'team_required':
      return 'Choose the team this game is for.';
    case 'not_captain':
      return 'Only a team captain can do this.';
    case 'gipedo_too_far_ahead':
      return ruleText(
        (r) => `Gipedo Pano can only be booked up to ${daysText(r.gipedo_max_days)} ahead.`,
        "Gipedo Pano can't be booked that far ahead.",
      );
    case 'gipedo_too_soon':
      return ruleText(
        (r) =>
          `Gipedo Pano needs at least ${hoursText(r.gipedo_opponent_hours)} before kickoff, so there is time to find an opponent.`,
        'Gipedo Pano needs more time before kickoff, so there is time to find an opponent.',
      );
    case 'credit_not_allowed':
      return "Venue credit can't be used for a Gipedo Pano hold. Pay by card.";
    case 'use_gipedo_pull_out':
      return 'In Gipedo Pano a team leaves by pulling out. Use Pull out to see what it costs.';
    case 'cannot_pull_out':
      return "You can't pull out of this game.";
    case 'match_not_ready':
      return "The match isn't ready yet. Try again in a minute.";
    case 'not_gipedo':
      return "This isn't a Gipedo Pano game any more.";
    case 'choice_not_due':
      return 'There is still time for an opponent to take this game on.';
    case 'already_chosen':
      return "You've already chosen what happens to this game.";
    case 'choice_closed':
      return ruleText(
        (r) => `Kickoff is less than ${hoursText(r.refund_cutoff_hours)} away, so the game has been cancelled free.`,
        'Kickoff is too close now, so the game has been cancelled free.',
      );
    case 'invalid_choice':
      return 'Choose to play it as a normal booking or cancel it free.';
    case 'post_closed':
      return 'This game is no longer looking for an opponent.';
    case 'cannot_rejoin':
      return "Your team pulled out of this game, so it can't take it on again.";
    case 'non_refundable_not_accepted':
      return ruleText(
        (r) => `This game starts in less than ${hoursText(r.refund_cutoff_hours)}, so it is non-refundable. Accept that to pay.`,
        'This game starts soon, so it is non-refundable. Accept that to pay.',
      );
    case 'cash_not_allowed':
      return "Cash isn't available when the booker pays for everyone.";
    case 'not_your_share':
      return 'You can only pay your own share.';
    case 'share_not_pending':
      return 'Your share is already paid.';
    case 'already_paid':
      return 'Your payment has already gone through.';
    case 'share_changed':
      return 'Your payment changed on another device. Check your booking and try again.';
    case 'payment_window_closed':
      return ruleText(
        (r) =>
          `Payment had to be completed within ${minutesText(r.payment_window_minutes)} of booking, so this booking was cancelled.`,
        "Payment wasn't completed in time, so this booking was cancelled.",
      );
    case 'saved_card_required':
      return "Paying this way needs a saved card, which isn't available yet. Pay by card instead.";
    case 'guarantee_closed':
      return 'The game has started, so the card for this booking can no longer be changed.';
    case 'no_guarantee_to_update':
      return "This booking doesn't have a guarantee card to update.";
    case 'no_saved_card':
      return 'Pay your share first. Your card is saved when you pay, and then you can change it here.';
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
      return ruleText(
        (r) => `Less than ${hoursText(r.refund_cutoff_hours)} to kickoff, so this booking can no longer be refunded.`,
        'Kickoff is too close, so this booking can no longer be refunded.',
      );
    case 'booking_cancelled':
      return 'This booking has been cancelled.';
    case 'booking_not_found':
      return 'This booking could not be found.';
    case 'quote_changed':
      return 'What happens to the money has changed. Check it again before you confirm.';
    case 'payment_in_progress':
      return 'A payment on this booking is going through right now. Try again in a minute.';
    case 'quote_required':
    case 'invalid_request':
      return 'Check what happens to the money first, then confirm.';
    case 'booking_started':
      return 'The game has started, so it can no longer be cancelled.';
    case 'not_in_booking':
      return "You don't have a spot in this booking.";
    case 'use_whole_team':
      return 'You paid for everyone, so you can only cancel the whole booking.';
    case 'legacy_booking':
      return 'This booking can only be cancelled as a whole.';
    case 'already_logged':
      return "You've already logged a result for this booking.";
    case 'too_early':
      return "That game hasn't finished yet.";
    case 'invalid_score':
      return 'Enter a valid score for both sides.';
    default:
      // QA 24 November: never the server's own text (SQL, a missing
      // function, an Edge Function's status line). Known codes are above.
      return SERVER_ERROR_FALLBACK;
  }
}

/** The one plain line for any server error that has no wording above. */
export const SERVER_ERROR_FALLBACK = 'Something went wrong. Try again.';

/** For the plain RPC paths (book_slot, log_booking_result) that still return
 *  a PostgrestError directly, message included. */
export function describeBookingError(error: PostgrestError) {
  return describeBookingErrorMessage(error.message);
}
