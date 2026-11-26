import { renderHook, waitFor } from '@testing-library/react-native';

import { useMyProfileRecent, useMyProfileSeason, useMyProfileSummary } from '@/lib/match/use-profile-summary';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const mockSummary = jest.fn();
const mockSeason = jest.fn();
const mockRecent = jest.fn();

jest.mock('@/lib/match/profile-summary-api', () => ({
  getMyProfileSummary: () => mockSummary(),
  getMyProfileSeason: (f: string | null) => mockSeason(f),
  getMyProfileRecent: (n: number) => mockRecent(n),
}));

beforeEach(() => jest.clearAllMocks());

describe('profile hooks', () => {
  it('signed out: stays loading and reads nothing', async () => {
    const { result } = await renderHook(() => useMyProfileSummary(null));
    expect(result.current.status).toBe('loading');
    expect(mockSummary).not.toHaveBeenCalled();
  });

  it('loads the summary', async () => {
    mockSummary.mockResolvedValue({ value: { followers: 2, following: 1, level: 6, provisional: false, levelChangeMonth: null } });
    const { result } = await renderHook(() => useMyProfileSummary('me'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ summary: { followers: 2, following: 1 } });
  });

  it('gives an error', async () => {
    mockSummary.mockResolvedValue({ error: 'offline' });
    const { result } = await renderHook(() => useMyProfileSummary('me'));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'error', message: 'offline' }));
  });

  it('loads the season again when the format changes', async () => {
    mockSeason.mockResolvedValue({ value: { formats: [], games: 1 } });
    const { result, rerender } = await renderHook(({ f }: { f: string | null }) => useMyProfileSeason('me', f), {
      initialProps: { f: null as string | null },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockSeason).toHaveBeenLastCalledWith(null);
    await rerender({ f: '7-a-side' });
    await waitFor(() => expect(mockSeason).toHaveBeenLastCalledWith('7-a-side'));
  });

  it('loads recent games with the limit, and passes errors on', async () => {
    mockRecent.mockResolvedValueOnce({ value: [{ match_id: 'm1' }] });
    const { result } = await renderHook(() => useMyProfileRecent('me', 3));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', games: [{ match_id: 'm1' }] }));
    expect(mockRecent).toHaveBeenCalledWith(3);

    mockRecent.mockResolvedValueOnce({ error: 'x' });
    const second = await renderHook(() => useMyProfileRecent('me'));
    await waitFor(() => expect(second.result.current).toMatchObject({ status: 'error', message: 'x' }));
    expect(mockRecent).toHaveBeenLastCalledWith(3);
  });

  it('season errors pass on', async () => {
    mockSeason.mockResolvedValue({ error: 'nope' });
    const { result } = await renderHook(() => useMyProfileSeason('me', null));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'error', message: 'nope' }));
  });
});
