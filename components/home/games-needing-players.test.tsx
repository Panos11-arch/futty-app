import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { GamesNeedingPlayers, gamesNeedingPlayers, GAMES_SHOWN, spotsLeftText } from '@/components/home/games-needing-players';
import type { MatchCard } from '@/lib/find-match';

const mockFetch = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/find-match', () => ({
  ...jest.requireActual('@/lib/find-match'),
  fetchMatches: (...args: unknown[]) => mockFetch(...args),
}));

const card = (over: Partial<MatchCard> = {}): MatchCard => ({
  post_id: 'p1',
  kind: 'players',
  // 17:00 UTC on 27 Nov is 19:00 in Cyprus.
  scheduled_at: '2026-11-27T17:00:00.000Z',
  format: '7-a-side',
  venue_id: 'v1',
  venue_name: 'Nuevo Campo',
  venue_city: 'Limassol',
  organiser_id: 'u1',
  organiser_name: 'Maria',
  team_id: null,
  team_name: null,
  players_in: 12,
  capacity: 14,
  level_min: null,
  level_max: null,
  people: [],
  booking_id: null,
  day: '2026-11-27',
  time: '19:00',
  priceCents: 680,
  v2: true,
  mine: false,
  ...over,
});

describe('gamesNeedingPlayers', () => {
  it('keeps players games with a spot left, soonest first', () => {
    const full = card({ post_id: 'full', players_in: 14 });
    const opposition = card({ post_id: 'opp', kind: 'opposition', players_in: null, capacity: null });
    const later = card({ post_id: 'later', scheduled_at: '2026-11-29T17:00:00.000Z' });
    const sooner = card({ post_id: 'sooner', scheduled_at: '2026-11-27T16:00:00.000Z' });
    expect(gamesNeedingPlayers([later, full, opposition, sooner]).map((c) => c.post_id)).toEqual(['sooner', 'later']);
  });

  it(`holds at most ${GAMES_SHOWN}`, () => {
    const many = Array.from({ length: GAMES_SHOWN + 3 }, (_, i) => card({ post_id: `p${i}` }));
    expect(gamesNeedingPlayers(many)).toHaveLength(GAMES_SHOWN);
  });

  it('spotsLeftText counts the free places', () => {
    expect(spotsLeftText({ players_in: 9, capacity: 10 })).toBe('1 spot');
    expect(spotsLeftText({ players_in: 8, capacity: 10 })).toBe('2 spots');
  });
});

describe('Home "Games needing players" (image 01)', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });
  beforeEach(() => {
    mockFetch.mockReset();
    jest.mocked(router.push).mockClear();
  });

  it('shows a skeleton while loading', async () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    expect(screen.getByTestId('home-games-skeleton')).toBeTruthy();
  });

  it('asks Find a match for every open game (no filters)', async () => {
    mockFetch.mockResolvedValue([]);
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    expect(mockFetch).toHaveBeenCalledWith(jest.requireActual('@/lib/find-match').emptyFilters());
  });

  it('nothing needs players: the section is hidden', async () => {
    mockFetch.mockResolvedValue([card({ players_in: 14 })]);
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    await waitFor(() => expect(screen.queryByTestId('home-games-skeleton')).toBeNull());
    expect(screen.queryByText('Games needing players')).toBeNull();
  });

  it('a card: Cyprus time, format and town, spots left, the server price as it is', async () => {
    mockFetch.mockResolvedValue([card()]);
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    const game = await screen.findByTestId('home-game-p1');
    expect(game).toHaveTextContent(/Fri 27 Nov · 19:00/);
    expect(game).toHaveTextContent(/7-a-side · Limassol/);
    expect(game).toHaveTextContent(/2 spots/);
    expect(game).toHaveTextContent(/€6\.80 per player/);
  });

  it('a game whose joiner pays nothing says so; one with no price shows none', async () => {
    mockFetch.mockResolvedValue([card({ post_id: 'free', priceCents: 0 }), card({ post_id: 'none', priceCents: null })]);
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    expect(await screen.findByTestId('home-game-free')).toHaveTextContent(/Paid by the captain/);
    expect(screen.getByTestId('home-game-none')).not.toHaveTextContent(/€/);
  });

  it('a card opens the same screen Find a match opens', async () => {
    mockFetch.mockResolvedValue([card()]);
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    await fireEvent.press(await screen.findByTestId('home-game-p1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/join-squad-post', params: { postId: 'p1' } });
  });

  it('See all opens Find a match', async () => {
    mockFetch.mockResolvedValue([card()]);
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'See all' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/squads', params: { view: 'players' } });
  });

  it('an error says so in one line, and Try again loads again', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Couldn’t load games. Try again.'));
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    expect(await screen.findByText('Could not load games needing players.')).toBeTruthy();
    mockFetch.mockResolvedValue([card()]);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('home-game-p1')).toBeTruthy();
  });

  it('pull to refresh loads again', async () => {
    mockFetch.mockResolvedValue([]);
    await render(<GamesNeedingPlayers refreshSignal={0} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await screen.rerender(<GamesNeedingPlayers refreshSignal={1} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});
