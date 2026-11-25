// S14: the Team of the Week screen shows the server's default team (the
// latest week, General · All Cyprus, smallest format) in the decision 1k
// shape. S15 moves it into the Rankings tab with its pickers.
import { fireEvent, render, screen } from '@testing-library/react-native';

import TeamOfTheWeekScreen from '@/app/match/team-of-the-week';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const mockReload = jest.fn();
let mockLatest: unknown = { status: 'loading', reload: mockReload };
let mockPlayers: unknown = { status: 'loading', reload: jest.fn() };
jest.mock('@/lib/match/use-stats', () => ({
  useLatestTeamOfTheWeek: () => mockLatest,
  useTeamOfTheWeekPlayers: () => mockPlayers,
}));

const team = {
  id: 't',
  week_start: '2026-11-09',
  kind: 'general',
  area: 'all',
  area_key: '',
  area_name: 'All Cyprus',
  league_id: null,
  format: '5-a-side',
  matches: 3,
};

describe('Team of the Week screen', () => {
  it('loading: a skeleton', async () => {
    mockLatest = { status: 'loading', reload: mockReload };
    await render(<TeamOfTheWeekScreen />);
    expect(screen.getByTestId('team-of-the-week-screen-skeleton')).toBeTruthy();
  });

  it('error: one line and Try again', async () => {
    mockLatest = { status: 'error', message: 'boom', reload: mockReload };
    await render(<TeamOfTheWeekScreen />);
    expect(screen.getByText('Couldn’t load the team of the week.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockReload).toHaveBeenCalled();
  });

  it('none yet: one line', async () => {
    mockLatest = { status: 'ready', team: null, reload: mockReload };
    await render(<TeamOfTheWeekScreen />);
    expect(screen.getByText('No team of the week yet.')).toBeTruthy();
  });

  it('the team, with no old-rule text', async () => {
    mockLatest = { status: 'ready', team, reload: mockReload };
    mockPlayers = {
      status: 'ready',
      players: [],
      shape: { format: '5-a-side', keepers: 1, defenders: 1, midfielders: 2, strikers: 1 },
      reload: jest.fn(),
    };
    await render(<TeamOfTheWeekScreen />);
    expect(screen.getByTestId('team-of-the-week-card')).toBeTruthy();
    expect(screen.getByText('Week of 9 Nov · 5-a-side · All Cyprus')).toBeTruthy();
    expect(screen.getAllByText('No eligible player')).toHaveLength(5);
    expect(screen.queryByText(/points per game/)).toBeNull();
    expect(screen.queryByText(/keeper, defender, midfielder and forward/)).toBeNull();
  });
});
