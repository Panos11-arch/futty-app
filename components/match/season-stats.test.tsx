import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  levelLine,
  PlayerSeasonStatsView,
  playerTiles,
  SeasonPicker,
  TeamSeasonStatsView,
  teamTiles,
} from '@/components/match/season-stats';
import type { PlayerSeasonStats, TeamSeasonStats } from '@/lib/match/stats-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const player: PlayerSeasonStats = {
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
  level_start: 3.0,
  level_end: 3.42,
};

const team: TeamSeasonStats = {
  played: 8,
  won: 5,
  drawn: 1,
  lost: 2,
  win_pct: 63,
  goals_for: 11,
  goals_against: 6,
  clean_sheets: 2,
  longest_win_run: 1,
  motm: 1,
  average_rating: null,
};

describe('season stats', () => {
  it('shows the server’s numbers as they are, formatted', () => {
    expect(playerTiles(player)).toEqual([
      { label: 'Games', value: '24' },
      { label: 'Win rate', value: '63%' },
      { label: 'W-D-L', value: '15-3-6' },
      { label: 'Goals', value: '31' },
      { label: 'Assists', value: '7' },
      { label: 'Man of the match', value: '6' },
      { label: 'Avg rating', value: '7.9' },
    ]);
    expect(teamTiles(team)).toContainEqual({ label: 'Best run', value: '1 win' });
    expect(teamTiles({ ...team, longest_win_run: 3 })).toContainEqual({ label: 'Best run', value: '3 wins' });
    expect(teamTiles(team)).toContainEqual({ label: 'Avg rating', value: '–' });
  });

  it('the level line, only when the level moved', () => {
    expect(levelLine(player, 'year')).toBe('Level 3.0 to 3.4 this year');
    expect(levelLine(player, 'all')).toBe('Level 3.0 to 3.4 so far');
    expect(levelLine({ ...player, level_start: null }, 'year')).toBeNull();
  });

  it('renders the tiles and the level', async () => {
    await render(<PlayerSeasonStatsView state={{ status: 'ready', stats: player }} pick="year" onRetry={jest.fn()} />);
    expect(screen.getByLabelText('Goals 31')).toBeTruthy();
    expect(screen.getByText('Level 3.0 to 3.4 this year')).toBeTruthy();
  });

  it('loading, empty and error states', async () => {
    const onRetry = jest.fn();
    const { rerender } = await render(<TeamSeasonStatsView state={{ status: 'loading' }} onRetry={onRetry} />);
    expect(screen.getByTestId('season-stats-skeleton')).toBeTruthy();
    await rerender(<TeamSeasonStatsView state={{ status: 'ready', stats: null }} onRetry={onRetry} />);
    expect(screen.getByText('No confirmed matches this season yet')).toBeTruthy();
    await rerender(<TeamSeasonStatsView state={{ status: 'error' }} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('the season picker', async () => {
    const onChange = jest.fn();
    await render(<SeasonPicker value="year" onChange={onChange} />);
    await fireEvent.press(screen.getByText('All time'));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
