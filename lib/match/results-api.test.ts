import { findMatchLinks, getResultMatch, listMyOpenResultMatches, MATCH_LINK_CHUNK } from '@/lib/match/results-api';

type Request = { table: string; select?: string; filters: [string, ...unknown[]][] };
let mockRequests: Request[] = [];
/** Answers each request in order; a missing answer is an empty success. */
let mockAnswers: { data: unknown; error: unknown }[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const request: Request = { table, filters: [] };
      mockRequests.push(request);
      const answer = mockAnswers[mockRequests.length - 1] ?? { data: [], error: null };
      const q: Record<string, unknown> = {
        select: (columns: string) => {
          request.select = columns;
          return q;
        },
        then: (resolve: (r: unknown) => unknown) => resolve(answer),
      };
      for (const method of ['eq', 'in', 'or', 'lte', 'gt', 'order', 'maybeSingle']) {
        q[method] = (...args: unknown[]) => {
          request.filters.push([method, ...args]);
          return q;
        };
      }
      return q;
    },
  },
}));

beforeEach(() => {
  mockRequests = [];
  mockAnswers = [];
});

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
/** The ids one request asks about, from its single .in(column, ids). */
const asked = (r: Request) => {
  const inFilters = r.filters.filter((f) => f[0] === 'in');
  expect(inFilters).toHaveLength(1);
  return { column: inFilters[0][1] as string, ids: inFilters[0][2] as string[] };
};

describe('findMatchLinks', () => {
  it('0 ids: asks nothing', async () => {
    await expect(findMatchLinks({ bookingIds: [], friendlyMatchIds: [], leagueFixtureIds: [] })).resolves.toEqual({
      links: { byBookingId: new Map(), byFriendlyMatchId: new Map(), byLeagueFixtureId: new Map() },
      error: null,
    });
    expect(mockRequests).toHaveLength(0);
  });

  it('1 id: one request, and the link it finds', async () => {
    mockAnswers = [{ data: [{ id: 'm1', booking_id: 'b0', friendly_match_id: null, league_fixture_id: null }], error: null }];
    const { links, error } = await findMatchLinks({ bookingIds: ['b0'] });
    expect(error).toBeNull();
    expect(mockRequests).toHaveLength(1);
    expect(asked(mockRequests[0])).toEqual({ column: 'booking_id', ids: ['b0'] });
    expect(links.byBookingId.get('b0')).toBe('m1');
  });

  // A player with many past games: one URL with every id is over the
  // gateway's limit (HTTP 414 "URI too long" at about 8 KB, ~220 ids).
  it('250 booking ids plus friendlies and fixtures: chunked, every id asked once, links merged', async () => {
    const bookingIds = ids('b', 250);
    const friendlyMatchIds = ids('f', 3);
    const leagueFixtureIds = ids('l', 2);
    mockAnswers = [
      { data: [{ id: 'm-b7', booking_id: 'b7', friendly_match_id: null, league_fixture_id: null }], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ id: 'm-b249', booking_id: 'b249', friendly_match_id: null, league_fixture_id: null }], error: null },
      { data: [{ id: 'm-f1', booking_id: null, friendly_match_id: 'f1', league_fixture_id: null }], error: null },
      { data: [{ id: 'm-l0', booking_id: null, friendly_match_id: null, league_fixture_id: 'l0' }], error: null },
    ];
    const { links, error } = await findMatchLinks({ bookingIds, friendlyMatchIds, leagueFixtureIds });

    expect(error).toBeNull();
    for (const r of mockRequests) {
      expect(r.table).toBe('matches');
      expect(r.filters.some((f) => f[0] === 'or')).toBe(false);
      expect(asked(r).ids.length).toBeLessThanOrEqual(MATCH_LINK_CHUNK);
    }
    const byColumn = (column: string) =>
      mockRequests.map(asked).filter((a) => a.column === column).flatMap((a) => a.ids);
    expect(byColumn('booking_id')).toEqual(bookingIds);
    expect(byColumn('friendly_match_id')).toEqual(friendlyMatchIds);
    expect(byColumn('league_fixture_id')).toEqual(leagueFixtureIds);
    expect(mockRequests).toHaveLength(7);

    expect(links.byBookingId).toEqual(new Map([['b7', 'm-b7'], ['b249', 'm-b249']]));
    expect(links.byFriendlyMatchId).toEqual(new Map([['f1', 'm-f1']]));
    expect(links.byLeagueFixtureId).toEqual(new Map([['l0', 'm-l0']]));
  });

  it('a failing chunk is the error, with no partial links', async () => {
    const failure = { message: 'URI too long', code: '' };
    mockAnswers = [
      { data: [{ id: 'm1', booking_id: 'b0', friendly_match_id: null, league_fixture_id: null }], error: null },
      { data: null, error: failure },
    ];
    const { links, error } = await findMatchLinks({ bookingIds: ids('b', 60) });
    expect(error).toBe(failure);
    expect(links.byBookingId.size).toBe(0);
  });
});

// match_ratings (A5a, 17 Nov) references both matches and match_players, so
// PostgREST sees a second path and refuses a plain "match_players (...)"
// embed with PGRST201. The embed names its foreign key.
describe('result reads name the match_players foreign key', () => {
  const embedsPlayersByFk = (select: string | undefined) => {
    expect(select).toMatch(/match_players!match_players_match_id_fkey\s*\(/);
    expect(select).not.toMatch(/match_players\s*\(/);
  };

  it('listMyOpenResultMatches', async () => {
    await listMyOpenResultMatches('viewer', new Date('2026-11-22T10:00:00Z'));
    embedsPlayersByFk(mockRequests[0].select);
    expect(mockRequests[0].filters).toContainEqual(['eq', 'match_players.profile_id', 'viewer']);
  });

  it('getResultMatch', async () => {
    mockAnswers = [{ data: null, error: null }];
    await getResultMatch('m1', 'viewer');
    embedsPlayersByFk(mockRequests[0].select);
  });
});
