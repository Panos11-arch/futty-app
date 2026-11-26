import { listPins, pinCompetition, unpinCompetition } from '@/lib/match/pins';

type Call = [string, ...unknown[]];
let mockCalls: Call[] = [];
let mockAnswer: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => {
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'insert', 'delete', 'eq', 'order']) {
      q[method] = (...args: unknown[]) => {
        mockCalls.push([method, ...args]);
        return q;
      };
    }
    q.then = (resolve: (r: unknown) => unknown) => resolve(mockAnswer);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        mockCalls.push(['from', table]);
        return query();
      },
    },
  };
});

beforeEach(() => {
  mockCalls = [];
  mockAnswer = { data: null, error: null };
});

describe('competition pins', () => {
  it('lists my pins, oldest first', async () => {
    mockAnswer = { data: [{ target_type: 'league', scope: 'limassol', format: '5-a-side' }], error: null };
    await expect(listPins()).resolves.toEqual({ pins: [{ target_type: 'league', scope: 'limassol', format: '5-a-side' }], error: null });
    expect(mockCalls).toEqual([
      ['from', 'competition_pins'],
      ['select', 'target_type, scope, format'],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('a failed read returns the error and no pins', async () => {
    mockAnswer = { data: null, error: { message: 'offline' } };
    await expect(listPins()).resolves.toEqual({ pins: [], error: 'offline' });
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
