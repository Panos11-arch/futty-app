import {
  cityKey,
  cyprusYear,
  defaultScope,
  formatRating,
  formatWeekOf,
  getLatestTeamsOfTheWeek,
  getLeaderboard,
  getLeaderboardScopes,
  getPlayerSeasonStats,
  getTeamOfTheWeekPlayers,
  getTeamRecentMatches,
  getTeamSeasonStats,
  teamForCity,
  type LeaderboardScope,
  type TeamOfTheWeek,
} from '@/lib/match/stats-api';

type Call = [string, ...unknown[]];
let mockCalls: Call[] = [];
let mockResponses: { data: unknown; error: unknown }[] = [];

jest.mock('@/lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'maybeSingle']) {
    query[method] = (...args: unknown[]) => {
      mockCalls.push([method, ...args]);
      return query;
    };
  }
  query.then = (resolve: (r: unknown) => unknown) => resolve(mockResponses.shift() ?? { data: [], error: null });
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
  mockResponses = [];
});

const names = (rows: { id: string; full_name: string }[]) => ({ data: rows, error: null });

describe('cyprusYear', () => {
  it('uses Cyprus time: 22:30 UTC on 31 December is 00:30 on 1 January there', () => {
    expect(cyprusYear(new Date('2025-12-31T22:30:00Z'))).toBe(2026);
    expect(cyprusYear(new Date('2025-12-31T21:30:00Z'))).toBe(2025);
  });
});

describe('cityKey', () => {
  it('matches the server: trimmed, lower case, null when empty', () => {
    expect(cityKey(' Nicosia ')).toBe('nicosia');
    expect(cityKey('  ')).toBeNull();
    expect(cityKey(null)).toBeNull();
  });
});

describe('season stats', () => {
  it('reads a player’s year', async () => {
    mockResponses = [{ data: { appearances: 5 }, error: null }];
    const { stats } = await getPlayerSeasonStats('p', { kind: 'year', year: 2026 });
    expect(stats).toEqual({ appearances: 5 });
    expect(mockCalls).toEqual(
      expect.arrayContaining([
        ['from', 'player_season_stats'],
        ['eq', 'profile_id', 'p'],
        ['eq', 'season_kind', 'year'],
        ['eq', 'season_year', 2026],
        ['maybeSingle'],
      ]),
    );
  });

  it('all time has no year; no row is null', async () => {
    mockResponses = [{ data: null, error: null }];
    const { stats } = await getTeamSeasonStats('t', { kind: 'all' });
    expect(stats).toBeNull();
    expect(mockCalls).toContainEqual(['eq', 'season_kind', 'all']);
    expect(mockCalls.some((c) => c[0] === 'eq' && c[1] === 'season_year')).toBe(false);
  });
});

describe('getTeamRecentMatches', () => {
  it('gives named recent-match rows, newest first', async () => {
    mockResponses = [{ data: [{ team_id: 't', match_id: 'm', result: 'W' }], error: null }];
    const { rows } = await getTeamRecentMatches('t', 5);
    expect(rows).toEqual([{ team_id: 't', match_id: 'm', result: 'W', profile_id: '', kind: 'named' }]);
    expect(mockCalls).toContainEqual(['order', 'kickoff_at', { ascending: false }]);
    expect(mockCalls).toContainEqual(['limit', 5]);
  });
});

describe('leaderboards', () => {
  it('lists each scope once', async () => {
    mockResponses = [
      {
        data: [
          { scope: 'city', scope_key: 'nicosia', scope_name: 'Nicosia' },
          { scope: 'city', scope_key: 'nicosia', scope_name: 'Nicosia' },
          { scope: 'venue', scope_key: 'v1', scope_name: 'North Arena' },
        ],
        error: null,
      },
    ];
    const { scopes } = await getLeaderboardScopes(2026);
    expect(scopes.map((s) => s.scope_key)).toEqual(['nicosia', 'v1']);
  });

  it('keeps the server’s order and rank for the board, with names', async () => {
    mockResponses = [
      {
        data: [
          { profile_id: 'b', appearances: 5, goals: 3, motm: 0, win_pct: 100, win_rate_rank: 1 },
          { profile_id: 'a', appearances: 6, goals: 3, motm: 1, win_pct: 80, win_rate_rank: 2 },
        ],
        error: null,
      },
      names([{ id: 'a', full_name: 'Ann' }]),
    ];
    const scope: LeaderboardScope = { scope: 'city', scope_key: 'nicosia', scope_name: 'Nicosia' };
    const { rows } = await getLeaderboard(scope, 2026, 'win_rate');
    expect(rows).toEqual([
      { profile_id: 'b', name: 'Player', appearances: 5, goals: 3, motm: 0, win_pct: 100, rank: 1 },
      { profile_id: 'a', name: 'Ann', appearances: 6, goals: 3, motm: 1, win_pct: 80, rank: 2 },
    ]);
    expect(mockCalls).toContainEqual(['order', 'win_rate_rank', { ascending: true }]);
    expect(mockCalls).toContainEqual(['eq', 'scope_key', 'nicosia']);
  });

  it('picks the viewer’s city first', () => {
    const scopes: LeaderboardScope[] = [
      { scope: 'city', scope_key: 'limassol', scope_name: 'Limassol' },
      { scope: 'city', scope_key: 'nicosia', scope_name: 'Nicosia' },
    ];
    expect(defaultScope(scopes, 'Nicosia')?.scope_key).toBe('nicosia');
    expect(defaultScope(scopes, null)?.scope_key).toBe('limassol');
    expect(defaultScope([], 'Nicosia')).toBeNull();
  });
});

const totw = (over: Partial<TeamOfTheWeek>): TeamOfTheWeek => ({
  id: 'x',
  week_start: '2026-11-09',
  scope: 'city',
  venue_id: null,
  city_key: 'nicosia',
  league_id: null,
  name: 'Nicosia',
  matches: 3,
  ...over,
});

describe('team of the week', () => {
  it('keeps only the latest week', async () => {
    mockResponses = [
      {
        data: [totw({ id: 'new1' }), totw({ id: 'new2', scope: 'venue' }), totw({ id: 'old', week_start: '2026-11-02' })],
        error: null,
      },
    ];
    const { teams } = await getLatestTeamsOfTheWeek();
    expect(teams.map((t) => t.id)).toEqual(['new1', 'new2']);
  });

  it('nothing at all is an empty list', async () => {
    mockResponses = [{ data: [], error: null }];
    expect((await getLatestTeamsOfTheWeek()).teams).toEqual([]);
  });

  it('the viewer’s city: its own team first, else a venue team there', () => {
    const venue = totw({ id: 'v', scope: 'venue', venue_id: 'v1' });
    const city = totw({ id: 'c' });
    const elsewhere = totw({ id: 'l', city_key: 'limassol' });
    expect(teamForCity([venue, city, elsewhere], ' NICOSIA')?.id).toBe('c');
    expect(teamForCity([venue, elsewhere], 'Nicosia')?.id).toBe('v');
    expect(teamForCity([elsewhere], 'Nicosia')).toBeNull();
    expect(teamForCity([city], null)).toBeNull();
  });

  it('players in their slots, with names', async () => {
    mockResponses = [
      { data: [{ profile_id: 'k', position_group: 'gk', sort: 1, average_rating: 7, rated_matches: 1, motm: 0, goals: 0 }], error: null },
      names([{ id: 'k', full_name: 'Kostas' }]),
    ];
    const { players } = await getTeamOfTheWeekPlayers('x');
    expect(players[0]).toMatchObject({ profile_id: 'k', name: 'Kostas', sort: 1 });
    expect(mockCalls).toContainEqual(['order', 'sort', { ascending: true }]);
  });
});

describe('formatting', () => {
  it('a rating with one decimal, a dash for none', () => {
    expect(formatRating(8.44)).toBe('8.4');
    expect(formatRating(7)).toBe('7.0');
    expect(formatRating(null)).toBe('–');
  });

  it('the week', () => {
    expect(formatWeekOf('2026-11-09')).toBe('Week of 9 Nov');
  });
});
