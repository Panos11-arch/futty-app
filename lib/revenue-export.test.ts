// "Export CSV" on the Money screen (P6d; spec 13 "Venue dashboard", The
// CSV): one venue_revenue_export call, the file built from that response by
// buildRevenueCsv, and the share sheet. When the export's figures aren't the
// screen's (money moved in between), nothing is shared (decided 17 November).
import { buildRevenueCsv } from '@/lib/money/revenue-csv';
import { formatEurosPlain } from '@/lib/money/format';
import { exportRevenueCsv } from '@/lib/revenue-export';
import { revenueExport, revenueScreenMatchingExport } from '@/lib/venue-money.fixtures';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

const mockWrites: { uri: string; content: string }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
    }
    create() {}
    write(content: string) {
      mockWrites.push({ uri: this.uri, content });
    }
  },
}));

const mockShare = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockAvailable = jest.fn(() => Promise.resolve(true));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockShare.mockClear();
  mockAvailable.mockReset();
  mockAvailable.mockResolvedValue(true);
  mockWrites.length = 0;
});

const screenData = revenueScreenMatchingExport();

describe('exportRevenueCsv', () => {
  it('calls venue_revenue_export once and shares the file buildRevenueCsv makes', async () => {
    mockRpc.mockResolvedValue({ data: revenueExport(), error: null });
    const result = await exportRevenueCsv('v1', 'day', '2026-11-17', screenData);

    expect(result).toEqual({ status: 'shared' });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('venue_revenue_export', { p_venue_id: 'v1', p_period: 'day', p_day: '2026-11-17' });
    expect(mockWrites).toEqual([
      { uri: 'file:///cache/futty-revenue-2026-11-17-2026-11-17.csv', content: buildRevenueCsv(revenueExport()) },
    ]);
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith('file:///cache/futty-revenue-2026-11-17-2026-11-17.csv', {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: 'Revenue CSV',
    });
  });

  it("the file's totals are the screen's", async () => {
    mockRpc.mockResolvedValue({ data: revenueExport(), error: null });
    await exportRevenueCsv('v1', 'day', '2026-11-17', screenData);
    const lines = mockWrites[0].content.split('\r\n');
    const total = lines.find((l) => l.startsWith('Total,'))!.split(',');
    expect(total[9]).toBe(formatEurosPlain(screenData.totals.venue_cents));
    expect(total[10]).toBe(formatEurosPlain(screenData.totals.futty_cents));
    expect(total[11]).toBe(formatEurosPlain(screenData.totals.stripe_fee_cents));
    const walkIn = lines.find((l) => l.startsWith('Total Walk-in,'))!.split(',');
    expect(walkIn[9]).toBe(formatEurosPlain(screenData.sources[2].venue_cents));
  });

  it("money moved since the screen loaded: nothing is shared", async () => {
    mockRpc.mockResolvedValue({
      data: revenueExport({ totals: { venue_cents: 5600, futty_cents: 45, stripe_fee_cents: 36, rows: 2 } }),
      error: null,
    });
    const result = await exportRevenueCsv('v1', 'day', '2026-11-17', screenData);
    expect(result).toEqual({ status: 'changed' });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockWrites).toEqual([]);
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("the server's refusal, in words", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not_venue_staff' } });
    const result = await exportRevenueCsv('v1', 'day', '2026-11-17', screenData);
    expect(result).toEqual({ status: 'error', message: "You're not staff at this venue." });
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("rows that don't add up to the totals: no file", async () => {
    // The screen and the export agree on the totals, but the rows don't make them.
    const data = revenueExport();
    const bad = { ...data, rows: data.rows.slice(0, 1) };
    mockRpc.mockResolvedValue({ data: bad, error: null });
    const result = await exportRevenueCsv('v1', 'day', '2026-11-17', screenData);
    expect(result).toEqual({ status: 'error', message: "The export didn't match its totals. Try again." });
    expect(mockWrites).toEqual([]);
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('a phone that cannot share', async () => {
    mockRpc.mockResolvedValue({ data: revenueExport(), error: null });
    mockAvailable.mockResolvedValue(false);
    const result = await exportRevenueCsv('v1', 'day', '2026-11-17', screenData);
    expect(result).toEqual({ status: 'error', message: "Sharing isn't available on this phone." });
    expect(mockShare).not.toHaveBeenCalled();
  });
});
