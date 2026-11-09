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
  ])('%s has a message', (code) => {
    const message = describeBookingErrorMessage(code);
    expect(message).not.toBe(code);
    expect(message.length).toBeGreaterThan(0);
  });

  it('tells a blocked slot apart from a full one', () => {
    expect(describeBookingErrorMessage('slot_blocked')).not.toBe(describeBookingErrorMessage('slot_full'));
  });

  it('passes unknown messages through', () => {
    expect(describeBookingErrorMessage('something else')).toBe('something else');
  });
});
