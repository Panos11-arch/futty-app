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
