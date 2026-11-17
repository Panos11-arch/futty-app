// Test data only: the dashboard's money reads shaped as the server returns
// them (supabase/migrations/20261113235802_pay_dashboard_revenue.sql and
// 20261113235806_pay_dashboard_people.sql). Several totals here are
// deliberately *not* the sum of their parts: the screens must show the
// server's figure, never one they added up themselves.
import type { RevenueExport } from '@/lib/money/revenue-csv';
import type {
  BookingListItem,
  CreditListItem,
  CustomerDetail,
  CustomerListItem,
  DebtListItem,
  RevenueScreen,
} from '@/lib/venue-money';

/** A player's email and phone, as if the server ever leaked them. They must never render. */
export const LEAKED_EMAIL = 'andreas@example.cy';
export const LEAKED_PHONE = '+35799111222';
const leak = { email: LEAKED_EMAIL, phone: LEAKED_PHONE } as Record<string, unknown>;

/** venue_revenue: the sources and a total that isn't their sum. */
export function revenueScreen(overrides: Partial<RevenueScreen> = {}): RevenueScreen {
  return {
    period: 'day',
    from: '2026-11-17',
    to: '2026-11-17',
    sources: [
      { source: 'app_card', venue_cents: 1000, futty_cents: 45, stripe_fee_cents: 35, rows: 2 },
      { source: 'app_cash', venue_cents: 200, futty_cents: 11, stripe_fee_cents: 0, rows: 1 },
      { source: 'walk_in', venue_cents: 4321, futty_cents: 0, stripe_fee_cents: 0, rows: 3 },
      { source: 'phone', venue_cents: 0, futty_cents: 0, stripe_fee_cents: 0, rows: 0 },
    ],
    totals: { venue_cents: 99999, futty_cents: 777, stripe_fee_cents: 333, rows: 42 },
    overrides: [
      {
        booking_id: 'cb1',
        source: 'walk_in',
        contact_name: 'Maria Georgiou',
        booking_day: '2026-11-17',
        start_time: '19:00:00',
        moved_on: '2026-11-17',
        venue_price_cents: 6000,
        charged_cents: 5000,
      },
      {
        booking_id: 'cb2',
        source: 'phone',
        contact_name: 'Nikos',
        booking_day: '2026-11-17',
        start_time: '21:00:00',
        moved_on: '2026-11-17',
        venue_price_cents: 6000,
        charged_cents: 0,
      },
    ],
    ...overrides,
  };
}

/** venue_revenue_export for one day whose rows and totals agree (buildRevenueCsv checks they do). */
export function revenueExport(overrides: Partial<RevenueExport> = {}): RevenueExport {
  return {
    period: 'day',
    from: '2026-11-17',
    to: '2026-11-17',
    rows: [
      {
        ledger_id: 'l1', moved_on: '2026-11-17', moved_at: '18:05', source: 'app_card', kind: 'capture',
        reason: 'share_captured', booking_id: 'b1', booking_day: '2026-11-17', start_time: '18:00:00',
        who: 'Andreas', venue_cents: 600, futty_cents: 45, stripe_fee_cents: 35, venue_price_cents: null,
        charged_cents: null,
      },
      {
        ledger_id: 'l2', moved_on: '2026-11-17', moved_at: '19:10', source: 'walk_in', kind: 'counter_paid',
        reason: 'counter_paid_cash', booking_id: 'cb1', booking_day: '2026-11-17', start_time: '19:00:00',
        who: 'Maria Georgiou', venue_cents: 5000, futty_cents: 0, stripe_fee_cents: 0, venue_price_cents: 6000,
        charged_cents: 5000,
      },
    ],
    sources: [
      { source: 'app_card', venue_cents: 600, futty_cents: 45, stripe_fee_cents: 35, rows: 1 },
      { source: 'app_cash', venue_cents: 0, futty_cents: 0, stripe_fee_cents: 0, rows: 0 },
      { source: 'walk_in', venue_cents: 5000, futty_cents: 0, stripe_fee_cents: 0, rows: 1 },
      { source: 'phone', venue_cents: 0, futty_cents: 0, stripe_fee_cents: 0, rows: 0 },
    ],
    totals: { venue_cents: 5600, futty_cents: 45, stripe_fee_cents: 35, rows: 2 },
    ...overrides,
  };
}

/** The screen for the same day as revenueExport(): the same totals. */
export function revenueScreenMatchingExport(): RevenueScreen {
  const data = revenueExport();
  return { period: data.period, from: data.from, to: data.to, sources: data.sources, totals: data.totals, overrides: [] };
}

export function bookingsList(): BookingListItem[] {
  return [
    {
      id: 'b1', source: 'app', status: 'confirmed', booking_day: '2026-11-17', start_time: '18:00:00',
      end_time: '19:00:00', format: '5v5', capacity: 10, pitch_ids: ['p1'], name: 'Andreas',
      payment_mode: 'split', joined: 7, ...leak,
    } as BookingListItem,
    {
      id: 'cb1', source: 'walk_in', status: 'confirmed', booking_day: '2026-11-17', start_time: '19:00:00',
      end_time: '20:00:00', format: '5v5', capacity: 10, pitch_ids: ['p1'], name: 'Maria Georgiou',
      phone: '+35799000001', contact_id: 'c1', venue_price_cents: 6000, charged_cents: 5000, paid_method: 'cash',
      paid_at: '2026-11-17T17:10:00Z',
    },
    {
      id: 'b2', source: 'app', status: 'cancelled', booking_day: '2026-11-18', start_time: '20:00:00',
      end_time: '21:00:00', format: '7v7', capacity: 14, pitch_ids: [], name: 'Eleni', payment_mode: 'booker_pays',
      joined: 0,
    },
  ];
}

export function customersList(): CustomerListItem[] {
  return [
    {
      kind: 'player', profile_id: 'u1', name: 'Andreas', bookings: 3, last_booking_day: '2026-11-17',
      debt_cents: 680, credit_cents: 1234, ...leak,
    } as CustomerListItem,
    {
      kind: 'contact', contact_id: 'c1', name: 'Maria Georgiou', phone: '+35799000001', bookings: 2,
      last_booking_day: '2026-11-17',
    },
  ];
}

/** venue_customer for a player: debt_cents and credit_cents aren't the sums of the lists. */
export function playerDetail(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    kind: 'player',
    profile_id: 'u1',
    name: 'Andreas',
    debt_cents: 4242,
    credit_cents: 888,
    bookings: [
      {
        booking_id: 'b1', booking_status: 'confirmed', booking_day: '2026-11-17', start_time: '18:00:00',
        end_time: '19:00:00', format: '5v5', is_booker: true, share_status: 'paid', payment_method: 'card',
        amount_cents: 680, cash_cents: 0,
      },
      {
        booking_id: 'b2', booking_status: 'cancelled', booking_day: '2026-11-10', start_time: '20:00:00',
        end_time: '21:00:00', format: '5v5', is_booker: false, share_status: 'credited', payment_method: 'cash',
        amount_cents: 80, cash_cents: 600,
      },
    ],
    debts: [
      { debt_id: 'd1', booking_id: 'b3', amount_cents: 680, reason: 'cash_unpaid', created_at: '2026-11-01T20:00:00Z', settled_at: null, settled_by: null },
      { debt_id: 'd2', booking_id: 'b4', amount_cents: 600, reason: 'unpaid_share', created_at: '2026-10-01T20:00:00Z', settled_at: '2026-10-02T09:00:00Z', settled_by: 'staff1' },
    ],
    credits: [
      { credit_id: 'cr1', amount_cents: 580, remaining_cents: 300, issued_at: '2026-11-01T10:00:00Z', expires_at: '2027-11-01T10:00:00Z', available: true },
      { credit_id: 'cr2', amount_cents: 500, remaining_cents: 400, issued_at: '2025-10-01T10:00:00Z', expires_at: '2026-10-01T10:00:00Z', available: false },
    ],
    ...leak,
    ...overrides,
  } as CustomerDetail;
}

export function contactDetail(): CustomerDetail {
  return {
    kind: 'contact',
    contact_id: 'c1',
    name: 'Maria Georgiou',
    phone: '+35799000001',
    bookings: [
      {
        booking_id: 'cb1', source: 'walk_in', booking_status: 'confirmed', booking_day: '2026-11-17',
        start_time: '19:00:00', end_time: '20:00:00', format: '5v5', venue_price_cents: 6000, charged_cents: 5000,
        paid_method: 'cash',
      },
    ],
  };
}

export function debtsList(includeSettled = false): DebtListItem[] {
  const open: DebtListItem = {
    debt_id: 'd1', profile_id: 'u1', name: 'Andreas', booking_id: 'b3', booking_day: '2026-11-01',
    start_time: '19:00:00', amount_cents: 680, venue_cents: 600, futty_cents: 80, reason: 'cash_unpaid',
    created_at: '2026-11-01T20:00:00Z', settled_at: null, settled_by: null, ...leak,
  } as DebtListItem;
  const settled: DebtListItem = {
    debt_id: 'd2', profile_id: 'u2', name: 'Eleni', booking_id: 'b4', booking_day: '2026-10-01',
    start_time: '20:00:00', amount_cents: 1111, venue_cents: 1000, futty_cents: 111, reason: 'unpaid_share',
    created_at: '2026-10-01T20:00:00Z', settled_at: '2026-10-02T09:00:00Z', settled_by: 'staff1',
  };
  return includeSettled ? [settled, open] : [open];
}

/** venue_credit_list: available_cents isn't the sum of the pieces. */
export function creditsList(): CreditListItem[] {
  return [
    {
      profile_id: 'u1', name: 'Andreas', available_cents: 888,
      credits: [
        // Expires 22:30 UTC on 31 Dec 2026: already 1 Jan 2027 in Cyprus.
        { credit_id: 'cr1', remaining_cents: 300, expires_at: '2026-12-31T22:30:00Z' },
        { credit_id: 'cr3', remaining_cents: 400, expires_at: '2027-11-01T10:00:00Z' },
      ],
      ...leak,
    } as CreditListItem,
  ];
}
