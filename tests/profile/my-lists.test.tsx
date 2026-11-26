// S8 follow-up (Panos, 26 November): the full lists behind Profile's
// "People you play with most" and "Your venues" rows. The server leaves out
// blocked players and adult/minor pairs and sends a minor's first name only,
// so the screen shows the names it gets.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import MyTeammatesScreen from '@/app/my-teammates';
import MyVenuesScreen from '@/app/my-venues';

let mockTeammates: Record<string, unknown>;
let mockVenues: Record<string, unknown>;
let mockTeammatesLimit: number | undefined;
let mockVenuesArgs: unknown[] = [];
const mockTeammatesReload = jest.fn();
const mockVenuesReload = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    Stack: { Screen: () => null },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/match/use-profile-matches', () => ({
  useMyTeammates: (limit: number) => {
    mockTeammatesLimit = limit;
    return { ...mockTeammates, reload: mockTeammatesReload };
  },
}));
jest.mock('@/lib/match/use-profile-summary', () => ({
  useMyVenues: (...args: unknown[]) => {
    mockVenuesArgs = args;
    return { ...mockVenues, reload: mockVenuesReload };
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockTeammates = {
    status: 'ready',
    teammates: [
      { teammate_profile_id: 'p1', name: 'Nikos Mate', matches_together: 12, last_played_at: null, kit: null },
      { teammate_profile_id: 'p2', name: 'Maria', matches_together: 1, last_played_at: null, kit: null },
    ],
  };
  mockVenues = {
    status: 'ready',
    venues: [
      { venue_id: 'v1', name: 'Kamares Sports Centre', city: 'Larnaca', games: 9, last_played_at: null },
      { venue_id: 'v2', name: 'Nuevo Campo', city: null, games: 1, last_played_at: null },
    ],
  };
});

describe('People you play with most', () => {
  it('lists up to 20, most games first, with the server’s names; reloads on focus', async () => {
    await render(<MyTeammatesScreen />);
    expect(screen.getByTestId('teammates-screen')).toBeTruthy();
    expect(mockTeammatesLimit).toBe(20);
    expect(mockTeammatesReload).toHaveBeenCalled();
    expect(screen.getAllByTestId('teammate-row').map((r) => r.props.accessibilityLabel ?? '')).toHaveLength(2);
    expect(screen.getByText('Nikos Mate')).toBeTruthy();
    expect(screen.getByText('12 games together')).toBeTruthy();
    // A minor: first name only, as the server sent it.
    expect(screen.getByText('Maria')).toBeTruthy();
  });

  it('a player opens their profile', async () => {
    await render(<MyTeammatesScreen />);
    await fireEvent.press(screen.getAllByTestId('teammate-row')[0]);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'p1' } });
  });

  it('loading, error with Try again, and empty', async () => {
    mockTeammates = { status: 'loading' };
    const view = await render(<MyTeammatesScreen />);
    expect(screen.getByTestId('teammates-skeleton')).toBeTruthy();
    mockTeammates = { status: 'error', message: 'offline' };
    await view.rerender(<MyTeammatesScreen />);
    mockTeammatesReload.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockTeammatesReload).toHaveBeenCalledTimes(1);
    mockTeammates = { status: 'ready', teammates: [] };
    await view.rerender(<MyTeammatesScreen />);
    expect(screen.getByText('Play a confirmed match to see who you play with most')).toBeTruthy();
  });
});

describe('Your venues', () => {
  it('lists your venues, most games first; reloads on focus', async () => {
    await render(<MyVenuesScreen />);
    expect(screen.getByTestId('venues-screen')).toBeTruthy();
    expect(mockVenuesArgs).toEqual(['me', 20]);
    expect(mockVenuesReload).toHaveBeenCalled();
    const rows = screen.getAllByTestId(/^my-venue-row-/).map((r) => r.props.testID);
    expect(rows).toEqual(['my-venue-row-v1', 'my-venue-row-v2']);
    expect(screen.getByText('Larnaca · 9 games')).toBeTruthy();
    expect(screen.getByText('1 game')).toBeTruthy();
  });

  it('a venue opens its venue page', async () => {
    await render(<MyVenuesScreen />);
    await fireEvent.press(screen.getByTestId('my-venue-row-v1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/venue/[id]', params: { id: 'v1' } });
  });

  it('loading, error with Try again, and empty', async () => {
    mockVenues = { status: 'loading' };
    const view = await render(<MyVenuesScreen />);
    expect(screen.getByTestId('venues-skeleton')).toBeTruthy();
    mockVenues = { status: 'error', message: 'offline' };
    await view.rerender(<MyVenuesScreen />);
    expect(screen.getByText('Couldn’t load your venues.')).toBeTruthy();
    mockVenuesReload.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockVenuesReload).toHaveBeenCalledTimes(1);
    mockVenues = { status: 'ready', venues: [] };
    await view.rerender(<MyVenuesScreen />);
    expect(screen.getByText('Play a confirmed match to see your venues')).toBeTruthy();
  });
});
