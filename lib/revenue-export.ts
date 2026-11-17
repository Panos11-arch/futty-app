// "Export CSV" on the venue dashboard's Money screen (P6d; spec 13 "Venue
// dashboard", The CSV). One venue_revenue_export call gives the rows, each
// source's total and the total from one snapshot; buildRevenueCsv writes
// them out; the share sheet hands the file to the owner. When the export's
// figures aren't the ones on screen (money moved in between), nothing is
// shared and the screen reloads (decided 17 November): the CSV always has the
// same totals as the screen.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { buildRevenueCsv, type RevenueExport } from '@/lib/money/revenue-csv';
import { describeMoneyError, fetchRevenueExport, sameRevenue, type Period, type RevenueScreen } from '@/lib/venue-money';

export type ExportResult = { status: 'shared' } | { status: 'changed' } | { status: 'error'; message: string };

// Apple's type for a .csv file; Android goes by the MIME type.
const CSV_UTI = 'public.comma-separated-values-text';

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

  let csv: string;
  try {
    csv = buildRevenueCsv(exported);
  } catch {
    return { status: 'error', message: "The export didn't match its totals. Try again." };
  }
  if (!(await Sharing.isAvailableAsync())) {
    return { status: 'error', message: "Sharing isn't available on this phone." };
  }

  try {
    const file = new File(Paths.cache, `futty-revenue-${exported.from}-${exported.to}.csv`);
    file.create({ overwrite: true });
    file.write(csv);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: CSV_UTI, dialogTitle: 'Revenue CSV' });
  } catch {
    return { status: 'error', message: "The file couldn't be shared. Try again." };
  }
  return { status: 'shared' };
}
