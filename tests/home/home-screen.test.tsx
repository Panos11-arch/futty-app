import '../navigation/mocks';

import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import HomeScreen from '@/app/(tabs)/index';
import { UPCOMING_SHOWN } from '@/components/home/upcoming-matches';
import type { MatchCard } from '@/lib/find-match';
import type { FeaturedEventState } from '@/lib/use-featured-event';
import { type Owed, type OwedDebt, type OwedPayment, paymentSentence } from '@/lib/use-owed';

type HookState = { status: string; [key: string]: unknown };
const mockReloads = {
  bookings: jest.fn(),
  unscored: jest.fn(),
  venues: jest.fn(),
  friendly: jest.fn(),
  fixtures: jest.fn(),
};
let mockBookings: HookState;
let mockVenues: HookState;
// S3: Games needing players come from Find a match (find_matches), the
// featured event from lib/use-featured-event.ts.
let mockGames: MatchCard[] = [];
let mockFeatured: FeaturedEventState = { status: 'ready', event: null };
let mockUnscored: { id: string; venue_id: string; booking_day: string; start_time: string }[] = [];
let mockFriendlies: Record<string, unknown>[] = [];
let mockLinks: { bookings: Map<string, string>; friendlies: Map<string, string> } = { bookings: new Map(), friendlies: new Map() };
let mockOpenMatches: unknown[] = [];
let mockFixtureLinks = new Map<string, string>();
let mockUnscoredStatus: 'ready' | 'loading' | 'error' = 'ready';
let mockOpenStatus: 'ready' | 'error' = 'ready';
let mockLinksStatus: 'ready' | 'error' = 'ready';
const mockReloadOpen = jest.fn();
// Levels like Playtomic: Home's "Check the score" cards (get_my_scores_to_check).
let mockScoresToCheck: unknown[] = [];
let mockCheckStatus: 'ready' | 'error' = 'ready';
const mockReloadCheck = jest.fn();
const mockReloadLinks = jest.fn();
/** Every candidate list Home passed to useMatchLinks, in render order. */
let mockLinkCandidates: { bookingIds?: string[] }[] = [];
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
jest.mock('@/lib/find-match', () => ({
  ...jest.requireActual('@/lib/find-match'),
  fetchMatches: () => Promise.resolve(mockGames),
}));
jest.mock('@/lib/use-featured-event', () => ({ useFeaturedEvent: () => ({ ...mockFeatured, reload: jest.fn() }) }));
jest.mock('@/lib/use-friendly-matches', () => ({
  useMyFriendlyMatches: () => ({ status: 'ready', matches: mockFriendlies, reload: mockReloads.friendly }),
}));
jest.mock('@/lib/use-fixtures', () => ({
  useMyFixtures: () => ({ status: 'ready', fixtures: [], reload: mockReloads.fixtures }),
  useMyCaptainTeamIds: () => [],
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
  useMyScoresToCheck: () =>
    mockCheckStatus === 'ready'
      ? { status: 'ready', scores: mockScoresToCheck, reload: mockReloadCheck }
      : { status: 'error', message: 'boom', reload: mockReloadCheck },
}));
jest.mock('@/lib/match/score-check-api', () => ({ respondToMatchScore: jest.fn() }));
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
const game: MatchCard = {
  post_id: 'p1',
  kind: 'players',
  // 17:30 UTC on 14 Nov is 19:30 in Cyprus (UTC+2 in winter).
  scheduled_at: '2026-11-14T17:30:00.000Z',
  format: '5-a-side',
  venue_id: 'v1',
  venue_name: 'English School',
  venue_city: 'Nicosia',
  organiser_id: 'u1',
  organiser_name: 'Maria',
  team_id: null,
  team_name: null,
  players_in: 8,
  capacity: 10,
  level_min: null,
  level_max: null,
  people: [],
  day: '2026-11-14',
  time: '19:30',
  priceCents: 680,
  v2: true,
  mine: false,
};
const owedPayment: OwedPayment = {
  kind: 'payment_due',
  booking_id: 'b1',
  share_id: null,
  venue_name: 'English School',
  booking_day: '2026-11-20',
  start_time: '19:00:00',
  amount_cents: 680,
};

/** The rendered tree as text, for order checks (the refresh control's props point back into React). */
function treeText() {
  return JSON.stringify(screen.toJSON(), (key, value) => (key === 'refreshControl' ? undefined : value));
}

describe('Home (S3, image 01)', () => {
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
    mockGames = [];
    mockFeatured = { status: 'ready', event: null };
    mockOwedState = { status: 'ready', data: nothingOwed };
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

  it('greets, then the four quick actions', async () => {
    await render(<HomeScreen />);
    expect(screen.getByTestId('home-greeting')).toHaveTextContent('Ready for your next game?');
    expect(['tab-book', 'home-action-find-match', 'home-action-leagues', 'home-action-event'].map((id) => screen.getByTestId(id).props.accessibilityLabel)).toEqual([
      'Book a pitch',
      'Find a match',
      'Leagues',
      'Join an event',
    ]);
  });

  it('nothing booked, no game, no event: only the greeting, the actions and the banner', async () => {
    await render(<HomeScreen />);
    for (const title of ['Upcoming matches', 'Games needing players', 'Featured event', 'Log the score', 'Check the score']) {
      expect(screen.queryByText(title)).toBeNull();
    }
    expect(screen.queryByText('No games booked')).toBeNull();
    expect(screen.getByTestId('home-banner')).toBeTruthy();
  });

  it('never shows a weather card, a venues row or Futty Games', async () => {
    await render(<HomeScreen />);
    expect(screen.queryByText('Venues')).toBeNull();
    expect(screen.queryByText('Futty Games')).toBeNull();
    expect(screen.queryByTestId('next-game-weather')).toBeNull();
  });

  it('shows skeletons while the upcoming matches load', async () => {
    mockBookings = { status: 'loading' };
    await render(<HomeScreen />);
    expect(screen.getByTestId('next-game-skeleton')).toBeTruthy();
  });

  it('shows the next games in Cyprus time; a card opens its booking', async () => {
    mockBookings = { status: 'ready', bookings: [booking, { ...booking, id: 'b2', booking_day: '2026-11-15' }] };
    await render(<HomeScreen />);
    expect(screen.getByText('Upcoming matches')).toBeTruthy();
    expect(screen.getByText('Sat 14 Nov · 19:00–20:00')).toBeTruthy();
    expect(screen.getByText('Sun 15 Nov · 19:00–20:00')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-upcoming-b1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } });
  });

  it(`shows at most ${UPCOMING_SHOWN}; See all opens My bookings`, async () => {
    const many = ['b1', 'b2', 'b3', 'b4'].map((id, i) => ({ ...booking, id, booking_day: `2026-11-${14 + i}` }));
    mockBookings = { status: 'ready', bookings: many };
    await render(<HomeScreen />);
    expect(screen.queryByTestId('home-upcoming-b4')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'See all' }));
    expect(router.push).toHaveBeenCalledWith('/my-bookings');
  });

  it('no See all when every booking is shown', async () => {
    mockBookings = { status: 'ready', bookings: [booking] };
    await render(<HomeScreen />);
    expect(screen.queryByRole('button', { name: 'See all' })).toBeNull();
  });

  it('shows an inline error with retry when bookings fail to load', async () => {
    mockBookings = { status: 'error', message: 'offline' };
    await render(<HomeScreen />);
    expect(screen.getByText('Could not load your bookings.')).toBeTruthy();
    mockReloads.bookings.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReloads.bookings).toHaveBeenCalled();
  });

  it('shows games needing players and the featured event when there are some', async () => {
    mockGames = [game];
    mockFeatured = {
      status: 'ready',
      event: { id: 'l1', kind: 'league', name: 'Limassol League', format: '5-a-side', startDate: '2026-12-05' },
    };
    await render(<HomeScreen />);
    expect(await screen.findByText('Games needing players')).toBeTruthy();
    expect(screen.getByTestId('home-game-p1')).toBeTruthy();
    expect(screen.getByText('Featured event')).toBeTruthy();
    expect(screen.getByTestId('home-featured-event')).toHaveTextContent(/Limassol League/);
  });

  // spec 15 section 0.6 order; the owed banner sits under the quick actions so
  // money owed always shows (not in image 01).
  it('keeps the agreed order', async () => {
    mockBookings = { status: 'ready', bookings: [booking] };
    mockOpenMatches = [toLog()];
    mockGames = [game];
    mockFeatured = {
      status: 'ready',
      event: { id: 'l1', kind: 'league', name: 'Limassol League', format: '5-a-side', startDate: '2026-12-05' },
    };
    mockOwedState = { status: 'ready', data: { ...nothingOwed, payments: [owedPayment] } };
    await render(<HomeScreen />);
    await screen.findByTestId('home-game-p1');
    const tree = treeText();
    const order = [
      '"home-greeting"',
      '"tab-book"',
      '"owed-banner"',
      '"home-log-score-section"',
      '"home-upcoming"',
      '"home-games-row"',
      '"home-featured-event"',
      '"home-banner"',
    ].map((id) => tree.indexOf(id));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    mockOpenMatches = [];
  });

  // A tap is lost when the button moves under the finger (Pressable cancels
  // the press). Nothing that loads may sit above the quick actions.
  it('the quick actions come first, above the owed banner and the loading next game', async () => {
    mockBookings = { status: 'loading' };
    mockOwedState = { status: 'ready', data: { ...nothingOwed, payments: [owedPayment] } };
    await render(<HomeScreen />);
    const tree = treeText();
    const quick = tree.indexOf('"Book a pitch"');
    expect(quick).toBeGreaterThan(-1);
    expect(quick).toBeLessThan(tree.indexOf('"owed-banner"'));
    expect(tree.indexOf('"owed-banner"')).toBeLessThan(tree.indexOf('"next-game-skeleton"'));
  });

  it('pull to refresh reloads the sections', async () => {
    mockBookings = { status: 'ready', bookings: [booking] };
    await render(<HomeScreen />);
    mockReloads.bookings.mockClear();
    mockReloadOwed.mockClear();
    mockReloadOpen.mockClear();
    const scroll = screen.getByTestId('home-scroll');
    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });
    expect(mockReloads.bookings).toHaveBeenCalled();
    expect(mockReloadOwed).toHaveBeenCalled();
    expect(mockReloadOpen).toHaveBeenCalled();
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
    expect(screen.getByTestId('home-greeting')).toBeTruthy();
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
    // Each render calls useMatchLinks once, from the Log the score section.
    const logScoreCalls = mockLinkCandidates;
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

describe('Home "Check the score" (levels like Playtomic, Panos 25 November)', () => {
  const card = {
    matchId: 'm9',
    kickoffAt: '2026-11-14T17:00:00.000Z',
    labelA: 'Bibs',
    labelB: 'Non-bibs',
    sideAScore: 2,
    sideBScore: 1,
    // Far ahead, so the card is still open whenever the test runs.
    checkUntil: '2999-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockBookings = { status: 'ready', bookings: [] };
    mockVenues = { status: 'ready', venues: [venue] };
    mockOpenMatches = [];
    mockScoresToCheck = [];
    mockCheckStatus = 'ready';
  });

  it('a score to check shows with Accept and Reject', async () => {
    mockScoresToCheck = [card];
    await render(<HomeScreen />);
    expect(screen.getByTestId('check-score-card-m9')).toHaveTextContent(/Bibs 2–1 Non-bibs/);
    expect(screen.getByTestId('check-score-accept-m9')).toBeTruthy();
    expect(screen.getByTestId('check-score-reject-m9')).toBeTruthy();
  });

  it("nothing to check (the booker's side, or already answered): no section", async () => {
    await render(<HomeScreen />);
    expect(screen.queryByText('Check the score')).toBeNull();
  });

  it('a failed load says so, with Try again', async () => {
    mockCheckStatus = 'error';
    await render(<HomeScreen />);
    expect(screen.getByText('Could not load the scores to check.')).toBeTruthy();
  });
});

const homeComponents = fs
  .readdirSync(path.join(__dirname, '..', '..', 'components', 'home'))
  .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
  .map((name) => `components/home/${name}`);

describe.each(['app/(tabs)/index.tsx', 'components/booking/next-game-card.tsx', ...homeComponents])('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

  it('has no hex colour', () => expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull());
  it('has no emoji', () => expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull());
  it('has no deprecated theme names', () => expect(text.match(/FuttyColors|FuttyFonts/g)).toBeNull());
});
