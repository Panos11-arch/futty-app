import {
  type DayFixture,
  filterDayFixtures,
  fixtureStatusLabel,
  groupFixturesByCompetition,
  listLeagueFixturesOnDay,
  shiftDayKey,
} from '@/lib/match/day-fixtures';

type Call = [string, ...unknown[]];
let mockCalls: Call[] = [];
let mockAnswer: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) {
    q[method] = (...args: unknown[]) => {
      mockCalls.push([method, ...args]);
      return q;
    };
  }
  q.then = (resolve: (r: unknown) => unknown) => resolve(mockAnswer);
  return { supabase: { from: (t: string) => (mockCalls.push(['from', t]), q) } };
});

beforeEach(() => {
  mockCalls = [];
  mockAnswer = { data: [], error: null };
});

const fixture = (over: Partial<DayFixture>): DayFixture => ({
  id: 'f1',
  league_id: 'l1',
  scheduled_day: '2026-11-26',
  scheduled_time: '20:00:00',
  status: 'agreed',
  home_score: null,
  away_score: null,
  forfeit_result: null,
  home_team: { id: 'ta', name: 'Lions' },
  away_team: { id: 'tb', name: 'Tigers' },
  league: { id: 'l1', name: 'Limassol 5s', format: '5-a-side', scope: 'Limassol', parent_league_id: null },
  ...over,
});

describe('listLeagueFixturesOnDay', () => {
  it('reads league fixtures on that Cyprus day, by kick-off', async () => {
    mockAnswer = { data: [fixture({})], error: null };
    await expect(listLeagueFixturesOnDay('2026-11-26')).resolves.toEqual({ fixtures: [fixture({})], error: null });
    expect(mockCalls[0]).toEqual(['from', 'league_fixtures']);
    expect(mockCalls[1][0]).toBe('select');
    expect(mockCalls.slice(2)).toEqual([
      ['eq', 'scheduled_day', '2026-11-26'],
      ['order', 'scheduled_time', { ascending: true }],
    ]);
  });

  it('a failed read is an error', async () => {
    mockAnswer = { data: null, error: { message: 'offline' } };
    await expect(listLeagueFixturesOnDay('2026-11-26')).resolves.toEqual({ fixtures: [], error: 'offline' });
  });
});

describe('fixtureStatusLabel', () => {
  it('shows the kick-off time, FT once completed, and a dash with no time', () => {
    expect(fixtureStatusLabel(fixture({}))).toBe('20:00');
    expect(fixtureStatusLabel(fixture({ status: 'completed', home_score: 2, away_score: 1 }))).toBe('FT');
    expect(fixtureStatusLabel(fixture({ scheduled_time: null }))).toBe('–');
  });
});

describe('shiftDayKey', () => {
  it('moves a Cyprus day by whole days across months and years', () => {
    expect(shiftDayKey('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDayKey('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDayKey('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('groupFixturesByCompetition', () => {
  const names = new Map([['league:limassol:5-a-side', 'Limassol 5s'], ['league:nicosia:7-a-side', 'Nicosia 7s']]);

  it('groups by competition (a division joins its league), names it, and keeps the area', () => {
    const groups = groupFixturesByCompetition(
      [
        fixture({ id: 'a' }),
        fixture({ id: 'b', league: { id: 'd1', name: 'Division 1', format: '5-a-side', scope: 'Limassol', parent_league_id: 'l1' } }),
      ],
      { myTeamIds: new Set(), pinnedKeys: new Set(), names },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'league:limassol:5-a-side', name: 'Limassol 5s', area: 'Limassol', scope: 'limassol', format: '5-a-side' });
    expect(groups[0].fixtures.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('my teams first: groups with my fixtures, then pinned, then by name; my fixtures first in a group, then by time', () => {
    const groups = groupFixturesByCompetition(
      [
        fixture({ id: 'n1', scheduled_time: '18:00:00', league: { id: 'n', name: 'Nicosia 7s', format: '7-a-side', scope: 'Nicosia', parent_league_id: null } }),
        fixture({ id: 'l-early', scheduled_time: '18:00:00' }),
        fixture({ id: 'l-mine', scheduled_time: '21:00:00', home_team: { id: 'mine', name: 'Mine FC' } }),
        fixture({ id: 'i1', league: { id: 'i', name: 'Cyprus Open 9s', format: '9-a-side', scope: 'Island-wide', parent_league_id: null } }),
      ],
      { myTeamIds: new Set(['mine']), pinnedKeys: new Set(['league:nicosia:7-a-side']), names },
    );
    expect(groups.map((g) => g.key)).toEqual(['league:limassol:5-a-side', 'league:nicosia:7-a-side', 'league:island-wide:9-a-side']);
    expect(groups[0].mine).toBe(true);
    expect(groups[1].pinned).toBe(true);
    expect(groups[2]).toMatchObject({ area: 'Island-wide', name: 'Cyprus Open 9-a-side League' });
    expect(groups[0].fixtures.map((f) => f.id)).toEqual(['l-mine', 'l-early']);
  });

  it('without a known name, names the competition from the area and format', () => {
    const [group] = groupFixturesByCompetition([fixture({ league: { id: 'p', name: 'Division 2', format: '6-a-side', scope: 'paphos', parent_league_id: 'x' } })], {
      myTeamIds: new Set(),
      pinnedKeys: new Set(),
      names: new Map(),
    });
    expect(group.name).toBe('Paphos 6-a-side League');
  });

  it('skips a fixture without a league', () => {
    expect(groupFixturesByCompetition([fixture({ league: null })], { myTeamIds: new Set(), pinnedKeys: new Set(), names })).toEqual([]);
  });
});

describe('filterDayFixtures', () => {
  const all = [
    fixture({ id: 'a' }),
    fixture({ id: 'b', league: { id: 'n', name: 'N', format: '7-a-side', scope: 'Nicosia', parent_league_id: null } }),
  ];

  it('keeps everything with no filter', () => {
    expect(filterDayFixtures(all, { format: null, scope: null }).map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('filters by format and by city (any case)', () => {
    expect(filterDayFixtures(all, { format: '7-a-side', scope: null }).map((f) => f.id)).toEqual(['b']);
    expect(filterDayFixtures(all, { format: null, scope: 'limassol' }).map((f) => f.id)).toEqual(['a']);
    expect(filterDayFixtures(all, { format: '7-a-side', scope: 'limassol' })).toEqual([]);
  });
});
