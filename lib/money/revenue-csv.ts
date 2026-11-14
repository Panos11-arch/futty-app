// The venue dashboard's revenue CSV (docs/specs/14 P6, added 11 November:
// "a CSV export of the same rows (amounts in euros with two decimals, Cyprus
// dates)"). Every row and amount comes from the server: the rows from
// venue_revenue_rows and the totals from venue_revenue, both read from
// money_ledger (supabase/migrations/*_pay_dashboard_revenue.sql). This only
// writes them out; it refuses totals that aren't those rows, so the file
// always matches the screen.

import { formatEurosPlain } from './format';

export type RevenueSource = 'app_card' | 'app_cash' | 'walk_in' | 'phone';

/** One row of venue_revenue_rows. Dates are Cyprus dates (YYYY-MM-DD), times
 *  Cyprus HH:MM; amounts are integer cents. */
export type RevenueRow = {
  ledger_id: string;
  moved_on: string;
  moved_at: string;
  source: RevenueSource;
  kind: string;
  reason: string;
  booking_id: string;
  booking_day: string;
  start_time: string;
  who: string | null;
  venue_cents: number;
  futty_cents: number;
  stripe_fee_cents: number;
  venue_price_cents: number | null;
  charged_cents: number | null;
};

/** venue_revenue's totals. */
export type RevenueTotals = {
  venue_cents: number;
  futty_cents: number;
  stripe_fee_cents: number;
  rows: number;
};

const SOURCE_LABELS: Record<RevenueSource, string> = {
  app_card: 'App card',
  app_cash: 'App cash',
  walk_in: 'Walk-in',
  phone: 'Phone',
};

const HEADER = [
  'Date',
  'Time',
  'Source',
  'Type',
  'Reason',
  'Booking',
  'Booking day',
  'Kickoff',
  'Who',
  'Venue (EUR)',
  'Futty fee (EUR)',
  'Stripe fee (EUR)',
  'Venue price (EUR)',
  'Charged (EUR)',
];

// A text cell: a spreadsheet must never run it as a formula (a name like
// "=HYPERLINK(...)" typed at the counter), and commas, quotes and line
// breaks are quoted (RFC 4180).
function text(value: string | null): string {
  let cell = value ?? '';
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function amount(cents: number | null): string {
  return cents === null ? '' : formatEurosPlain(cents);
}

/** The CSV for one period: a header, one line per row in the server's order,
 *  and the server's totals. Lines end in CRLF. */
export function buildRevenueCsv(rows: RevenueRow[], totals: RevenueTotals): string {
  const sum = (pick: (r: RevenueRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
  if (
    rows.length !== totals.rows ||
    sum((r) => r.venue_cents) !== totals.venue_cents ||
    sum((r) => r.futty_cents) !== totals.futty_cents ||
    sum((r) => r.stripe_fee_cents) !== totals.stripe_fee_cents
  ) {
    throw new Error('revenue rows and totals disagree');
  }

  const lines = [
    HEADER.join(','),
    ...rows.map((r) =>
      [
        r.moved_on,
        r.moved_at,
        SOURCE_LABELS[r.source],
        text(r.kind),
        text(r.reason),
        r.booking_id,
        r.booking_day,
        r.start_time.slice(0, 5),
        text(r.who),
        amount(r.venue_cents),
        amount(r.futty_cents),
        amount(r.stripe_fee_cents),
        amount(r.venue_price_cents),
        amount(r.charged_cents),
      ].join(','),
    ),
    ['Total', '', '', '', '', '', '', '', '', amount(totals.venue_cents), amount(totals.futty_cents),
      amount(totals.stripe_fee_cents), '', ''].join(','),
  ];
  return lines.map((line) => `${line}\r\n`).join('');
}
