import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useFollowSuggestions } from './use-follow-suggestions';

const mockFetch = jest.fn();
const mockDismiss = jest.fn();
jest.mock('@/lib/community', () => ({
  fetchFollowSuggestions: (...a: unknown[]) => mockFetch(...a),
  dismissFollowSuggestion: (...a: unknown[]) => mockDismiss(...a),
}));

const nikos = { id: 'u1', username: 'nikos', full_name: 'Nikos', matches_in_common: 3 };
const petros = { id: 'u2', username: null, full_name: 'Petros', matches_in_common: 1 };

beforeEach(() => {
  jest.resetAllMocks();
});

describe('useFollowSuggestions', () => {
  it('loads with the limit', async () => {
    mockFetch.mockResolvedValue({ data: [nikos, petros], error: null });
    const { result } = await renderHook(() => useFollowSuggestions(8));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockFetch).toHaveBeenCalledWith(8);
    expect(result.current.status === 'ready' && result.current.items).toEqual([nikos, petros]);
  });

  it('error, then reload', async () => {
    mockFetch.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    const { result } = await renderHook(() => useFollowSuggestions());
    await waitFor(() => expect(result.current.status).toBe('error'));
    mockFetch.mockResolvedValueOnce({ data: [], error: null });
    await act(() => result.current.reload());
    expect(result.current.status).toBe('ready');
  });

  it('dismiss hides the card at once', async () => {
    mockFetch.mockResolvedValue({ data: [nikos, petros], error: null });
    mockDismiss.mockResolvedValue({ error: null });
    const { result } = await renderHook(() => useFollowSuggestions());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.dismiss('u1'));
    expect(mockDismiss).toHaveBeenCalledWith('u1');
    expect(result.current.status === 'ready' && result.current.items).toEqual([petros]);
  });

  it('a refused dismiss puts the card back', async () => {
    mockFetch.mockResolvedValue({ data: [nikos, petros], error: null });
    mockDismiss.mockResolvedValue({ error: { message: 'offline' } });
    const { result } = await renderHook(() => useFollowSuggestions());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let res: { error: unknown } = { error: null };
    await act(async () => {
      res = await result.current.dismiss('u1');
    });
    expect(res.error).toEqual({ message: 'offline' });
    expect(result.current.status === 'ready' && result.current.items).toEqual([nikos, petros]);
  });

  it('dismiss before loading does nothing', async () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useFollowSuggestions());
    expect(await result.current.dismiss('u1')).toEqual({ error: null });
    expect(mockDismiss).not.toHaveBeenCalled();
  });
});
