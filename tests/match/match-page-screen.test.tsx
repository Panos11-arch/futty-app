// The match page on app/match/[id].tsx (A4b, S13B): what members and strangers see.
import '../navigation/mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import MatchScreen from '@/app/match/[id]';
import { mockMatchLog } from '@/lib/match/log-score-mock';
import { mockMatchPage, mockPagePlayer, mockResultMatch, mockRoster } from '@/lib/match/mock';

import { testIdsInOrder } from '../ads/test-ids';

let mockResult: Record<string, unknown>;
let mockPage: Record<string, unknown>;
let mockViewer = 'booker';
const mockReload = jest.fn();
const mockReloadPage = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
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
let mockLog: Record<string, unknown> = { status: 'loading' };
const mockReloadLog = jest.fn();
jest.mock('@/lib/match/use-match-log', () => ({
  useMatchLog: (matchId: string | undefined) =>
    matchId ? { ...mockLog, reload: mockReloadLog } : { status: 'loading', reload: mockReloadLog },
}));
jest.mock('@/lib/match/levels-api', () => ({
  setMatchCompetitive: jest.fn(),
  balanceMatchTeams: jest.fn(),
}));
// Share's sheet reads the safe area; the screen's SafeAreaView is a plain view here.
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});
jest.mock('@/lib/use-fixtures', () => ({ useMyCaptainTeamIds: () => new Set<string>() }));
jest.mock('@/lib/match/score-check-api', () => ({ respondToMatchScore: jest.fn() }));
jest.mock('@/lib/match/page-api', () => ({ castMotmVote: jest.fn(), setMatchLineup: jest.fn() }));
jest.mock('@/components/booking/check-in-panel', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { CheckInSection: ({ matchId }: { matchId: string }) => <Text>{`check-in for ${matchId}`}</Text> };
});
// G4a: the shared banner as a marker (its own rules: components/ads/ad-banner.test.tsx).
jest.mock('@/components/ads/ad-banner', () => jest.requireActual('../ads/test-ids').adBannerMarker());
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
  mockReloadLog.mockReset();
  mockLog = { status: 'ready', log: mockMatchLog({ canLog: false }) };
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

  it('once confirmed, anyone can share the match cards', async () => {
    mockPage = { status: 'ready', page: mockMatchPage() };
    await render(<MatchScreen />);
    expect(screen.getByTestId('match-share')).toBeTruthy();
  });

  it('a confirmed forfeit has no cards to share', async () => {
    mockPage = { status: 'ready', page: mockMatchPage({ forfeit: { side: 'b', reason: 'no_show' } }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('match-share')).toBeNull();
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

  it('scorers and assists are read-only here: no editor on the match page', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = {
      status: 'ready',
      page: mockMatchPage({
        goals: [{ side: 'a', scorer: mockPagePlayer('p-me'), assist: null }],
        assists: [{ ...mockPagePlayer('p-booker'), side: 'a', assists: 1 }],
      }),
    };
    await render(<MatchScreen />);
    expect(screen.getByTestId('scorer-p-me')).toHaveTextContent('Me Player1');
    expect(screen.getByTestId('assister-p-booker')).toHaveTextContent('Andreas Booker1');
    expect(screen.queryByTestId('scorers-editor')).toBeNull();
    expect(screen.queryByText(/Add .* scorers/)).toBeNull();
  });

  it('before kickoff: only lineups, which the captain can set', async () => {
    mockResult = { status: 'ready', match: mockResultMatch({ status: 'scheduled' }) };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'scheduled', kickoffAt: '2099-01-01T17:00:00.000Z' }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('match-share')).toBeNull();
    expect(screen.queryByTestId('section-scorers')).toBeNull();
    expect(screen.queryByTestId('section-motm')).toBeNull();
    expect(screen.getByText('Set lineup')).toBeTruthy();
  });
});

describe('Match page: ratings (S13B) and levels (A5b)', () => {
  it('a confirmed match: every rating as a badge, best first; no 1-10 voting', async () => {
    mockViewer = 'me';
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = {
      status: 'ready',
      page: mockMatchPage({
        ratings: [
          { ...mockPagePlayer('p-booker'), side: 'a', rating: 8.2 },
          { ...mockPagePlayer('p-nikos'), side: 'b', rating: 6.8 },
        ],
      }),
    };
    await render(<MatchScreen />);
    expect(screen.getByTestId('section-ratings')).toBeTruthy();
    expect(screen.getByTestId('rating-p-booker')).toHaveTextContent(/8\.2/);
    expect(screen.getByTestId('rating-p-nikos')).toHaveTextContent(/6\.8/);
    expect(screen.queryByTestId('rate-p-nikos')).toBeNull();
  });

  it('ratings wait for the page: the sections show skeletons while it loads', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'loading' };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('section-ratings')).toBeNull();
    expect(screen.getByTestId('section-scorers-skeleton')).toBeTruthy();
  });

  it('strangers see the ratings the server returns', async () => {
    mockViewer = 'stranger';
    mockResult = { status: 'ready', match: null };
    mockPage = { status: 'ready', page: mockMatchPage({ ratings: [{ ...mockPagePlayer('p-nikos'), side: 'b', rating: 6.8 }] }) };
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

  it('members see the game type (Competitive by default); the pickup booker sees Balance teams before sides lock', async () => {
    mockResult = { status: 'ready', match: mockResultMatch({ status: 'scheduled' }) };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'scheduled' }) };
    const view = await render(<MatchScreen />);
    expect(screen.getByTestId('competitive-label')).toHaveTextContent('Competitive');
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

describe('Match page: Log the score and Edit stats (S13B)', () => {
  it('Log the score while the captain can log; it opens the after-game screens', async () => {
    mockResult = { status: 'ready', match: mockResultMatch() };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'played' }) };
    mockLog = { status: 'ready', log: mockMatchLog() };
    jest.mocked(router.push).mockClear();
    await render(<MatchScreen />);
    await fireEvent.press(screen.getByTestId('match-add-stats'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/after-game', params: { id: 'm1' } });
    expect(screen.queryByTestId('match-edit-stats')).toBeNull();
  });

  it('Edit stats for 24 hours after the result: the correction', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'ready', page: mockMatchPage() };
    mockLog = { status: 'ready', log: mockMatchLog({ status: 'confirmed', canLog: false, canCorrect: true }) };
    jest.mocked(router.push).mockClear();
    await render(<MatchScreen />);
    expect(screen.getByTestId('match-result-panel')).toHaveTextContent('Bibs 2–1 Non-bibs');
    expect(screen.queryByTestId('match-add-stats')).toBeNull();
    await fireEvent.press(screen.getByTestId('match-edit-stats'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/after-game', params: { id: 'm1', correct: '1' } });
  });

  it('a player who is not a captain sees neither', async () => {
    mockViewer = 'me';
    mockResult = { status: 'ready', match: mockResultMatch() };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'played' }) };
    mockLog = { status: 'ready', log: mockMatchLog({ writableSides: [], canLog: false }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('match-add-stats')).toBeNull();
    expect(screen.queryByTestId('match-edit-stats')).toBeNull();
  });

  it('hidden for someone outside the match (nothing is even loaded)', async () => {
    mockViewer = 'stranger';
    mockResult = { status: 'ready', match: null };
    mockPage = { status: 'ready', page: mockMatchPage() };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('match-add-stats')).toBeNull();
  });
});

describe('Match page: "Check the score" (levels like Playtomic, Panos 25 November)', () => {
  const open = { state: 'pending' as const, canAnswer: true, checkUntil: '2999-01-01T00:00:00.000Z' };

  it('a player on the other side who played sees the score with Accept and Reject', async () => {
    mockViewer = 'me';
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'ready', page: mockMatchPage({ scoreCheck: open }) };
    await render(<MatchScreen />);
    expect(screen.getByTestId('check-score-card-m1')).toHaveTextContent(/Bibs 2–1 Non-bibs/);
    expect(screen.getByTestId('check-score-accept-m1')).toBeTruthy();
    expect(screen.getByTestId('check-score-reject-m1')).toBeTruthy();
  });

  it("hidden for the booker's side (the server says they can't answer)", async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'ready', page: mockMatchPage({ scoreCheck: { ...open, canAnswer: false } }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('check-score-card-m1')).toBeNull();
  });

  it('hidden once answered', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'ready', page: mockMatchPage({ scoreCheck: { ...open, state: 'accepted' } }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('check-score-card-m1')).toBeNull();
  });
});

describe('Match page: banner ad (G4a, after the game only)', () => {
  it('a confirmed match ends with a banner ad, for members and strangers', async () => {
    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'ready', page: mockMatchPage({}) };
    await render(<MatchScreen />);
    let ids = testIdsInOrder();
    expect(ids).toContain('match-ad');
    expect(ids[ids.length - 1]).toBe('match-ad');

    mockViewer = 'stranger';
    mockResult = { status: 'ready', match: null };
    await render(<MatchScreen />);
    ids = testIdsInOrder();
    expect(ids[ids.length - 1]).toBe('match-ad');
  });

  it('before the game, while the page loads, or on an error: no banner ad', async () => {
    mockResult = { status: 'ready', match: mockResultMatch({ status: 'scheduled' }) };
    mockPage = { status: 'ready', page: mockMatchPage({ status: 'scheduled', kickoffAt: '2099-01-01T17:00:00.000Z' }) };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('match-ad')).toBeNull();

    mockResult = { status: 'ready', match: confirmedResult() };
    mockPage = { status: 'loading' };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('match-ad')).toBeNull();

    mockPage = { status: 'error', message: 'boom' };
    await render(<MatchScreen />);
    expect(screen.queryByTestId('match-ad')).toBeNull();
  });
});
