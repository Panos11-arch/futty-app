import {
  breakdownLine,
  categoryLabel,
  expectedLine,
  formatChange,
  formatPoints,
  getMyMostPlayedFormat,
  getPowerRanking,
  getPowerRankingHistory,
  getTeamPowerRanking,
  rankMove,
  spokenResult,
} from '@/lib/match/power-ranking-api';

let mockCalls: unknown[][] = [];
let mockResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      mockCalls.push([fn, args]);
      return Promise.resolve(mockResponse);
    },
  },
}));

beforeEach(() => {
  mockCalls = [];
  mockResponse = { data: null, error: null };
});

describe('reads', () => {
  it('the ranking for a format', async () => {
    mockResponse = { data: [{ rank: 1, team_id: 't', team_name: 'Kato', points: 1046.2, matches: 4, last_results: ['W'], rank_change: 2 }], error: null };
    const { rows, error } = await getPowerRanking('5-a-side');
    expect(mockCalls).toEqual([['get_power_ranking', { p_format: '5-a-side' }]]);
    expect(rows[0].team_name).toBe('Kato');
    expect(error).toBeNull();
  });

  it('the ranking: an error gives no rows', async () => {
    mockResponse = { data: null, error: { message: 'boom' } };
    const { rows, error } = await getPowerRanking('5-a-side');
    expect(rows).toEqual([]);
    expect(error).toEqual({ message: 'boom' });
  });

  it('a team’s breakdown, 20 games by default', async () => {
    await getPowerRankingHistory('t', '7-a-side');
    expect(mockCalls).toEqual([['get_power_ranking_history', { p_team_id: 't', p_format: '7-a-side', p_limit: 20 }]]);
  });

  it('the breakdown: an error gives no games', async () => {
    mockResponse = { data: null, error: { message: 'boom' } };
    expect((await getPowerRankingHistory('t', '7-a-side')).games).toEqual([]);
  });

  it('a team’s place in each format', async () => {
    mockResponse = { data: [{ format: '6-a-side', rank: 3, points: 1012, matches: 5 }], error: null };
    const { rows } = await getTeamPowerRanking('t');
    expect(mockCalls).toEqual([['get_team_power_ranking', { p_team_id: 't' }]]);
    expect(rows).toHaveLength(1);
  });

  it('a team’s places: an error gives none', async () => {
    mockResponse = { data: null, error: { message: 'boom' } };
    expect((await getTeamPowerRanking('t')).rows).toEqual([]);
  });

  it('the most played format, or null', async () => {
    mockResponse = { data: '7-a-side', error: null };
    expect((await getMyMostPlayedFormat()).format).toBe('7-a-side');
    expect(mockCalls).toEqual([['my_most_played_format', undefined]]);
    mockResponse = { data: null, error: null };
    expect((await getMyMostPlayedFormat()).format).toBeNull();
    mockResponse = { data: null, error: { message: 'boom' } };
    const failed = await getMyMostPlayedFormat();
    expect(failed.format).toBeNull();
    expect(failed.error).toEqual({ message: 'boom' });
  });
});

describe('formatPoints', () => {
  it('whole numbers, rounded', () => {
    expect(formatPoints(1046.4)).toBe('1046');
    expect(formatPoints(1045.5)).toBe('1046');
    expect(formatPoints(998)).toBe('998');
  });
});

describe('formatChange', () => {
  it('signed, one decimal (decision 1m worked examples)', () => {
    expect(formatChange(20.8)).toBe('+20.8');
    expect(formatChange(-20.8)).toBe('−20.8');
    expect(formatChange(10)).toBe('+10');
    expect(formatChange(-20)).toBe('−20');
    expect(formatChange(0)).toBe('0');
    expect(formatChange(0.04)).toBe('0');
    expect(formatChange(3.14159)).toBe('+3.1');
  });
});

describe('rankMove', () => {
  it('▲ up, ▼ down, – unchanged or new', () => {
    expect(rankMove(2)).toEqual({ direction: 'up', label: '▲2', spoken: 'up 2' });
    expect(rankMove(-1)).toEqual({ direction: 'down', label: '▼1', spoken: 'down 1' });
    expect(rankMove(0)).toEqual({ direction: 'none', label: '–', spoken: 'no change' });
    expect(rankMove(null)).toEqual({ direction: 'none', label: '–', spoken: 'new' });
  });
});

describe('breakdown lines', () => {
  const game = { opponent_name: 'Limassol Lions', goals_for: 3, goals_against: 2, category: 'league' };

  it('names the result, opponent, score and match type', () => {
    expect(breakdownLine({ ...game, result: 'W' })).toBe('Beat Limassol Lions 3–2 · League');
    expect(breakdownLine({ ...game, result: 'L', goals_for: 0, goals_against: 1, category: 'non_league' })).toBe(
      'Lost to Limassol Lions 0–1 · Non-league',
    );
    expect(breakdownLine({ ...game, result: 'D', goals_for: 1, goals_against: 1 })).toBe('Drew with Limassol Lions 1–1 · League');
  });

  it('every match type has a label', () => {
    expect(categoryLabel('tournament_group')).toBe('Tournament');
    expect(categoryLabel('tournament_knockout')).toBe('Knockout');
    expect(categoryLabel('something_new')).toBe('Match');
  });

  it('the expected win chance, as a whole percent', () => {
    expect(expectedLine(0.48)).toBe('Expected to win 48% of the time');
    expect(expectedLine(0.5)).toBe('Expected to win 50% of the time');
    expect(expectedLine(0.4713)).toBe('Expected to win 47% of the time');
  });

  it('spoken results', () => {
    expect(spokenResult('W')).toBe('won');
    expect(spokenResult('D')).toBe('drew');
    expect(spokenResult('L')).toBe('lost');
  });
});
