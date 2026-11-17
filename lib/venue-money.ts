// The venue dashboard's money screens (P6d; docs/specs/13-payments-bookings.md
// "Venue dashboard", "Cash, debt and venue credit"; spec 14 P6, added 11
// November): Money (revenue by source), Bookings, Customers, Debts and
// Credits. Everything comes from P6b's staff-checked server functions
// (supabase/migrations/20261113235802_pay_dashboard_revenue.sql,
// 20261113235806_pay_dashboard_people.sql, 20261113235757_pay_dashboard_debt_cash.sql).
// This file only sends ids, Cyprus dates and filter choices, and puts what
// comes back into words. It never adds, subtracts or works out an amount.

import type { RevenueExport, RevenueSource, RevenueSourceTotals, RevenueTotals } from '@/lib/money/revenue-csv';
import { supabase } from '@/lib/supabase';
import { addDays, cyprusToday, describeVenueError } from '@/lib/venue-today';

// ---- Types: as the server returns them -----------------------------------

export type Period = 'day' | 'week' | 'month';

/** A walk-in or phone booking paid in the period at a price other than the venue's. */
export type PriceOverride = {
  booking_id: string;
  source: 'walk_in' | 'phone';
  contact_name: string;
  booking_day: string;
  start_time: string;
  moved_on: string;
  venue_price_cents: number | null;
  charged_cents: number | null;
};

/** venue_revenue's response. */
export type RevenueScreen = {
  period: Period;
  from: string;
  to: string;
  sources: RevenueSourceTotals[];
  totals: RevenueTotals;
  overrides: PriceOverride[];
};

export type BookingSource = 'app' | 'walk_in' | 'phone';
export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled';

type BookingBase = {
  id: string;
  status: BookingStatus;
  booking_day: string;
  start_time: string;
  end_time: string;
  format: string;
  capacity: number | null;
  pitch_ids: string[];
  name: string | null;
};

/** One row of venue_bookings_list. */
export type BookingListItem =
  | (BookingBase & { source: 'app'; payment_mode: string | null; joined: number })
  | (BookingBase & {
      source: 'walk_in' | 'phone';
      phone: string | null;
      contact_id: string;
      venue_price_cents: number | null;
      charged_cents: number | null;
      paid_method: 'cash' | 'card' | null;
      paid_at: string | null;
    });

/** One row of venue_customers. */
export type CustomerListItem =
  | {
      kind: 'player';
      profile_id: string;
      name: string;
      bookings: number;
      last_booking_day: string | null;
      debt_cents: number;
      credit_cents: number;
    }
  | {
      kind: 'contact';
      contact_id: string;
      name: string;
      phone: string | null;
      bookings: number;
      last_booking_day: string | null;
    };

export type PlayerBooking = {
  booking_id: string;
  booking_status: BookingStatus;
  booking_day: string;
  start_time: string;
  end_time: string;
  format: string;
  is_booker: boolean;
  share_status: string | null;
  payment_method: 'card' | 'cash' | null;
  amount_cents: number | null;
  cash_cents: number | null;
  /** A cash player's cash part: true once the venue has it, false until then; null for a card player or no share. */
  cash_received: boolean | null;
};

export type ContactBooking = {
  booking_id: string;
  source: 'walk_in' | 'phone';
  booking_status: BookingStatus;
  booking_day: string;
  start_time: string;
  end_time: string;
  format: string;
  venue_price_cents: number | null;
  charged_cents: number | null;
  paid_method: 'cash' | 'card' | null;
};

export type CustomerDebt = {
  debt_id: string;
  booking_id: string | null;
  amount_cents: number;
  reason: string;
  created_at: string;
  settled_at: string | null;
  settled_by: string | null;
};

export type CustomerCredit = {
  credit_id: string;
  amount_cents: number;
  remaining_cents: number;
  issued_at: string;
  expires_at: string;
  available: boolean;
  /** Its expiry has passed (the server's clock, not the phone's). */
  expired: boolean;
};

/** venue_customer's response. */
export type CustomerDetail =
  | {
      kind: 'player';
      profile_id: string;
      name: string;
      debt_cents: number;
      credit_cents: number;
      bookings: PlayerBooking[];
      debts: CustomerDebt[];
      credits: CustomerCredit[];
    }
  | { kind: 'contact'; contact_id: string; name: string; phone: string | null; bookings: ContactBooking[] };

export type CustomerKind = CustomerDetail['kind'];

/** One row of venue_debt_list. */
export type DebtListItem = {
  debt_id: string;
  profile_id: string;
  name: string;
  booking_id: string | null;
  booking_day: string | null;
  start_time: string | null;
  amount_cents: number;
  venue_cents: number;
  futty_cents: number;
  reason: string;
  created_at: string;
  settled_at: string | null;
  settled_by: string | null;
};

/** One row of venue_credit_list. */
export type CreditListItem = {
  profile_id: string;
  name: string;
  available_cents: number;
  credits: { credit_id: string; remaining_cents: number; expires_at: string }[];
};

// ---- Calls ---------------------------------------------------------------

export function fetchRevenue(venueId: string, period: Period, day: string) {
  return supabase.rpc('venue_revenue', { p_venue_id: venueId, p_period: period, p_day: day });
}

export function fetchRevenueExport(venueId: string, period: Period, day: string) {
  return supabase.rpc('venue_revenue_export', { p_venue_id: venueId, p_period: period, p_day: day });
}

/** The payouts CSV's one call: the payouts sent in the period (Cyprus
 *  dates), each payout's total and the total sent and reversed. */
export function fetchPayoutsExport(venueId: string, period: Period, day: string) {
  return supabase.rpc('venue_payouts_export', { p_venue_id: venueId, p_period: period, p_day: day });
}

export type BookingsQuery = {
  venueId: string;
  from: string;
  to: string;
  source: BookingSource | null;
  status: BookingStatus | null;
};

/** The venue's bookings in a range. A range the app refuses (over 31 days,
 *  or backwards) is never sent. */
export async function fetchBookingsList(q: BookingsQuery): Promise<{ data: unknown; error: { message: string } | null }> {
  const days = rangeDays(q.from, q.to);
  if (days < 1) return { data: null, error: { message: 'range_backwards' } };
  if (days > MAX_RANGE_DAYS) return { data: null, error: { message: 'range_too_long' } };
  return supabase.rpc('venue_bookings_list', {
    p_venue_id: q.venueId,
    p_from: q.from,
    p_to: q.to,
    p_source: q.source,
    p_status: q.status,
  });
}

export function fetchCustomers(venueId: string) {
  return supabase.rpc('venue_customers', { p_venue_id: venueId });
}

export function fetchCustomer(venueId: string, kind: CustomerKind, id: string) {
  return supabase.rpc('venue_customer', { p_venue_id: venueId, p_kind: kind, p_id: id });
}

export function fetchDebts(venueId: string, includeSettled: boolean) {
  return supabase.rpc('venue_debt_list', { p_venue_id: venueId, p_include_settled: includeSettled });
}

/** The venue marks a debt settled: the player paid in person (spec 13, "A debt settled at the venue"). */
export function settleDebt(debtId: string) {
  return supabase.rpc('settle_debt', { p_debt_id: debtId });
}

export function fetchCredits(venueId: string) {
  return supabase.rpc('venue_credit_list', { p_venue_id: venueId });
}

// ---- The CSV and the screen agree ----------------------------------------

function sameTotals(a: RevenueTotals, b: RevenueTotals) {
  return (
    a.venue_cents === b.venue_cents &&
    a.futty_cents === b.futty_cents &&
    a.stripe_fee_cents === b.stripe_fee_cents &&
    a.rows === b.rows
  );
}

/** Does the export say exactly what the screen shows: the same period, each
 *  source's figures and the totals? Compares the server's numbers; adds none. */
export function sameRevenue(onScreen: Pick<RevenueScreen, 'from' | 'to' | 'sources' | 'totals'>, exported: RevenueExport) {
  if (onScreen.from !== exported.from || onScreen.to !== exported.to) return false;
  if (!sameTotals(onScreen.totals, exported.totals)) return false;
  if (onScreen.sources.length !== exported.sources.length) return false;
  return onScreen.sources.every((s) => {
    const other = exported.sources.find((e) => e.source === s.source);
    return other !== undefined && sameTotals(s, other);
  });
}

// ---- Cyprus dates ----------------------------------------------------------
// Dates are Cyprus calendar dates (YYYY-MM-DD); stepping them is calendar
// arithmetic on the date alone, never on the phone's clock.

function dayToUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Cyprus date of a server timestamp. */
export function cyprusDateOf(timestamp: string): string {
  return cyprusToday(new Date(timestamp));
}

/** The first day of the period holding `day`: itself, its Monday, or the 1st. */
export function periodStart(period: Period, day: string): string {
  if (period === 'day') return day;
  if (period === 'week') return addDays(day, -((dayToUtc(day).getUTCDay() + 6) % 7));
  return `${day.slice(0, 7)}-01`;
}

/** The first day of the period `n` periods from the one holding `day`. */
export function stepPeriod(period: Period, day: string, n: number): string {
  const start = periodStart(period, day);
  if (period === 'day') return addDays(start, n);
  if (period === 'week') return addDays(start, 7 * n);
  const date = dayToUtc(start);
  date.setUTCMonth(date.getUTCMonth() + n);
  return date.toISOString().slice(0, 10);
}

/** The stepper stops at the period holding Cyprus today. */
export function canStepForward(period: Period, day: string, today: string): boolean {
  return periodStart(period, day) < periodStart(period, today);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '2027-01-01' -> 'Fri 1 Jan 2027'. */
export function formatDay(day: string): string {
  const date = dayToUtc(day);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The period's title, from the dates the server says it covers. */
export function periodLabel(period: Period, from: string, to: string, today: string): string {
  if (period === 'day') {
    if (from === today) return 'Today';
    if (from === addDays(today, -1)) return 'Yesterday';
    return formatDay(from);
  }
  if (period === 'week') return `${formatDay(from)} – ${formatDay(to)}`;
  const date = dayToUtc(from);
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The bookings list's longest range, both ends counted (decided 14 November). */
export const MAX_RANGE_DAYS = 31;

/** Cyprus today and the next six days. */
export function defaultRange(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, 6) };
}

/** Calendar days from `from` to `to`, both counted (0 or less when backwards). */
export function rangeDays(from: string, to: string): number {
  return Math.round((dayToUtc(to).getTime() - dayToUtc(from).getTime()) / DAY_MS) + 1;
}

/** Null when the range can be asked for, else why not. */
export function checkRange(from: string, to: string): string | null {
  const days = rangeDays(from, to);
  if (days < 1) return describeMoneyError('range_backwards');
  if (days > MAX_RANGE_DAYS) return describeMoneyError('range_too_long');
  return null;
}

// ---- Words -----------------------------------------------------------------

export const REVENUE_SOURCES: RevenueSource[] = ['app_card', 'app_cash', 'walk_in', 'phone'];

export function revenueSourceLabel(source: RevenueSource): string {
  switch (source) {
    case 'app_card':
      return 'App card';
    case 'app_cash':
      return 'App cash';
    case 'walk_in':
      return 'Walk-in';
    case 'phone':
      return 'Phone';
  }
}

export function bookingSourceLabel(source: BookingSource): string {
  switch (source) {
    case 'app':
      return 'App';
    case 'walk_in':
      return 'Walk-in';
    case 'phone':
      return 'Phone';
  }
}

export function bookingStatusLabel(status: BookingStatus): string {
  switch (status) {
    case 'pending_payment':
      return 'Waiting for payment';
    case 'confirmed':
      return 'Confirmed';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function debtReasonLabel(reason: string): string {
  switch (reason) {
    case 'unpaid_share':
      return 'Unpaid share';
    case 'cash_unpaid':
      return 'Cash not paid';
    case 'top_up_failed':
      return 'Top-up not paid';
    case 'guarantee_not_held':
      return 'Guarantee not held';
    case 'cancellation_fee':
      return 'Cancellation fee';
    case 'gipedo_hold_expired':
      return 'Gipedo Pano hold expired';
    default:
      return 'Unpaid';
  }
}

/** A player's share in a booking, in a word. */
export function shareStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'paying';
    case 'authorized':
      return 'held';
    case 'paid':
      return 'paid';
    case 'covered':
      return 'covered by the booker';
    case 'credited':
      return 'left with credit';
    case 'refunded':
      return 'refunded';
    case 'refund_due':
      return 'refund due';
    case 'forfeited':
      return 'forfeited';
    case 'expired':
      return 'expired';
    case 'cancelled':
      return 'left';
    default:
      return status;
  }
}

/** The server's refusal, in words staff can act on. */
export function describeMoneyError(code: string): string {
  switch (code) {
    case 'range_too_long':
      return `Pick a range of ${MAX_RANGE_DAYS} days or less.`;
    case 'range_backwards':
    case 'invalid_range':
      return 'Pick an end date on or after the start date.';
    case 'debt_settled':
      return 'This debt is already settled.';
    case 'debt_not_found':
      return 'That debt is gone.';
    case 'customer_not_found':
      return 'This customer isn’t one of yours.';
    case 'revenue_changed':
      return 'Revenue changed since you opened this. Check the new totals and export again.';
    default:
      return describeVenueError(code);
  }
}
