import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PlayerProfileScreen from '@/app/player-profile';
import { testIdsInOrder } from '../ads/test-ids';

const mockGetPublicProfile = jest.fn();
let mockForm: Record<string, unknown>;
let mockRecent: Record<string, unknown>;
let mockTeammates: Record<string, unknown>;
const mockAuth = { user: { id: 'me' } };
let mockProfileId = 'p1';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ profileId: mockProfileId }),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
// G4a: the shared banner as a marker (its own rules: components/ads/ad-banner.test.tsx).
jest.mock('@/components/ads/ad-banner', () => jest.requireActual('../ads/test-ids').adBannerMarker());
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/app/(tabs)/profile', () => ({ ProfileCard: () => null }));
jest.mock('@/lib/use-profile', () => ({
  getPublicProfile: (...a: unknown[]) => mockGetPublicProfile(...a),
  publicProfileAsProfile: (p: unknown) => p,
}));
jest.mock('@/lib/match/use-profile-matches', () => ({
  usePlayerForm: () => mockForm,
  usePlayerRecentMatches: () => mockRecent,
  useMyTeammates: () => mockTeammates,
}));
const mockSeasonCalls: unknown[][] = [];
jest.mock('@/lib/match/use-stats', () => ({
  usePlayerSeasonStats: (...args: unknown[]) => {
    mockSeasonCalls.push(args);
    return {
      status: 'ready',
      stats: {
        appearances: 24,
        won: 15,
        drawn: 3,
        lost: 6,
        win_pct: 63,
        goals: 31,
        assists: 7,
        motm: 6,
        average_rating: 7.94,
        rated_matches: 20,
        level_start: null,
        level_end: null,
      },
      reload: jest.fn(),
    };
  },
}));
let mockStreakBadges: Record<string, unknown>;
const mockStreakCalls: unknown[][] = [];
jest.mock('@/lib/stats/use-streak', () => ({
  usePlayerStreakBadges: (...args: unknown[]) => {
    mockStreakCalls.push(args);
    return mockStreakBadges;
  },
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const reload = jest.fn();

beforeEach(() => {
  mockProfileId = 'p1';
  mockGetPublicProfile.mockReset().mockResolvedValue({ data: { id: 'p1', username: 'bob' }, error: null });
  mockForm = { status: 'ready', form: ['L_forfeit', 'W', 'W', 'D', 'L'], reload };
  mockRecent = { status: 'ready', rows: [], reload };
  mockTeammates = { status: 'ready', teammates: [], reload };
  mockStreakCalls.length = 0;
  mockStreakBadges = {
    status: 'ready',
    badges: {
      inColour: false,
      badges: [{ badge: 'bronze', label: 'Bronze', weeks: 2, awardedAt: '2026-11-16T07:00:00+00:00' }],
    },
    reload,
  };
});

describe('Player profile', () => {
  it('shows the form in the server’s order, the forfeit chip included', async () => {
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Form')).toBeTruthy());
    expect(screen.getAllByTestId('form-chip').map((c) => c.props.accessibilityLabel)).toEqual([
      'lost by forfeit',
      'won',
      'won',
      'drew',
      'lost',
    ]);
    expect(screen.getByText('Recent matches')).toBeTruthy();
  });

  it('A7: the season stats, this year then all time, and a way to the leaderboards', async () => {
    const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Season')).toBeTruthy());
    expect(screen.getByLabelText('Goals 31')).toBeTruthy();
    expect(screen.getByLabelText('Avg rating 7.9')).toBeTruthy();
    expect(mockSeasonCalls.at(-1)).toEqual(['p1', { kind: 'year', year: expect.any(Number) }]);
    await fireEvent.press(screen.getByText('All time'));
    expect(mockSeasonCalls.at(-1)).toEqual(['p1', { kind: 'all' }]);
    await fireEvent.press(screen.getByText('Leaderboards'));
    expect(router.push).toHaveBeenCalledWith('/match/leaderboards');
  });

  it('another player’s profile has no "Players you play with most"', async () => {
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Form')).toBeTruthy());
    expect(screen.queryByText('Players you play with most')).toBeNull();
  });

  it('the viewer’s own profile has it', async () => {
    mockProfileId = 'me';
    mockGetPublicProfile.mockResolvedValue({ data: { id: 'me', username: 'me' }, error: null });
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Players you play with most')).toBeTruthy());
  });

  it('form error state', async () => {
    mockForm = { status: 'error', message: 'boom', reload };
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText("Couldn't load form")).toBeTruthy());
  });

  it('a profile that fails to load: an inline error with retry', async () => {
    mockGetPublicProfile.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Couldn’t load this player.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Form')).toBeTruthy());
    expect(mockGetPublicProfile).toHaveBeenCalledTimes(2);
  });

  it('A11: another player’s streak badges, greyed while they aren’t Premium', async () => {
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Streak badges')).toBeTruthy());
    expect(mockStreakCalls).toContainEqual(['p1']);
    expect(screen.getByTestId('streak-badge-bronze-greyed')).toBeTruthy();
  });

  it('A11: a Premium player’s badges in colour', async () => {
    mockStreakBadges = {
      status: 'ready',
      badges: {
        inColour: true,
        badges: [{ badge: 'bronze', label: 'Bronze', weeks: 2, awardedAt: '2026-11-16T07:00:00+00:00' }],
      },
      reload,
    };
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('streak-badge-bronze-colour')).toBeTruthy());
  });

  it('A11: no badge row on the viewer’s own profile (their Streak card is on the Profile tab)', async () => {
    mockProfileId = 'me';
    mockGetPublicProfile.mockResolvedValue({ data: { id: 'me', username: 'me' }, error: null });
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Form')).toBeTruthy());
    expect(screen.queryByText('Streak badges')).toBeNull();
    expect(mockStreakCalls).toEqual([]);
  });

  it('G4a: another player’s profile ends with a banner ad', async () => {
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Form')).toBeTruthy());
    const ids = testIdsInOrder();
    expect(ids).toContain('player-profile-ad');
    expect(ids[ids.length - 1]).toBe('player-profile-ad');
  });

  it('G4a: never on the viewer’s own profile', async () => {
    mockProfileId = 'me';
    mockGetPublicProfile.mockResolvedValue({ data: { id: 'me', username: 'me' }, error: null });
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Form')).toBeTruthy());
    expect(screen.queryByTestId('player-profile-ad')).toBeNull();
  });

  it('G4a: no banner ad while loading or when the profile fails', async () => {
    mockGetPublicProfile.mockReturnValueOnce(new Promise(() => {}));
    await render(<PlayerProfileScreen />);
    expect(screen.queryByTestId('player-profile-ad')).toBeNull();
    mockGetPublicProfile.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await render(<PlayerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Try again')).toBeTruthy());
    expect(screen.queryByTestId('player-profile-ad')).toBeNull();
  });
});
