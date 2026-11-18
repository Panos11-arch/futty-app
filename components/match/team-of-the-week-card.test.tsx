import { fireEvent, render, screen } from '@testing-library/react-native';

import { TeamOfTheWeekCard } from '@/components/match/team-of-the-week-card';
import type { TeamOfTheWeek, TeamOfTheWeekPlayer } from '@/lib/match/stats-api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const team: TeamOfTheWeek = {
  id: 't',
  week_start: '2026-11-09',
  matches: 4,
};

const player = (over: Partial<TeamOfTheWeekPlayer>): TeamOfTheWeekPlayer => ({
  profile_id: 'k',
  name: 'Kostas',
  position_group: 'gk',
  sort: 1,
  average_points: 8,
  games: 1,
  goals: 0,
  assists: 0,
  clean_sheets: 1,
  motm: 0,
  average_rating: 7,
  ...over,
});

describe('TeamOfTheWeekCard', () => {
  it('the team, its week and its players in the server’s order', async () => {
    const players = [player({}), player({ profile_id: 'f', name: 'Fotis', position_group: 'fwd', sort: 2, average_points: 8.5, games: 2, goals: 2, assists: 1, clean_sheets: 0, motm: 1 })];
    await render(<TeamOfTheWeekCard team={team} state={{ status: 'ready', players }} onRetry={jest.fn()} />);
    expect(screen.getByText('Team of the week')).toBeTruthy();
    expect(screen.getByText('Week of 9 Nov · 4 matches')).toBeTruthy();
    expect(screen.getAllByTestId('team-of-the-week-player').map((r) => r.props.accessibilityLabel)).toEqual([
      'Kostas, Keeper, 1 clean sheet · 1 game, 8.0 pts per game',
      'Fotis, Forward, 2 goals · 1 assist · 1 man of the match · 2 games, 8.5 pts per game',
    ]);
    expect(screen.getByText('Forward · 2 goals · 1 assist · 1 man of the match · 2 games')).toBeTruthy();
    expect(screen.getByText('8.5 pts')).toBeTruthy();
    await fireEvent.press(screen.getByText('Fotis'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'f' } });
  });

  it('loading and error', async () => {
    const onRetry = jest.fn();
    const { rerender } = await render(<TeamOfTheWeekCard team={team} state={{ status: 'loading' }} onRetry={onRetry} />);
    expect(screen.getByTestId('team-of-the-week-skeleton')).toBeTruthy();
    await rerender(<TeamOfTheWeekCard team={team} state={{ status: 'error' }} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
