import { fireEvent, render, screen } from '@testing-library/react-native';

import { TeamOfTheWeekCard } from '@/components/match/team-of-the-week-card';
import type { TeamOfTheWeek, TeamOfTheWeekPlayer, TeamShape } from '@/lib/match/stats-api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const team: TeamOfTheWeek = {
  id: 't',
  week_start: '2026-11-09',
  kind: 'general',
  area: 'all',
  area_key: '',
  area_name: 'All Cyprus',
  league_id: null,
  format: '5-a-side',
  matches: 4,
};

const shape: TeamShape = { format: '5-a-side', keepers: 1, defenders: 1, midfielders: 2, strikers: 1 };

const player = (over: Partial<TeamOfTheWeekPlayer>): TeamOfTheWeekPlayer => ({
  profile_id: 'k',
  name: 'Kostas',
  slot: 'gk',
  sort: 1,
  games: 1,
  goals: 0,
  assists: 0,
  clean_sheets: 1,
  average_rating: 7.4,
  player_of_the_week: false,
  ...over,
});

beforeEach(() => mockPush.mockClear());

describe('TeamOfTheWeekCard', () => {
  it('the team, its week, format and area, every slot in order, empty ones marked', async () => {
    const players = [
      player({}),
      player({ profile_id: 'm', name: 'Marios', slot: 'mid', sort: 2, goals: 2, assists: 3, clean_sheets: 0, average_rating: 8.2 }),
      player({ profile_id: 'f', name: 'Fotis', slot: 'fwd', sort: 3, goals: 4, assists: 1, clean_sheets: 0, average_rating: 8.9, player_of_the_week: true }),
    ];
    await render(<TeamOfTheWeekCard team={team} state={{ status: 'ready', players, shape }} onRetry={jest.fn()} />);
    expect(screen.getByText('Team of the week')).toBeTruthy();
    expect(screen.getByText('Week of 9 Nov · 5-a-side · All Cyprus')).toBeTruthy();
    expect(screen.getAllByTestId('team-of-the-week-player').map((r) => r.props.accessibilityLabel)).toEqual([
      'Kostas, Keeper, 1 clean sheet, rating 7.4',
      'Marios, Midfield, 2 G · 3 A, rating 8.2',
      'Fotis, Striker, 4 G · 1 A, Player of the week, rating 8.9',
    ]);
    expect(screen.getAllByTestId('team-of-the-week-empty-slot').map((r) => r.props.accessibilityLabel)).toEqual([
      'Defence, No eligible player',
      'Midfield, No eligible player',
    ]);
    expect(screen.getByText('Striker · 4 G · 1 A · Player of the week')).toBeTruthy();
    expect(screen.getByText('8.9')).toBeTruthy();
    await fireEvent.press(screen.getByText('Fotis'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'f' } });
  });

  it('an empty slot opens nothing', async () => {
    await render(<TeamOfTheWeekCard team={team} state={{ status: 'ready', players: [], shape }} onRetry={jest.fn()} />);
    expect(screen.getAllByTestId('team-of-the-week-empty-slot')).toHaveLength(5);
    await fireEvent.press(screen.getAllByText('No eligible player')[0]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('no shape from the server: the players alone', async () => {
    await render(<TeamOfTheWeekCard team={team} state={{ status: 'ready', players: [player({})], shape: null }} onRetry={jest.fn()} />);
    expect(screen.getAllByTestId('team-of-the-week-player')).toHaveLength(1);
    expect(screen.queryByTestId('team-of-the-week-empty-slot')).toBeNull();
  });

  it('loading and error', async () => {
    const onRetry = jest.fn();
    const { rerender } = await render(<TeamOfTheWeekCard team={team} state={{ status: 'loading' }} onRetry={onRetry} />);
    expect(screen.getByTestId('team-of-the-week-skeleton')).toBeTruthy();
    await rerender(<TeamOfTheWeekCard team={team} state={{ status: 'error' }} onRetry={onRetry} />);
    expect(screen.getByText('Couldn’t load the team.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
