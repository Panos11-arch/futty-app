import { bookSlot, cancelBooking, chooseCancellationRefund, getCancellationQuote } from './booking-actions';

// jest.mock is hoisted above the import; the factory reads the mocks lazily.
const mockRpc = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockInvoke.mockReset();
});

describe('bookSlot', () => {
  it('sends the venue, slot, format and mode; the server picks the pitches (no count from the app)', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'b1' }, error: null });
    await bookSlot({ venueId: 'v1', day: '2026-11-16', start: '18:00', end: '19:00', format: '7-a-side', mode: 'pay_all' });
    expect(mockRpc).toHaveBeenCalledWith('book_slot', {
      p_venue_id: 'v1',
      p_day: '2026-11-16',
      p_start: '18:00',
      p_end: '19:00',
      p_pitches: 1,
      p_format: '7-a-side',
      p_players_per_side: 5,
      p_mode: 'pay_all',
    });
  });

  it.each(['pay_all', 'each_pays_responsible', 'each_pays_own_spot'] as const)(
    'the chosen mode %s reaches book_slot',
    async (mode) => {
      mockRpc.mockResolvedValue({ data: { id: 'b1' }, error: null });
      await bookSlot({ venueId: 'v1', day: '2026-11-16', start: '18:00', end: '19:00', format: '5-a-side', playersPerSide: 6, mode });
      expect(mockRpc).toHaveBeenCalledWith('book_slot', expect.objectContaining({ p_mode: mode, p_players_per_side: 6 }));
    },
  );
});

describe('getCancellationQuote', () => {
  it('asks the server what cancelling would do, for this booking and scope', async () => {
    mockRpc.mockResolvedValue({ data: { quote: 'q1' }, error: null });
    await getCancellationQuote('b1', 'my_spot');
    expect(mockRpc).toHaveBeenCalledWith('cancellation_quote', { p_booking_id: 'b1', p_scope: 'my_spot' });
  });
});

describe('cancelBooking', () => {
  it('sends the scope and the quote the player confirmed, never an amount', async () => {
    mockInvoke.mockResolvedValue({ data: { cancelled: true }, error: null });
    await cancelBooking('b1', { scope: 'whole_team', quote: 'q1' });
    expect(mockInvoke).toHaveBeenCalledWith('cancel-booking', { body: { bookingId: 'b1', scope: 'whole_team', quote: 'q1' } });
  });

  it('a booking made before P4a is cancelled with its id alone', async () => {
    mockInvoke.mockResolvedValue({ data: { cancelled: true }, error: null });
    await cancelBooking('b1');
    expect(mockInvoke).toHaveBeenCalledWith('cancel-booking', { body: { bookingId: 'b1' } });
  });
});

describe('chooseCancellationRefund', () => {
  it('sends only the line and the choice', async () => {
    mockInvoke.mockResolvedValue({ data: { choice: 'credit', creditCents: 680 }, error: null });
    await chooseCancellationRefund('l1', 'credit');
    expect(mockInvoke).toHaveBeenCalledWith('choose-cancellation-refund', { body: { lineId: 'l1', choice: 'credit' } });
  });
});

describe('bookSlot: Gipedo Pano (P8)', () => {
  it('sends the mode and the team the captain books for; never an amount', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'b1' }, error: null });
    await bookSlot({ venueId: 'v1', day: '2026-11-16', start: '18:00', end: '19:00', format: '5-a-side', mode: 'gipedo_pano', teamId: 't1' });
    expect(mockRpc).toHaveBeenCalledWith('book_slot', {
      p_venue_id: 'v1',
      p_day: '2026-11-16',
      p_start: '18:00',
      p_end: '19:00',
      p_pitches: 1,
      p_format: '5-a-side',
      p_players_per_side: 5,
      p_mode: 'gipedo_pano',
      p_team_id: 't1',
    });
  });

  it('the other modes send no team', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'b1' }, error: null });
    await bookSlot({ venueId: 'v1', day: '2026-11-16', start: '18:00', end: '19:00', format: '5-a-side', mode: 'pay_all', teamId: 't1' });
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_team_id');
  });
});
