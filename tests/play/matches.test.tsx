import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import MatchmakingScreen from '@/app/matchmaking';
import { PreviousGamesList } from '@/app/previous-games';
import { UpcomingFixturesList } from '@/app/upcoming-fixtures';
import { BookingResultForm } from '@/components/booking-result-form';
import { FixtureScoreForm } from '@/components/fixture-score-form';
import type { Fixture } from '@/lib/fixtures';

let mockFixtures: Record<string, unknown>;
let mockCaptainOf = new Set<string>();
let mockUnscored: Record<string, unknown>;
let mockLinks: Record<string, unknown>;
const mockFixturesReload = jest.fn();
const mockUnscoredReload = jest.fn();
const mockLinksReload = jest.fn();
const mockSubmitScore = jest.fn();
const mockResolve = jest.fn();
const mockProposals = jest.fn();
const mockLogResult = jest.fn();
const mockCancel = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-fixtures', () => ({
  useMyFixtures: () => ({ ...mockFixtures, reload: mockFixturesReload }),
  useMyCaptainTeamIds: () => mockCaptainOf,
}));
jest.mock('@/lib/use-my-bookings', () => ({
  useMyUnscoredBookings: () => ({ ...mockUnscored, reload: mockUnscoredReload }),
}));
jest.mock('@/lib/match/use-match-result', () => ({
  useMatchLinks: () => ({ ...mockLinks, reload: mockLinksReload }),
}));
jest.mock('@/lib/use-venues', () => ({
  useVenues: () => ({ status: 'ready', venues: [{ id: 'v1', name: 'Arena', city: 'Nicosia' }], cities: [], reload: jest.fn() }),
}));
jest.mock('@/lib/fixtures', () => ({
  ...jest.requireActual('@/lib/fixtures'),
  submitFixtureScore: (...args: unknown[]) => mockSubmitScore(...args),
  resolveUnscheduledFixture: (...args: unknown[]) => mockResolve(...args),
  listFixtureProposals: (...args: unknown[]) => mockProposals(...args),
}));
jest.mock('@/lib/booking-actions', () => ({
  logBookingResult: (...args: unknown[]) => mockLogResult(...args),
  cancelBooking: (...args: unknown[]) => mockCancel(...args),
}));
jest.mock('@/components/match/fixture-score-entry', () => ({ FixtureScoreEntry: () => null }));
jest.mock('@/components/wizard-modal', () => {
  const { View, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    WizardModal: ({ title, children }: { title: string; children: React.ReactNode }) => (
      <View testID="wizard">
        <Text>{title}</Text>
        {children}
      </View>
    ),
  };
});

const fixture = (over: Partial<Fixture> = {}): Fixture => ({
  id: 'f1',
  league_id: 'L1',
  division_name: null,
  home_team_id: 'home',
  away_team_id: 'away',
  venue_id: null,
  scheduled_day: null,
  scheduled_time: null,
  status: 'unscheduled',
  score_attempts: 0,
  score_locked: false,
  created_at: '2026-11-01T10:00:00Z',
  home_score: null,
  away_score: null,
  home_team: { id: 'home', name: 'Tigers' },
  away_team: { id: 'away', name: 'Lions' },
  venue: null,
  ...over,
});

const booking = {
  id: 'b1',
  venue_id: 'v1',
  booking_day: '2026-11-10',
  start_time: '19:00:00',
  end_time: '20:00:00',
  pitches: 1,
  capacity: 10,
  format: '5-a-side',
};

beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-11-17T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  mockCaptainOf = new Set();
  mockFixtures = { status: 'ready', fixtures: [] };
  mockUnscored = { status: 'ready', bookings: [] };
  mockLinks = { status: 'ready', links: { byBookingId: new Map(), byLeagueFixtureId: new Map() } };
  mockProposals.mockResolvedValue({ data: [] });
});

describe('Upcoming fixtures', () => {
  it.each([
    ['loading', { status: 'loading' }],
    ['empty', { status: 'ready', fixtures: [] }],
  ])('%s', async (_, state) => {
    mockFixtures = state;
    const view = await render(<UpcomingFixturesList />);
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('error retries the same load', async () => {
    mockFixtures = { status: 'error', message: 'offline' };
    await render(<UpcomingFixturesList />);
    mockFixturesReload.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockFixturesReload).toHaveBeenCalledTimes(1);
  });

  it('populated for a captain: same actions and targets', async () => {
    mockCaptainOf = new Set(['home']);
    mockResolve.mockResolvedValue({ error: null });
    mockFixtures = {
      status: 'ready',
      fixtures: [fixture(), fixture({ id: 'f2', status: 'completed' })],
    };
    const view = await render(<UpcomingFixturesList />);
    expect(screen.getAllByTestId('fixture-card')).toHaveLength(1);
    expect(view.toJSON()).toMatchSnapshot();

    await fireEvent.press(screen.getByRole('button', { name: 'Go to matchmaking' }));
    expect(router.push).toHaveBeenCalledWith('/matchmaking');
    await fireEvent.press(screen.getByRole('button', { name: 'Message the other captain' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fixture-chat', params: { fixtureId: 'f1' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Resolve outcome — no agreed date this week' }));
    expect(mockResolve).toHaveBeenCalledWith('f1');
  });

  it('not a captain: no actions', async () => {
    mockFixtures = { status: 'ready', fixtures: [fixture()] };
    await render(<UpcomingFixturesList />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Previous games', () => {
  it.each([
    ['loading', { status: 'loading' }],
    ['empty', { status: 'ready', bookings: [] }],
  ])('%s', async (_, state) => {
    mockUnscored = state;
    const view = await render(<PreviousGamesList />);
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('errors retry the same loads', async () => {
    mockUnscored = { status: 'error', message: 'offline' };
    mockLinks = { status: 'error' };
    await render(<PreviousGamesList />);
    const retries = screen.getAllByRole('button', { name: 'Try again' });
    expect(retries).toHaveLength(2);
    mockUnscoredReload.mockClear();
    mockLinksReload.mockClear();
    await fireEvent.press(retries[0]);
    await fireEvent.press(retries[1]);
    expect(mockUnscoredReload).toHaveBeenCalledTimes(1);
    expect(mockLinksReload).toHaveBeenCalledTimes(1);
  });

  it('populated: a match opens the match screen, the rest keep the old form', async () => {
    mockUnscored = { status: 'ready', bookings: [booking, { ...booking, id: 'b2', booking_day: '2026-11-12' }] };
    mockLinks = { status: 'ready', links: { byBookingId: new Map([['b2', 'm2']]), byLeagueFixtureId: new Map() } };
    const view = await render(<PreviousGamesList />);
    expect(view.toJSON()).toMatchSnapshot();
    await fireEvent.press(screen.getByRole('button', { name: 'Arena' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/[id]', params: { id: 'm2' } });
    expect(screen.getByRole('button', { name: 'Log result' })).toBeTruthy();
  });
});

describe('Score forms', () => {
  it('BookingResultForm logs and cancels with the same arguments', async () => {
    const done = jest.fn();
    mockLogResult.mockResolvedValue({ error: null });
    mockCancel.mockResolvedValue({ error: null });
    await render(<BookingResultForm booking={booking} venueName="Arena" onSubmitted={done} />);
    await fireEvent.changeText(screen.getByLabelText('Your goals'), '3');
    await fireEvent.changeText(screen.getByLabelText('Their goals'), '1');
    await fireEvent.press(screen.getByRole('button', { name: 'Log result' }));
    await waitFor(() => expect(mockLogResult).toHaveBeenCalledWith({ bookingId: 'b1', goalsFor: 3, goalsAgainst: 1 }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('b1'));
    expect(done).toHaveBeenCalledTimes(2);
  });

  it('BookingResultForm keeps Log result off until both scores are in', async () => {
    await render(<BookingResultForm booking={booking} venueName="Arena" onSubmitted={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Your goals'), '3');
    await fireEvent.press(screen.getByRole('button', { name: 'Log result' }));
    expect(mockLogResult).not.toHaveBeenCalled();
  });

  it('FixtureScoreForm submits the same score', async () => {
    mockSubmitScore.mockResolvedValue({ error: null });
    const done = jest.fn();
    await render(<FixtureScoreForm fixture={fixture()} onSubmitted={done} />);
    await fireEvent.changeText(screen.getByLabelText('Tigers score'), '2');
    await fireEvent.changeText(screen.getByLabelText('Lions score'), '2');
    await fireEvent.press(screen.getByRole('button', { name: 'Log score' }));
    await waitFor(() => expect(mockSubmitScore).toHaveBeenCalledWith('f1', 2, 2));
    expect(done).toHaveBeenCalled();
  });
});

describe('Matchmaking', () => {
  it.each([
    ['loading', { status: 'loading' }, []],
    ['not a captain', { status: 'ready', fixtures: [] }, []],
    ['nothing to schedule', { status: 'ready', fixtures: [] }, ['home']],
  ])('%s', async (_, state, captainOf) => {
    mockFixtures = state;
    mockCaptainOf = new Set(captainOf as string[]);
    const view = await render(<MatchmakingScreen />);
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('populated: a row shows their proposal and opens the wizard', async () => {
    mockCaptainOf = new Set(['home']);
    mockFixtures = { status: 'ready', fixtures: [fixture({ status: 'proposed' })] };
    mockProposals.mockResolvedValue({
      data: [{ id: 'p1', fixture_id: 'f1', proposed_by_team_id: 'away', venue_id: 'v1', proposed_day: '2026-11-20', proposed_time: '20:00:00', created_at: '', venue: { id: 'v1', name: 'Arena', city: 'Nicosia' } }],
    });
    await render(<MatchmakingScreen />);
    await screen.findByText('They proposed 2026-11-20 at 20:00');
    expect(mockProposals).toHaveBeenCalledWith('f1');
    await fireEvent.press(screen.getByRole('button', { name: 'vs Lions. Schedule' }));
    expect(screen.getByTestId('wizard')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agree to this instead' })).toBeTruthy();
  });
});
