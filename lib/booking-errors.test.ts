import { describeBookingErrorMessage } from './booking-errors';

describe('describeBookingErrorMessage', () => {
  // Every code book_slot raises gets a sentence, not the raw code.
  it.each([
    'slot_full',
    'slot_blocked',
    'venue_closed',
    'price_not_set',
    'outside_opening_hours',
    'invalid_format',
    'invalid_pitches',
    'six_a_side_not_allowed',
    'venue_not_live',
    'beyond_booking_window',
    'mode_required',
    'invalid_payment_mode',
    // create-share-payment
    'non_refundable_not_accepted',
    'cash_not_allowed',
    'not_your_share',
    'share_not_pending',
    'share_changed',
    'already_paid',
    'payment_window_closed',
    'saved_card_required',
    // update-guarantee-card
    'guarantee_closed',
    'no_guarantee_to_update',
    'no_saved_card',
    // booking_detail, cancellation_quote and cancel-booking (P5b)
    'booking_not_found',
    'quote_changed',
    'quote_required',
    'booking_started',
    'not_in_booking',
    'use_whole_team',
    'legacy_booking',
    'invalid_request',
  ])('%s has a message', (code) => {
    const message = describeBookingErrorMessage(code);
    expect(message).not.toBe(code);
    expect(message.length).toBeGreaterThan(0);
  });

  it('tells a blocked slot apart from a full one', () => {
    expect(describeBookingErrorMessage('slot_blocked')).not.toBe(describeBookingErrorMessage('slot_full'));
  });

  // booking_cancelled is also raised when paying a share of a cancelled
  // booking, so it can't talk about logging a result.
  it('booking_cancelled says the booking is cancelled, not about results', () => {
    const message = describeBookingErrorMessage('booking_cancelled');
    expect(message).toMatch(/cancelled/i);
    expect(message).not.toMatch(/result/i);
  });

  // Spec 13: refunds stop 6 hours before kickoff; nothing says 30 minutes.
  it('too_late_to_cancel uses the 6-hour rule', () => {
    const message = describeBookingErrorMessage('too_late_to_cancel');
    expect(message).toMatch(/6 hours/);
    expect(message).not.toMatch(/30 minutes/);
  });

  it('passes unknown messages through', () => {
    expect(describeBookingErrorMessage('something else')).toBe('something else');
  });
});

describe('Gipedo Pano (P8)', () => {
  it.each([
    'team_required',
    'not_captain',
    'gipedo_too_soon',
    'credit_not_allowed',
    'use_gipedo_pull_out',
    'cannot_pull_out',
    'match_not_ready',
    'not_gipedo',
    'choice_not_due',
    'already_chosen',
    'choice_closed',
    'invalid_choice',
    'post_closed',
    'cannot_rejoin',
  ])('%s has a message', (code) => {
    expect(describeBookingErrorMessage(code)).not.toBe(code);
  });

  it('more than 5 days ahead says exactly what spec 13 says', () => {
    expect(describeBookingErrorMessage('gipedo_too_far_ahead')).toBe('Gipedo Pano can only be booked up to 5 days ahead.');
  });

  it('who pays now names all four ways', () => {
    expect(describeBookingErrorMessage('mode_required')).toContain('Gipedo Pano');
  });

  it('cancelling while a hold is being taken asks to try again in a minute', () => {
    expect(describeBookingErrorMessage('payment_in_progress')).toBe(
      'A payment on this booking is going through right now. Try again in a minute.',
    );
  });
});
