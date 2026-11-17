import columns from './payouts-row-columns.json';
import {
  buildPayoutsCsv,
  type PayoutExportRow,
  type PayoutExportStatus,
  type PayoutExportTotal,
  type PayoutsExport,
} from './payouts-csv';

// November from supabase/tests/pay-dashboard-13-payouts-export.test.sql, as
// venue_payouts_export returns it: P1 sent at 23:30 UTC on 31 October (01:30
// on 1 November in Cyprus) for two bookings, and P2 sent on 10 November and
// reversed. The pending payout isn't in it. The SQL test checks the server's
// rows have exactly the columns in payouts-row-columns.json; buildPayoutsCsv
// refuses rows that don't.
function row(over: Partial<PayoutExportRow>): PayoutExportRow {
  return {
    payout_id: 'p1',
    sent_on: '2026-11-01',
    sent_at: '01:30',
    stripe_transfer_id: 'tr_1',
    status: 'sent',
    booking_id: 'b-a',
    booking_day: '2026-11-20',
    start_time: '12:00:00',
    venue_cents: 0,
    ...over,
  };
}

const NOVEMBER: PayoutExportRow[] = [
  row({ venue_cents: 1200 }),
  row({ booking_id: 'b-b', start_time: '18:00:00', venue_cents: 600 }),
  row({
    payout_id: 'p2', sent_on: '2026-11-10', sent_at: '12:00', stripe_transfer_id: 'tr_2', status: 'reversed',
    venue_cents: 600,
  }),
];

// What the server sends with those rows: each payout's total and the totals.
function exportOf(rows: PayoutExportRow[]): PayoutsExport {
  const ids = [...new Set(rows.map((r) => r.payout_id))];
  const payouts: PayoutExportTotal[] = ids.map((id) => {
    const own = rows.filter((r) => r.payout_id === id);
    return { payout_id: id, status: own[0].status, amount_cents: own.reduce((t, r) => t + r.venue_cents, 0), rows: own.length };
  });
  const of = (status: PayoutExportStatus) =>
    payouts.filter((p) => p.status === status).reduce((t, p) => t + p.amount_cents, 0);
  return {
    period: 'month',
    from: '2026-11-01',
    to: '2026-11-30',
    rows,
    payouts,
    totals: { sent_cents: of('sent'), reversed_cents: of('reversed'), rows: rows.length },
  };
}

const NOVEMBER_EXPORT = exportOf(NOVEMBER);

const BOM = '﻿';
const HEADER = 'Sent date,Sent time,Payout,Stripe transfer,Status,Booking,Booking day,Kickoff,This payout (EUR)';

function lines(csv: string) {
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(BOM.length, -2).split('\r\n');
}

describe('buildPayoutsCsv', () => {
  it('the server totals are those rows (the fixture is consistent)', () => {
    expect(NOVEMBER_EXPORT.totals).toEqual({ sent_cents: 1800, reversed_cents: 600, rows: 3 });
    expect(NOVEMBER_EXPORT.payouts).toEqual([
      { payout_id: 'p1', status: 'sent', amount_cents: 1800, rows: 2 },
      { payout_id: 'p2', status: 'reversed', amount_cents: 600, rows: 1 },
    ]);
  });

  it('writes the rows, each payout total, the total sent and the total reversed', () => {
    expect(lines(buildPayoutsCsv(NOVEMBER_EXPORT))).toEqual([
      HEADER,
      '2026-11-01,01:30,p1,tr_1,Sent,b-a,2026-11-20,12:00,12.00',
      '2026-11-01,01:30,p1,tr_1,Sent,b-b,2026-11-20,18:00,6.00',
      '2026-11-10,12:00,p2,tr_2,Reversed,b-a,2026-11-20,12:00,6.00',
      'Payout total,,p1,tr_1,Sent,,,,18.00',
      'Payout total,,p2,tr_2,Reversed,,,,6.00',
      'Total sent,,,,,,,,18.00',
      'Total reversed,,,,,,,,6.00',
    ]);
  });

  it('starts with a UTF-8 BOM and ends each line in CRLF', () => {
    const csv = buildPayoutsCsv(NOVEMBER_EXPORT);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')).toHaveLength(9);
  });

  it('keeps the Cyprus dates and times as the server gave them', () => {
    const out = lines(buildPayoutsCsv(NOVEMBER_EXPORT));
    expect(out[1].startsWith('2026-11-01,01:30,')).toBe(true);
  });

  it('writes a negative amount for a booking a payout took money back on', () => {
    const csv = buildPayoutsCsv(exportOf([row({ venue_cents: 1000 }), row({ booking_id: 'b-old', venue_cents: -35 })]));
    expect(lines(csv)[2]).toBe('2026-11-01,01:30,p1,tr_1,Sent,b-old,2026-11-20,12:00,-0.35');
    expect(lines(csv)[3]).toBe('Payout total,,p1,tr_1,Sent,,,,9.65');
  });

  it('an empty period is the header and zero totals', () => {
    expect(lines(buildPayoutsCsv(exportOf([])))).toEqual([HEADER, 'Total sent,,,,,,,,0.00', 'Total reversed,,,,,,,,0.00']);
  });

  it('never lets a spreadsheet run a cell as a formula, and quotes commas', () => {
    const csv = buildPayoutsCsv(exportOf([row({ stripe_transfer_id: '=HYPERLINK("x")', venue_cents: 100 })]));
    expect(lines(csv)[1]).toBe(`2026-11-01,01:30,p1,"'=HYPERLINK(""x"")",Sent,b-a,2026-11-20,12:00,1.00`);
    expect(lines(buildPayoutsCsv(exportOf([row({ stripe_transfer_id: 'tr_a,b', venue_cents: 100 })])))[1]).toContain(
      ',"tr_a,b",',
    );
  });

  describe('refuses totals that are not its rows', () => {
    const refused = (data: PayoutsExport) => expect(() => buildPayoutsCsv(data)).toThrow('payouts rows and totals disagree');
    const payouts = NOVEMBER_EXPORT.payouts;

    it("a payout's total that isn't its rows", () => {
      refused({ ...NOVEMBER_EXPORT, payouts: [{ ...payouts[0], amount_cents: 1801 }, payouts[1]] });
    });

    it("a payout's row count that isn't its rows", () => {
      refused({ ...NOVEMBER_EXPORT, payouts: [{ ...payouts[0], rows: 3 }, payouts[1]] });
    });

    it('a payout with no rows', () => {
      refused({
        ...NOVEMBER_EXPORT,
        payouts: [...payouts, { payout_id: 'p9', status: 'sent', amount_cents: 0, rows: 0 }],
      });
    });

    it('a row of a payout that is not listed, or listed with another status', () => {
      refused({ ...NOVEMBER_EXPORT, payouts: [payouts[0]] });
      refused({ ...NOVEMBER_EXPORT, payouts: [payouts[0], { ...payouts[1], status: 'sent' }] });
    });

    it('a payout listed twice', () => {
      refused({ ...NOVEMBER_EXPORT, payouts: [...payouts, payouts[1]] });
    });

    it('a total sent or total reversed that is not the payouts', () => {
      refused({ ...NOVEMBER_EXPORT, totals: { ...NOVEMBER_EXPORT.totals, sent_cents: 1700 } });
      refused({ ...NOVEMBER_EXPORT, totals: { ...NOVEMBER_EXPORT.totals, reversed_cents: 0 } });
      refused({ ...NOVEMBER_EXPORT, totals: { ...NOVEMBER_EXPORT.totals, rows: 2 } });
    });
  });

  it('refuses rows whose columns are not the server', () => {
    const { venue_cents: _, ...missing } = row({});
    expect(() => buildPayoutsCsv(exportOf([missing as PayoutExportRow]))).toThrow('payout row columns changed');
    expect(() => buildPayoutsCsv(exportOf([{ ...row({}), email: 'x@y.z' } as PayoutExportRow]))).toThrow(
      'payout row columns changed',
    );
    expect([...columns].sort()).toEqual(Object.keys(row({})).sort());
  });

  it('refuses a row without a sent or reversed status (a pending payout is never in the file)', () => {
    expect(() => buildPayoutsCsv(exportOf([row({ status: 'pending' as PayoutExportStatus })]))).toThrow(
      'payout row without a status',
    );
  });
});
