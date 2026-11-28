import { getMatchLog, getMyMatchesToLog, logMatchResult, setMatchStats } from '@/lib/match/log-score-api';
import { mockMatchLog } from '@/lib/match/log-score-mock';

let mockCalls: [string, unknown][] = [];
let mockAnswers: Record<string, { data: unknown; error: unknown }> = {};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      mockCalls.push([fn, args]);
      return Promise.resolve(mockAnswers[fn] ?? { data: null, error: null });
    },
  },
}));

beforeEach(() => {
  mockCalls = [];
  mockAnswers = {};
});

describe('log-score-api', () => {
  it('reads the log; match_not_found is no log, not an error', async () => {
    mockAnswers.get_match_log = { data: mockMatchLog(), error: null };
    expect((await getMatchLog('m1')).log?.matchId).toBe('m1');
    expect(mockCalls).toEqual([['get_match_log', { p_match_id: 'm1' }]]);

    mockAnswers.get_match_log = { data: null, error: { message: 'match_not_found' } };
    expect(await getMatchLog('m1')).toEqual({ log: null, error: null });
    mockAnswers.get_match_log = { data: null, error: { message: 'boom' } };
    expect((await getMatchLog('m1')).error).toEqual({ message: 'boom' });
  });

  it('logs both scores with the stats, and returns what the server decided', async () => {
    mockAnswers.log_match_result = { data: { status: 'mismatch', tries: 1, maxTries: 3 }, error: null };
    const stats = { a: { players: [{ playerId: 'a2', goals: 4, assists: 0 }], ownGoals: 0 } };
    const { result } = await logMatchResult('m1', { a: 4, b: 1 }, stats);
    expect(result).toEqual({ status: 'mismatch', tries: 1, maxTries: 3 });
    expect(mockCalls).toEqual([
      ['log_match_result', { p_match_id: 'm1', p_side_a_score: 4, p_side_b_score: 1, p_stats: stats }],
    ]);
    mockAnswers.log_match_result = { data: null, error: { message: 'not_your_player' } };
    expect(await logMatchResult('m1', { a: 1, b: 0 }, {})).toEqual({ result: null, error: { message: 'not_your_player' } });
  });

  it('a drawn knockout game sends the shootout too (S10A)', async () => {
    await logMatchResult('m1', { a: 1, b: 1 }, {}, { a: 4, b: 3 });
    expect(mockCalls).toEqual([
      ['log_match_result', { p_match_id: 'm1', p_side_a_score: 1, p_side_b_score: 1, p_stats: {}, p_side_a_pens: 4, p_side_b_pens: 3 }],
    ]);
  });

  it('corrects the stats', async () => {
    expect(await setMatchStats('m1', { a: { players: [], ownGoals: 1 } })).toEqual({ error: null });
    expect(mockCalls[0]).toEqual(['set_match_stats', { p_match_id: 'm1', p_stats: { a: { players: [], ownGoals: 1 } } }]);
    // A lone captain's correction carries the new score (decided 25 November).
    expect(await setMatchStats('m1', { a: { players: [], ownGoals: 5 } }, { a: 5, b: 1 })).toEqual({ error: null });
    expect(mockCalls[1]).toEqual(['set_match_stats', {
      p_match_id: 'm1', p_stats: { a: { players: [], ownGoals: 5 } }, p_side_a_score: 5, p_side_b_score: 1,
    }]);
    mockAnswers.set_match_stats = { data: null, error: { message: 'scorers_window_closed' } };
    expect((await setMatchStats('m1', {})).error).toEqual({ message: 'scorers_window_closed' });
  });

  it('lists the games to log', async () => {
    const row = { matchId: 'm1', kickoffAt: 'x', labelA: 'Bibs', labelB: 'Non-bibs', state: 'log' };
    mockAnswers.get_my_matches_to_log = { data: [row], error: null };
    expect(await getMyMatchesToLog()).toEqual({ matches: [row], error: null });
    mockAnswers.get_my_matches_to_log = { data: null, error: { message: 'boom' } };
    expect(await getMyMatchesToLog()).toEqual({ matches: [], error: { message: 'boom' } });
  });
});
