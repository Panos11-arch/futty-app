import {
  balanceMatchTeams,
  getPlayerLevel,
  setMatchCompetitive,
  setStartingLevel,
} from '@/lib/match/levels-api';

type Call = [string, ...unknown[]];
let mockCalls: Call[] = [];
let mockAnswers: Record<string, { data: unknown; error: unknown }> = {};

jest.mock('@/lib/supabase', () => {
  const query = (name: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'maybeSingle']) {
      q[method] = (...args: unknown[]) => {
        mockCalls.push([method, ...args]);
        return q;
      };
    }
    q.then = (resolve: (r: unknown) => unknown) => resolve(mockAnswers[name] ?? { data: null, error: null });
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        mockCalls.push(['from', table]);
        return query(table);
      },
      rpc: (fn: string, args: unknown) => {
        mockCalls.push(['rpc', fn, args]);
        return query(fn);
      },
    },
  };
});

beforeEach(() => {
  mockCalls = [];
  mockAnswers = {};
});

describe('getPlayerLevel', () => {
  it('reads one player_levels row and shapes it', async () => {
    mockAnswers.player_levels = {
      data: { level: '3.45', provisional: true, reliability_pct: 10, competitive_matches: 2, source: 'questionnaire' },
      error: null,
    };
    await expect(getPlayerLevel('pr1')).resolves.toEqual({
      level: { level: 3.45, provisional: true, reliabilityPct: 10, competitiveMatches: 2, source: 'questionnaire' },
      error: null,
    });
    expect(mockCalls).toContainEqual(['from', 'player_levels']);
    expect(mockCalls).toContainEqual(['eq', 'profile_id', 'pr1']);
  });

  it('no row: null, not an error', async () => {
    await expect(getPlayerLevel('pr1')).resolves.toEqual({ level: null, error: null });
  });

  it('an error comes back', async () => {
    mockAnswers.player_levels = { data: null, error: { message: 'boom' } };
    await expect(getPlayerLevel('pr1')).resolves.toEqual({ level: null, error: { message: 'boom' } });
  });
});

describe('setStartingLevel', () => {
  it('sends the five answers, the rating as a number', async () => {
    await setStartingLevel({ years: '3_10', highest: 'amateur', frequency: 'weekly', position: 'mid', selfRating: '7' });
    expect(mockCalls).toContainEqual([
      'rpc',
      'set_starting_level',
      { p_years: '3_10', p_highest: 'amateur', p_frequency: 'weekly', p_position: 'mid', p_self_rating: 7 },
    ]);
  });
});

describe('match writes send ids only', () => {
  it('set_match_competitive', async () => {
    await setMatchCompetitive('m1', false);
    expect(mockCalls).toContainEqual(['rpc', 'set_match_competitive', { p_match_id: 'm1', p_competitive: false }]);
  });

  it('balance_match_teams', async () => {
    mockAnswers.balance_match_teams = {
      data: { sideA: { players: ['a'], average: 3.25 }, sideB: { players: ['b'], average: 3.2 } },
      error: null,
    };
    await expect(balanceMatchTeams('m1')).resolves.toEqual({
      result: { sideA: { players: ['a'], average: 3.25 }, sideB: { players: ['b'], average: 3.2 } },
      error: null,
    });
    expect(mockCalls).toContainEqual(['rpc', 'balance_match_teams', { p_match_id: 'm1' }]);
  });
});

