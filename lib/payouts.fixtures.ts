// Test data only: venue_payouts_overview and venue_payout_bookings shaped as
// the server returns them (supabase/migrations/20261116144010_pay_payouts_functions.sql),
// with the amounts of supabase/tests/pay-payouts-*.test.sql.
import type { BookingMoney, PayoutDetail, PayoutsOverview } from './payouts';

export function overview(overrides: Partial<PayoutsOverview> = {}): PayoutsOverview {
  return {
    account: { status: 'ready', venue_live: true, requirements_due: 0 },
    can_receive: true,
    ready_cents: 0,
    owed_to_futty_cents: 0,
    sending_cents: 0,
    payouts: [
      {
        id: 'po2', booking_id: 'b2', label: 'Nuevo Campo on Tuesday 17 Nov at 20:00', amount_cents: 5895,
        status: 'sent', created_at: '2026-11-17T21:00:00Z', sent_at: '2026-11-17T21:05:00Z', bookings: 2,
      },
      {
        id: 'po1', booking_id: 'b1', label: 'Nuevo Campo on Monday 16 Nov at 19:00', amount_cents: 6000,
        status: 'pending', created_at: '2026-11-16T20:00:00Z', sent_at: null, bookings: 1,
      },
    ],
    ...overrides,
  };
}

export function bookingMoney(overrides: Partial<BookingMoney> = {}): BookingMoney {
  return {
    booking_id: 'b1',
    label: 'Nuevo Campo on Monday 16 Nov at 19:00',
    status: 'confirmed',
    ready: true,
    taken_cents: 6800,
    refunded_cents: 0,
    futty_cents: 800 - 350,
    stripe_fee_cents: 350,
    owed_to_futty_cents: 0,
    paid_at_venue_cents: 0,
    venue_cents: 6000,
    transferred_cents: 6000,
    credit_held_cents: 0,
    ...overrides,
  };
}

export function payoutDetail(overrides: Partial<PayoutDetail> = {}): PayoutDetail {
  return {
    id: 'po2',
    amount_cents: 5895,
    status: 'sent',
    created_at: '2026-11-17T21:00:00Z',
    sent_at: '2026-11-17T21:05:00Z',
    bookings: [
      bookingMoney({ booking_id: 'b2', label: 'Nuevo Campo on Tuesday 17 Nov at 20:00', this_payout_cents: 6000 }),
      bookingMoney({
        booking_id: 'b0', label: 'Nuevo Campo on Sunday 15 Nov at 18:00', status: 'cancelled', taken_cents: 2040,
        refunded_cents: 2040, futty_cents: -105, stripe_fee_cents: 105, owed_to_futty_cents: 105, venue_cents: -105,
        transferred_cents: -105, this_payout_cents: -105,
      }),
    ],
    ...overrides,
  };
}
