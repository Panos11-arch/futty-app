import '../navigation/mocks';

import fs from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import HomeScreen from '@/app/(tabs)/index';
import { mockResultMatch } from '@/lib/match/mock';

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
  useMyUnscoredBookings: () => ({ status: 'ready', bookings: mockUnscored, reload: mockReloads.unscored }),
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
  useRecentResults: () => ({ status: 'ready', results: [], reload: mockReloads.results }),
}));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/components/booking-result-form', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BookingResultForm: ({ booking }: { booking: { id: string } }) => <Text>{`old booking form ${booking.id}`}</Text> };
});
jest.mock('@/components/match/result-panel', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    MatchResultPanel: ({ match }: { match: { match: { id: string } } }) => <Text>{`new result panel ${match.match.id}`}</Text>,
  };
});
jest.mock('@/lib/match/use-match-result', () => ({
  useOpenResultMatches: () => ({ status: 'ready', matches: mockOpenMatches, viewerId: 'booker', reload: jest.fn() }),
  useMatchLinks: () => ({
    status: 'ready',
    links: { byBookingId: mockLinks.bookings, byFriendlyMatchId: mockLinks.friendlies, byLeagueFixtureId: new Map() },
    reload: jest.fn(),
  }),
}));
jest.mock('@/components/fixture-score-form', () => ({ FixtureScoreForm: () => null }));

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

  it('keeps the header', async () => {
    await render(<HomeScreen />);
    expect(screen.getByRole('header', { name: 'Home' })).toBeTruthy();
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

  it('shows nothing in the owed slot by default', async () => {
    await render(<HomeScreen />);
    expect(screen.queryByTestId('owed-banner')).toBeNull();
  });

  it('shows the owed banner at the top when one is passed in', async () => {
    const onPay = jest.fn();
    await render(
      <HomeScreen
        owedBanner={{ tone: 'danger', title: 'You owe €6.80', message: 'For Nuevo Campo.', action: { label: 'Pay what I owe', onPress: onPay } }}
      />,
    );
    expect(screen.getByTestId('owed-banner')).toBeTruthy();
    expect(screen.getByText('You owe €6.80')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay what I owe' }));
    expect(onPay).toHaveBeenCalled();
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
});

describe('Home score logging: new matches use A2, old ones the old form', () => {
  const pastBooking = (id: string) => ({ id, venue_id: 'v1', booking_day: '2026-11-01', start_time: '19:00:00' });

  beforeEach(() => {
    mockBookings = { status: 'ready', bookings: [] };
    mockVenues = { status: 'ready', venues: [venue] };
    mockPosts = { status: 'ready', posts: [] };
    mockUnscored = [];
    mockFriendlies = [];
    mockLinks = { bookings: new Map(), friendlies: new Map() };
    mockOpenMatches = [];
  });

  afterAll(() => {
    mockUnscored = [];
    mockFriendlies = [];
    mockOpenMatches = [];
  });

  it('a booking recorded before A2 keeps the old form', async () => {
    mockUnscored = [pastBooking('old')];
    await render(<HomeScreen />);
    expect(screen.getByText('old booking form old')).toBeTruthy();
  });

  it('a booking with a match shows the result panel, never the old form', async () => {
    mockUnscored = [pastBooking('new'), pastBooking('old')];
    mockLinks.bookings.set('new', 'm1');
    mockOpenMatches = [mockResultMatch()];
    await render(<HomeScreen />);
    expect(screen.getByText('new result panel m1')).toBeTruthy();
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

  it('a non-captain with nothing to do sees no panel on Home', async () => {
    mockOpenMatches = [mockResultMatch({ mySide: 'a', sideACaptain: 'someone-else' })];
    await render(<HomeScreen />);
    expect(screen.queryByText(/new result panel/)).toBeNull();
  });

  it('the other side sees the panel to answer', async () => {
    mockOpenMatches = [mockResultMatch({ submission: { submitted_by: 'x' }, mySide: 'b', sideACaptain: 'x' })];
    await render(<HomeScreen />);
    expect(screen.getByText('new result panel m1')).toBeTruthy();
  });
});

describe.each(['app/(tabs)/index.tsx', 'components/booking/next-game-card.tsx'])('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

  it('has no hex colour', () => expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull());
  it('has no emoji', () => expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull());
  it('has no deprecated theme names', () => expect(text.match(/FuttyColors|FuttyFonts/g)).toBeNull());
});
