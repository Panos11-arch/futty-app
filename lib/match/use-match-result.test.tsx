import { renderHook, waitFor } from '@testing-library/react-native';

import { useMatchLinks, useOpenResultMatches } from '@/lib/match/use-match-result';

const mockFindMatchLinks = jest.fn();
const mockListOpen = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
jest.mock('@/lib/match/results-api', () => ({
  ...jest.requireActual('@/lib/match/results-api'),
  findMatchLinks: (...args: unknown[]) => mockFindMatchLinks(...args),
  listMyOpenResultMatches: (...args: unknown[]) => mockListOpen(...args),
}));

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockFindMatchLinks.mockReset();
  mockListOpen.mockReset();
});
afterEach(() => warn.mockRestore());

// Home shows one line per failing read; the PostgREST code and message go
// to the log so the cause can be found.
describe('read errors are logged with their code', () => {
  it('useOpenResultMatches', async () => {
    mockListOpen.mockResolvedValue({ matches: [], error: { code: 'PGRST201', message: 'more than one relationship' } });
    const { result } = await renderHook(() => useOpenResultMatches());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(warn).toHaveBeenCalledWith('Could not load open result matches:', 'PGRST201', 'more than one relationship');
  });

  it('useMatchLinks', async () => {
    mockFindMatchLinks.mockResolvedValue({ links: null, error: { message: 'URI too long' } });
    const { result } = await renderHook(() => useMatchLinks({ bookingIds: ['b1'] }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(warn).toHaveBeenCalledWith('Could not load match links:', '', 'URI too long');
  });

  it('a successful read logs nothing', async () => {
    mockListOpen.mockResolvedValue({ matches: [], error: null });
    const { result } = await renderHook(() => useOpenResultMatches());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(warn).not.toHaveBeenCalled();
  });
});
