// Test data only: booking_quote_v2 and venue_free_pitches as the server
// returns them, with spec 13's Booking v2 worked examples: a €40.00
// 5-a-side pitch, 10 players (5 v 5), one hour.
import type { BookingQuoteV2, CheckoutData, FreePitch } from './booking-v2';

/** A standard account: examples 1 (whole, pay for everyone €45.50), 2 (whole,
 *  pay for myself €4.80, €40.00 held), 3 (cash: €0.80 now, €4.00 at the
 *  venue), 4 (half, pay for everyone €22.75) and 5 (half, pay for myself
 *  €4.80, €20.00 held). */
export function quoteV2Fixture(overrides: Partial<BookingQuoteV2> = {}): BookingQuoteV2 {
  return {
    venue_id: 'v1',
    day: '2026-11-26',
    start_time: '20:00:00',
    end_time: '21:00:00',
    format: '5-a-side',
    players_per_side: 5,
    players: 10,
    pitch_cents: 4000,
    is_premium: false,
    kickoff_at: '2026-11-26T18:00:00+00:00',
    refunds_stop_at: '2026-11-26T12:00:00+00:00',
    non_refundable: false,
    whole: {
      pay_all: { pitch_cents: 4000, fee_cents: 550, card_cents: 4550 },
      pay_for_myself: { card_cents: 480, pitch_cents: 400, fee_cents: 80, player_cents: 480, guarantee_cents: 4000 },
      cash: { card_cents: 80, cash_cents: 400, guarantee_cents: 4000 },
    },
    half: {
      available: true,
      side_pitch_cents: 2000,
      pay_all: { pitch_cents: 2000, fee_cents: 275, card_cents: 2275 },
      pay_for_myself: { card_cents: 480, pitch_cents: 400, fee_cents: 80, player_cents: 480, guarantee_cents: 2000 },
    },
    in_debt: false,
    cash_allowed: true,
    cancellation: { fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 },
    ...overrides,
  };
}

/** Example 11: a Premium booker. Pay for myself €4.00 (no fee on their own
 *  spot); paying for everyone €40.00 + 9 × €0.55 = €44.95. */
export function premiumQuoteV2Fixture(): BookingQuoteV2 {
  const q = quoteV2Fixture({ is_premium: true });
  return {
    ...q,
    whole: {
      pay_all: { pitch_cents: 4000, fee_cents: 495, card_cents: 4495 },
      pay_for_myself: { card_cents: 400, pitch_cents: 400, fee_cents: 0, player_cents: 480, guarantee_cents: 4000 },
      cash: { card_cents: 0, cash_cents: 400, guarantee_cents: 4000 },
    },
  };
}

export function checkoutDataFixture(quote: BookingQuoteV2 = quoteV2Fixture(), credit: CheckoutData['credit'] = null): CheckoutData {
  return { quote, credit };
}

export function pitchesFixture(): FreePitch[] {
  return [
    { pitch_ids: ['p2'], label: 'Pitch 2', kind: 'pitch', surface: 'Artificial grass', indoor: false, price_cents: 4000 },
    { pitch_ids: ['p3'], label: 'Pitch 3', kind: 'pitch', surface: 'Artificial grass', indoor: true, price_cents: 4000 },
  ];
}
