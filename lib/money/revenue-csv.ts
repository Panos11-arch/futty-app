// The venue dashboard's revenue CSV (docs/specs/14 P6, added 11 November:
// "a CSV export of the same rows (amounts in euros with two decimals, Cyprus
// dates)"). Everything comes from one call, venue_revenue_export
// (supabase/migrations/*_pay_dashboard_revenue.sql): the rows, the per-source
// totals and the totals, read from money_ledger in one snapshot. This only
// writes them out; it refuses rows whose columns aren't the server's
// (revenue-row-columns.json, which the SQL tests check against the server)
// and totals that aren't those rows, so the file always matches the screen.

import columns from './revenue-row-columns.json';
import { formatEurosPlain } from './format';

export type RevenueSource = 'app_card' | 'app_cash' | 'walk_in' | 'phone';

/** One row of venue_revenue_export. Dates are Cyprus dates (YYYY-MM-DD),
 *  times Cyprus HH:MM; amounts are integer cents. */
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
  /** The player, or the walk-in's contact; null for venue-level money. */
  who: string | null;
  venue_cents: number;
  futty_cents: number;
  stripe_fee_cents: number;
  venue_price_cents: number | null;
  charged_cents: number | null;
};

export type RevenueTotals = {
  venue_cents: number;
  futty_cents: number;
  stripe_fee_cents: number;
  rows: number;
};

export type RevenueSourceTotals = RevenueTotals & { source: RevenueSource };

/** venue_revenue_export's response. */
export type RevenueExport = {
  period: 'day' | 'week' | 'month';
  from: string;
  to: string;
  rows: RevenueRow[];
  sources: RevenueSourceTotals[];
  totals: RevenueTotals;
};

const SOURCES: RevenueSource[] = ['app_card', 'app_cash', 'walk_in', 'phone'];

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
  'Futty (EUR)',
  'Stripe fee (EUR)',
  'Venue price (EUR)',
  'Charged (EUR)',
];

// Excel opens a UTF-8 file without it as ANSI, garbling Greek names.
const BOM = '﻿';

const COLUMNS = [...columns].sort().join(',');

// A text cell: a spreadsheet must never run it as a formula (a name like
// "=HYPERLINK(...)" typed at the counter or set on a profile), and commas,
// quotes and line breaks are quoted (RFC 4180).
function text(value: string | null): string {
  let cell = value ?? '';
  if (/^[=+\-@\t\r\n]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function amount(cents: number | null): string {
  return cents === null ? '' : formatEurosPlain(cents);
}

function totalOf(rows: RevenueRow[]): RevenueTotals {
  return {
    venue_cents: rows.reduce((t, r) => t + r.venue_cents, 0),
    futty_cents: rows.reduce((t, r) => t + r.futty_cents, 0),
    stripe_fee_cents: rows.reduce((t, r) => t + r.stripe_fee_cents, 0),
    rows: rows.length,
  };
}

function same(a: RevenueTotals, b: RevenueTotals) {
  return (
    a.venue_cents === b.venue_cents &&
    a.futty_cents === b.futty_cents &&
    a.stripe_fee_cents === b.stripe_fee_cents &&
    a.rows === b.rows
  );
}

function totalLine(label: string, t: RevenueTotals) {
  return [label, '', '', '', '', '', '', '', '', amount(t.venue_cents), amount(t.futty_cents),
    amount(t.stripe_fee_cents), '', ''].join(',');
}

/** The CSV for one period, from one venue_revenue_export response: a UTF-8
 *  BOM, a header, one line per row in the server's order, each source's
 *  total and the total. Lines end in CRLF. */
export function buildRevenueCsv(data: RevenueExport): string {
  const { rows, sources, totals } = data;
  for (const r of rows) {
    if (Object.keys(r).sort().join(',') !== COLUMNS) throw new Error('revenue row columns changed');
    if (!SOURCES.includes(r.source)) throw new Error('revenue row without a source');
  }
  const bySource = SOURCES.map((source) => sources.find((s) => s.source === source));
  if (
    sources.length !== SOURCES.length ||
    !same(totalOf(rows), totals) ||
    bySource.some((s, i) => !s || !same(totalOf(rows.filter((r) => r.source === SOURCES[i])), s))
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
    ...SOURCES.map((source, i) => totalLine(`Total ${SOURCE_LABELS[source]}`, bySource[i] as RevenueTotals)),
    totalLine('Total', totals),
  ];
  return BOM + lines.map((line) => `${line}\r\n`).join('');
}
