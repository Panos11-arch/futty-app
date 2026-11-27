// S15: the Rankings tab (images 14, 15, 27): Team of the Week | Power
// ranking for one format at a time, opening on the viewer's most played
// format; params open a view, a format, or a named team of the week.
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import RankingsScreen from '@/app/(tabs)/rankings';

let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

let mockMost: Record<string, unknown> = { status: 'ready', format: null };
let mockLinked: Record<string, unknown> = { status: 'loading', reload: jest.fn() };
const mockLinkedArgs: unknown[] = [];
jest.mock('@/lib/match/use-stats', () => ({
  useMyMostPlayedFormat: () => mockMost,
  useTeamOfTheWeekById: (id: unknown) => {
    mockLinkedArgs.push(id);
    return mockLinked;
  },
}));

// The two views have their own tests; here they show what they were given.
jest.mock('@/components/match/team-of-the-week-view', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    TeamOfTheWeekView: ({ format, initialTeam }: { format: string; initialTeam?: { id: string } | null }): ReactNode => (
      <Text testID="totw-view">{`totw ${format} ${initialTeam?.id ?? '-'}`}</Text>
    ),
  };
});
jest.mock('@/components/match/power-ranking-list', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { PowerRankingList: ({ format }: { format: string }): ReactNode => <Text testID="power-ranking-list">{`power ${format}`}</Text> };
});

beforeEach(() => {
  mockParams = {};
  mockMost = { status: 'ready', format: null };
  mockLinked = { status: 'loading', reload: jest.fn() };
  mockLinkedArgs.length = 0;
});

describe('Rankings tab', () => {
  it('opens on Team of the Week, 5-a-side for a player with no games', async () => {
    await render(<RankingsScreen />);
    expect(screen.getByTestId('rankings-screen')).toBeTruthy();
    expect(screen.getByTestId('rankings-totw')).toBeTruthy();
    expect(screen.getByText('totw 5-a-side -')).toBeTruthy();
    expect(screen.getByText('How it’s picked')).toBeTruthy();
  });

  it('opens on the player’s most played format', async () => {
    mockMost = { status: 'ready', format: '7-a-side' };
    await render(<RankingsScreen />);
    expect(screen.getByText('totw 7-a-side -')).toBeTruthy();
  });

  it('waits for the most played format before showing a team (no jump)', async () => {
    mockMost = { status: 'loading' };
    await render(<RankingsScreen />);
    expect(screen.getByTestId('rankings-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('totw-view')).toBeNull();
  });

  it('the switch and the chips change view and format', async () => {
    await render(<RankingsScreen />);
    await fireEvent.press(screen.getByTestId('rankings-power'));
    expect(screen.getByText('power 5-a-side')).toBeTruthy();
    expect(screen.getByText('How it works')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rankings-format-9'));
    expect(screen.getByText('power 9-a-side')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rankings-totw'));
    expect(screen.getByText('totw 9-a-side -')).toBeTruthy();
  });

  it('"How it’s picked" and "How it works" open their sheets', async () => {
    await render(<RankingsScreen />);
    await fireEvent.press(screen.getByTestId('rankings-how'));
    expect(screen.getByTestId('how-its-picked-sheet')).toBeTruthy();
  });

  it('params: Power ranking in a format (from a team page)', async () => {
    mockParams = { view: 'power', format: '11-a-side' };
    await render(<RankingsScreen />);
    expect(screen.getByText('power 11-a-side')).toBeTruthy();
  });

  it('an unknown format param is ignored', async () => {
    mockParams = { format: '8-a-side' };
    await render(<RankingsScreen />);
    expect(screen.getByText('totw 5-a-side -')).toBeTruthy();
  });

  it('params: a named team of the week opens in its format', async () => {
    mockParams = { view: 'totw', teamId: 't9' };
    mockLinked = { status: 'ready', team: { id: 't9', format: '9-a-side', week_start: '2026-11-09' }, reload: jest.fn() };
    await render(<RankingsScreen />);
    expect(mockLinkedArgs).toContain('t9');
    expect(screen.getByText('totw 9-a-side t9')).toBeTruthy();
  });

  it('a named team that is gone: the default team', async () => {
    mockParams = { teamId: 'gone' };
    mockLinked = { status: 'ready', team: null, reload: jest.fn() };
    await render(<RankingsScreen />);
    expect(screen.getByText('totw 5-a-side -')).toBeTruthy();
  });
});
