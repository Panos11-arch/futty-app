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
  scope: 'venue',
  venue_id: 'v',
  city_key: 'nicosia',
  league_id: null,
  name: 'North Arena',
  matches: 4,
};

const player = (over: Partial<TeamOfTheWeekPlayer>): TeamOfTheWeekPlayer => ({
  profile_id: 'k',
  name: 'Kostas',
  position_group: 'gk',
  sort: 1,
  average_rating: 7,
  rated_matches: 1,
  motm: 0,
  goals: 0,
  ...over,
});

describe('TeamOfTheWeekCard', () => {
  it('the team, its week and its players in the server’s order', async () => {
    const players = [player({}), player({ profile_id: 'f', name: 'Fotis', position_group: 'fwd', sort: 2, average_rating: 8.5, rated_matches: 2 })];
    await render(<TeamOfTheWeekCard team={team} state={{ status: 'ready', players }} onRetry={jest.fn()} />);
    expect(screen.getByText('North Arena')).toBeTruthy();
    expect(screen.getByText('Week of 9 Nov · 4 matches')).toBeTruthy();
    expect(screen.getAllByTestId('team-of-the-week-player').map((r) => r.props.accessibilityLabel)).toEqual([
      'Kostas, Keeper, rated 7.0',
      'Fotis, Forward, rated 8.5',
    ]);
    expect(screen.getByText('Forward · 2 rated games')).toBeTruthy();
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
