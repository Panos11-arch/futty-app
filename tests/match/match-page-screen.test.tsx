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
    await fireEvent.press(retries[2]);
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
