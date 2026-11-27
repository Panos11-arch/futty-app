import { listPins, pinCompetition, pinTournament, unpinCompetition, unpinTournament } from '@/lib/match/pins';

type Call = [string, ...unknown[]];
let mockCalls: Call[] = [];
let mockAnswer: { data: unknown; error: unknown } = { data: null, error: null };
let mockByTable: Record<string, { data: unknown; error: unknown }> = {};

jest.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'insert', 'delete', 'eq', 'order']) {
      q[method] = (...args: unknown[]) => {
        mockCalls.push([method, ...args]);
        return q;
      };
    }
    q.then = (resolve: (r: unknown) => unknown) => resolve(mockByTable[table] ?? mockAnswer);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        mockCalls.push(['from', table]);
        return query(table);
      },
    },
  };
});

beforeEach(() => {
  mockCalls = [];
  mockAnswer = { data: null, error: null };
  mockByTable = {};
});

describe('competition pins', () => {
  it('lists my league pins and tournament pins, each oldest first', async () => {
    mockByTable = {
      competition_pins: { data: [{ target_type: 'league', scope: 'limassol', format: '5-a-side' }], error: null },
      tournament_pins: { data: [{ tournament_id: 't1' }], error: null },
    };
    await expect(listPins()).resolves.toEqual({
      pins: [
        { target_type: 'league', scope: 'limassol', format: '5-a-side' },
        { target_type: 'tournament', tournament_id: 't1' },
      ],
      error: null,
    });
    expect(mockCalls).toEqual([
      ['from', 'competition_pins'],
      ['select', 'target_type, scope, format'],
      ['order', 'created_at', { ascending: true }],
      ['from', 'tournament_pins'],
      ['select', 'tournament_id'],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('a failed read returns the error and no pins', async () => {
    mockAnswer = { data: null, error: { message: 'offline' } };
    await expect(listPins()).resolves.toEqual({ pins: [], error: 'offline' });
  });

  it('a failed tournament read fails the list too', async () => {
    mockByTable = { tournament_pins: { data: null, error: { message: 'tournaments down' } } };
    await expect(listPins()).resolves.toEqual({ pins: [], error: 'tournaments down' });
  });

  it('empty answers are no pins', async () => {
    await expect(listPins()).resolves.toEqual({ pins: [], error: null });
  });

  it('pins and unpins a tournament by id; the server sets whose pin it is', async () => {
    await expect(pinTournament('t1')).resolves.toEqual({ error: null });
    mockAnswer = { data: null, error: { message: 'nope' } };
    await expect(unpinTournament('t1')).resolves.toEqual({ error: 'nope' });
    expect(mockCalls).toEqual([
      ['from', 'tournament_pins'],
      ['insert', { tournament_id: 't1' }],
      ['from', 'tournament_pins'],
      ['delete'],
      ['eq', 'tournament_id', 't1'],
    ]);
  });

  it('pins with a normalised scope; the server sets whose pin it is', async () => {
    await expect(pinCompetition(' Limassol ', '7-a-side')).resolves.toEqual({ error: null });
    expect(mockCalls).toEqual([
      ['from', 'competition_pins'],
      ['insert', { target_type: 'league', scope: 'limassol', format: '7-a-side' }],
    ]);
  });

  it('unpins by scope and format', async () => {
    mockAnswer = { data: null, error: { message: 'nope' } };
    await expect(unpinCompetition('Limassol', '7-a-side')).resolves.toEqual({ error: 'nope' });
    expect(mockCalls).toEqual([
      ['from', 'competition_pins'],
      ['delete'],
      ['eq', 'target_type', 'league'],
      ['eq', 'scope', 'limassol'],
      ['eq', 'format', '7-a-side'],
    ]);
  });
});
