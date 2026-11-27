// S10 screens: the competition hooks pass the right ids to their reads and
// turn the answers into loading, error or ready. Player stats turn the
// server's Premium refusal into `premium`, not an error.
import { renderHook, waitFor } from '@testing-library/react-native';

import {
  useCaptainContacts,
  useCompetition,
  useCompetitionAwards,
  useCompetitionMatches,
  useCompetitionPlayerStats,
  useCompetitionPowerRanking,
  useCompetitionStandings,
  useCompetitionStats,
} from '@/lib/match/use-competition';

const mockApi = {
  getCompetition: jest.fn(),
  getCompetitionStandings: jest.fn(),
  getCompetitionMatches: jest.fn(),
  getCompetitionPlayerStats: jest.fn(),
  getCompetitionStats: jest.fn(),
  getCompetitionAwards: jest.fn(),
  getCompetitionPowerRanking: jest.fn(),
};
jest.mock('@/lib/match/competition-api', () => ({
  ...jest.requireActual('@/lib/match/competition-api'),
  getCompetition: (...a: unknown[]) => mockApi.getCompetition(...a),
  getCompetitionStandings: (...a: unknown[]) => mockApi.getCompetitionStandings(...a),
  getCompetitionMatches: (...a: unknown[]) => mockApi.getCompetitionMatches(...a),
  getCompetitionPlayerStats: (...a: unknown[]) => mockApi.getCompetitionPlayerStats(...a),
  getCompetitionStats: (...a: unknown[]) => mockApi.getCompetitionStats(...a),
  getCompetitionAwards: (...a: unknown[]) => mockApi.getCompetitionAwards(...a),
  getCompetitionPowerRanking: (...a: unknown[]) => mockApi.getCompetitionPowerRanking(...a),
}));
const mockContacts = jest.fn();
jest.mock('@/lib/messages', () => ({ fetchLeagueCaptainContacts: (...a: unknown[]) => mockContacts(...a) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

beforeEach(() => jest.clearAllMocks());

describe('competition hooks', () => {
  it('useCompetition: ready with the competition; no id, no read', async () => {
    mockApi.getCompetition.mockResolvedValue({ competition: { id: 'L1' }, error: null });
    const { result } = await renderHook(() => useCompetition('L1', 'S2'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockApi.getCompetition).toHaveBeenCalledWith('L1', 'S2');
    expect((result.current as { competition: unknown }).competition).toEqual({ id: 'L1' });
    await renderHook(() => useCompetition(undefined, null));
    expect(mockApi.getCompetition).toHaveBeenCalledTimes(1);
  });

  it('an error carries the server’s code', async () => {
    mockApi.getCompetition.mockResolvedValue({ competition: null, error: { message: 'competition_not_found' } });
    const { result } = await renderHook(() => useCompetition('gone', null));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect((result.current as { message: string }).message).toBe('competition_not_found');
  });

  it('standings, matches (by team), awards (by matchday), power and stats', async () => {
    mockApi.getCompetitionStandings.mockResolvedValue({ standings: { rules: 'r', tables: [] }, error: null });
    mockApi.getCompetitionMatches.mockResolvedValue({ matches: [], error: null });
    mockApi.getCompetitionAwards.mockResolvedValue({ awards: null, error: null });
    mockApi.getCompetitionPowerRanking.mockResolvedValue({ rows: [], error: { message: 'x' } });
    mockApi.getCompetitionStats.mockResolvedValue({ categories: [], error: null });
    const standings = await renderHook(() => useCompetitionStandings('S1'));
    const matches = await renderHook(() => useCompetitionMatches('S1', 'T1'));
    const awards = await renderHook(() => useCompetitionAwards('S1', 2));
    const power = await renderHook(() => useCompetitionPowerRanking('S1'));
    const stats = await renderHook(() => useCompetitionStats('S1', 'teams', 'goals_scored', 100));
    await waitFor(() => expect(standings.result.current.status).toBe('ready'));
    await waitFor(() => expect(matches.result.current.status).toBe('ready'));
    await waitFor(() => expect(awards.result.current.status).toBe('ready'));
    await waitFor(() => expect(power.result.current.status).toBe('error'));
    await waitFor(() => expect(stats.result.current.status).toBe('ready'));
    expect(mockApi.getCompetitionStandings).toHaveBeenCalledWith('S1');
    expect(mockApi.getCompetitionMatches).toHaveBeenCalledWith('S1', 'T1');
    expect(mockApi.getCompetitionAwards).toHaveBeenCalledWith('S1', 2);
    expect(mockApi.getCompetitionPowerRanking).toHaveBeenCalledWith('S1');
    expect(mockApi.getCompetitionStats).toHaveBeenCalledWith('S1', 'teams', 'goals_scored', 100);
  });

  it('player stats: the Premium refusal is `premium`, other errors are errors', async () => {
    mockApi.getCompetitionPlayerStats.mockResolvedValueOnce({ rows: [], error: { message: 'premium_required' } });
    const refused = await renderHook(() => useCompetitionPlayerStats('S1', null));
    await waitFor(() => expect(refused.result.current.status).toBe('ready'));
    expect((refused.result.current as { premium: boolean }).premium).toBe(true);

    mockApi.getCompetitionPlayerStats.mockResolvedValueOnce({ rows: [{ profileId: 'p' }], error: null });
    const allowed = await renderHook(() => useCompetitionPlayerStats('S1', 'T1'));
    await waitFor(() => expect(allowed.result.current.status).toBe('ready'));
    expect(allowed.result.current).toMatchObject({ premium: false, rows: [{ profileId: 'p' }] });
    expect(mockApi.getCompetitionPlayerStats).toHaveBeenLastCalledWith('S1', 'T1');

    mockApi.getCompetitionPlayerStats.mockResolvedValueOnce({ rows: [], error: { message: 'offline' } });
    const failed = await renderHook(() => useCompetitionPlayerStats('S1', null));
    await waitFor(() => expect(failed.result.current.status).toBe('error'));
  });

  it('captain contacts: every table’s, and a failed table only hides its buttons', async () => {
    mockContacts.mockImplementation((id: string) =>
      id === 'D1' ? Promise.resolve([{ my_team_id: 'a', team_id: 'b', can_message: true }]) : Promise.reject(new Error('x')),
    );
    const { result } = await renderHook(() => useCaptainContacts(['D1', 'D2']));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(mockContacts).toHaveBeenCalledWith('D1');
    expect(mockContacts).toHaveBeenCalledWith('D2');
  });
});
