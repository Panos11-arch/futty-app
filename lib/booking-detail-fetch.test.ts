// P7: fetchBookingDetail learns whether the venue is taking new players
// from the server (venues.is_live), never by its own check.
import { fetchBookingDetail } from '@/lib/booking-detail';
import { detailFixture } from '@/lib/booking-search.fixtures';

const mockRpc = jest.fn();
const mockVenue = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({ maybeSingle: () => mockVenue(table, columns, column, value) }),
      }),
    }),
  },
}));
jest.mock('@/lib/calendar', () => ({}));

const terms = { fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 };

beforeEach(() => {
  mockRpc.mockImplementation(async (fn: string) =>
    fn === 'booking_detail' ? { data: detailFixture(), error: null } : { data: terms, error: null });
});

it.each([
  [{ is_live: false }, false],
  [{ is_live: true }, true],
  [null, null],
])('venues.is_live %j -> venueTakingPlayers %s', async (row, expected) => {
  mockVenue.mockResolvedValue({ data: row, error: null });
  const detail = await fetchBookingDetail('b1');
  expect(detail.venueTakingPlayers).toBe(expected);
  expect(mockVenue).toHaveBeenCalledWith('venues', 'is_live', 'id', detailFixture().venue.id);
  expect(detail.cancellation).toEqual(terms);
});
