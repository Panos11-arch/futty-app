import { fireEvent, render, screen } from '@testing-library/react-native';

import { HeadToHead } from '@/components/match/head-to-head';
import type { HeadToHeadRow } from '@/lib/match/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const record: HeadToHeadRow = {
  team_id: 'lions',
  opponent_team_id: 'tigers',
  played: 4,
  won: 2,
  drawn: 1,
  lost: 1,
  goals_for: 9,
  goals_against: 7,
  last_3: [
    { matchId: 'm4', kickoffAt: '2026-11-07T17:00:00Z', result: 'D', goalsFor: 2, goalsAgainst: 2 },
    { matchId: 'm3', kickoffAt: '2026-11-03T17:00:00Z', result: 'L', goalsFor: 0, goalsAgainst: 1 },
    { matchId: 'm2', kickoffAt: '2026-10-31T17:00:00Z', result: 'W', goalsFor: null, goalsAgainst: null },
  ],
};

const props = { teamName: 'Lions', opponentName: 'Tigers', onRetry: jest.fn() };

describe('HeadToHead', () => {
  it('shows the server’s numbers unchanged', async () => {
    await render(<HeadToHead state={{ status: 'ready', record }} {...props} />);
    expect(screen.getByTestId('h2h-played').props.children).toBe('4');
    expect(screen.getByTestId('h2h-won').props.children).toBe('2');
    expect(screen.getByTestId('h2h-drawn').props.children).toBe('1');
    expect(screen.getByTestId('h2h-lost').props.children).toBe('1');
    expect(screen.getByTestId('h2h-goals').props.children).toBe('9 – 7');
  });

  it('lists the last 3 in the server’s order, a forfeit with no score', async () => {
    await render(<HeadToHead state={{ status: 'ready', record }} {...props} />);
    const meetings = screen.getAllByTestId('h2h-meeting');
    expect(meetings.map((m) => m.props.accessibilityLabel)).toEqual([
      'Sat 7 Nov, drew, 2 – 2',
      'Tue 3 Nov, lost, 0 – 1',
      'Sat 31 Oct, won, Forfeit',
    ]);
  });

  it('loading: a skeleton', async () => {
    await render(<HeadToHead state={{ status: 'loading' }} {...props} />);
    expect(screen.getByTestId('h2h-skeleton')).toBeTruthy();
  });

  it('never met: an empty state', async () => {
    await render(<HeadToHead state={{ status: 'ready', record: null }} {...props} />);
    expect(screen.getByText('Lions haven’t played Tigers yet')).toBeTruthy();
  });

  it('error: an inline error with retry', async () => {
    const onRetry = jest.fn();
    await render(<HeadToHead state={{ status: 'error' }} {...props} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
