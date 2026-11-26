import {
  followLine,
  getMyProfileRecent,
  getMyProfileSeason,
  getMyProfileSummary,
  goalsAssistsLabel,
  levelProgress,
  levelRightLabel,
  profileSubtitle,
  recentGameWhere,
  seasonTiles,
  teamSubtitle,
} from '@/lib/match/profile-summary-api';

let mockCalls: [string, unknown][] = [];
let mockResponse: { data: unknown; error: { message: string } | null } = { data: null, error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      mockCalls.push([fn, args]);
      return Promise.resolve(mockResponse);
    },
  },
}));

beforeEach(() => {
  mockCalls = [];
  mockResponse = { data: null, error: null };
});

describe('reads', () => {
  it('reads the summary and turns numeric strings into numbers', async () => {
    mockResponse = {
      data: { followers: 128, following: 96, level: '6.40', provisional: false, levelChangeMonth: '0.20' },
      error: null,
    };
    const r = await getMyProfileSummary();
    expect(mockCalls).toEqual([['my_profile_summary', undefined]]);
    expect(r).toEqual({
      value: { followers: 128, following: 96, level: 6.4, provisional: false, levelChangeMonth: 0.2 },
    });
  });

  it('keeps a missing level as null', async () => {
    mockResponse = { data: { followers: 0, following: 0, level: null, provisional: null, levelChangeMonth: null }, error: null };
    const r = await getMyProfileSummary();
    expect(r).toEqual({ value: { followers: 0, following: 0, level: null, provisional: null, levelChangeMonth: null } });
  });

  it('passes a summary error on', async () => {
    mockResponse = { data: null, error: { message: 'boom' } };
    expect(await getMyProfileSummary()).toEqual({ error: 'boom' });
  });

  it('reads the season for a format, or all formats', async () => {
    mockResponse = {
      data: { formats: ['5-a-side'], games: 24, wins: 14, goals: 19, assists: 11, motm: 4, avgRating: '7.30', totw: 3 },
      error: null,
    };
    const r = await getMyProfileSeason('5-a-side');
    expect(mockCalls).toEqual([['my_profile_season', { p_format: '5-a-side' }]]);
    expect(r).toEqual({
      value: { formats: ['5-a-side'], games: 24, wins: 14, goals: 19, assists: 11, motm: 4, avgRating: 7.3, totw: 3 },
    });
    await getMyProfileSeason(null);
    expect(mockCalls[1]).toEqual(['my_profile_season', { p_format: null }]);
  });

  it('treats an empty season answer as zeros', async () => {
    mockResponse = { data: null, error: null };
    expect(await getMyProfileSeason(null)).toEqual({
      value: { formats: [], games: 0, wins: 0, goals: 0, assists: 0, motm: 0, avgRating: null, totw: 0 },
    });
  });

  it('passes a season error on', async () => {
    mockResponse = { data: null, error: { message: 'nope' } };
    expect(await getMyProfileSeason(null)).toEqual({ error: 'nope' });
  });

  it('reads recent games with the limit', async () => {
    mockResponse = { data: [{ match_id: 'm1', rating: '8.90' }, { match_id: 'm2', rating: null }], error: null };
    const r = await getMyProfileRecent(3);
    expect(mockCalls).toEqual([['my_profile_recent', { p_limit: 3 }]]);
    expect(r).toEqual({ value: [{ match_id: 'm1', rating: 8.9 }, { match_id: 'm2', rating: null }] });
  });

  it('gives no recent games for a null answer, and passes errors on', async () => {
    expect(await getMyProfileRecent()).toEqual({ value: [] });
    mockResponse = { data: null, error: { message: 'x' } };
    expect(await getMyProfileRecent()).toEqual({ error: 'x' });
  });
});

describe('formatters', () => {
  it('builds the subtitle and leaves out what is empty', () => {
    expect(profileSubtitle({ username: 'panos', city: 'Limassol', position: 'Midfielder', preferred_foot: 'Right' })).toBe(
      '@panos · Limassol · Midfielder · Right foot',
    );
    expect(profileSubtitle({ username: 'panos', city: null, position: null, preferred_foot: 'Both' })).toBe(
      '@panos · Both feet',
    );
    expect(profileSubtitle({ username: null, city: null, position: null, preferred_foot: null })).toBe('');
  });

  it('writes the follow line', () => {
    expect(followLine({ followers: 128, following: 96 })).toBe('128 followers · 96 following');
    expect(followLine({ followers: 1, following: 0 })).toBe('1 follower · 0 following');
  });

  it('fills the level bar from 0 to 1', () => {
    expect(levelProgress(6.4)).toBeCloseTo(0.64);
    expect(levelProgress(null)).toBe(0);
    expect(levelProgress(12)).toBe(1);
    expect(levelProgress(-1)).toBe(0);
    expect(levelProgress(Number.NaN)).toBe(0);
  });

  it('shows the month change only when there is one', () => {
    expect(levelRightLabel(0.2)).toBe('of 10.0 · ▲0.2 this month');
    expect(levelRightLabel(-0.34)).toBe('of 10.0 · ▼0.3 this month');
    expect(levelRightLabel(0.04)).toBe('of 10.0');
    expect(levelRightLabel(null)).toBe('of 10.0');
  });

  it('labels goals and assists without zeros', () => {
    expect(goalsAssistsLabel(2, 1)).toBe('2 G · 1 A');
    expect(goalsAssistsLabel(0, 1)).toBe('1 A');
    expect(goalsAssistsLabel(1, 0)).toBe('1 G');
    expect(goalsAssistsLabel(0, 0)).toBe('');
  });

  it('gives the venue and the Cyprus weekday', () => {
    // 22:30 UTC on Saturday 21 Nov 2026 is 00:30 on Sunday in Cyprus.
    expect(recentGameWhere({ venue_name: 'Nuevo Campo', kickoff_at: '2026-11-21T22:30:00Z' })).toBe('Nuevo Campo · Sun');
    expect(recentGameWhere({ venue_name: null, kickoff_at: '2026-11-19T18:00:00Z' })).toBe('Thu');
  });

  it('writes the team subtitle', () => {
    expect(teamSubtitle('captain', 'Limassol')).toBe('Captain · Limassol');
    expect(teamSubtitle('player', null)).toBe('Player');
    expect(teamSubtitle('', null)).toBe('');
  });

  it('lists the season tiles in image 19 order', () => {
    const tiles = seasonTiles({ formats: [], games: 24, wins: 14, goals: 19, assists: 11, motm: 4, avgRating: 7.25, totw: 3 });
    expect(tiles.map((t) => `${t.label}:${t.value}`)).toEqual([
      'Games:24',
      'Goals:19',
      'Assists:11',
      'Avg rating:7.3',
      'Wins:14',
      'MOTM:4',
      'TOTW:3',
    ]);
    expect(seasonTiles({ formats: [], games: 0, wins: 0, goals: 0, assists: 0, motm: 0, avgRating: null, totw: 0 })[3].value).toBe(
      '–',
    );
  });
});
