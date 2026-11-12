import {
  getHeadToHead,
  getMyTeammates,
  getPlayerForm,
  getPlayerRecentMatches,
  getPublicNames,
  getTeamForm,
  recentRowToListItem,
} from '@/lib/match/profile-api';
import type { PlayerRecentMatchRow } from '@/lib/match/types';

type Call = [string, ...unknown[]];
let mockCalls: Call[] = [];
let mockResponse: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock('@/lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) {
    query[method] = (...args: unknown[]) => {
      mockCalls.push([method, ...args]);
      return query;
    };
  }
  query.maybeSingle = () => {
    mockCalls.push(['maybeSingle']);
    return query;
  };
  query.then = (resolve: (r: unknown) => unknown) => resolve(mockResponse);
  return {
    supabase: {
      from: (table: string) => {
        mockCalls.push(['from', table]);
        return query;
      },
      rpc: (fn: string, args: unknown) => {
        mockCalls.push(['rpc', fn, args]);
        return query;
      },
    },
  };
});

beforeEach(() => {
  mockCalls = [];
  mockResponse = { data: [], error: null };
});

const recentRow = (over: Partial<PlayerRecentMatchRow> = {}): PlayerRecentMatchRow => ({
  profile_id: 'me',
  match_id: 'm1',
  kickoff_at: '2026-11-07T17:00:00Z',
  kickoff_local: '2026-11-07T19:00:00',
  venue_id: 'v1',
  venue_name: 'Nuevo Campo',
  kind: 'named',
  side: 'b',
  label: 'Tigers',
  opponent_label: 'Lions',
  team_id: 't2',
  opponent_team_id: 't1',
  goals_for: 3,
  goals_against: 1,
  result: 'W',
  forfeit_side: null,
  forfeit_reason: null,
  ...over,
});

describe('getPlayerForm', () => {
  it('reads player_form for the player, newest first by position, and keeps the server results', async () => {
    mockResponse = {
      data: [
        { position: 1, result: 'L_forfeit' },
        { position: 2, result: 'W' },
        { position: 3, result: 'D' },
      ],
      error: null,
    };
    const { form, error } = await getPlayerForm('p1');
    expect(error).toBeNull();
    expect(form).toEqual(['L_forfeit', 'W', 'D']);
    expect(mockCalls).toEqual([
      ['from', 'player_form'],
      ['select', 'position, result'],
      ['eq', 'profile_id', 'p1'],
      ['order', 'position', { ascending: true }],
    ]);
  });

  it('passes an error on', async () => {
    mockResponse = { data: null, error: { message: 'boom' } };
    const { form, error } = await getPlayerForm('p1');
    expect(form).toEqual([]);
    expect(error).toEqual({ message: 'boom' });
  });
});

describe('getTeamForm', () => {
  it('reads team_form for the team in position order', async () => {
    mockResponse = { data: [{ position: 1, result: 'D' }, { position: 2, result: 'L' }], error: null };
    const { form } = await getTeamForm('t1');
    expect(form).toEqual(['D', 'L']);
    expect(mockCalls).toEqual([
      ['from', 'team_form'],
      ['select', 'position, result'],
      ['eq', 'team_id', 't1'],
      ['order', 'position', { ascending: true }],
    ]);
  });
});

describe('getPlayerRecentMatches', () => {
  it('reads player_recent_matches, newest first, limited', async () => {
    mockResponse = { data: [recentRow()], error: null };
    const { rows } = await getPlayerRecentMatches('p1', 5);
    expect(rows).toHaveLength(1);
    expect(mockCalls).toEqual([
      ['from', 'player_recent_matches'],
      ['select', '*'],
      ['eq', 'profile_id', 'p1'],
      ['order', 'kickoff_at', { ascending: false }],
      ['order', 'match_id', { ascending: true }],
      ['limit', 5],
    ]);
  });
});

describe('getHeadToHead', () => {
  it('reads one row for the pair, from the first team’s side', async () => {
    const row = { team_id: 't1', opponent_team_id: 't2', played: 4, won: 2, drawn: 1, lost: 1, goals_for: 9, goals_against: 7, last_3: [] };
    mockResponse = { data: row, error: null };
    const { record } = await getHeadToHead('t1', 't2');
    expect(record).toEqual(row);
    expect(mockCalls).toEqual([
      ['from', 'head_to_head'],
      ['select', '*'],
      ['eq', 'team_id', 't1'],
      ['eq', 'opponent_team_id', 't2'],
      ['maybeSingle'],
    ]);
  });

  it('gives null when the teams have never met', async () => {
    mockResponse = { data: null, error: null };
    expect((await getHeadToHead('t1', 't2')).record).toBeNull();
  });
});

describe('getMyTeammates', () => {
  it('reads player_teammates (the caller’s own rows only, by the view), most games first', async () => {
    mockResponse = { data: [{ teammate_profile_id: 'x', matches_together: 3 }], error: null };
    const { rows } = await getMyTeammates(5);
    expect(rows).toHaveLength(1);
    expect(mockCalls).toEqual([
      ['from', 'player_teammates'],
      ['select', 'teammate_profile_id, matches_together, last_played_at'],
      ['order', 'matches_together', { ascending: false }],
      ['order', 'last_played_at', { ascending: false }],
      ['limit', 5],
    ]);
  });
});

describe('getPublicNames', () => {
  it('asks get_public_profiles and maps ids to names', async () => {
    mockResponse = { data: [{ id: 'a', username: 'andy', full_name: 'Andreas K' }, { id: 'b', username: 'bo', full_name: null }], error: null };
    const { names } = await getPublicNames(['a', 'b']);
    expect(names).toEqual({ a: 'Andreas K', b: 'bo' });
    expect(mockCalls[0]).toEqual(['rpc', 'get_public_profiles', { p_profile_ids: ['a', 'b'] }]);
  });

  it('skips the call with no ids', async () => {
    expect((await getPublicNames([])).names).toEqual({});
    expect(mockCalls).toEqual([]);
  });
});

describe('recentRowToListItem', () => {
  it('puts the player’s side back where it was, with the server’s score', () => {
    const item = recentRowToListItem(recentRow());
    expect(item.match).toMatchObject({ id: 'm1', kind: 'named', status: 'confirmed', kickoff_at: '2026-11-07T17:00:00Z' });
    expect(item.sides.a.label).toBe('Lions');
    expect(item.sides.b.label).toBe('Tigers');
    expect(item.result).toMatchObject({ side_a_score: 1, side_b_score: 3, outcome: 'side_b_won' });
    expect(item.venueName).toBe('Nuevo Campo');
  });

  it('keeps a forfeit as the server sent it, with no score', () => {
    const item = recentRowToListItem(
      recentRow({ side: 'a', label: 'Lions', opponent_label: 'Tigers', goals_for: null, goals_against: null, result: 'L_forfeit', forfeit_side: 'a', forfeit_reason: 'no_show' }),
    );
    expect(item.result).toMatchObject({ side_a_score: null, side_b_score: null, forfeit_side: 'a', forfeit_reason: 'no_show', outcome: 'side_b_won' });
  });

  it('a draw has no winner', () => {
    const item = recentRowToListItem(recentRow({ goals_for: 2, goals_against: 2, result: 'D' }));
    expect(item.result?.outcome).toBe('draw');
  });
});
