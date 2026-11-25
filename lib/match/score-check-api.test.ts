import { getMyScoresToCheck, respondToMatchScore } from '@/lib/match/score-check-api';

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

describe('score-check-api', () => {
  it('sends only the match id and Accept or Reject; returns what the server decided', async () => {
    mockAnswers.respond_to_match_score = { data: { status: 'accepted', ignored: false }, error: null };
    expect(await respondToMatchScore('m1', true)).toEqual({ result: { status: 'accepted', ignored: false }, error: null });
    expect(mockCalls).toEqual([['respond_to_match_score', { p_match_id: 'm1', p_accept: true }]]);

    mockAnswers.respond_to_match_score = { data: null, error: { message: 'cannot_check_score' } };
    expect(await respondToMatchScore('m1', false)).toEqual({ result: null, error: { message: 'cannot_check_score' } });
  });

  it("reads Home's cards", async () => {
    const card = {
      matchId: 'm1',
      kickoffAt: '2026-11-25T18:00:00.000Z',
      labelA: 'Bibs',
      labelB: 'Non-bibs',
      sideAScore: 2,
      sideBScore: 1,
      checkUntil: '2026-11-26T20:00:00.000Z',
    };
    mockAnswers.get_my_scores_to_check = { data: [card], error: null };
    expect(await getMyScoresToCheck()).toEqual({ scores: [card], error: null });
    expect(mockCalls).toEqual([['get_my_scores_to_check', undefined]]);

    mockAnswers.get_my_scores_to_check = { data: null, error: { message: 'boom' } };
    expect(await getMyScoresToCheck()).toEqual({ scores: [], error: { message: 'boom' } });
  });
});
