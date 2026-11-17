// P7: fetchBookingDetail learns whether the venue is taking new players
// from the server (venues.is_live), never by its own check.
import { answerVenuePlayer, fetchBookingDetail, removeVenuePlayer } from '@/lib/booking-detail';
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

// P6e: the booker answers a venue's offer, or removes an accepted venue
// player (spec 13 "Venue-offered players"). Offer ids only; refusals in words.
describe('venue players', () => {
  beforeEach(() => mockRpc.mockReset());

  it('passes venue_players through as the server sent them', async () => {
    const venuePlayers = [{ id: 'o1', name: 'Kostas', state: 'offered', can_answer: true, can_remove: false }];
    mockRpc.mockImplementation(async (fn: string) =>
      fn === 'booking_detail'
        ? { data: { ...detailFixture(), venue_players: venuePlayers }, error: null }
        : { data: terms, error: null });
    mockVenue.mockResolvedValue({ data: { is_live: true }, error: null });
    expect((await fetchBookingDetail('b1')).venue_players).toEqual(venuePlayers);
  });

  it('accepts and declines with the offer id only', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'o1', name: 'Kostas', state: 'accepted' }, error: null });
    expect(await answerVenuePlayer('o1', true)).toBeNull();
    expect(await answerVenuePlayer('o1', false)).toBeNull();
    expect(mockRpc.mock.calls).toEqual([
      ['answer_venue_player', { p_offer_id: 'o1', p_accept: true }],
      ['answer_venue_player', { p_offer_id: 'o1', p_accept: false }],
    ]);
  });

  it('removes with the offer id only', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'o2', name: 'Loizos', state: 'removed' }, error: null });
    expect(await removeVenuePlayer('o2')).toBeNull();
    expect(mockRpc.mock.calls).toEqual([['remove_venue_player', { p_offer_id: 'o2' }]]);
  });

  it('turns a refusal into words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'no_empty_spot' } });
    expect(await answerVenuePlayer('o1', true)).toBe('Every spot is taken now, so there’s no room for a venue player.');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'booking_started' } });
    expect(await removeVenuePlayer('o2')).toBe('This game has already started.');
  });
});
