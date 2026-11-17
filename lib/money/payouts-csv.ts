// The venue dashboard's payouts CSV (spec 13 "Venue dashboard", The CSV, the
// payouts CSV), next to the revenue CSV, so a venue's owner can match
// Futty's transfers against their Stripe Express dashboard. Everything comes
// from one call, venue_payouts_export
// (supabase/migrations/*_pay_payouts_export.sql): the rows (one per payout
// and booking), each payout's total and the period's total sent and total
// reversed, read from venue_payouts and venue_payout_items in one snapshot.
// This only writes them out; it refuses rows whose columns aren't the
// server's (payouts-row-columns.json, which the SQL tests check against the
// server) and totals that aren't those rows.

import columns from './payouts-row-columns.json';
import { formatEurosPlain } from './format';

export type PayoutExportStatus = 'sent' | 'reversed';

/** One row of venue_payouts_export: what one payout sent for one booking.
 *  Dates are Cyprus dates (YYYY-MM-DD), times Cyprus HH:MM; amounts are
 *  integer cents. */
export type PayoutExportRow = {
  payout_id: string;
  sent_on: string;
  sent_at: string;
  stripe_transfer_id: string;
  status: PayoutExportStatus;
  booking_id: string;
  booking_day: string;
  start_time: string;
  venue_cents: number;
};

/** One payout's total, as venue_payouts has it. */
export type PayoutExportTotal = {
  payout_id: string;
  status: PayoutExportStatus;
  amount_cents: number;
  rows: number;
};

export type PayoutExportTotals = { sent_cents: number; reversed_cents: number; rows: number };

/** venue_payouts_export's response. */
export type PayoutsExport = {
  period: 'day' | 'week' | 'month';
  from: string;
  to: string;
  rows: PayoutExportRow[];
  payouts: PayoutExportTotal[];
  totals: PayoutExportTotals;
};

const STATUS_LABELS: Record<PayoutExportStatus, string> = { sent: 'Sent', reversed: 'Reversed' };

const HEADER = [
  'Sent date',
  'Sent time',
  'Payout',
  'Stripe transfer',
  'Status',
  'Booking',
  'Booking day',
  'Kickoff',
  'This payout (EUR)',
];

// Excel opens a UTF-8 file without it as ANSI.
const BOM = '﻿';

const COLUMNS = [...columns].sort().join(',');

// A text cell: a spreadsheet must never run it as a formula, and commas,
// quotes and line breaks are quoted (RFC 4180).
function text(value: string): string {
  const cell = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function sum(values: number[]): number {
  return values.reduce((t, v) => t + v, 0);
}

function disagree(): never {
  throw new Error('payouts rows and totals disagree');
}

function line(cells: string[]): string {
  return cells.join(',');
}

/** The CSV for one period, from one venue_payouts_export response: a UTF-8
 *  BOM, a header, one line per row in the server's order, each payout's
 *  total, the total sent and the total reversed. Lines end in CRLF. */
export function buildPayoutsCsv(data: PayoutsExport): string {
  const { rows, payouts, totals } = data;
  for (const r of rows) {
    if (Object.keys(r).sort().join(',') !== COLUMNS) throw new Error('payout row columns changed');
    if (!(r.status in STATUS_LABELS)) throw new Error('payout row without a status');
  }

  // Every row belongs to a listed payout of the same status; each payout's
  // total is its rows; the period's totals are the payouts, and the rows.
  const byId = new Map(payouts.map((p) => [p.payout_id, p]));
  if (byId.size !== payouts.length) disagree();
  if (rows.some((r) => byId.get(r.payout_id)?.status !== r.status)) disagree();
  for (const p of payouts) {
    const own = rows.filter((r) => r.payout_id === p.payout_id);
    if (own.length === 0 || own.length !== p.rows || sum(own.map((r) => r.venue_cents)) !== p.amount_cents) disagree();
  }
  const byStatus = (status: PayoutExportStatus) =>
    sum(payouts.filter((p) => p.status === status).map((p) => p.amount_cents));
  // (With every row in its payout, the rows then add up to sent + reversed.)
  if (
    totals.rows !== rows.length ||
    totals.sent_cents !== byStatus('sent') ||
    totals.reversed_cents !== byStatus('reversed')
  ) {
    disagree();
  }

  const lines = [
    line(HEADER),
    ...rows.map((r) =>
      line([
        r.sent_on,
        r.sent_at,
        r.payout_id,
        text(r.stripe_transfer_id),
        STATUS_LABELS[r.status],
        r.booking_id,
        r.booking_day,
        r.start_time.slice(0, 5),
        formatEurosPlain(r.venue_cents),
      ]),
    ),
    ...payouts.map((p) => {
      const first = rows.find((r) => r.payout_id === p.payout_id) as PayoutExportRow;
      return line(['Payout total', '', p.payout_id, text(first.stripe_transfer_id), STATUS_LABELS[p.status],
        '', '', '', formatEurosPlain(p.amount_cents)]);
    }),
    line(['Total sent', '', '', '', '', '', '', '', formatEurosPlain(totals.sent_cents)]),
    line(['Total reversed', '', '', '', '', '', '', '', formatEurosPlain(totals.reversed_cents)]),
  ];
  return BOM + lines.map((l) => `${l}\r\n`).join('');
}
