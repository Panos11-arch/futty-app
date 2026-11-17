import {
  castMotmVote,
  getFormationPresets,
  getMatchPage,
  getMatchRoster,
  setMatchGoals,
  setMatchLineup,
} from '@/lib/match/page-api';
import { mockMatchPage } from '@/lib/match/mock';

type Call = [string, ...unknown[]];
let mockCalls: Call[] = [];
/** Answers by table or function name. */
let mockAnswers: Record<string, { data: unknown; error: unknown }> = {};

jest.mock('@/lib/supabase', () => {
  const query = (name: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order']) {
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

describe('getMatchPage', () => {
  it('asks get_match_page with the match id', async () => {
    const page = mockMatchPage();
    mockAnswers.get_match_page = { data: page, error: null };
    await expect(getMatchPage('m1')).resolves.toEqual({ page, error: null });
    expect(mockCalls).toContainEqual(['rpc', 'get_match_page', { p_match_id: 'm1' }]);
  });

  it('match_not_found is "no page", not an error', async () => {
    mockAnswers.get_match_page = { data: null, error: { message: 'match_not_found' } };
    await expect(getMatchPage('m1')).resolves.toEqual({ page: null, error: null });
  });

  it('anything else is an error', async () => {
    mockAnswers.get_match_page = { data: null, error: { message: 'boom' } };
    await expect(getMatchPage('m1')).resolves.toEqual({ page: null, error: { message: 'boom' } });
  });
});

describe('getMatchRoster', () => {
  it('joins the squad, check-ins and public names; guests keep their name', async () => {
    mockAnswers.match_players = {
      data: [
        { id: 'p1', side: 'a', profile_id: 'u1', guest_name: null, left_at: null },
        { id: 'p2', side: 'a', profile_id: null, guest_name: 'Kostas', left_at: null },
        { id: 'p3', side: 'b', profile_id: 'u3', guest_name: null, left_at: '2026-11-14T17:00:00Z' },
      ],
      error: null,
    };
    mockAnswers.match_attendance = { data: [{ profile_id: 'u1' }], error: null };
    mockAnswers.get_public_profiles = {
      data: [
        { id: 'u1', username: 'one', full_name: 'User One' },
        { id: 'u3', username: 'three', full_name: null },
      ],
      error: null,
    };
    const { roster, error } = await getMatchRoster('m1');
    expect(error).toBeNull();
    expect(roster).toEqual([
      { id: 'p1', side: 'a', profileId: 'u1', guestName: null, name: 'User One', leftAt: null, checkedIn: true },
      { id: 'p2', side: 'a', profileId: null, guestName: 'Kostas', name: 'Kostas', leftAt: null, checkedIn: false },
      { id: 'p3', side: 'b', profileId: 'u3', guestName: null, name: 'three', leftAt: '2026-11-14T17:00:00Z', checkedIn: false },
    ]);
    expect(mockCalls).toContainEqual(['rpc', 'get_public_profiles', { p_profile_ids: ['u1', 'u3'] }]);
  });

  it('an error from either read is returned', async () => {
    mockAnswers.match_players = { data: [], error: null };
    mockAnswers.match_attendance = { data: null, error: { message: 'denied' } };
    await expect(getMatchRoster('m1')).resolves.toEqual({ roster: [], error: { message: 'denied' } });
  });
});

it('getFormationPresets reads the presets for that many players, in order', async () => {
  mockAnswers.match_formation_presets = { data: [{ formation: '2-2-1' }, { formation: '3-1-1' }], error: null };
  await expect(getFormationPresets(6)).resolves.toEqual({ formations: ['2-2-1', '3-1-1'], error: null });
  expect(mockCalls).toContainEqual(['eq', 'players_per_side', 6]);
  expect(mockCalls).toContainEqual(['order', 'sort']);
});

describe('writes send ids only', () => {
  it('set_match_goals without a side for a one-side captain', () => {
    setMatchGoals('m1', [{ scorerPlayerId: null, assistPlayerId: null }]);
    expect(mockCalls).toContainEqual([
      'rpc',
      'set_match_goals',
      { p_match_id: 'm1', p_goals: [{ scorerPlayerId: null, assistPlayerId: null }] },
    ]);
  });

  it('set_match_goals with p_side for a pickup booker', () => {
    setMatchGoals('m1', [], 'b');
    expect(mockCalls).toContainEqual(['rpc', 'set_match_goals', { p_match_id: 'm1', p_goals: [], p_side: 'b' }]);
  });

  it('cast_motm_vote', () => {
    castMotmVote('m1', 'p2');
    expect(mockCalls).toContainEqual(['rpc', 'cast_motm_vote', { p_match_id: 'm1', p_nominee_player_id: 'p2' }]);
  });

  it('set_match_lineup', () => {
    setMatchLineup('m1', 'a', '2-2', { gk: 'p1', d1: null });
    expect(mockCalls).toContainEqual([
      'rpc',
      'set_match_lineup',
      { p_match_id: 'm1', p_side: 'a', p_formation: '2-2', p_positions: { gk: 'p1', d1: null } },
    ]);
  });
});
