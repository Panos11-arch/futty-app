// Test data only: server responses shaped as the P5 functions return them,
// with the amounts from spec 13's worked examples (a €60 5 v 5).
import type { BookingDetail, BookingQuote } from './booking-search';

export function quoteFixture(overrides: Partial<BookingQuote> = {}): BookingQuote {
  return {
    venue_id: 'v1',
    day: '2026-11-16',
    start_time: '19:00:00',
    end_time: '20:00:00',
    format: '5-a-side',
    players_per_side: 5,
    players: 10,
    pitch_cents: 6000,
    is_premium: false,
    kickoff_at: '2026-11-16T17:00:00+00:00',
    refunds_stop_at: '2026-11-16T11:00:00+00:00',
    non_refundable: false,
    pay_all: { pitch_cents: 6000, fee_cents: 550, card_cents: 6550, with_credit: null },
    each_pays: {
      player_cents: 680,
      player_pitch_cents: 600,
      player_fee_cents: 80,
      mine: { pitch_cents: 600, fee_cents: 80, card_cents: 680, with_credit: null },
      cash: { card_cents: 80, cash_cents: 600 },
    },
    credit: { available_cents: 0, expires_at: null },
    in_debt: false,
    cash_allowed: true,
    cancellation: { fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 },
    ...overrides,
  };
}

export function detailFixture(
  overrides: { me?: Partial<NonNullable<BookingDetail['me']>> | null; booking?: Partial<BookingDetail['booking']> } = {},
): BookingDetail {
  const me: BookingDetail['me'] =
    overrides.me === null
      ? null
      : {
          share_id: 's2',
          status: 'pending',
          payment_method: 'card',
          amount_cents: 680,
          pitch_cents: 600,
          fee_cents: 80,
          cash_cents: 0,
          free_until: null,
          ...overrides.me,
        };
  return {
    booking: {
      id: 'b1',
      status: 'confirmed',
      booking_day: '2026-11-16',
      start_time: '19:00:00',
      end_time: '20:00:00',
      format: '5-a-side',
      capacity: 10,
      players_per_side: 5,
      payment_mode: 'each_pays_own_spot',
      kickoff_at: '2026-11-16T17:00:00+00:00',
      ends_at: '2026-11-16T18:00:00+00:00',
      refunds_stop_at: '2026-11-16T11:00:00+00:00',
      payment_window_ends_at: null,
      ...overrides.booking,
    },
    venue: {
      id: 'v1',
      name: 'Nuevo Campo',
      city: 'Nicosia',
      address: '2 Aristidou Street, Latsia',
      google_maps_link: null,
      photo_path: null,
    },
    is_booker: false,
    me,
  };
}
