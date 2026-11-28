import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useCompetitionPins } from '@/lib/match/use-competition-pins';

const mockList = jest.fn();
const mockPin = jest.fn();
const mockUnpin = jest.fn();
const mockTap = jest.fn();
const mockPinT = jest.fn();
const mockUnpinT = jest.fn();

jest.mock('@/lib/match/pins', () => ({
  listPins: () => mockList(),
  pinCompetition: (...a: unknown[]) => mockPin(...a),
  unpinCompetition: (...a: unknown[]) => mockUnpin(...a),
  pinTournament: (...a: unknown[]) => mockPinT(...a),
  unpinTournament: (...a: unknown[]) => mockUnpinT(...a),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: () => mockTap() } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ pins: [{ target_type: 'league', scope: 'limassol', format: '5-a-side' }], error: null });
  mockPin.mockResolvedValue({ error: null });
  mockUnpin.mockResolvedValue({ error: null });
  mockPinT.mockResolvedValue({ error: null });
  mockUnpinT.mockResolvedValue({ error: null });
});

describe('useCompetitionPins', () => {
  it('loads my pins', async () => {
    const { result } = await renderHook(() => useCompetitionPins());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.pins).toHaveLength(1);
    expect(result.current.isPinned('Limassol ', '5-a-side')).toBe(true);
    expect(result.current.isPinned('limassol', '7-a-side')).toBe(false);
  });

  it('a failed load is an error that reload retries', async () => {
    mockList.mockResolvedValueOnce({ pins: [], error: 'offline' });
    const { result } = await renderHook(() => useCompetitionPins());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.message).toBe('offline');
    await act(() => result.current.reload());
    expect(result.current.status).toBe('ready');
  });

  it('pins at once, with a light haptic, then saves', async () => {
    const { result } = await renderHook(() => useCompetitionPins());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.toggle('Nicosia', '9-a-side'));
    expect(mockPin).toHaveBeenCalledWith('nicosia', '9-a-side');
    expect(mockTap).toHaveBeenCalledTimes(1);
    expect(result.current.isPinned('nicosia', '9-a-side')).toBe(true);
    expect(result.current.toggleError).toBeNull();
  });

  it('unpins a pinned one', async () => {
    const { result } = await renderHook(() => useCompetitionPins());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.toggle('limassol', '5-a-side'));
    expect(mockUnpin).toHaveBeenCalledWith('limassol', '5-a-side');
    expect(result.current.isPinned('limassol', '5-a-side')).toBe(false);
  });

  it('puts it back and says so when the server refuses', async () => {
    mockUnpin.mockResolvedValueOnce({ error: 'offline' });
    const { result } = await renderHook(() => useCompetitionPins());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.toggle('limassol', '5-a-side'));
    expect(result.current.isPinned('limassol', '5-a-side')).toBe(true);
    expect(result.current.toggleError).toBe('Could not save your pin. Try again.');
  });

  it('a tournament pin never reads as a league pin', async () => {
    mockList.mockResolvedValueOnce({ pins: [{ target_type: 'tournament', tournament_id: 't1' }], error: null });
    const { result } = await renderHook(() => useCompetitionPins());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.isTournamentPinned('t1')).toBe(true);
    expect(result.current.isTournamentPinned('t2')).toBe(false);
    expect(result.current.isPinned('limassol', '5-a-side')).toBe(false);
  });

  it('pins and unpins a tournament at once, with a haptic', async () => {
    const { result } = await renderHook(() => useCompetitionPins());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.toggleTournament('t1'));
    expect(mockPinT).toHaveBeenCalledWith('t1');
    expect(mockTap).toHaveBeenCalledTimes(1);
    expect(result.current.isTournamentPinned('t1')).toBe(true);
    expect(result.current.isPinned('limassol', '5-a-side')).toBe(true);
    await act(() => result.current.toggleTournament('t1'));
    expect(mockUnpinT).toHaveBeenCalledWith('t1');
    expect(result.current.isTournamentPinned('t1')).toBe(false);
  });

  it('a refused tournament pin is put back and says so', async () => {
    mockPinT.mockResolvedValueOnce({ error: 'offline' });
    const { result } = await renderHook(() => useCompetitionPins());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.toggleTournament('t1'));
    expect(result.current.isTournamentPinned('t1')).toBe(false);
    expect(result.current.toggleError).toBe('Could not save your pin. Try again.');
  });
});
