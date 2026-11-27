// S6 Find a match (app/squads.tsx): the filters kept on the phone, the
// server's games for them, and where each tap goes.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import FindMatchScreen from '@/app/squads';
import type { MatchCard, MatchFilters } from '@/lib/find-match';
import { takeStartMatch } from '@/lib/start-match';

const mockPush = jest.fn();
const mockFetchMatches = jest.fn();
const mockSaveFilters = jest.fn();
let mockSaved: MatchFilters | null = null;

jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));
jest.mock('@/lib/use-venues', () => ({ useVenues: () => ({ status: 'ready', venues: [] }) }));
jest.mock('@/lib/saved-searches', () => ({ fetchSearchPlaces: () => Promise.resolve([{ city: 'Limassol' }]) }));
jest.mock('@/lib/booking-search', () => ({
  ...jest.requireActual('@/lib/booking-search'),
  fetchSearchOptions: () => Promise.resolve({ today: '2026-11-24', window_days: 7, is_premium: false, six_on_five_available: false }),
  loadRecentPlaces: () => Promise.resolve([]),
  saveRecentPlace: () => Promise.resolve([]),
  requestVenue: jest.fn(),
}));
jest.mock('@/lib/find-match', () => ({
  ...jest.requireActual('@/lib/find-match'),
  fetchMatches: (...a: unknown[]) => mockFetchMatches(...a),
  loadMatchFilters: () => Promise.resolve(mockSaved),
  saveMatchFilters: (...a: unknown[]) => mockSaveFilters(...a),
}));

const filters: MatchFilters = {
  format: '5-a-side',
  place: { kind: 'town', town: 'Limassol' },
  days: ['2026-11-20', '2026-11-27'],
  window: { preset: 'all_day', from: '00:00', to: '24:00' },
};

function card(over: Partial<MatchCard> = {}): MatchCard {
  return {
    post_id: 'p1',
    kind: 'players',
    scheduled_at: '2026-11-27T17:00:00Z',
    format: '5-a-side',
    venue_id: 'v1',
    venue_name: 'Kamares',
    venue_city: 'Limassol',
    organiser_id: 'u1',
    organiser_name: 'Maria',
    team_id: null,
    team_name: null,
    players_in: 8,
    capacity: 10,
    level_min: '5.00',
    level_max: '7.00',
    people: [{ id: 'u1', name: 'Maria' }],
    booking_id: null,
    day: '2026-11-27',
    time: '19:00',
    priceCents: 680,
    v2: true,
    mine: false,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSaved = null;
  takeStartMatch();
});

describe('Find a match screen', () => {
  it('with no filters kept: "No filters yet", and no games are loaded', async () => {
    await render(<FindMatchScreen />);
    await waitFor(() => expect(screen.getByText('No filters yet')).toBeTruthy());
    expect(mockFetchMatches).not.toHaveBeenCalled();
  });

  it('loads the games for the kept filters, without days already gone, grouped by day', async () => {
    mockSaved = filters;
    mockFetchMatches.mockResolvedValue([card()]);
    await render(<FindMatchScreen />);
    await waitFor(() => expect(screen.getByText('FRIDAY 27 NOV')).toBeTruthy());
    expect(mockFetchMatches).toHaveBeenCalledWith({ ...filters, days: ['2026-11-27'] });
    expect(screen.getByText('€6.80 per player')).toBeTruthy();
  });

  it('a card opens the B4 join screen; the organiser opens their profile', async () => {
    mockSaved = filters;
    mockFetchMatches.mockResolvedValue([card(), card({ post_id: 'p2', kind: 'opposition', team_id: 't1', team_name: 'Lions' })]);
    await render(<FindMatchScreen />);
    await waitFor(() => expect(screen.getByTestId('find-match-card-p1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('find-match-card-p1'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/join-squad-post', params: { postId: 'p1' } });
    await fireEvent.press(screen.getByTestId('find-match-card-p2'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/opposition-invite', params: { postId: 'p2' } });
    await fireEvent.press(screen.getByTestId('find-match-organiser-p1'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/player-profile', params: { profileId: 'u1' } });
    await fireEvent.press(screen.getByTestId('find-match-organiser-p2'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/team-profile', params: { teamId: 't1' } });
  });

  // Bug 27 Nov (Panos): my own card opened the posts list, which never shows it.
  it('my own card opens its booking; anyone else’s still opens Join', async () => {
    mockSaved = filters;
    mockFetchMatches.mockResolvedValue([card(), card({ post_id: 'p2', mine: true, booking_id: 'b9' })]);
    await render(<FindMatchScreen />);
    await waitFor(() => expect(screen.getByTestId('find-match-card-p2')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('find-match-card-p2'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/booking/[id]', params: { id: 'b9' } });
    await fireEvent.press(screen.getByTestId('find-match-card-p1'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/join-squad-post', params: { postId: 'p1' } });
  });

  it('a failed load shows one line and "Try again" loads again', async () => {
    mockSaved = filters;
    mockFetchMatches.mockRejectedValueOnce(new Error('Couldn’t load games. Try again.')).mockResolvedValue([]);
    await render(<FindMatchScreen />);
    await waitFor(() => expect(screen.getByText('Couldn’t load games. Try again.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('No open games')).toBeTruthy());
  });

  it('setting filters keeps them on the phone and loads the games', async () => {
    mockFetchMatches.mockResolvedValue([]);
    await render(<FindMatchScreen />);
    await waitFor(() => expect(screen.getByTestId('find-match-set-filters')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('find-match-set-filters'));
    await fireEvent.press(screen.getByTestId('find-match-format-7-a-side'));
    await fireEvent.press(screen.getByTestId('find-match-filter-next-format'));
    await fireEvent.press(screen.getByTestId('find-match-filter-next-places'));
    await fireEvent.press(screen.getByTestId('find-match-filter-next-days'));
    await fireEvent.press(screen.getByTestId('find-match-filter-see-results'));
    const chosen = { format: '7-a-side', place: { kind: 'all' }, days: [], window: { preset: 'all_day', from: '00:00', to: '24:00' } };
    expect(mockSaveFilters).toHaveBeenCalledWith(chosen);
    await waitFor(() => expect(mockFetchMatches).toHaveBeenCalledWith(chosen));
  });

  it('"Start a match" opens Book a pitch from Start a match', async () => {
    await render(<FindMatchScreen />);
    await fireEvent.press(screen.getByTestId('find-match-start'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/book', params: { startMatch: '1' } });
  });
});
