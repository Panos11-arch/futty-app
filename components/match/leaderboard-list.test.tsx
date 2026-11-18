import { fireEvent, render, screen } from '@testing-library/react-native';

import { boardValue, LeaderboardList } from '@/components/match/leaderboard-list';
import type { LeaderboardRow } from '@/lib/match/stats-api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const rows: LeaderboardRow[] = [
  { profile_id: 'b', name: 'Bob', appearances: 5, goals: 3, motm: 1, win_pct: 100, rank: 1 },
  { profile_id: 'a', name: 'Ann', appearances: 6, goals: 3, motm: 0, win_pct: 80, rank: 1 },
];

describe('LeaderboardList', () => {
  it('each board’s value', () => {
    expect(boardValue(rows[0], 'goals')).toBe('3 goals');
    expect(boardValue(rows[0], 'motm')).toBe('1 award');
    expect(boardValue(rows[1], 'win_rate')).toBe('80%');
  });

  it('keeps the server’s order and shared ranks; opens a profile', async () => {
    await render(<LeaderboardList state={{ status: 'ready', rows }} board="goals" minAppearances={5} onRetry={jest.fn()} />);
    expect(screen.getAllByTestId('leaderboard-row').map((r) => r.props.accessibilityLabel)).toEqual([
      '1. Bob, 3 goals',
      '1. Ann, 3 goals',
    ]);
    await fireEvent.press(screen.getByText('Ann'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'a' } });
  });

  it('empty with the minimum, loading and error', async () => {
    const onRetry = jest.fn();
    const { rerender } = await render(
      <LeaderboardList state={{ status: 'ready', rows: [] }} board="goals" minAppearances={5} onRetry={onRetry} />,
    );
    expect(screen.getByText('Nobody has played 5 confirmed games here this year yet')).toBeTruthy();
    await rerender(<LeaderboardList state={{ status: 'loading' }} board="goals" minAppearances={5} onRetry={onRetry} />);
    expect(screen.getByTestId('leaderboard-skeleton')).toBeTruthy();
    await rerender(<LeaderboardList state={{ status: 'error' }} board="goals" minAppearances={5} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
