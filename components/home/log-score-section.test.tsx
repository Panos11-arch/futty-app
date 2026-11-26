import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { LogScoreSection } from '@/components/home/log-score-section';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/match/score-check-api', () => ({ respondToMatchScore: jest.fn() }));
jest.mock('@/components/fixture-score-form', () => ({ FixtureScoreForm: () => null }));
jest.mock('@/components/booking-result-form', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BookingResultForm: ({ booking }: { booking: { id: string } }) => <Text>{`old booking form ${booking.id}`}</Text> };
});

type Status = 'loading' | 'ready' | 'error';
let mockToLog: { status: Status; matches: unknown[] } = { status: 'ready', matches: [] };
let mockToCheck: { status: Status; scores: unknown[] } = { status: 'ready', scores: [] };
let mockUnscored: { status: Status; bookings: unknown[] } = { status: 'ready', bookings: [] };
let mockLinksStatus: Status = 'ready';
const mockReload = {
  toLog: jest.fn(),
  toCheck: jest.fn(),
  unscored: jest.fn(),
  friendly: jest.fn(),
  fixtures: jest.fn(),
  links: jest.fn(),
};

jest.mock('@/lib/match/use-match-log', () => ({
  useMyMatchesToLog: () => ({ ...mockToLog, message: 'boom', reload: mockReload.toLog }),
  useMyScoresToCheck: () => ({ ...mockToCheck, message: 'boom', reload: mockReload.toCheck }),
}));
jest.mock('@/lib/use-my-bookings', () => ({
  useMyUnscoredBookings: () => ({ ...mockUnscored, message: 'boom', reload: mockReload.unscored }),
}));
jest.mock('@/lib/use-friendly-matches', () => ({
  useMyFriendlyMatches: () => ({ status: 'ready', matches: [], reload: mockReload.friendly }),
}));
jest.mock('@/lib/use-fixtures', () => ({
  useMyFixtures: () => ({ status: 'ready', fixtures: [], reload: mockReload.fixtures }),
  useMyCaptainTeamIds: () => [],
}));
jest.mock('@/lib/use-venues', () => ({
  useVenues: () => ({ status: 'ready', venues: [{ id: 'v1', name: 'Nuevo Campo', city: 'Nicosia' }], reload: jest.fn() }),
}));
jest.mock('@/lib/match/use-match-result', () => ({
  useMatchLinks: () => ({
    status: mockLinksStatus,
    links: { byBookingId: new Map(), byFriendlyMatchId: new Map(), byLeagueFixtureId: new Map() },
    reload: mockReload.links,
  }),
}));

const toLog = { matchId: 'm1', kickoffAt: '2026-11-14T17:00:00.000Z', labelA: 'Bibs', labelB: 'Non-bibs', state: 'log' };
const toCheck = {
  matchId: 'm9',
  kickoffAt: '2026-11-14T17:00:00.000Z',
  labelA: 'Bibs',
  labelB: 'Non-bibs',
  sideAScore: 2,
  sideBScore: 1,
  checkUntil: '2999-01-01T00:00:00.000Z',
};
const pastBooking = (id: string, day = '2026-11-01') => ({ id, venue_id: 'v1', booking_day: day, start_time: '19:00:00' });

describe('Home "Log the score" section', () => {
  beforeEach(() => {
    mockToLog = { status: 'ready', matches: [] };
    mockToCheck = { status: 'ready', scores: [] };
    mockUnscored = { status: 'ready', bookings: [] };
    mockLinksStatus = 'ready';
    Object.values(mockReload).forEach((fn) => fn.mockClear());
    jest.mocked(router.push).mockClear();
  });

  it('loading: nothing yet (no card flashes in and out)', async () => {
    mockToLog = { status: 'loading', matches: [] };
    mockToCheck = { status: 'loading', scores: [] };
    mockUnscored = { status: 'loading', bookings: [] };
    mockLinksStatus = 'loading';
    await render(<LogScoreSection refreshSignal={0} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('nothing to log or check: hidden', async () => {
    await render(<LogScoreSection refreshSignal={0} />);
    expect(screen.queryByTestId('home-log-score-section')).toBeNull();
  });

  it('a game to log: the S13B card, with no extra heading', async () => {
    mockToLog = { status: 'ready', matches: [toLog] };
    await render(<LogScoreSection refreshSignal={0} />);
    expect(screen.getByTestId('home-log-score-section')).toBeTruthy();
    expect(screen.getAllByText('Log the score')).toHaveLength(1);
    expect(screen.getByText('Bibs v Non-bibs · Sat 14 Nov · 19:00')).toBeTruthy();
  });

  it('Log opens the after-game screens (testID kept for Maestro)', async () => {
    mockToLog = { status: 'ready', matches: [toLog] };
    await render(<LogScoreSection refreshSignal={0} />);
    await fireEvent.press(screen.getByTestId('home-log-score-m1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/after-game', params: { id: 'm1' } });
  });

  it('a score to check: its card with Accept and Reject', async () => {
    mockToCheck = { status: 'ready', scores: [toCheck] };
    await render(<LogScoreSection refreshSignal={0} />);
    expect(screen.getByTestId('check-score-card-m9')).toHaveTextContent(/Bibs 2–1 Non-bibs/);
    expect(screen.getByTestId('check-score-accept-m9')).toBeTruthy();
    expect(screen.getByTestId('check-score-reject-m9')).toBeTruthy();
  });

  it('a game from before A2 keeps its old form under a heading', async () => {
    mockUnscored = { status: 'ready', bookings: [pastBooking('old')] };
    await render(<LogScoreSection refreshSignal={0} />);
    expect(screen.getByRole('header', { name: 'Log the score' })).toBeTruthy();
    expect(screen.getByText('old booking form old')).toBeTruthy();
  });

  it('more than two old bookings: two inline, View all opens the rest', async () => {
    mockUnscored = {
      status: 'ready',
      bookings: [pastBooking('a', '2026-11-01'), pastBooking('b', '2026-11-02'), pastBooking('c', '2026-11-03')],
    };
    await render(<LogScoreSection refreshSignal={0} />);
    // Newest first.
    expect(screen.getByText('old booking form c')).toBeTruthy();
    expect(screen.getByText('old booking form b')).toBeTruthy();
    expect(screen.queryByText('old booking form a')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'View all 3 pending' }));
    expect(router.push).toHaveBeenCalledWith('/previous-games');
  });

  it('a check error: one line with Try again, which reloads only that', async () => {
    mockToCheck = { status: 'error', scores: [] };
    await render(<LogScoreSection refreshSignal={0} />);
    expect(screen.getByText('Could not load the scores to check.')).toBeTruthy();
    Object.values(mockReload).forEach((fn) => fn.mockClear());
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload.toCheck).toHaveBeenCalledTimes(1);
    expect(mockReload.toLog).not.toHaveBeenCalled();
  });

  it('a log error: one line with Try again, which reloads only that', async () => {
    mockToLog = { status: 'error', matches: [] };
    await render(<LogScoreSection refreshSignal={0} />);
    expect(screen.getByText('Could not load your games waiting for a score.')).toBeTruthy();
    Object.values(mockReload).forEach((fn) => fn.mockClear());
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload.toLog).toHaveBeenCalledTimes(1);
    expect(mockReload.toCheck).not.toHaveBeenCalled();
  });

  it('pull to refresh reloads every source', async () => {
    await render(<LogScoreSection refreshSignal={0} />);
    Object.values(mockReload).forEach((fn) => fn.mockClear());
    await screen.rerender(<LogScoreSection refreshSignal={1} />);
    for (const key of ['toLog', 'toCheck', 'unscored', 'friendly', 'fixtures'] as const) {
      expect(mockReload[key]).toHaveBeenCalledTimes(1);
    }
  });
});
