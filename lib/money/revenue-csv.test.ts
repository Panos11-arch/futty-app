import columns from './revenue-row-columns.json';
import {
  buildRevenueCsv,
  type RevenueExport,
  type RevenueRow,
  type RevenueSource,
  type RevenueTotals,
} from './revenue-csv';

// The day from supabase/tests/pay-dashboard-8-revenue.test.sql, as
// venue_revenue_export returns it: app card, ticked cash (one handed back), a
// discounted walk-in, a cancelled phone booking and a debt settled at the
// counter. The SQL test checks the server's rows have exactly the columns in
// revenue-row-columns.json; buildRevenueCsv refuses rows that don't.
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

const SOURCES: RevenueSource[] = ['app_card', 'app_cash', 'walk_in', 'phone'];

// What the server sends with those rows: its per-source totals and totals.
function exportOf(rows: RevenueRow[]): RevenueExport {
  const total = (rs: RevenueRow[]): RevenueTotals => ({
    venue_cents: rs.reduce((t, r) => t + r.venue_cents, 0),
    futty_cents: rs.reduce((t, r) => t + r.futty_cents, 0),
    stripe_fee_cents: rs.reduce((t, r) => t + r.stripe_fee_cents, 0),
    rows: rs.length,
  });
  return {
    period: 'day',
    from: '2026-11-14',
    to: '2026-11-14',
    rows,
    sources: SOURCES.map((source) => ({ source, ...total(rows.filter((r) => r.source === source)) })),
    totals: total(rows),
  };
}

const DAY_EXPORT = exportOf(DAY);

const BOM = '﻿';
const HEADER =
  'Date,Time,Source,Type,Reason,Booking,Booking day,Kickoff,Who,Venue (EUR),Futty (EUR),Stripe fee (EUR),Venue price (EUR),Charged (EUR)';

function lines(csv: string) {
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(BOM.length, -2).split('\r\n');
}

describe('buildRevenueCsv', () => {
  it('the server totals are those rows (the fixture is consistent)', () => {
    expect(DAY_EXPORT.totals).toEqual({ venue_cents: 6300, futty_cents: 179, stripe_fee_cents: 61, rows: 10 });
    expect(DAY_EXPORT.sources.map((s) => s.venue_cents)).toEqual([600, 1200, 4500, 0]);
  });

  it('starts with a UTF-8 BOM, so Excel reads Greek names, and keeps commas', () => {
    const csv = buildRevenueCsv(exportOf([row({ who: 'Ανδρέας Χ' })]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines(csv)[0]).toBe(HEADER);
    expect(lines(csv)[1]).toContain(',Ανδρέας Χ,');
  });

  it('has the same rows as the export, in order, then each source total and the total', () => {
    const out = lines(buildRevenueCsv(DAY_EXPORT));
    expect(out[0]).toBe(HEADER);
    expect(out).toHaveLength(1 + DAY.length + SOURCES.length + 1);
    expect(out[1]).toBe('2026-11-14,10:00,App card,capture,share_captured,b-app,2026-11-17,12:00,Bea Booker,6.00,0.45,0.35,,');
    expect(out[5]).toBe('2026-11-14,10:00,App cash,cash_received,cash_returned,b-app,2026-11-17,12:00,Back Bo,-6.00,0.00,0.00,,');
    expect(out[6]).toBe(
      '2026-11-14,10:00,Walk-in,counter_paid,counter_paid_cash,b-walk,2026-11-17,15:00,Regular Rex,45.00,0.00,0.00,60.00,45.00',
    );
    expect(out[8]).toBe(
      '2026-11-14,11:15,Phone,counter_paid,counter_booking_cancelled,b-phone,2026-11-17,17:00,Caller Cleo,-60.00,0.00,0.00,60.00,60.00',
    );
    expect(out.slice(11)).toEqual([
      'Total App card,,,,,,,,,6.00,0.99,0.61,,',
      'Total App cash,,,,,,,,,12.00,0.80,0.00,,',
      'Total Walk-in,,,,,,,,,45.00,0.00,0.00,,',
      'Total Phone,,,,,,,,,0.00,0.00,0.00,,',
      'Total,,,,,,,,,63.00,1.79,0.61,,',
    ]);
  });

  it('every row keeps its own amounts', () => {
    const out = lines(buildRevenueCsv(DAY_EXPORT)).slice(1, 1 + DAY.length);
    out.forEach((line, i) => {
      const cells = line.split(',');
      expect(cells[9]).toBe(euros(DAY[i].venue_cents));
      expect(cells[10]).toBe(euros(DAY[i].futty_cents));
      expect(cells[11]).toBe(euros(DAY[i].stripe_fee_cents));
    });
  });

  it('refuses totals that are not those rows', () => {
    const bad = (over: Partial<RevenueTotals>) => ({ ...DAY_EXPORT, totals: { ...DAY_EXPORT.totals, ...over } });
    expect(() => buildRevenueCsv(bad({ venue_cents: 6200 }))).toThrow('revenue rows and totals disagree');
    expect(() => buildRevenueCsv(bad({ futty_cents: 180 }))).toThrow('revenue rows and totals disagree');
    expect(() => buildRevenueCsv(bad({ stripe_fee_cents: 60 }))).toThrow('revenue rows and totals disagree');
    expect(() => buildRevenueCsv({ ...DAY_EXPORT, rows: DAY.slice(1) })).toThrow('revenue rows and totals disagree');
  });

  it('refuses per-source totals that are not those rows', () => {
    const sources = DAY_EXPORT.sources.map((s) => (s.source === 'walk_in' ? { ...s, venue_cents: 4400 } : s));
    expect(() => buildRevenueCsv({ ...DAY_EXPORT, sources })).toThrow('revenue rows and totals disagree');
    expect(() => buildRevenueCsv({ ...DAY_EXPORT, sources: DAY_EXPORT.sources.slice(1) })).toThrow(
      'revenue rows and totals disagree',
    );
  });

  it('refuses rows whose columns are not the server columns', () => {
    const { who: _who, ...missing } = row({});
    expect(() => buildRevenueCsv(exportOf([missing as RevenueRow]))).toThrow('revenue row columns changed');
    expect(() => buildRevenueCsv(exportOf([{ ...row({}), email: 'x@y.z' } as RevenueRow]))).toThrow(
      'revenue row columns changed',
    );
  });

  it('a row with an unknown source is refused, never written as blank', () => {
    expect(() => buildRevenueCsv(exportOf([row({ source: null as unknown as RevenueSource })]))).toThrow(
      'revenue row without a source',
    );
  });

  it('reads the server columns from the shared file', () => {
    expect(Object.keys(row({})).sort()).toEqual([...columns].sort());
  });

  it('a period with no money is the header and zero totals', () => {
    expect(lines(buildRevenueCsv(exportOf([])))).toEqual([
      HEADER,
      'Total App card,,,,,,,,,0.00,0.00,0.00,,',
      'Total App cash,,,,,,,,,0.00,0.00,0.00,,',
      'Total Walk-in,,,,,,,,,0.00,0.00,0.00,,',
      'Total Phone,,,,,,,,,0.00,0.00,0.00,,',
      'Total,,,,,,,,,0.00,0.00,0.00,,',
    ]);
  });

  it('quotes names with commas, quotes and line breaks', () => {
    const csv = buildRevenueCsv(exportOf([row({ who: 'Smith, "Smithy"\nJr' })]));
    expect(csv).toContain(',"Smith, ""Smithy""\nJr",');
  });

  it.each(['=HYPERLINK("x")', '+357 99', '-1', '@SUM(A1)', '\tTab', '\rCR', '\n=1+1'])(
    'a name starting %j can never run as a formula',
    (who) => {
      const out = buildRevenueCsv(exportOf([row({ who })]));
      const cell = out.split('\r\n')[1].split(',').slice(8).join(',');
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('leaves negative amounts as numbers and a missing name empty', () => {
    const out = lines(buildRevenueCsv(exportOf([row({ who: null, venue_cents: -600 })])));
    expect(out[1]).toBe('2026-11-14,10:00,App card,capture,share_captured,b-app,2026-11-17,12:00,,-6.00,0.00,0.00,,');
  });
});

function euros(cents: number) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
