import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PlayerProfileScreen from '@/app/player-profile';

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
});
