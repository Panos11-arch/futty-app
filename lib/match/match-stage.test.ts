import { getMatchKnockout } from '@/lib/match/match-stage';

let mockCalls: unknown[][] = [];
let mockAnswers: Record<string, { data: unknown; error: unknown }> = {};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockCalls.push(['from', table]);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) {
        q[m] = (...args: unknown[]) => {
          mockCalls.push([m, ...args]);
          return q;
        };
      }
      q.maybeSingle = () => Promise.resolve(mockAnswers[table] ?? { data: null, error: null });
      return q;
    },
  },
}));

beforeEach(() => {
  mockCalls = [];
  mockAnswers = {};
});

describe('getMatchKnockout', () => {
  it('a knockout fixture (qf, sf, final) is a knockout', async () => {
    for (const stage of ['qf', 'sf', 'final']) {
      mockAnswers = { matches: { data: { tournament_fixture_id: 'f1' }, error: null }, tournament_fixtures: { data: { stage }, error: null } };
      await expect(getMatchKnockout('m1')).resolves.toEqual({ knockout: true, error: null });
    }
    expect(mockCalls.slice(0, 7)).toEqual([
      ['from', 'matches'],
      ['select', 'tournament_fixture_id'],
      ['eq', 'id', 'm1'],
      ['from', 'tournament_fixtures'],
      ['select', 'stage'],
      ['eq', 'id', 'f1'],
      ['from', 'matches'],
    ]);
  });

  it('a group game is not', async () => {
    mockAnswers = { matches: { data: { tournament_fixture_id: 'f1' }, error: null }, tournament_fixtures: { data: { stage: 'group' }, error: null } };
    await expect(getMatchKnockout('m1')).resolves.toEqual({ knockout: false, error: null });
  });

  it('a game outside a tournament is not, and reads no fixture', async () => {
    mockAnswers = { matches: { data: { tournament_fixture_id: null }, error: null } };
    await expect(getMatchKnockout('m1')).resolves.toEqual({ knockout: false, error: null });
    expect(mockCalls.some((c) => c[1] === 'tournament_fixtures')).toBe(false);
    mockAnswers = {};
    await expect(getMatchKnockout('m1')).resolves.toEqual({ knockout: false, error: null });
  });

  it('a failed read is not a knockout, with the error', async () => {
    mockAnswers = { matches: { data: null, error: { message: 'offline' } } };
    await expect(getMatchKnockout('m1')).resolves.toEqual({ knockout: false, error: 'offline' });
    mockAnswers = { matches: { data: { tournament_fixture_id: 'f1' }, error: null }, tournament_fixtures: { data: null, error: { message: 'down' } } };
    await expect(getMatchKnockout('m1')).resolves.toEqual({ knockout: false, error: 'down' });
    mockAnswers = { matches: { data: { tournament_fixture_id: 'f1' }, error: null } };
    await expect(getMatchKnockout('m1')).resolves.toEqual({ knockout: false, error: null });
  });
});
