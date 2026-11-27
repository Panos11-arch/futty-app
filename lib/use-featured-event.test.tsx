import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { League } from '@/lib/leagues';
import type { Tournament, TournamentHeader } from '@/lib/match/tournament-api';
import { useFeaturedEvent } from '@/lib/use-featured-event';

type ListState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; [key: string]: unknown };

let mockLeagues: ListState = { status: 'loading' };
let mockTournaments: ListState = { status: 'loading' };
const mockReloadLeagues = jest.fn();
const mockReloadTournaments = jest.fn();
const mockGetTournament = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-leagues', () => ({ useLeagues: () => ({ ...mockLeagues, reload: mockReloadLeagues }) }));
jest.mock('@/lib/match/use-tournament', () => ({
  useTournaments: () => ({ ...mockTournaments, reload: mockReloadTournaments }),
}));
jest.mock('@/lib/match/tournament-api', () => ({
  getTournament: (...args: unknown[]) => mockGetTournament(...args),
}));

const league: League = {
  id: 'l1',
  name: 'Limassol League',
  format: '5-a-side',
  scope: 'Limassol',
  stage: 'signup',
  start_date: '2026-12-05',
  season_weeks: 10,
  capacity: 16,
  parent_league_id: null,
};

const cup = (over: Partial<TournamentHeader> = {}): TournamentHeader => ({
  id: 't1',
  name: 'Nuevo Campo Cup',
  area: 'Limassol',
  country: 'Cyprus',
  format: '5-a-side',
  status: 'registration',
  comingSoon: false,
  startDate: '2026-12-12',
  endDate: null,
  venueId: null,
  venueName: null,
  maxTeams: 16,
  teamsCount: 3,
  entryFeeCents: 1200,
  championTeamId: null,
  ...over,
});

// 12:00 on 27 November in Cyprus.
const now = () => new Date('2026-11-27T10:00:00Z');
const deadline = (registrationDeadline: string | null) => ({
  tournament: { ...cup(), registrationDeadline } as Tournament,
  error: null,
});

describe('useFeaturedEvent (S10B: tournaments, then leagues)', () => {
  beforeEach(() => {
    mockLeagues = { status: 'ready', leagues: [league] };
    mockTournaments = { status: 'ready', tournaments: [] };
    mockGetTournament.mockReset();
    mockReloadLeagues.mockClear();
    mockReloadTournaments.mockClear();
  });

  it('loading while either list loads', async () => {
    mockTournaments = { status: 'loading' };
    const a = await renderHook(() => useFeaturedEvent(now));
    expect(a.result.current.status).toBe('loading');
    mockTournaments = { status: 'ready', tournaments: [] };
    mockLeagues = { status: 'loading' };
    const b = await renderHook(() => useFeaturedEvent(now));
    expect(b.result.current.status).toBe('loading');
  });

  it('no tournaments: the league, as before', async () => {
    const { result } = await renderHook(() => useFeaturedEvent(now));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ status: 'ready', event: { kind: 'league', id: 'l1' } });
    expect(mockGetTournament).not.toHaveBeenCalled();
  });

  it('reads the deadline only for sign-up open tournaments, and features one still open', async () => {
    mockTournaments = { status: 'ready', tournaments: [cup(), cup({ id: 'soon', status: 'coming_soon', comingSoon: true })] };
    mockGetTournament.mockResolvedValue(deadline('2026-11-30T20:00:00Z'));
    const { result } = await renderHook(() => useFeaturedEvent(now));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGetTournament).toHaveBeenCalledTimes(1);
    expect(mockGetTournament).toHaveBeenCalledWith('t1');
    expect(result.current).toMatchObject({ event: { kind: 'tournament', id: 't1', comingSoon: false } });
  });

  it('past its deadline: not featured; the Coming soon one instead', async () => {
    mockTournaments = { status: 'ready', tournaments: [cup(), cup({ id: 'soon', status: 'coming_soon', comingSoon: true })] };
    mockGetTournament.mockResolvedValue(deadline('2026-11-26T20:00:00Z'));
    const { result } = await renderHook(() => useFeaturedEvent(now));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ event: { id: 'soon', comingSoon: true } });
  });

  it.each([
    ['rejects', () => mockGetTournament.mockRejectedValue(new Error('offline'))],
    ['returns an error', () => mockGetTournament.mockResolvedValue({ tournament: null, error: { message: 'boom' } })],
  ])('a deadline read that %s skips that tournament; Home still shows the league', async (_, arrange) => {
    arrange();
    mockTournaments = { status: 'ready', tournaments: [cup()] };
    const { result } = await renderHook(() => useFeaturedEvent(now));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ event: { kind: 'league', id: 'l1' } });
  });

  it('the tournament list fails: the league is still featured', async () => {
    mockTournaments = { status: 'error', message: 'list_tournaments failed' };
    const { result } = await renderHook(() => useFeaturedEvent(now));
    expect(result.current).toMatchObject({ status: 'ready', event: { kind: 'league', id: 'l1' } });
  });

  it('both lists fail: an error, so the card is hidden', async () => {
    mockTournaments = { status: 'error', message: 'list_tournaments failed' };
    mockLeagues = { status: 'error', message: 'leagues failed' };
    const { result } = await renderHook(() => useFeaturedEvent(now));
    expect(result.current).toMatchObject({ status: 'error', message: 'leagues failed' });
  });

  it('the league list fails with no tournament to show: an error', async () => {
    mockLeagues = { status: 'error', message: 'leagues failed' };
    const { result } = await renderHook(() => useFeaturedEvent(now));
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('the league list fails but a tournament is there: the tournament (it comes first anyway)', async () => {
    mockLeagues = { status: 'error', message: 'leagues failed' };
    mockTournaments = { status: 'ready', tournaments: [cup({ status: 'coming_soon', comingSoon: true })] };
    const { result } = await renderHook(() => useFeaturedEvent(now));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ event: { kind: 'tournament', id: 't1' } });
  });

  it('reload loads the leagues, the tournaments and the deadlines again', async () => {
    mockTournaments = { status: 'ready', tournaments: [cup()] };
    mockGetTournament.mockResolvedValue(deadline(null));
    const { result } = await renderHook(() => useFeaturedEvent(now));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGetTournament).toHaveBeenCalledTimes(1);
    await act(async () => result.current.reload());
    expect(mockReloadLeagues).toHaveBeenCalledTimes(1);
    expect(mockReloadTournaments).toHaveBeenCalledTimes(1);
    expect(mockGetTournament).toHaveBeenCalledTimes(2);
  });
});
