// S8 Profile tab (image 19; spec 15): the dark top, This season, Recent
// games and My teams, in that order. The shared header is hidden on this
// tab; My card opens the player card; Share follows the card's show_qr.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Share } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';

let mockProfile: Record<string, unknown>;
const mockProfileReload = jest.fn();
const mockSetOptions = jest.fn();
let mockCard: unknown;
let mockSeasonFormats: (string | null)[] = [];
const mockReloads = {
  summary: jest.fn(),
  level: jest.fn(),
  season: jest.fn(),
  recent: jest.fn(),
  teams: jest.fn(),
  teammates: jest.fn(),
  venues: jest.fn(),
};
let mockTeammates: Record<string, unknown>;
let mockVenues: Record<string, unknown>;

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me', email: 'ann@example.com' } }) }));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ ...mockProfile, reload: mockProfileReload }) }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useNavigation: () => ({ setOptions: mockSetOptions }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/components/navigation/my-card-sheet', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    MyCardSheet: ({ visible, onClose }: { visible: boolean; onClose: () => void }) =>
      visible ? (
        <Pressable testID="my-card-sheet" onPress={onClose}>
          <Text>card</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock('@/lib/player-card', () => ({
  cardLink: (u: string) => `https://futty.app/p/${u}`,
  fetchMyPlayerCard: () => Promise.resolve(mockCard),
}));
jest.mock('@/lib/match/use-levels', () => ({
  STARTING_LEVEL_ROUTE: '/starting-level',
  usePlayerLevel: () => ({
    status: 'ready',
    level: { level: 6.4, provisional: false, reliabilityPct: 60, competitiveMatches: 12, source: 'questionnaire' },
    reload: mockReloads.level,
  }),
}));
jest.mock('@/lib/match/use-profile-summary', () => ({
  useMyProfileSummary: () => ({
    status: 'ready',
    summary: { followers: 128, following: 96, level: 6.4, provisional: false, levelChangeMonth: 0.2 },
    reload: mockReloads.summary,
  }),
  useMyProfileSeason: (_: string, format: string | null) => {
    mockSeasonFormats.push(format);
    return {
      status: 'ready',
      season: { formats: ['5-a-side', '7-a-side'], games: 24, wins: 14, goals: 19, assists: 11, motm: 4, avgRating: 7.3, totw: 3, showedUpPct: 92 },
      reload: mockReloads.season,
    };
  },
  useMyProfileRecent: () => ({
    status: 'ready',
    games: [
      {
        match_id: 'm1',
        kickoff_at: '2026-11-22T17:00:00Z',
        venue_id: null,
        venue_name: 'Nuevo Campo',
        format: '5-a-side',
        label: 'Bibs',
        opponent_label: 'Non-bibs',
        team_id: null,
        opponent_team_id: null,
        goals_for: 4,
        goals_against: 1,
        result: 'W',
        goals: 2,
        assists: 1,
        rating: 8.9,
      },
    ],
    reload: mockReloads.recent,
  }),
  useMyVenues: () => ({ ...mockVenues, reload: mockReloads.venues }),
}));
jest.mock('@/lib/match/use-profile-matches', () => ({
  useMyTeammates: () => ({ ...mockTeammates, reload: mockReloads.teammates }),
}));
jest.mock('@/lib/use-my-teams', () => ({
  useMyTeams: () => ({
    status: 'ready',
    teams: [{ team: { id: 't1', name: 'Kato United', city: 'Limassol' }, role: 'captain' }],
    reload: mockReloads.teams,
  }),
}));

const profile = {
  id: 'me',
  full_name: 'Ann Lee',
  username: 'ann',
  city: 'Limassol',
  position: 'Midfielder',
  preferred_foot: 'Right',
  is_premium: false,
  role: 'player',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { status: 'ready', profile };
  mockCard = { status: 'ready', card: { username: 'ann', show_qr: true } };
  mockSeasonFormats = [];
  mockTeammates = {
    status: 'ready',
    teammates: [{ teammate_profile_id: 'p1', name: 'Nikos Mate', matches_together: 12, last_played_at: null, kit: null }],
  };
  mockVenues = {
    status: 'ready',
    venues: [{ venue_id: 'v1', name: 'Kamares Sports Centre', city: 'Larnaca', games: 9, last_played_at: null }],
  };
});

describe('Profile tab', () => {
  it('hides the shared header and shows image 19’s sections in order', async () => {
    await render(<ProfileScreen />);
    expect(mockSetOptions).toHaveBeenCalledWith({ headerShown: false });
    const order = ['profile-top', 'profile-season', 'profile-people', 'profile-recent', 'profile-teams'].map(
      (id) => screen.getByTestId(id),
    );
    expect(order).toHaveLength(5);
    // In tree order: the new rows sit under This season, above Recent games.
    expect(screen.getAllByTestId(/^profile-(top|season|people|recent|teams)$/).map((n) => n.props.testID)).toEqual([
      'profile-top',
      'profile-season',
      'profile-people',
      'profile-recent',
      'profile-teams',
    ]);
    expect(screen.getByText('Ann Lee')).toBeTruthy();
    expect(screen.getByText('128 followers · 96 following')).toBeTruthy();
    expect(screen.getByText('This season')).toBeTruthy();
    expect(screen.getByText('Recent games')).toBeTruthy();
    expect(screen.getByText('My teams')).toBeTruthy();
    // What moved to the Account menu is gone from here.
    for (const gone of ['My bookings', 'Payments', 'Help', 'Sign out', 'Go Premium', 'Venue dashboard']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByText('ann@example.com')).toBeNull();
    // No banner ad on your own profile (Panos, 26 November); Dream team is S21.
    expect(screen.queryByText(/Dream team/)).toBeNull();
    expect(screen.queryByText(/Banner ad/)).toBeNull();
    expect(screen.queryByTestId(/banner-ad|ad-banner/)).toBeNull();
  });

  it('People you play with most and Your venues sit under This season and open their lists', async () => {
    await render(<ProfileScreen />);
    expect(screen.getByText('People you play with most')).toBeTruthy();
    expect(screen.getByText('Nikos Mate · 12 games')).toBeTruthy();
    expect(screen.getByText('Your venues')).toBeTruthy();
    expect(screen.getByText('Kamares Sports Centre · 9 games')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-teammates'));
    expect(router.push).toHaveBeenCalledWith('/my-teammates');
    await fireEvent.press(screen.getByTestId('profile-venues'));
    expect(router.push).toHaveBeenCalledWith('/my-venues');
  });

  it('Showed up shows on This season', async () => {
    await render(<ProfileScreen />);
    expect(screen.getByTestId('profile-season-tile-showedUp')).toHaveTextContent('92%Showed up');
  });

  it('hides an empty row, and the card when both are empty or still loading', async () => {
    mockTeammates = { status: 'ready', teammates: [] };
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('profile-teammates')).toBeNull();
    expect(screen.getByTestId('profile-venues')).toBeTruthy();
    mockVenues = { status: 'loading' };
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('profile-people')).toBeNull();
  });

  it('a row whose list failed still opens it (the list has Try again)', async () => {
    mockVenues = { status: 'error', message: 'offline' };
    await render(<ProfileScreen />);
    expect(screen.getByTestId('profile-venues')).toBeTruthy();
    expect(screen.queryByText(/· \d+ games/)).toBeTruthy();
  });

  it('My card opens the player card and closes it', async () => {
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('my-card-sheet')).toBeNull();
    await fireEvent.press(screen.getByTestId('profile-my-card'));
    expect(screen.getByTestId('my-card-sheet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('my-card-sheet'));
    expect(screen.queryByTestId('my-card-sheet')).toBeNull();
  });

  it('Share sends the card link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await render(<ProfileScreen />);
    await fireEvent.press(await screen.findByTestId('profile-share'));
    expect(share).toHaveBeenCalledWith({ message: 'Play with me on Futty: @ann https://futty.app/p/ann' });
  });

  it('no Share for a minor (the card has no QR)', async () => {
    mockCard = { status: 'ready', card: { username: 'kid', show_qr: false } };
    await render(<ProfileScreen />);
    await act(async () => {});
    expect(screen.queryByTestId('profile-share')).toBeNull();
    expect(screen.getByTestId('profile-settings')).toBeTruthy();
  });

  it('no Share when the card fails to load', async () => {
    mockCard = { status: 'error' };
    await render(<ProfileScreen />);
    await act(async () => {});
    expect(screen.queryByTestId('profile-share')).toBeNull();
  });

  it('a picked format reloads This season for that format', async () => {
    await render(<ProfileScreen />);
    expect(mockSeasonFormats.at(-1)).toBeNull();
    await fireEvent.press(screen.getByTestId('profile-season-format'));
    await fireEvent.press(screen.getByTestId('profile-season-format-7-a-side'));
    expect(mockSeasonFormats.at(-1)).toBe('7-a-side');
  });

  it('coming back to the tab reloads everything', async () => {
    await render(<ProfileScreen />);
    expect(mockProfileReload).toHaveBeenCalled();
    for (const reload of Object.values(mockReloads)) expect(reload).toHaveBeenCalled();
  });

  it('loading shows the skeleton', async () => {
    mockProfile = { status: 'loading' };
    await render(<ProfileScreen />);
    expect(screen.getByTestId('profile-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('profile-top')).toBeNull();
  });

  it.each(['error', 'missing'])('%s: one line and Try again', async (status) => {
    mockProfile = { status, message: 'offline' };
    await render(<ProfileScreen />);
    expect(screen.getByText('Your profile couldn’t load.')).toBeTruthy();
    mockProfileReload.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockProfileReload).toHaveBeenCalledTimes(1);
  });

  it('Settings opens the Account menu', async () => {
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId('profile-settings'));
    expect(router.push).toHaveBeenCalledWith('/account');
  });
});
