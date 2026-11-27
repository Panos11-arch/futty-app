import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useLeagueTeams } from '@/lib/use-league-teams';

const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockOrder = jest.fn();
const mockHandlers: (() => void)[] = [];
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'league_teams') throw new Error(`unexpected table ${table}`);
      const chain = {
        select: (cols: string) => {
          mockSelect(cols);
          return chain;
        },
        eq: (col: string, value: string) => {
          mockEq(col, value);
          return chain;
        },
        order: (col: string, opts: unknown) => mockOrder(col, opts),
      };
      return chain;
    },
    channel: () => {
      const channel = {
        on: (_: string, __: unknown, handler: () => void) => {
          mockHandlers.push(handler);
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: jest.fn(),
  },
}));
jest.mock('@/lib/realtime', () => ({ useRealtimeChannelName: (name: string) => name }));

beforeEach(() => {
  mockSelect.mockReset();
  mockEq.mockReset();
  mockOrder.mockReset();
  mockHandlers.length = 0;
});

it('reads only team names, in the order teams joined, never the old counters', async () => {
  mockOrder.mockResolvedValue({
    data: [
      { team_id: 't1', teams: { name: 'Lions', city: 'Limassol' } },
      { team_id: 't2', teams: null },
    ],
    error: null,
  });
  const { result } = await renderHook(() => useLeagueTeams('hub-1'));
  await waitFor(() => expect(result.current.status).toBe('ready'));

  const cols = mockSelect.mock.calls[0][0] as string;
  for (const counter of ['played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against']) {
    expect(cols).not.toContain(counter);
  }
  expect(mockEq).toHaveBeenCalledWith('league_id', 'hub-1');
  expect(mockOrder).toHaveBeenCalledWith('joined_at', { ascending: true });
  expect(result.current.status === 'ready' && result.current.rows).toEqual([
    { team_id: 't1', team_name: 'Lions', team_city: 'Limassol' },
    { team_id: 't2', team_name: 'Unknown team', team_city: null },
  ]);
});

it('reloads when a team joins or leaves', async () => {
  mockOrder.mockResolvedValue({ data: [], error: null });
  const { result } = await renderHook(() => useLeagueTeams('hub-1'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  mockOrder.mockResolvedValue({ data: [{ team_id: 't3', teams: { name: 'Bulls', city: null } }], error: null });
  await act(async () => mockHandlers.forEach((h) => h()));
  await waitFor(() => expect(result.current.status === 'ready' && result.current.rows.length).toBe(1));
});

it('shows the error', async () => {
  mockOrder.mockResolvedValue({ data: null, error: { message: 'boom' } });
  const { result } = await renderHook(() => useLeagueTeams('hub-1'));
  await waitFor(() => expect(result.current).toMatchObject({ status: 'error', message: 'boom' }));
});
