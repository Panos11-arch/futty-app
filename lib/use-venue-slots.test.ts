import { renderHook, waitFor } from '@testing-library/react-native';

import { useVenueFormats, useVenueSlots } from './use-venue-slots';

// supabase stand-in: each table answers with mockTables[table]; rpc with mockRpc.
const mockTables: Record<string, { data: unknown; error: unknown }> = {};
const mockFilters: { table: string; method: string; args: unknown[] }[] = [];
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'lte', 'gte']) {
      q[method] = (...args: unknown[]) => {
        mockFilters.push({ table, method, args });
        return q;
      };
    }
    q.maybeSingle = () => Promise.resolve(mockTables[table]);
    q.then = (resolve: (r: unknown) => unknown) => resolve(mockTables[table]);
    return q;
  };
  return { supabase: { from: (table: string) => query(table), rpc: (...args: unknown[]) => mockRpc(...args) } };
});

beforeEach(() => {
  mockFilters.length = 0;
  mockRpc.mockReset();
});

describe('useVenueFormats', () => {
  it('reads the venue\'s pitches and combinations, never the legacy columns', async () => {
    mockTables.pitches = { data: [{ formats: ['5-a-side'], is_open: true }, { formats: ['7-a-side'], is_open: false }], error: null };
    mockTables.pitch_combinations = { data: [{ format: '9-a-side' }], error: null };
    const { result } = await renderHook(() => useVenueFormats('v1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', formats: ['5-a-side', '9-a-side'], pitchCount: 1 });
    expect(mockFilters).toEqual(
      expect.arrayContaining([
        { table: 'pitches', method: 'select', args: ['formats, is_open'] },
        { table: 'pitches', method: 'eq', args: ['venue_id', 'v1'] },
      ]),
    );
  });

  it('a venue with no pitches has no formats', async () => {
    mockTables.pitches = { data: [], error: null };
    mockTables.pitch_combinations = { data: [], error: null };
    const { result } = await renderHook(() => useVenueFormats('v1'));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', formats: [], pitchCount: 0 }));
  });
});

describe('useVenueSlots', () => {
  it('asks the server for the free slots and lays them on that weekday\'s opening hours', async () => {
    mockTables.opening_hours = { data: { opens: '18:00:00', closes: '20:00:00' }, error: null };
    mockTables.venue_closures = { data: [], error: null };
    mockRpc.mockResolvedValue({ data: [{ start_time: '19:00:00', end_time: '20:00:00', price_cents: 6000 }], error: null });

    const { result } = await renderHook(() => useVenueSlots('v1', '2026-11-16', '5-a-side', 60));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    expect(mockRpc).toHaveBeenCalledWith('venue_free_slots', {
      p_venue_id: 'v1',
      p_day: '2026-11-16',
      p_format: '5-a-side',
      p_minutes: 60,
    });
    expect(mockFilters).toContainEqual({ table: 'opening_hours', method: 'eq', args: ['weekday', 1] });
    expect(result.current.state).toEqual({
      status: 'ready',
      slots: [
        { start: '18:00', end: '19:00', available: false, priceCents: null },
        { start: '18:30', end: '19:30', available: false, priceCents: null },
        { start: '19:00', end: '20:00', available: true, priceCents: 6000 },
      ],
    });
  });

  it('a day with no opening hours, or a closure, is closed', async () => {
    mockTables.opening_hours = { data: null, error: null };
    mockTables.venue_closures = { data: [], error: null };
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { result } = await renderHook(() => useVenueSlots('v1', '2026-11-16', '5-a-side', 60));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'closed' }));

    mockTables.opening_hours = { data: { opens: '18:00:00', closes: '20:00:00' }, error: null };
    mockTables.venue_closures = { data: [{ id: 'c1' }], error: null };
    const closed = await renderHook(() => useVenueSlots('v1', '2026-11-17', '5-a-side', 60));
    await waitFor(() => expect(closed.result.current.state).toEqual({ status: 'closed' }));
  });

  it('waits until a venue, day and format are chosen', async () => {
    const { result } = await renderHook(() => useVenueSlots('v1', null, '5-a-side', 60));
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
