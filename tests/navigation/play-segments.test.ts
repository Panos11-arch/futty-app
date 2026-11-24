import { PLAY_SEGMENTS, parsePlaySegment, playHref } from '@/lib/play-segments';

describe('Play segments', () => {
  it('lists the three segments in order (Community is a tab since S2)', () => {
    expect(PLAY_SEGMENTS.map((s) => [s.value, s.label])).toEqual([
      ['teams', 'Teams'],
      ['matches', 'Matches'],
      ['leagues', 'Leagues'],
    ]);
  });

  it('parses a known segment', () => {
    expect(parsePlaySegment('leagues')).toBe('leagues');
    expect(parsePlaySegment('matches')).toBe('matches');
  });

  it('defaults to teams when missing or unknown', () => {
    expect(parsePlaySegment(undefined)).toBe('teams');
    expect(parsePlaySegment('')).toBe('teams');
    expect(parsePlaySegment('shop')).toBe('teams');
    expect(parsePlaySegment('community')).toBe('teams');
  });

  it('takes the first value of a repeated param', () => {
    expect(parsePlaySegment(['matches', 'leagues'])).toBe('matches');
  });

  it('builds the Play href, keeping a team id', () => {
    expect(playHref('leagues')).toEqual({ pathname: '/play', params: { segment: 'leagues' } });
    expect(playHref('teams', { teamId: 't1' })).toEqual({
      pathname: '/play',
      params: { segment: 'teams', teamId: 't1' },
    });
  });

  it('leaves out an empty team id', () => {
    expect(playHref('teams', { teamId: undefined })).toEqual({ pathname: '/play', params: { segment: 'teams' } });
  });
});
