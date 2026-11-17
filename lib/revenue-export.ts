// "Export CSV" and "Export payouts CSV" on the venue dashboard's Money screen
// (P6d; spec 13 "Venue dashboard", The CSV). One venue_revenue_export call
// gives the rows, each source's total and the total from one snapshot;
// buildRevenueCsv writes them out; the share sheet hands the file to the
// owner. When the export's figures aren't the ones on screen (money moved in
// between), nothing is shared and the screen reloads (decided 17 November):
// the CSV always has the same totals as the screen. The payouts CSV is the
// same, from one venue_payouts_export call and buildPayoutsCsv; the screen
// shows no payout figures, so there is nothing to compare it with.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { buildPayoutsCsv, type PayoutsExport } from '@/lib/money/payouts-csv';
import { buildRevenueCsv, type RevenueExport } from '@/lib/money/revenue-csv';
import {
  describeMoneyError,
  fetchPayoutsExport,
  fetchRevenueExport,
  sameRevenue,
  type Period,
  type RevenueScreen,
} from '@/lib/venue-money';

export type ExportResult = { status: 'shared' } | { status: 'changed' } | { status: 'error'; message: string };

// Apple's type for a .csv file; Android goes by the MIME type.
const CSV_UTI = 'public.comma-separated-values-text';

// Builds the file (refused when its totals aren't its rows), writes it to
// the cache and opens the share sheet.
async function shareCsv(build: () => string, fileName: string, dialogTitle: string): Promise<ExportResult> {
  let csv: string;
  try {
    csv = build();
  } catch {
    return { status: 'error', message: "The export didn't match its totals. Try again." };
  }
  if (!(await Sharing.isAvailableAsync())) {
    return { status: 'error', message: "Sharing isn't available on this phone." };
  }

  try {
    const file = new File(Paths.cache, fileName);
    file.create({ overwrite: true });
    file.write(csv);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: CSV_UTI, dialogTitle });
  } catch {
    return { status: 'error', message: "The file couldn't be shared. Try again." };
  }
  return { status: 'shared' };
}

export async function exportRevenueCsv(
  venueId: string,
  period: Period,
  day: string,
  onScreen: Pick<RevenueScreen, 'from' | 'to' | 'sources' | 'totals'>,
): Promise<ExportResult> {
  const { data, error } = await fetchRevenueExport(venueId, period, day);
  if (error || !data) return { status: 'error', message: describeMoneyError(error?.message ?? '') };
  const exported = data as RevenueExport;
  if (!sameRevenue(onScreen, exported)) return { status: 'changed' };
  return shareCsv(() => buildRevenueCsv(exported), `futty-revenue-${exported.from}-${exported.to}.csv`, 'Revenue CSV');
}

/** The payouts sent in the period (Cyprus dates), one line per payout and
 *  booking, each payout's total and the total sent and reversed. */
export async function exportPayoutsCsv(venueId: string, period: Period, day: string): Promise<ExportResult> {
  const { data, error } = await fetchPayoutsExport(venueId, period, day);
  if (error || !data) return { status: 'error', message: describeMoneyError(error?.message ?? '') };
  const exported = data as PayoutsExport;
  return shareCsv(() => buildPayoutsCsv(exported), `futty-payouts-${exported.from}-${exported.to}.csv`, 'Payouts CSV');
}
