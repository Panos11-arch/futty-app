// The dashboard's money screens (P6d): the Cyprus dates the period stepper
// and the bookings range send, the 31-day cap (decided 14 November), and the
// parameters each read and write sends. The app never computes an amount.
import {
  bookingStatusLabel,
  canStepForward,
  checkRange,
  cyprusDateOf,
  debtReasonLabel,
  defaultRange,
  describeMoneyError,
  fetchBookingsList,
  fetchCredits,
  fetchCustomer,
  fetchCustomers,
  fetchDebts,
  fetchRevenue,
  fetchRevenueExport,
  formatDay,
  MAX_RANGE_DAYS,
  noShowsLine,
  periodLabel,
  periodStart,
  rangeDays,
  sameRevenue,
  settleDebt,
  stepPeriod,
} from '@/lib/venue-money';
import { revenueExport, revenueScreenMatchingExport } from '@/lib/venue-money.fixtures';
import { cyprusToday } from '@/lib/venue-today';

const mockRpc = jest.fn((..._args: unknown[]) => Promise.resolve({ data: null, error: null }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

beforeEach(() => mockRpc.mockClear());

describe('Cyprus today across midnight', () => {
  it('winter (UTC+2): 21:59 UTC is still the day, 22:00 UTC is the next', () => {
    expect(cyprusToday(new Date('2026-11-16T21:59:59Z'))).toBe('2026-11-16');
    expect(cyprusToday(new Date('2026-11-16T22:00:00Z'))).toBe('2026-11-17');
  });

  it('summer (UTC+3): 20:59 UTC is still the day, 21:00 UTC is the next', () => {
    expect(cyprusToday(new Date('2026-07-01T20:59:59Z'))).toBe('2026-07-01');
    expect(cyprusToday(new Date('2026-07-01T21:00:00Z'))).toBe('2026-07-02');
  });

  it('new year: 31 Dec 22:30 UTC is 1 Jan in Cyprus', () => {
    expect(cyprusToday(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01');
  });

  it('a timestamp from the server is dated in Cyprus', () => {
    expect(cyprusDateOf('2026-12-31T22:30:00Z')).toBe('2027-01-01');
    expect(cyprusDateOf('2026-12-31T21:30:00Z')).toBe('2026-12-31');
  });
});

describe('period start', () => {
  it('a day is itself', () => {
    expect(periodStart('day', '2026-11-17')).toBe('2026-11-17');
  });

  it('a week starts on Monday, across the year end', () => {
    expect(periodStart('week', '2026-11-17')).toBe('2026-11-16');
    expect(periodStart('week', '2026-11-16')).toBe('2026-11-16');
    expect(periodStart('week', '2026-11-22')).toBe('2026-11-16');
    expect(periodStart('week', '2027-01-03')).toBe('2026-12-28');
    expect(periodStart('week', '2027-01-01')).toBe('2026-12-28');
  });

  it('a month starts on the 1st', () => {
    expect(periodStart('month', '2026-11-30')).toBe('2026-11-01');
    expect(periodStart('month', '2028-02-29')).toBe('2028-02-01');
  });
});

describe('stepping a period', () => {
  it('days step over a month end and a year end', () => {
    expect(stepPeriod('day', '2027-01-31', 1)).toBe('2027-02-01');
    expect(stepPeriod('day', '2027-02-01', -1)).toBe('2027-01-31');
    expect(stepPeriod('day', '2026-12-31', 1)).toBe('2027-01-01');
    expect(stepPeriod('day', '2027-01-01', -1)).toBe('2026-12-31');
    expect(stepPeriod('day', '2028-02-28', 1)).toBe('2028-02-29');
  });

  it('weeks step Monday to Monday across the year end', () => {
    expect(stepPeriod('week', '2026-12-21', 1)).toBe('2026-12-28');
    expect(stepPeriod('week', '2026-12-28', 1)).toBe('2027-01-04');
    expect(stepPeriod('week', '2027-01-04', -1)).toBe('2026-12-28');
    // From any day of the week, to the Monday of the next one.
    expect(stepPeriod('week', '2027-01-02', -1)).toBe('2026-12-21');
  });

  it('months step to the 1st across the year end, and from a 31st', () => {
    expect(stepPeriod('month', '2026-12-01', 1)).toBe('2027-01-01');
    expect(stepPeriod('month', '2027-01-01', -1)).toBe('2026-12-01');
    expect(stepPeriod('month', '2027-01-31', 1)).toBe('2027-02-01');
    expect(stepPeriod('month', '2028-03-31', -1)).toBe('2028-02-01');
    expect(stepPeriod('month', '2026-11-17', -12)).toBe('2025-11-01');
  });

  it("can't go past the current Cyprus period", () => {
    expect(canStepForward('day', '2026-11-16', '2026-11-17')).toBe(true);
    expect(canStepForward('day', '2026-11-17', '2026-11-17')).toBe(false);
    expect(canStepForward('week', '2026-11-09', '2026-11-17')).toBe(true);
    expect(canStepForward('week', '2026-11-16', '2026-11-17')).toBe(false);
    expect(canStepForward('month', '2026-12-01', '2027-01-01')).toBe(true);
    expect(canStepForward('month', '2027-01-01', '2027-01-01')).toBe(false);
  });
});

describe('period labels', () => {
  it('days', () => {
    expect(periodLabel('day', '2026-11-17', '2026-11-17', '2026-11-17')).toBe('Today');
    expect(periodLabel('day', '2026-11-16', '2026-11-16', '2026-11-17')).toBe('Yesterday');
    expect(periodLabel('day', '2026-11-10', '2026-11-10', '2026-11-17')).toBe('Tue 10 Nov 2026');
  });

  it('weeks, across the year end', () => {
    expect(periodLabel('week', '2026-12-28', '2027-01-03', '2027-01-01')).toBe('Mon 28 Dec 2026 – Sun 3 Jan 2027');
  });

  it('months', () => {
    expect(periodLabel('month', '2026-12-01', '2026-12-31', '2027-01-01')).toBe('December 2026');
    expect(periodLabel('month', '2028-02-01', '2028-02-29', '2028-02-10')).toBe('February 2028');
  });

  it('a day on its own', () => {
    expect(formatDay('2027-01-01')).toBe('Fri 1 Jan 2027');
  });
});

describe('bookings range', () => {
  it('defaults to Cyprus today and the next six days', () => {
    expect(defaultRange('2026-12-29')).toEqual({ from: '2026-12-29', to: '2027-01-04' });
  });

  it('counts both ends', () => {
    expect(rangeDays('2026-12-01', '2026-12-01')).toBe(1);
    expect(rangeDays('2026-12-01', '2026-12-31')).toBe(31);
    expect(rangeDays('2026-12-01', '2027-01-01')).toBe(32);
    expect(rangeDays('2028-02-01', '2028-03-01')).toBe(30);
  });

  it('allows up to 31 days, and refuses more or a backwards range', () => {
    expect(MAX_RANGE_DAYS).toBe(31);
    expect(checkRange('2026-12-01', '2026-12-31')).toBeNull();
    expect(checkRange('2026-12-01', '2027-01-01')).toBe('Pick a range of 31 days or less.');
    expect(checkRange('2026-12-02', '2026-12-01')).toBe('Pick an end date on or after the start date.');
  });
});

describe('what each call sends', () => {
  it('revenue for the screen and for the CSV', async () => {
    await fetchRevenue('v1', 'week', '2026-11-16');
    await fetchRevenueExport('v1', 'month', '2026-11-01');
    expect(mockRpc.mock.calls).toEqual([
      ['venue_revenue', { p_venue_id: 'v1', p_period: 'week', p_day: '2026-11-16' }],
      ['venue_revenue_export', { p_venue_id: 'v1', p_period: 'month', p_day: '2026-11-01' }],
    ]);
  });

  it('the bookings list: no filter is null', async () => {
    await fetchBookingsList({ venueId: 'v1', from: '2026-11-17', to: '2026-11-23', source: null, status: null });
    await fetchBookingsList({ venueId: 'v1', from: '2026-11-17', to: '2026-11-17', source: 'walk_in', status: 'cancelled' });
    expect(mockRpc.mock.calls).toEqual([
      ['venue_bookings_list', { p_venue_id: 'v1', p_from: '2026-11-17', p_to: '2026-11-23', p_source: null, p_status: null }],
      ['venue_bookings_list', { p_venue_id: 'v1', p_from: '2026-11-17', p_to: '2026-11-17', p_source: 'walk_in', p_status: 'cancelled' }],
    ]);
  });

  it('a range over 31 days is never sent', async () => {
    const result = await fetchBookingsList({ venueId: 'v1', from: '2026-12-01', to: '2027-01-01', source: null, status: null });
    expect(result.error?.message).toBe('range_too_long');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('customers, debts, credits and settling', async () => {
    await fetchCustomers('v1');
    await fetchCustomer('v1', 'contact', 'c1');
    await fetchDebts('v1', false);
    await fetchDebts('v1', true);
    await fetchCredits('v1');
    await settleDebt('d1');
    expect(mockRpc.mock.calls).toEqual([
      ['venue_customers', { p_venue_id: 'v1' }],
      ['venue_customer', { p_venue_id: 'v1', p_kind: 'contact', p_id: 'c1' }],
      ['venue_debt_list', { p_venue_id: 'v1', p_include_settled: false }],
      ['venue_debt_list', { p_venue_id: 'v1', p_include_settled: true }],
      ['venue_credit_list', { p_venue_id: 'v1' }],
      ['settle_debt', { p_debt_id: 'd1' }],
    ]);
  });
});

describe('the CSV and the screen agree', () => {
  it('the same period and figures', () => {
    expect(sameRevenue(revenueScreenMatchingExport(), revenueExport())).toBe(true);
  });

  it('a total that moved', () => {
    const moved = revenueExport({ totals: { venue_cents: 5601, futty_cents: 45, stripe_fee_cents: 35, rows: 2 } });
    expect(sameRevenue(revenueScreenMatchingExport(), moved)).toBe(false);
  });

  it("a source's row count that moved", () => {
    const data = revenueExport();
    const sources = data.sources.map((s) => (s.source === 'phone' ? { ...s, rows: 1 } : s));
    expect(sameRevenue(revenueScreenMatchingExport(), { ...data, sources })).toBe(false);
  });

  it('another period', () => {
    expect(sameRevenue(revenueScreenMatchingExport(), revenueExport({ from: '2026-11-16' }))).toBe(false);
  });
});

describe('words', () => {
  it('labels', () => {
    expect(bookingStatusLabel('pending_payment')).toBe('Waiting for payment');
    expect(debtReasonLabel('cash_unpaid')).toBe('Cash not paid');
    expect(debtReasonLabel('something_new')).toBe('Unpaid');
  });

  it("a player's no-shows at this venue, as the server counted them (P6e)", () => {
    expect(noShowsLine(0)).toBe('No-shows here: 0');
    expect(noShowsLine(2)).toBe('No-shows here: 2');
  });

  it('errors', () => {
    expect(describeMoneyError('debt_settled')).toBe('This debt is already settled.');
    expect(describeMoneyError('customer_not_found')).toBe('This customer isn’t one of yours.');
    expect(describeMoneyError('not_venue_staff')).toBe("You're not staff at this venue.");
  });
});
