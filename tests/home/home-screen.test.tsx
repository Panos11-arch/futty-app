import '../navigation/mocks';

import fs from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import HomeScreen from '@/app/(tabs)/index';
import type { RecentResult } from '@/lib/use-recent-results';
import { type Owed, type OwedDebt, type OwedPayment, paymentSentence } from '@/lib/use-owed';

type HookState = { status: string; [key: string]: unknown };
const mockReloads = {
  bookings: jest.fn(),
  unscored: jest.fn(),
  venues: jest.fn(),
  posts: jest.fn(),
  friendly: jest.fn(),
  fixtures: jest.fn(),
  results: jest.fn(),
};
let mockBookings: HookState;
let mockVenues: HookState;
let mockPosts: HookState;
let mockUnscored: { id: string; venue_id: string; booking_day: string; start_time: string }[] = [];
let mockFriendlies: Record<string, unknown>[] = [];
let mockLinks: { bookings: Map<string, string>; friendlies: Map<string, string> } = { bookings: new Map(), friendlies: new Map() };
let mockOpenMatches: unknown[] = [];
let mockFixtureLinks = new Map<string, string>();
let mockUnscoredStatus: 'ready' | 'loading' | 'error' = 'ready';
let mockOpenStatus: 'ready' | 'error' = 'ready';
let mockLinksStatus: 'ready' | 'error' = 'ready';
const mockReloadOpen = jest.fn();
const mockReloadLinks = jest.fn();
/** Every candidate list Home passed to useMatchLinks, in render order. */
let mockLinkCandidates: { bookingIds?: string[] }[] = [];
let mockRecent: RecentResult[] = [];
const nothingOwed: Owed = { blocked: false, debt_cents: 0, debts: [], payments: [] };
let mockOwedState: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Owed } = {
  status: 'ready',
  data: nothingOwed,
};
const mockReloadOwed = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/use-notifications', () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
jest.mock('@/lib/use-my-bookings', () => ({
  useMyBookings: () => ({ ...mockBookings, reload: mockReloads.bookings }),
  useMyUnscoredBookings: () =>
    mockUnscoredStatus === 'ready'
      ? { status: 'ready', bookings: mockUnscored, reload: mockReloads.unscored }
      : { status: mockUnscoredStatus, message: 'offline', reload: mockReloads.unscored },
}));
jest.mock('@/lib/use-venues', () => ({ useVenues: () => ({ ...mockVenues, cities: [], reload: mockReloads.venues }) }));
jest.mock('@/lib/use-squad-posts', () => ({ useSquadPosts: () => ({ ...mockPosts, reload: mockReloads.posts }) }));
jest.mock('@/lib/use-friendly-matches', () => ({
  useMyFriendlyMatches: () => ({ status: 'ready', matches: mockFriendlies, reload: mockReloads.friendly }),
}));
jest.mock('@/lib/use-fixtures', () => ({
  useMyFixtures: () => ({ status: 'ready', fixtures: [], reload: mockReloads.fixtures }),
  useMyCaptainTeamIds: () => [],
}));
jest.mock('@/lib/use-recent-results', () => ({
  useRecentResults: () => ({ status: 'ready', results: mockRecent, reload: mockReloads.results }),
}));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/components/booking-result-form', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BookingResultForm: ({ booking }: { booking: { id: string } }) => <Text>{`old booking form ${booking.id}`}</Text> };
});
// S13B: the games still waiting for the viewer's score come from the server (get_my_matches_to_log).
jest.mock('@/lib/match/use-match-log', () => ({
  useMyMatchesToLog: () =>
    mockOpenStatus === 'ready'
      ? { status: 'ready', matches: mockOpenMatches, reload: mockReloadOpen }
      : { status: 'error', message: 'boom', reload: mockReloadOpen },
}));
jest.mock('@/lib/match/use-match-result', () => ({
  useMatchLinks: (candidates: { bookingIds?: string[] }) => {
    mockLinkCandidates.push(candidates);
    return {
      status: mockLinksStatus,
      links: { byBookingId: mockLinks.bookings, byFriendlyMatchId: mockLinks.friendlies, byLeagueFixtureId: mockFixtureLinks },
      reload: mockReloadLinks,
    };
  },
}));
jest.mock('@/components/fixture-score-form', () => ({ FixtureScoreForm: () => null }));
// A7's team of the week has its own tests (components/match/team-of-the-week-home.test.tsx).
jest.mock('@/components/match/team-of-the-week-home', () => ({ TeamOfTheWeekHome: () => null }));
const mockStartingLevelOffer = jest.fn();
jest.mock('@/lib/match/use-levels', () => ({ useStartingLevelOffer: () => mockStartingLevelOffer() }));
// Only the hook is faked: the banner's words come from the real helpers.
jest.mock('@/lib/use-owed', () => ({
  ...jest.requireActual('@/lib/use-owed'),
  useOwed: () => ({ state: mockOwedState, reload: mockReloadOwed }),
}));

const booking = {
  id: 'b1',
  venue_id: 'v1',
  booking_day: '2026-11-14',
  start_time: '19:00:00',
  end_time: '20:00:00',
  pitches: 1,
  capacity: 10,
  format: '5-a-side',
};
const venue = {
  id: 'v1',
  name: 'Nuevo Campo',
  city: 'Nicosia',
  surface: null,
  base_pitches: 2,
  open_time: '09:00:00',
  close_time: '23:00:00',
  price_per_pitch_hour: null,
  is_live: true,
};
const post = {
  id: 'p1',
  venue_id: 'v1',
  // 17:30 UTC on 14 Nov is 19:30 in Cyprus (UTC+2 in winter).
  scheduled_at: '2026-11-14T17:30:00.000Z',
  format: '5-a-side',
  type: 'players',
  level: null,
  level_needed: 'Intermediate',
  position_needed: null,
  players_needed: 3,
  joined_count: 1,
  status: 'open',
  venue_name: 'English School',
  venue_city: 'Nicosia',
};

describe('Home', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  beforeEach(() => {
    mockBookings = { status: 'ready', bookings: [] };
    mockVenues = { status: 'ready', venues: [venue] };
    mockPosts = { status: 'ready', posts: [] };
    jest.mocked(router.push).mockClear();
    Object.values(mockReloads).forEach((fn) => fn.mockClear());
  });

  // S2: the tab layout draws the header (components/navigation/app-header.tsx),
  // so Home has no title of its own; its Book a pitch button carries tab-book.
  it('draws no header of its own, and Book a pitch carries tab-book', async () => {
    await render(<HomeScreen />);
    expect(screen.queryByRole('header', { name: 'Home' })).toBeNull();
    expect(screen.getByTestId('tab-book')).toBeTruthy();
  });

  it('has a testID for the Maestro tests (.maestro)', async () => {
    await render(<HomeScreen />);
    expect(screen.getByTestId('home-screen')).toBeTruthy();
  });

  it('offers the starting-level questions from Home (A5b)', async () => {
    mockStartingLevelOffer.mockClear();
    await render(<HomeScreen />);
    expect(mockStartingLevelOffer).toHaveBeenCalled();
  });

  it('shows skeletons while the next game loads', async () => {
    mockBookings = { status: 'loading' };
    await render(<HomeScreen />);
    expect(screen.getByTestId('next-game-skeleton')).toBeTruthy();
    expect(screen.queryByText('No games booked')).toBeNull();
  });

  it('shows an empty state with Book a pitch when nothing is booked', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('No games booked')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Book a pitch' })[0]);
    expect(router.push).toHaveBeenCalledWith('/book');
  });

  it('shows the next game in Cyprus time and opens My bookings', async () => {
    mockBookings = { status: 'ready', bookings: [booking] };
    await render(<HomeScreen />);
    expect(screen.getByText('Sat 14 Nov · 19:00–20:00')).toBeTruthy();
    expect(screen.queryByText('No games booked')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /Next game, Nuevo Campo/ }));
    expect(router.push).toHaveBeenCalledWith('/my-bookings');
  });

  it('lists the other upcoming bookings under the next game', async () => {
    mockBookings = {
      status: 'ready',
      bookings: [booking, { ...booking, id: 'b2', booking_day: '2026-11-15' }],
    };
    await render(<HomeScreen />);
    expect(screen.getByText('Also booked')).toBeTruthy();
    expect(screen.getByText('Sun 15 Nov · 19:00–20:00')).toBeTruthy();
  });

  it('shows an inline error with retry when bookings fail to load', async () => {
    mockBookings = { status: 'error', message: 'offline' };
    await render(<HomeScreen />);
    mockReloads.bookings.mockClear();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(mockReloads.bookings).toHaveBeenCalled();
  });

  it('has the two quick actions', async () => {
    mockBookings = { status: 'ready', bookings: [booking] };
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Book a pitch' }));
    expect(router.push).toHaveBeenCalledWith('/book');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Find a game' })[0]);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/squads', params: { view: 'players' } });
  });

  it('lists venues, opening Book', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Venues')).toBeTruthy();
    await fireEvent.press(screen.getByText('Nuevo Campo'));
    expect(router.push).toHaveBeenCalledWith('/book');
  });

  it('lists need players games with level and Cyprus time', async () => {
    mockPosts = { status: 'ready', posts: [post, { ...post, id: 'full', joined_count: 3 }] };
    await render(<HomeScreen />);
    expect(screen.getByText('English School')).toBeTruthy();
    expect(screen.getByText('Intermediate · Sat 14 Nov · 19:30')).toBeTruthy();
    expect(screen.getAllByText('English School')).toHaveLength(1);
    await fireEvent.press(screen.getByText('English School'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/join-squad-post', params: { postId: 'p1' } });
  });

  it('retries need players games inline', async () => {
    mockPosts = { status: 'error', message: 'offline' };
    await render(<HomeScreen />);
    expect(screen.getByText('Could not load games looking for players.')).toBeTruthy();
  });

  it('each Book a pitch opens /book exactly once per tap', async () => {
    await render(<HomeScreen />);
    const buttons = screen.getAllByRole('button', { name: 'Book a pitch' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      jest.mocked(router.push).mockClear();
      await fireEvent.press(button);
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith('/book');
    }
  });

  // A tap is lost when the button moves under the finger (Pressable cancels
  // the press). Nothing that loads may sit above the quick actions: they come
  // first, then the owed banner, then the next game.
  it('the quick actions come first, above the owed banner and the loading next game', async () => {
    mockBookings = { status: 'loading' };
    mockOwedState = { status: 'ready', data: { ...nothingOwed, payments: [{ kind: 'payment_due', booking_id: 'b1', share_id: null, venue_name: 'English School', booking_day: '2026-11-20', start_time: '19:00:00', amount_cents: 680 }] } };
    await render(<HomeScreen />);
    const tree = JSON.stringify(screen.toJSON());
    const quick = tree.indexOf('"Book a pitch"');
    expect(quick).toBeGreaterThan(-1);
    expect(quick).toBeLessThan(tree.indexOf('"owed-banner"'));
    expect(tree.indexOf('"owed-banner"')).toBeLessThan(tree.indexOf('"next-game-skeleton"'));
    mockOwedState = { status: 'ready', data: nothingOwed };
  });
});

describe('Home owed banner (contract 6)', () => {
  const debt = (over: Partial<OwedDebt> = {}): OwedDebt => ({
    debt_id: 'd1',
    owed_to: 'venue',
    venue_id: 'v1',
    venue_name: 'Nuevo Campo',
    booking_id: 'b1',
    amount_cents: 600,
    reason: 'cash_unpaid',
    created_at: '2026-11-14T20:00:00.000Z',
    ...over,
  });
  const payment = (over: Partial<OwedPayment> = {}): OwedPayment => ({
    kind: 'card_failed',
    booking_id: 'b1',
    share_id: null,
    venue_name: 'English School',
    booking_day: '2026-11-20',
    start_time: '19:00:00',
    amount_cents: 6000,
    ...over,
  });
  const owes = (data: Partial<Owed>) => {
    mockOwedState = { status: 'ready', data: { ...nothingOwed, ...data } };
  };

  beforeEach(() => {
    mockBookings = { status: 'ready', bookings: [] };
    // No venue rows, so a venue name on screen can only be the banner's.
    mockVenues = { status: 'ready', venues: [] };
    mockPosts = { status: 'ready', posts: [] };
    mockOwedState = { status: 'ready', data: nothingOwed };
    jest.mocked(router.push).mockClear();
  });

  afterAll(() => {
    mockOwedState = { status: 'ready', data: nothingOwed };
  });

  it('one debt: the server amount, to the cent, and its venue', async () => {
    owes({ blocked: true, debt_cents: 600, debts: [debt()] });
    await render(<HomeScreen />);
    expect(screen.getByTestId('owed-banner')).toBeTruthy();
    expect(screen.getByText('You owe €6.00. Pay it before booking.')).toBeTruthy();
    expect(screen.getByText('Nuevo Campo')).toBeTruthy();
  });

  it("several debts: the server's total, never a sum the app makes", async () => {
    // The items deliberately don't add up to debt_cents: Home must show the
    // server's total as it is.
    owes({
      blocked: true,
      debt_cents: 1360,
      debts: [debt({ amount_cents: 500 }), debt({ debt_id: 'd2', owed_to: 'futty', venue_id: null, venue_name: null, amount_cents: 700 })],
    });
    await render(<HomeScreen />);
    expect(screen.getByText('You owe €13.60. Pay it before booking.')).toBeTruthy();
    expect(screen.queryByText('€12.00', { exact: false })).toBeNull();
    // Owed to two places: no single venue to name.
    expect(screen.queryByText('Futty')).toBeNull();
  });

  it('several debts to the same venue name it once', async () => {
    owes({ blocked: true, debt_cents: 1360, debts: [debt({ amount_cents: 680 }), debt({ debt_id: 'd2', amount_cents: 680 })] });
    await render(<HomeScreen />);
    expect(screen.getByText('You owe €13.60. Pay it before booking.')).toBeTruthy();
    expect(screen.getAllByText('Nuevo Campo')).toHaveLength(1);
  });

  it('a failed guarantee hold: its sentence and venue, not the hold as money owed', async () => {
    owes({ payments: [payment()] });
    await render(<HomeScreen />);
    expect(screen.getByText(paymentSentence('card_failed'))).toBeTruthy();
    expect(screen.getByText('English School')).toBeTruthy();
    expect(screen.queryByText('€60.00', { exact: false })).toBeNull();
  });

  it('an unpaid spot shows its sentence', async () => {
    owes({ payments: [payment({ kind: 'payment_due', amount_cents: 680 })] });
    await render(<HomeScreen />);
    expect(screen.getByText(paymentSentence('payment_due'))).toBeTruthy();
  });

  it('unticked cash after the match shows its sentence', async () => {
    owes({ payments: [payment({ kind: 'cash_unpaid', share_id: 's1', amount_cents: 600 })] });
    await render(<HomeScreen />);
    expect(screen.getByText(paymentSentence('cash_unpaid'))).toBeTruthy();
  });

  it('nothing owed: no banner', async () => {
    await render(<HomeScreen />);
    expect(screen.queryByTestId('owed-banner')).toBeNull();
  });

  it('loading: no banner and no skeleton for it', async () => {
    mockOwedState = { status: 'loading' };
    await render(<HomeScreen />);
    expect(screen.queryByTestId('owed-banner')).toBeNull();
    expect(screen.queryByTestId('owed-banner-skeleton')).toBeNull();
  });

  it("error: no banner, and the rest of Home still shows", async () => {
    mockOwedState = { status: 'error', message: 'offline' };
    await render(<HomeScreen />);
    expect(screen.queryByTestId('owed-banner')).toBeNull();
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    expect(screen.getByText('No games booked')).toBeTruthy();
  });

  it('Pay what I owe opens the pay screen', async () => {
    owes({ blocked: true, debt_cents: 600, debts: [debt()] });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pay what I owe' }));
    expect(router.push).toHaveBeenCalledWith('/account/payments/owed');
  });
});

const toLog = (over: Record<string, unknown> = {}) => ({
  matchId: 'm1',
  kickoffAt: '2026-11-14T17:00:00.000Z',
  labelA: 'Bibs',
  labelB: 'Non-bibs',
  state: 'log',
  ...over,
});

describe('Home score logging: new matches are logged by their captain (S13B), old ones keep the old form', () => {
  const pastBooking = (id: string) => ({ id, venue_id: 'v1', booking_day: '2026-11-01', start_time: '19:00:00' });

  beforeEach(() => {
    mockBookings = { status: 'ready', bookings: [] };
    mockVenues = { status: 'ready', venues: [venue] };
    mockPosts = { status: 'ready', posts: [] };
    mockUnscored = [];
    mockFriendlies = [];
    mockLinks = { bookings: new Map(), friendlies: new Map() };
    mockOpenMatches = [];
    mockUnscoredStatus = 'ready';
    mockOpenStatus = 'ready';
    mockLinksStatus = 'ready';
    mockLinkCandidates = [];
    mockReloadOpen.mockClear();
    mockReloadLinks.mockClear();
  });

  afterAll(() => {
    mockUnscored = [];
    mockFriendlies = [];
    mockOpenMatches = [];
    mockUnscoredStatus = 'ready';
    mockOpenStatus = 'ready';
    mockLinksStatus = 'ready';
  });

  it('open results failing has its own words and retries only itself', async () => {
    mockOpenStatus = 'error';
    await render(<HomeScreen />);
    expect(screen.getByText('Could not load your games waiting for a score.')).toBeTruthy();
    expect(screen.queryByText('Could not check which games have a match record.')).toBeNull();
    // Home's focus effect reloads on mount; only the button counts here.
    mockReloadOpen.mockClear();
    mockReloadLinks.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReloadOpen).toHaveBeenCalled();
    expect(mockReloadLinks).not.toHaveBeenCalled();
  });

  it('match links failing has its own words and retries only itself', async () => {
    mockLinksStatus = 'error';
    await render(<HomeScreen />);
    expect(screen.getByText('Could not check which games have a match record.')).toBeTruthy();
    expect(screen.queryByText('Could not load your games waiting for a score.')).toBeNull();
    // Home's focus effect reloads on mount; only the button counts here.
    mockReloadOpen.mockClear();
    mockReloadLinks.mockClear();
    // LogScoreSection's Try again (the previous-game section has no error here).
    await fireEvent.press(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(mockReloadLinks).toHaveBeenCalled();
    expect(mockReloadOpen).not.toHaveBeenCalled();
  });

  it('both failing show both lines, each with Try again', async () => {
    mockOpenStatus = 'error';
    mockLinksStatus = 'error';
    await render(<HomeScreen />);
    expect(screen.getByText('Could not load your games waiting for a score.')).toBeTruthy();
    expect(screen.getAllByText('Could not check which games have a match record.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Could not load your matches.')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThanOrEqual(2);
  });

  // Every refocus reloads the past bookings, which go back to loading; the
  // match-link ids must not flip to [] and back (two extra requests and
  // re-renders on Home each time).
  it('past bookings reloading keeps the last match-link ids', async () => {
    mockUnscored = [pastBooking('a'), pastBooking('b')];
    await render(<HomeScreen />);
    mockUnscoredStatus = 'loading';
    mockLinkCandidates = [];
    await screen.rerender(<HomeScreen />);
    // Each render calls useMatchLinks twice: LogScoreSection, then the
    // previous-game section (no recent results here, so always []).
    const logScoreCalls = mockLinkCandidates.filter((_, i) => i % 2 === 0);
    expect(logScoreCalls.length).toBeGreaterThan(0);
    for (const c of logScoreCalls) expect(c.bookingIds).toEqual(['a', 'b']);
  });

  it('a booking recorded before A2 keeps the old form', async () => {
    mockUnscored = [pastBooking('old')];
    await render(<HomeScreen />);
    expect(screen.getByText('old booking form old')).toBeTruthy();
  });

  it('a booking with a match shows Log the score, never the old form', async () => {
    mockUnscored = [pastBooking('new'), pastBooking('old')];
    mockLinks.bookings.set('new', 'm1');
    mockOpenMatches = [toLog()];
    await render(<HomeScreen />);
    expect(screen.getByTestId('log-score-card-m1')).toHaveTextContent(/Log the score/);
    expect(screen.getByText('Bibs v Non-bibs · Sat 14 Nov · 19:00')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-log-score-m1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/after-game', params: { id: 'm1' } });
    expect(screen.queryByText('old booking form new')).toBeNull();
    expect(screen.getByText('old booking form old')).toBeTruthy();
  });

  it('a friendly with a match hides its old score form', async () => {
    mockFriendlies = [
      {
        id: 'f1',
        status: 'pending_score',
        home_team: { name: 'Home FC' },
        away_team: { name: 'Away FC' },
        post: { scheduled_at: '2026-11-01T17:00:00.000Z', venue_booking_id: null, venue: null },
      },
    ];
    await render(<HomeScreen />);
    expect(screen.getByText('Home FC vs Away FC')).toBeTruthy();

    mockLinks.friendlies.set('f1', 'm2');
    await render(<HomeScreen />);
    expect(screen.queryByText('Home FC vs Away FC')).toBeNull();
  });

  it('nothing to log (a player, or a score already logged): no card', async () => {
    mockOpenMatches = [];
    await render(<HomeScreen />);
    expect(screen.queryByText('Log the score')).toBeNull();
  });

  it("the captains' scores differ: the card says so", async () => {
    mockOpenMatches = [toLog({ state: 'mismatch' })];
    await render(<HomeScreen />);
    expect(screen.getByTestId('log-score-card-m1')).toHaveTextContent(/Scores differ/);
  });
});

describe('Home previous game: the post-match flow (A10, decision 1j)', () => {
  const recent = (over: Partial<RecentResult>): RecentResult => ({
    key: 'booking:b1',
    kind: 'booking',
    homeTeamName: 'You',
    awayTeamName: '',
    homeScore: 5,
    awayScore: 3,
    playedAt: '2026-11-14T17:00:00.000Z',
    ...over,
  });

  beforeEach(() => {
    mockBookings = { status: 'ready', bookings: [] };
    mockVenues = { status: 'ready', venues: [venue] };
    mockPosts = { status: 'ready', posts: [] };
    mockLinks = { bookings: new Map(), friendlies: new Map() };
    mockFixtureLinks = new Map();
    mockRecent = [];
    jest.mocked(router.push).mockClear();
  });

  afterAll(() => {
    mockRecent = [];
    mockLinks = { bookings: new Map(), friendlies: new Map() };
    mockFixtureLinks = new Map();
  });

  it('a game with a match offers "Add your stats", which opens the flow', async () => {
    mockRecent = [recent({ bookingId: 'b1' })];
    mockLinks.bookings.set('b1', 'm1');
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId('previous-game-stats-booking:b1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/after-game', params: { id: 'm1' } });
  });

  it('friendlies and league fixtures with a match offer it too', async () => {
    mockRecent = [
      recent({ key: 'friendly:f1', kind: 'friendly', homeTeamName: 'Home FC', awayTeamName: 'Away FC', friendlyMatchId: 'f1' }),
      recent({ key: 'league:l1', kind: 'league', homeTeamName: 'Lions', awayTeamName: 'Tigers', leagueFixtureId: 'l1' }),
    ];
    mockLinks.friendlies.set('f1', 'm2');
    mockFixtureLinks.set('l1', 'm3');
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId('previous-game-stats-friendly:f1'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/match/after-game', params: { id: 'm2' } });
    await fireEvent.press(screen.getByTestId('previous-game-stats-league:l1'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/match/after-game', params: { id: 'm3' } });
  });

  it('a game recorded before A2 (no match) has no "Add your stats"', async () => {
    mockRecent = [recent({ bookingId: 'old' })];
    await render(<HomeScreen />);
    expect(screen.getByText('You 5–3')).toBeTruthy();
    expect(screen.queryByText('Add your stats')).toBeNull();
  });
});

describe.each(['app/(tabs)/index.tsx', 'components/booking/next-game-card.tsx'])('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

  it('has no hex colour', () => expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull());
  it('has no emoji', () => expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull());
  it('has no deprecated theme names', () => expect(text.match(/FuttyColors|FuttyFonts/g)).toBeNull());
});
