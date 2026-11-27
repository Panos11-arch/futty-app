import {
  cityKey,
  cyprusYear,
  defaultScope,
  formatRating,
  getTeamOfTheWeek,
  getTeamShape,
  getLeaderboard,
  getLeaderboardScopes,
  getPlayerSeasonStats,
  getTeamOfTheWeekPlayers,
  getTeamRecentMatches,
  getTeamSeasonStats,
  areaOptions,
  isTeamFormat,
  kindLabel,
  lineup,
  listTeamOfTheWeekWeeks,
  listTeamsOfTheWeek,
  pickDefaultTeam,
  playerOfTheWeekLine,
  scopeCaption,
  SLOT_LABELS,
  weekRangeLabel,
  statLine,
  type LeaderboardScope,
  type TeamOfTheWeek,
  type TeamOfTheWeekPlayer,
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
      { profile_id: 'b', name: 'Player', appearances: 5, goals: 3, motm: 0, win_pct: 100, rank: 1, kit: null },
      { profile_id: 'a', name: 'Ann', appearances: 6, goals: 3, motm: 1, win_pct: 80, rank: 2, kit: null },
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
  id: 't',
  week_start: '2026-11-09',
  kind: 'general',
  area: 'all',
  area_key: '',
  area_name: 'All Cyprus',
  league_id: null,
  format: '5-a-side',
  matches: 3,
  ...over,
});

const pick = (over: Partial<TeamOfTheWeekPlayer>): TeamOfTheWeekPlayer => ({
  profile_id: 'p',
  name: 'Player',
  slot: 'mid',
  sort: 1,
  games: 1,
  goals: 0,
  assists: 0,
  clean_sheets: 0,
  average_rating: 7,
  player_of_the_week: false,
  ...over,
});

describe('team of the week', () => {
  it('the weeks with a team in a format, newest first, each once', async () => {
    mockResponses = [
      { data: [{ week_start: '2026-11-16' }, { week_start: '2026-11-16' }, { week_start: '2026-11-09' }], error: null },
    ];
    const { weeks } = await listTeamOfTheWeekWeeks('7-a-side');
    expect(weeks).toEqual(['2026-11-16', '2026-11-09']);
    expect(mockCalls).toContainEqual(['from', 'team_of_the_week']);
    expect(mockCalls).toContainEqual(['eq', 'format', '7-a-side']);
    expect(mockCalls).toContainEqual(['order', 'week_start', { ascending: false }]);
  });

  it('weeks: none yet is empty; an error is passed on', async () => {
    mockResponses = [{ data: null, error: null }];
    expect((await listTeamOfTheWeekWeeks('5-a-side')).weeks).toEqual([]);
    mockResponses = [{ data: null, error: { message: 'boom' } }];
    const failed = await listTeamOfTheWeekWeeks('5-a-side');
    expect(failed.weeks).toEqual([]);
    expect(failed.error).toEqual({ message: 'boom' });
  });

  it('every General and League team of one week and format', async () => {
    mockResponses = [{ data: [totw({ id: 'a' }), totw({ id: 'l', kind: 'league', area: 'league' })], error: null }];
    const { teams } = await listTeamsOfTheWeek('2026-11-09', '5-a-side');
    expect(teams.map((t) => t.id)).toEqual(['a', 'l']);
    expect(mockCalls).toContainEqual(['eq', 'week_start', '2026-11-09']);
    expect(mockCalls).toContainEqual(['eq', 'format', '5-a-side']);
    mockResponses = [{ data: null, error: { message: 'boom' } }];
    const failed = await listTeamsOfTheWeek('2026-11-09', '5-a-side');
    expect(failed.teams).toEqual([]);
    expect(failed.error).toEqual({ message: 'boom' });
  });

  it('one team by id (a notification opens it); null once it is gone; an error is passed on', async () => {
    mockResponses = [{ data: totw({ id: 'x', area_name: 'Limassol' }), error: null }];
    expect((await getTeamOfTheWeek('x')).team?.area_name).toBe('Limassol');
    expect(mockCalls).toContainEqual(['from', 'team_of_the_week']);
    expect(mockCalls).toContainEqual(['eq', 'id', 'x']);
    expect(mockCalls).toContainEqual(['maybeSingle']);
    mockResponses = [{ data: null, error: null }];
    expect((await getTeamOfTheWeek('gone')).team).toBeNull();
    mockResponses = [{ data: null, error: { message: 'boom' } }];
    expect((await getTeamOfTheWeek('x')).error).toEqual({ message: 'boom' });
  });

  it('areaOptions: All Cyprus, then cities, then busy venues, by name; leagues on their own', () => {
    const teams = [
      totw({ id: 'venue', area: 'venue', area_key: 'v1', area_name: 'Kamares' }),
      totw({ id: 'paphos', area: 'city', area_key: 'paphos', area_name: 'Paphos' }),
      totw({ id: 'league', kind: 'league', area: 'league', area_key: 'l1', area_name: 'Limassol League' }),
      totw({ id: 'all' }),
      totw({ id: 'limassol', area: 'city', area_key: 'limassol', area_name: 'Limassol' }),
    ];
    expect(areaOptions(teams, 'general').map((t) => t.id)).toEqual(['all', 'limassol', 'paphos', 'venue']);
    expect(areaOptions(teams, 'league').map((t) => t.id)).toEqual(['league']);
  });

  it('pickDefaultTeam: General · my city, else All Cyprus, else the first there is', () => {
    const all = totw({ id: 'all' });
    const limassol = totw({ id: 'limassol', area: 'city', area_key: 'limassol', area_name: 'Limassol' });
    const venue = totw({ id: 'venue', area: 'venue', area_key: 'v1', area_name: 'Kamares' });
    const league = totw({ id: 'league', kind: 'league', area: 'league', area_key: 'l1', area_name: 'League' });
    expect(pickDefaultTeam([all, limassol, league], 'limassol')?.id).toBe('limassol');
    expect(pickDefaultTeam([all, limassol, league], 'nicosia')?.id).toBe('all');
    expect(pickDefaultTeam([all, limassol], null)?.id).toBe('all');
    expect(pickDefaultTeam([venue, league], 'limassol')?.id).toBe('venue');
    expect(pickDefaultTeam([league], 'limassol')?.id).toBe('league');
    expect(pickDefaultTeam([], 'limassol')).toBeNull();
  });

  it('kind and scope captions', () => {
    expect(kindLabel('general')).toBe('General');
    expect(kindLabel('league')).toBe('League');
    expect(scopeCaption({ kind: 'general', format: '7-a-side' })).toBe('7-a-side · non-league games');
    expect(scopeCaption({ kind: 'league', format: '5-a-side' })).toBe('5-a-side · league games');
  });

  it('isTeamFormat: the five formats only', () => {
    expect(isTeamFormat('9-a-side')).toBe(true);
    expect(isTeamFormat('8-a-side')).toBe(false);
    expect(isTeamFormat(undefined)).toBe(false);
  });

  it('slot names (S15)', () => {
    expect(SLOT_LABELS).toEqual({ gk: 'Goalkeeper', def: 'Defence', mid: 'Midfield', fwd: 'Striker' });
  });

  it('players in their slots, with names', async () => {
    mockResponses = [
      {
        data: [
          { profile_id: 'k', slot: 'gk', sort: 1, games: 1, goals: 0, assists: 0, clean_sheets: 1, average_rating: 7, player_of_the_week: false },
        ],
        error: null,
      },
      names([{ id: 'k', full_name: 'Kostas' }]),
    ];
    const { players } = await getTeamOfTheWeekPlayers('x');
    expect(players[0]).toMatchObject({ profile_id: 'k', name: 'Kostas', slot: 'gk', sort: 1 });
    expect(mockCalls).toContainEqual(['eq', 'team_of_the_week_id', 'x']);
    expect(mockCalls).toContainEqual(['order', 'sort', { ascending: true }]);
  });

  it('a minor: the first name the server gives, never a username (spec 05 section 16)', async () => {
    mockResponses = [
      {
        data: [
          { profile_id: 'm', slot: 'fwd', sort: 1, games: 2, goals: 3, assists: 0, clean_sheets: 0, average_rating: 8.4, player_of_the_week: true },
        ],
        error: null,
      },
      { data: [{ id: 'm', username: null, full_name: 'Eleni' }], error: null },
    ];
    const { players } = await getTeamOfTheWeekPlayers('x');
    expect(players[0].name).toBe('Eleni');
    expect(mockCalls).toContainEqual(['rpc', 'get_public_profiles', { p_profile_ids: ['m'] }]);
  });

  it('players: an error gives none', async () => {
    mockResponses = [{ data: null, error: { message: 'boom' } }];
    const { players, error } = await getTeamOfTheWeekPlayers('x');
    expect(players).toEqual([]);
    expect(error).toEqual({ message: 'boom' });
  });

  it('a format’s shape from the server', async () => {
    mockResponses = [{ data: { format: '7-a-side', keepers: 1, defenders: 2, midfielders: 3, strikers: 1 }, error: null }];
    const { shape } = await getTeamShape('7-a-side');
    expect(shape).toEqual({ format: '7-a-side', keepers: 1, defenders: 2, midfielders: 3, strikers: 1 });
    expect(mockCalls).toContainEqual(['from', 'team_of_the_week_shapes']);
    expect(mockCalls).toContainEqual(['eq', 'format', '7-a-side']);
    mockResponses = [{ data: null, error: null }];
    expect((await getTeamShape('8-a-side')).shape).toBeNull();
  });

  it('lineup: every slot of the shape, keeper first, an empty slot as null', () => {
    const shape = { format: '5-a-side', keepers: 1, defenders: 1, midfielders: 2, strikers: 1 };
    const slots = lineup(
      [pick({ profile_id: 'f', slot: 'fwd', sort: 3 }), pick({ profile_id: 'm1', slot: 'mid', sort: 1 }), pick({ profile_id: 'm2', slot: 'mid', sort: 2 })],
      shape,
    );
    expect(slots.map((s) => `${s.slot}:${s.player?.profile_id ?? '-'}`)).toEqual(['gk:-', 'def:-', 'mid:m1', 'mid:m2', 'fwd:f']);
    expect(lineup([], shape)).toHaveLength(5);
  });

  it('statLine: goals and assists, else clean sheets, else nothing', () => {
    expect(statLine(pick({ goals: 2, assists: 3 }))).toBe('2 G · 3 A');
    expect(statLine(pick({ goals: 1 }))).toBe('1 G');
    expect(statLine(pick({ assists: 1 }))).toBe('1 A');
    expect(statLine(pick({ clean_sheets: 1 }))).toBe('1 clean sheet');
    expect(statLine(pick({ clean_sheets: 2 }))).toBe('2 clean sheets');
    expect(statLine(pick({}))).toBe('');
  });

  it('playerOfTheWeekLine: games, then goals and assists left out at 0', () => {
    expect(playerOfTheWeekLine({ games: 2, goals: 4, assists: 1 })).toBe('2 games · 4 goals, 1 assist');
    expect(playerOfTheWeekLine({ games: 1, goals: 1, assists: 0 })).toBe('1 game · 1 goal');
    expect(playerOfTheWeekLine({ games: 3, goals: 0, assists: 2 })).toBe('3 games · 2 assists');
    expect(playerOfTheWeekLine({ games: 1, goals: 0, assists: 0 })).toBe('1 game');
  });
});

describe('formatting', () => {
  it('a rating with one decimal, a dash for none', () => {
    expect(formatRating(8.44)).toBe('8.4');
    expect(formatRating(7)).toBe('7.0');
    expect(formatRating(null)).toBe('–');
  });

  it('the week: Monday to Sunday, across a month too', () => {
    expect(weekRangeLabel('2026-11-16')).toBe('16–22 Nov');
    expect(weekRangeLabel('2026-11-30')).toBe('30 Nov – 6 Dec');
    expect(weekRangeLabel('2026-12-28')).toBe('28 Dec – 3 Jan');
  });
});
