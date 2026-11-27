// S15: Rankings → Power ranking (image 14; decision 1m): every listed team
// with rank, ▲▼, badge, name, last three results and whole points; a row
// opens its breakdown in place; the badge and name open the team.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PowerRankingList, rankingRowLabel } from '@/components/match/power-ranking-list';
import type { PowerRankingRow } from '@/lib/match/power-ranking-api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

let mockRanking: Record<string, unknown> = { status: 'loading', reload: jest.fn() };
let mockHistory: Record<string, unknown> = { status: 'loading', reload: jest.fn() };
const mockRankingArgs: string[] = [];
const mockHistoryArgs: unknown[][] = [];
jest.mock('@/lib/match/use-stats', () => ({
  usePowerRanking: (format: string) => {
    mockRankingArgs.push(format);
    return mockRanking;
  },
  usePowerRankingHistory: (...args: unknown[]) => {
    mockHistoryArgs.push(args);
    return mockHistory;
  },
}));

const row = (over: Partial<PowerRankingRow>): PowerRankingRow => ({
  rank: 1,
  team_id: 'ku',
  team_name: 'Kato United',
  points: 1046.3,
  matches: 4,
  last_results: ['W', 'W', 'D'],
  rank_change: 2,
  ...over,
});

const rows = [
  row({}),
  row({ rank: 2, team_id: 'll', team_name: 'Limassol Lions', points: 1030.6, last_results: ['L', 'W', 'W'], rank_change: -1 }),
  row({ rank: 3, team_id: 'nf', team_name: 'Nicosia Foxes', points: 984, last_results: ['D', 'D', 'L'], rank_change: null }),
];

beforeEach(() => {
  mockPush.mockClear();
  mockRankingArgs.length = 0;
  mockHistoryArgs.length = 0;
  mockHistory = { status: 'loading', reload: jest.fn() };
});

describe('PowerRankingList', () => {
  it('loading: skeletons', async () => {
    mockRanking = { status: 'loading', reload: jest.fn() };
    await render(<PowerRankingList format="5-a-side" onSeeTeamOfTheWeek={jest.fn()} />);
    expect(screen.getByTestId('power-ranking-skeleton')).toBeTruthy();
    expect(mockRankingArgs).toContain('5-a-side');
  });

  it('error: one line and Try again', async () => {
    const reload = jest.fn();
    mockRanking = { status: 'error', message: 'boom', reload };
    await render(<PowerRankingList format="5-a-side" onSeeTeamOfTheWeek={jest.fn()} />);
    expect(screen.getByText('Couldn’t load the ranking.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(reload).toHaveBeenCalled();
  });

  it('empty: one line and one button', async () => {
    const onSee = jest.fn();
    mockRanking = { status: 'ready', rows: [], reload: jest.fn() };
    await render(<PowerRankingList format="9-a-side" onSeeTeamOfTheWeek={onSee} />);
    expect(screen.getByText('No ranked teams yet')).toBeTruthy();
    await fireEvent.press(screen.getByText('See Team of the Week'));
    expect(onSee).toHaveBeenCalled();
  });

  it('each team: rank, ▲▼ or –, name, last three results and whole points', async () => {
    mockRanking = { status: 'ready', rows, reload: jest.fn() };
    await render(<PowerRankingList format="5-a-side" onSeeTeamOfTheWeek={jest.fn()} />);
    expect(screen.getByText('Kato United')).toBeTruthy();
    expect(screen.getByText('▲2')).toBeTruthy();
    expect(screen.getByText('▼1')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
    expect(screen.getByText('1046')).toBeTruthy();
    expect(screen.getByText('1031')).toBeTruthy();
    expect(screen.getByText('984')).toBeTruthy();
    expect(screen.getAllByText('W')).toHaveLength(4);
    expect(screen.getAllByText('D')).toHaveLength(3);
    expect(screen.getByLabelText('1, Kato United, up 2, won, won, drew, 1046 points')).toBeTruthy();
    expect(rankingRowLabel(rows[2])).toBe('3, Nicosia Foxes, new, drew, drew, lost, 984 points');
  });

  it('tapping a row opens its breakdown in place; tapping again closes it', async () => {
    mockRanking = { status: 'ready', rows, reload: jest.fn() };
    mockHistory = {
      status: 'ready',
      games: [
        {
          game_id: 'g1',
          kickoff_at: '2026-11-20T18:00:00Z',
          opponent_team_id: 'll',
          opponent_name: 'Limassol Lions',
          category: 'league',
          goals_for: 3,
          goals_against: 2,
          result: 'W',
          expected: 0.48,
          points_before: 1025.5,
          points_after: 1046.3,
          change: 20.8,
        },
      ],
      reload: jest.fn(),
    };
    await render(<PowerRankingList format="5-a-side" onSeeTeamOfTheWeek={jest.fn()} />);
    expect(screen.queryByTestId('power-ranking-breakdown-ku')).toBeNull();
    await fireEvent.press(screen.getByTestId('power-ranking-row-ku'));
    expect(screen.getByTestId('power-ranking-breakdown-ku')).toBeTruthy();
    expect(mockHistoryArgs).toContainEqual(['ku', '5-a-side']);
    expect(screen.getByText('Beat Limassol Lions 3–2 · League')).toBeTruthy();
    expect(screen.getByText('Expected to win 48% of the time')).toBeTruthy();
    expect(screen.getByText('+20.8')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('power-ranking-row-ku'));
    expect(screen.queryByTestId('power-ranking-breakdown-ku')).toBeNull();
  });

  it('the breakdown can fail on its own, with Try again', async () => {
    const reload = jest.fn();
    mockRanking = { status: 'ready', rows, reload: jest.fn() };
    mockHistory = { status: 'error', message: 'boom', reload };
    await render(<PowerRankingList format="5-a-side" onSeeTeamOfTheWeek={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('power-ranking-row-ll'));
    await fireEvent.press(screen.getByText('Try again'));
    expect(reload).toHaveBeenCalled();
  });

  it('the badge and name open the team page; an opponent in the breakdown opens theirs', async () => {
    mockRanking = { status: 'ready', rows, reload: jest.fn() };
    mockHistory = {
      status: 'ready',
      games: [
        { game_id: 'g1', kickoff_at: '', opponent_team_id: 'nf', opponent_name: 'Nicosia Foxes', category: 'non_league', goals_for: 0, goals_against: 1, result: 'L', expected: 0.6, points_before: 1040, points_after: 1028, change: -12 },
      ],
      reload: jest.fn(),
    };
    await render(<PowerRankingList format="5-a-side" onSeeTeamOfTheWeek={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('power-ranking-team-ll'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'll' } });
    await fireEvent.press(screen.getByTestId('power-ranking-row-ku'));
    expect(screen.getByText('−12')).toBeTruthy();
    await fireEvent.press(screen.getByText('Lost to Nicosia Foxes 0–1 · Non-league'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'nf' } });
  });
});
