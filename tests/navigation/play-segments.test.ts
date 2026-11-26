import { isLeaguesSegment, PLAY_SEGMENTS, parsePlaySegment, playHref } from '@/lib/play-segments';

describe('Play segments', () => {
  it('lists the two segments in order (Community is a tab since S2, Leagues its own screen since S9)', () => {
    expect(PLAY_SEGMENTS.map((s) => [s.value, s.label])).toEqual([
      ['teams', 'Teams'],
      ['matches', 'Matches'],
    ]);
  });

  it('parses a known segment', () => {
    expect(parsePlaySegment('matches')).toBe('matches');
    expect(parsePlaySegment('teams')).toBe('teams');
  });

  it('knows the old Leagues segment moved to /leagues (S9)', () => {
    expect(isLeaguesSegment('leagues')).toBe(true);
    expect(isLeaguesSegment(['leagues'])).toBe(true);
    expect(isLeaguesSegment('teams')).toBe(false);
    expect(isLeaguesSegment(undefined)).toBe(false);
  });

  it('defaults to teams when missing or unknown', () => {
    expect(parsePlaySegment(undefined)).toBe('teams');
    expect(parsePlaySegment('')).toBe('teams');
    expect(parsePlaySegment('shop')).toBe('teams');
    expect(parsePlaySegment('community')).toBe('teams');
  });

  it('takes the first value of a repeated param', () => {
    expect(parsePlaySegment(['matches', 'teams'])).toBe('matches');
  });

  it('builds the Play href, keeping a team id', () => {
    expect(playHref('matches')).toEqual({ pathname: '/play', params: { segment: 'matches' } });
    expect(playHref('teams', { teamId: 't1' })).toEqual({
      pathname: '/play',
      params: { segment: 'teams', teamId: 't1' },
    });
  });

  it('leaves out an empty team id', () => {
    expect(playHref('teams', { teamId: undefined })).toEqual({ pathname: '/play', params: { segment: 'teams' } });
  });
});
