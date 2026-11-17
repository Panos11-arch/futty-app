// The match page on app/match/[id].tsx (A4b): what members and strangers see.
import '../navigation/mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';

import MatchScreen from '@/app/match/[id]';
import { mockMatchPage, mockPagePlayer, mockResultMatch, mockRoster } from '@/lib/match/mock';

let mockResult: Record<string, unknown>;
let mockPage: Record<string, unknown>;
let mockViewer = 'booker';
const mockReload = jest.fn();
const mockReloadPage = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    Stack: { Screen: () => null },
    useLocalSearchParams: () => ({ id: 'm1' }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/match/use-match-result', () => ({
  useResultMatch: () => ({ ...mockResult, viewerId: mockViewer, reload: mockReload }),
}));
jest.mock('@/lib/match/use-match-page', () => ({
  useMatchPage: () => ({ ...mockPage, reload: mockReloadPage }),
  useMatchRoster: (_: string, enabled: boolean) =>
    enabled ? { status: 'ready', roster: mockRoster(), reload: jest.fn() } : { status: 'loading', reload: jest.fn() },
  useFormationPresets: () => ({ status: 'ready', formations: ['1-2-1', '2-2'], reload: jest.fn() }),
}));
let mockRatings: Record<string, unknown> = { status: 'loading' };
const mockReloadRatings = jest.fn();
jest.mock('@/lib/match/use-levels', () => ({
  useMatchRatings: (_: string, enabled: boolean) =>
    enabled ? { ...mockRatings, reload: mockReloadRatings } : { status: 'loading', reload: mockReloadRatings },
}));
jest.mock('@/lib/match/levels-api', () => ({
  setMatchCompetitive: jest.fn(),
  rateMatchPlayer: jest.fn(),
  balanceMatchTeams: jest.fn(),
}));
jest.mock('@/lib/use-fixtures', () => ({ useMyCaptainTeamIds: () => new Set<string>() }));
jest.mock('@/lib/match/results-api', () => ({ submitMatchResult: jest.fn(), respondToMatchResult: jest.fn() }));
jest.mock('@/lib/match/page-api', () => ({ setMatchGoals: jest.fn(), castMotmVote: jest.fn(), setMatchLineup: jest.fn() }));
jest.mock('@/components/booking/check-in-panel', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { CheckInSection: ({ matchId }: { matchId: string }) => <Text>{`check-in for ${matchId}`}</Text> };
});
jest.mock('@/components/offers/post-match-offers', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { PostMatchOffers: ({ matchId }: { matchId: string }) => <Text>{`offers for ${matchId}`}</Text> };
});

const confirmedResult = () =>
  mockResultMatch({ status: 'confirmed', scores: [2, 1], submission: { response: 'accepted' } });

beforeEach(() => {
  mockReload.mockReset();
  mockReloadPage.mockReset();
  mockViewer = 'booker';
  mockReloadRatings.mockReset();
  mockRatings = { status: 'loading' };
});

describe('Match page: strangers', () => {
  beforeEach(() => {
    mockViewer = 'stranger';
    mockResult = { status: 'ready', match: null };
  });

  it('before confirmation the server says match_not_found: "Match not found"', async () => {
    mockPage = { status: 'ready', page: null };
    await render(<MatchScreen />);
    expect(screen.getByText('Match not found')).toBeTruthy();
    expect(screen.queryByTestId('section-scorers')).toBeNull();
  });

  it('once confirmed: score, scorers, man of the match and lineups, with no result panel, offers or edit controls', async () => {
    mockPage = {
      status: 'ready',
      page: mockMatchPage({ goals: [{ side: 'a', scorer: mockPagePlayer('p-me'), assist: null }] }),
    };
    await render(<MatchScreen />);
    expect(screen.getByText('Sat 14 Nov · 19:00 · Nuevo Campo')).toBeTruthy();
    expect(screen.getByText('Bibs 2–1 Non-bibs')).toBeTruthy();
    expect(screen.getByText('Me Player')).toBeTruthy();
    expect(screen.getByTestId('section-motm')).toBeTruthy();
    expect(screen.getByTestId('section-lineups')).toBeTruthy();
    expect(screen.queryByTestId('match-result-panel')).toBeNull();
    expect(screen.queryByText(/^offers for/)).toBeNull();
    expect(screen.queryByText(/^check-in for/)).toBeNull();
    expect(screen.queryByText(/Add .* scorers/)).toBeNull();
    expect(screen.queryByTestId('cast-vote')).toBeNull();
  });

  it('page loading: a skeleton; page error: an inline error with retry', async () => {
    mockPage = { status: 'loading' };
    const view = await render(<MatchScreen />);
    expect(screen.getByTestId('match-skeleton')).toBeTruthy();
    mockPage = { status: 'error', message: 'boom' };
    await view.rerender(<MatchScreen />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockReloadPage).toHaveBeenCalled();
  });
});

describe('Match page: members', () => {
  it('the result panel and the offers still render, with the page sections below', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'ready', page: mockMatchPage() };
    await render(<MatchScreen />);
    expect(screen.getByText('check-in for m1')).toBeTruthy();
    expect(screen.getByTestId('match-result-panel')).toBeTruthy();
    expect(screen.getByText('offers for m1')).toBeTruthy();
    expect(screen.getByTestId('section-scorers')).toBeTruthy();
    expect(screen.queryByTestId('match-page-score')).toBeNull();
  });

  it('while the page loads, each section shows a skeleton', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'loading' };
    await render(<MatchScreen />);
    expect(screen.getByTestId('match-result-panel')).toBeTruthy();
    expect(screen.getByTestId('section-scorers-skeleton')).toBeTruthy();
    expect(screen.getByTestId('section-motm-skeleton')).toBeTruthy();
    expect(screen.getByTestId('section-lineups-skeleton')).toBeTruthy();
  });

  it('a page error shows inline in each section, with retry', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'error', message: 'boom' };
    await render(<MatchScreen />);
    expect(screen.getByText('Could not load scorers.')).toBeTruthy();
    expect(screen.getByText('Could not load man of the match.')).toBeTruthy();
    expect(screen.getByText('Could not load lineups.')).toBeTruthy();
    const retries = screen.getAllByText('Try again');
    expect(retries).toHaveLength(3);
    await fireEvent.press(retries[retries.length - 1]);
    expect(mockReloadPage).toHaveBeenCalled();
  });

  it('the pickup booker can add scorers; a Non-bibs player cannot', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    // The screen uses the real clock: keep the scorers window open.
    mockPage = { status: 'ready', page: mockMatchPage({ scorersOpenUntil: '2099-01-01T00:00:00.000Z' }) };
    const view = await render(<MatchScreen />);
    expect(screen.getByText('Add Bibs scorers')).toBeTruthy();
    mockViewer = 'me';
    await view.rerender(<MatchScreen />);
    expect(screen.queryByText('Add Bibs scorers')).toBeNull();
  });

  it('before kickoff: only lineups, which the captain can set', async () => {
    mockResult = { status: 'ready', match: mockResultMatch({ status: 'scheduled' }) };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'scheduled', kickoffAt: '2099-01-01T17:00:00.000Z' }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('section-scorers')).toBeNull();
    expect(screen.queryByTestId('section-motm')).toBeNull();
    expect(screen.getByText('Set lineup')).toBeTruthy();
  });
});

describe('Match page: levels (A5b)', () => {
  const ratings = (over: Record<string, unknown> = {}) => ({
    status: 'ready',
    ratings: { ratingsOpen: true, ratingsCloseAt: '2026-11-15T19:00:00.000Z', players: [], myRatings: [], ...over },
    names: {},
  });

  it('a confirmed match: player ratings for a checked-in member, never themselves', async () => {
    mockViewer = 'me';
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'ready', page: mockMatchPage() };
    mockRatings = ratings();
    await render(<MatchScreen />);
    expect(screen.getByTestId('section-ratings')).toBeTruthy();
    expect(screen.getByTestId('rate-p-nikos')).toBeTruthy();
    expect(screen.queryByTestId('rate-p-me')).toBeNull();
  });

  it('ratings: skeleton while loading, an inline error with retry', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'ready', page: mockMatchPage() };
    const view = await render(<MatchScreen />);
    expect(screen.getByTestId('section-ratings-skeleton')).toBeTruthy();
    mockRatings = { status: 'error', message: 'boom' };
    await view.rerender(<MatchScreen />);
    expect(screen.getByText('Could not load the ratings.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockReloadRatings).toHaveBeenCalled();
  });

  it('strangers see ratings only as the server returns them', async () => {
    mockViewer = 'stranger';
    mockResult = { status: 'ready', match: null };
    mockPage = { status: 'ready', page: mockMatchPage() };
    mockRatings = {
      ...ratings({ ratingsOpen: false, players: [{ playerId: 'p-nikos', profileId: 'nikos', rating: 6.8, count: 3 }] }),
      names: { nikos: 'Nikos Away' },
    };
    await render(<MatchScreen />);
    expect(screen.getByTestId('rating-p-nikos')).toHaveTextContent(/6\.8/);
    expect(screen.queryByTestId('section-competitive')).toBeNull();
  });

  it('no ratings section before confirmation', async () => {
    mockResult = { status: 'ready', match: mockResultMatch({ status: 'scheduled' }) };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'scheduled' }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('section-ratings')).toBeNull();
  });

  it('members see competitive or casual; the pickup booker sees Balance teams before sides lock', async () => {
    mockResult = { status: 'ready', match: mockResultMatch({ status: 'scheduled' }) };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'scheduled' }) };
    const view = await render(<MatchScreen />);
    expect(screen.getByTestId('competitive-label')).toHaveTextContent('Casual');
    expect(screen.getByTestId('section-balance')).toBeTruthy();

    mockViewer = 'me';
    await view.rerender(<MatchScreen />);
    expect(screen.queryByTestId('section-balance')).toBeNull();
  });

  it('no Balance teams once a score is entered', async () => {
    mockResult = { status: 'ready', match: mockResultMatch({ status: 'played', submission: {} }) };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'played' }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('section-balance')).toBeNull();
  });
});
