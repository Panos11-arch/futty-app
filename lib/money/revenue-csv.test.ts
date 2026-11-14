import { buildRevenueCsv, type RevenueRow, type RevenueTotals } from './revenue-csv';

// The day from supabase/tests/pay-dashboard-8-revenue.test.sql, as
// venue_revenue_rows returns it: app card, ticked cash (one handed back), a
// discounted walk-in, a cancelled phone booking and a debt settled at the
// counter.
function row(over: Partial<RevenueRow>): RevenueRow {
  return {
    ledger_id: 'l',
    moved_on: '2026-11-14',
    moved_at: '10:00',
    source: 'app_card',
    kind: 'capture',
    reason: 'share_captured',
    booking_id: 'b-app',
    booking_day: '2026-11-17',
    start_time: '12:00:00',
    who: 'Bea Booker',
    venue_cents: 0,
    futty_cents: 0,
    stripe_fee_cents: 0,
    venue_price_cents: null,
    charged_cents: null,
    ...over,
  };
}

const DAY: RevenueRow[] = [
  row({ ledger_id: 'l1', venue_cents: 600, futty_cents: 45, stripe_fee_cents: 35 }),
  row({ ledger_id: 'l2', who: 'Cash Carl', futty_cents: 54, stripe_fee_cents: 26 }),
  row({ ledger_id: 'l3', source: 'app_cash', kind: 'cash_received', reason: 'cash_received_at_venue', who: 'Cash Carl', venue_cents: 600 }),
  row({ ledger_id: 'l4', source: 'app_cash', kind: 'cash_received', reason: 'cash_received_at_venue', who: 'Back Bo', venue_cents: 600 }),
  row({ ledger_id: 'l5', source: 'app_cash', kind: 'cash_received', reason: 'cash_returned', who: 'Back Bo', venue_cents: -600 }),
  row({
    ledger_id: 'l6', source: 'walk_in', kind: 'counter_paid', reason: 'counter_paid_cash', booking_id: 'b-walk',
    start_time: '15:00:00', who: 'Regular Rex', venue_cents: 4500, venue_price_cents: 6000, charged_cents: 4500,
  }),
  row({
    ledger_id: 'l7', source: 'phone', kind: 'counter_paid', reason: 'counter_paid_card', booking_id: 'b-phone',
    start_time: '17:00:00', who: 'Caller Cleo', venue_cents: 6000, venue_price_cents: 6000, charged_cents: 6000,
  }),
  row({
    ledger_id: 'l8', moved_at: '11:15', source: 'phone', kind: 'counter_paid', reason: 'counter_booking_cancelled',
    booking_id: 'b-phone', start_time: '17:00:00', who: 'Caller Cleo', venue_cents: -6000, venue_price_cents: 6000,
    charged_cents: 6000,
  }),
  row({ ledger_id: 'l9', source: 'app_cash', kind: 'debt_cash_received', reason: 'debt_settled_at_venue', who: 'Dee Debt', venue_cents: 680 }),
  row({ ledger_id: 'l10', source: 'app_cash', kind: 'venue_payable', reason: 'venue_settled_debt_fee', who: 'Dee Debt', venue_cents: -80, futty_cents: 80 }),
];
// venue_revenue's totals for that day.
const DAY_TOTALS: RevenueTotals = { venue_cents: 6300, futty_cents: 179, stripe_fee_cents: 61, rows: 10 };

const HEADER =
  'Date,Time,Source,Type,Reason,Booking,Booking day,Kickoff,Who,Venue (EUR),Futty fee (EUR),Stripe fee (EUR),Venue price (EUR),Charged (EUR)';

function lines(csv: string) {
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(0, -2).split('\r\n');
}

describe('buildRevenueCsv', () => {
  it('has the same rows as venue_revenue_rows, in order, and its totals', () => {
    const out = lines(buildRevenueCsv(DAY, DAY_TOTALS));
    expect(out[0]).toBe(HEADER);
    expect(out).toHaveLength(1 + DAY.length + 1);
    expect(out[1]).toBe('2026-11-14,10:00,App card,capture,share_captured,b-app,2026-11-17,12:00,Bea Booker,6.00,0.45,0.35,,');
    expect(out[5]).toBe('2026-11-14,10:00,App cash,cash_received,cash_returned,b-app,2026-11-17,12:00,Back Bo,-6.00,0.00,0.00,,');
    expect(out[6]).toBe(
      '2026-11-14,10:00,Walk-in,counter_paid,counter_paid_cash,b-walk,2026-11-17,15:00,Regular Rex,45.00,0.00,0.00,60.00,45.00',
    );
    expect(out[8]).toBe(
      '2026-11-14,11:15,Phone,counter_paid,counter_booking_cancelled,b-phone,2026-11-17,17:00,Caller Cleo,-60.00,0.00,0.00,60.00,60.00',
    );
    expect(out[11]).toBe('Total,,,,,,,,,63.00,1.79,0.61,,');
  });

  it('every row keeps its own amounts', () => {
    const out = lines(buildRevenueCsv(DAY, DAY_TOTALS)).slice(1, -1);
    out.forEach((line, i) => {
      const cells = line.split(',');
      expect(cells[9]).toBe(euros(DAY[i].venue_cents));
      expect(cells[10]).toBe(euros(DAY[i].futty_cents));
      expect(cells[11]).toBe(euros(DAY[i].stripe_fee_cents));
    });
  });

  it('refuses totals that are not those rows', () => {
    expect(() => buildRevenueCsv(DAY, { ...DAY_TOTALS, venue_cents: 6200 })).toThrow('revenue rows and totals disagree');
    expect(() => buildRevenueCsv(DAY, { ...DAY_TOTALS, futty_cents: 180 })).toThrow('revenue rows and totals disagree');
    expect(() => buildRevenueCsv(DAY, { ...DAY_TOTALS, stripe_fee_cents: 60 })).toThrow('revenue rows and totals disagree');
    expect(() => buildRevenueCsv(DAY.slice(1), DAY_TOTALS)).toThrow('revenue rows and totals disagree');
  });

  it('a period with no money is the header and a zero total', () => {
    expect(lines(buildRevenueCsv([], { venue_cents: 0, futty_cents: 0, stripe_fee_cents: 0, rows: 0 }))).toEqual([
      HEADER,
      'Total,,,,,,,,,0.00,0.00,0.00,,',
    ]);
  });

  it('quotes names with commas, quotes and line breaks', () => {
    const rows = [row({ who: 'Smith, "Smithy"\nJr' })];
    const csv = buildRevenueCsv(rows, { venue_cents: 0, futty_cents: 0, stripe_fee_cents: 0, rows: 1 });
    expect(csv).toContain(',"Smith, ""Smithy""\nJr",');
  });

  it.each(['=HYPERLINK("x")', '+357 99', '-1', '@SUM(A1)', '\tTab', '\rCR'])(
    'a name starting %j can never run as a formula',
    (who) => {
      const out = buildRevenueCsv([row({ who })], { venue_cents: 0, futty_cents: 0, stripe_fee_cents: 0, rows: 1 });
      const cell = out.split('\r\n')[1].split(',').slice(8).join(',');
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('leaves negative amounts as numbers and a missing name empty', () => {
    const out = lines(
      buildRevenueCsv([row({ who: null, venue_cents: -600 })], { venue_cents: -600, futty_cents: 0, stripe_fee_cents: 0, rows: 1 }),
    );
    expect(out[1]).toBe('2026-11-14,10:00,App card,capture,share_captured,b-app,2026-11-17,12:00,,-6.00,0.00,0.00,,');
  });
});

function euros(cents: number) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
