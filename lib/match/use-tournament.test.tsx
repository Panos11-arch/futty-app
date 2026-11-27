// S10A page: the tournament hooks pass the right ids to their reads and turn
// the answers into loading, error or ready.
import { renderHook, waitFor } from '@testing-library/react-native';

import {
  useIsAppAdmin,
  useTournament,
  useTournamentKnockout,
  useTournamentMatches,
  useTournaments,
  useTournamentStandings,
} from '@/lib/match/use-tournament';

const mockApi = {
  listTournaments: jest.fn(),
  getTournament: jest.fn(),
  getTournamentStandings: jest.fn(),
  getTournamentMatches: jest.fn(),
  getTournamentKnockout: jest.fn(),
  isAppAdmin: jest.fn(),
};
jest.mock('@/lib/match/tournament-api', () => ({
  ...jest.requireActual('@/lib/match/tournament-api'),
  listTournaments: (...a: unknown[]) => mockApi.listTournaments(...a),
  getTournament: (...a: unknown[]) => mockApi.getTournament(...a),
  getTournamentStandings: (...a: unknown[]) => mockApi.getTournamentStandings(...a),
  getTournamentMatches: (...a: unknown[]) => mockApi.getTournamentMatches(...a),
  getTournamentKnockout: (...a: unknown[]) => mockApi.getTournamentKnockout(...a),
  isAppAdmin: (...a: unknown[]) => mockApi.isAppAdmin(...a),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));

const fail = { message: 'offline' };

beforeEach(() => jest.clearAllMocks());

describe('tournament hooks', () => {
  it('useTournaments: ready with the list, or an error', async () => {
    mockApi.listTournaments.mockResolvedValueOnce({ tournaments: [{ id: 't1' }], error: null });
    const { result } = await renderHook(() => useTournaments());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect((result.current as { tournaments: unknown }).tournaments).toEqual([{ id: 't1' }]);
    mockApi.listTournaments.mockResolvedValueOnce({ tournaments: [], error: fail });
    const failed = await renderHook(() => useTournaments());
    await waitFor(() => expect(failed.result.current.status).toBe('error'));
  });

  it('useTournament: reads by id; no id, no read', async () => {
    mockApi.getTournament.mockResolvedValue({ tournament: { id: 't1' }, error: null });
    const { result } = await renderHook(() => useTournament('t1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockApi.getTournament).toHaveBeenCalledWith('t1');
    await renderHook(() => useTournament(undefined));
    expect(mockApi.getTournament).toHaveBeenCalledTimes(1);
    mockApi.getTournament.mockResolvedValueOnce({ tournament: null, error: { message: 'tournament_not_found' } });
    const failed = await renderHook(() => useTournament('gone'));
    await waitFor(() => expect(failed.result.current).toMatchObject({ status: 'error', message: 'tournament_not_found' }));
  });

  it('standings, matches (with a team) and knockout', async () => {
    mockApi.getTournamentStandings.mockResolvedValue({ standings: { rules: 'r', groups: [] }, error: null });
    mockApi.getTournamentMatches.mockResolvedValue({ matches: [], error: null });
    mockApi.getTournamentKnockout.mockResolvedValue({ slots: [], error: fail });
    const s = await renderHook(() => useTournamentStandings('t1'));
    const m = await renderHook(() => useTournamentMatches('t1', 'team1'));
    const k = await renderHook(() => useTournamentKnockout('t1'));
    await waitFor(() => expect(s.result.current.status).toBe('ready'));
    await waitFor(() => expect(m.result.current.status).toBe('ready'));
    await waitFor(() => expect(k.result.current.status).toBe('error'));
    expect(mockApi.getTournamentStandings).toHaveBeenCalledWith('t1');
    expect(mockApi.getTournamentMatches).toHaveBeenCalledWith('t1', 'team1');
    expect(mockApi.getTournamentKnockout).toHaveBeenCalledWith('t1');
    mockApi.getTournamentStandings.mockResolvedValueOnce({ standings: { rules: '', groups: [] }, error: fail });
    mockApi.getTournamentMatches.mockResolvedValueOnce({ matches: [], error: fail });
    mockApi.getTournamentKnockout.mockResolvedValueOnce({ slots: [{ slot: 'QF1' }], error: null });
    const s2 = await renderHook(() => useTournamentStandings('t2'));
    const m2 = await renderHook(() => useTournamentMatches('t2', null));
    const k2 = await renderHook(() => useTournamentKnockout('t2'));
    await waitFor(() => expect(s2.result.current.status).toBe('error'));
    await waitFor(() => expect(m2.result.current.status).toBe('error'));
    await waitFor(() => expect(k2.result.current.status).toBe('ready'));
  });

  it('useIsAppAdmin: true only when the server says so; an error hides it', async () => {
    mockApi.isAppAdmin.mockResolvedValueOnce({ admin: true, error: null });
    const yes = await renderHook(() => useIsAppAdmin());
    await waitFor(() => expect(yes.result.current.admin).toBe(true));
    mockApi.isAppAdmin.mockResolvedValueOnce({ admin: false, error: fail });
    const no = await renderHook(() => useIsAppAdmin());
    await waitFor(() => expect(mockApi.isAppAdmin).toHaveBeenCalledTimes(2));
    expect(no.result.current.admin).toBe(false);
  });
});
