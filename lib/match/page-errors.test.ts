import { describeMatchPageError, MATCH_PAGE_ERROR_CODES } from '@/lib/match/page-errors';

// Every code A4a's functions raise (supabase/migrations/20261112154119_match_goals_motm.sql,
// 20261112154123_match_lineups.sql, 20261112154127_match_page.sql).
const A4A_CODES = [
  'match_not_found',
  'not_in_match',
  'not_captain',
  'invalid_side',
  'match_not_confirmed',
  'scorers_window_closed',
  'invalid_goals',
  'score_mismatch',
  'not_checked_in',
  'voting_closed',
  'cannot_vote_for_self',
  'nominee_not_eligible',
  'already_voted',
  'lineup_locked',
  'unknown_formation',
  'invalid_position',
  'duplicate_player',
];

describe('describeMatchPageError', () => {
  it('has words for every A4a code', () => {
    expect([...MATCH_PAGE_ERROR_CODES].sort()).toEqual([...A4A_CODES].sort());
  });

  it.each(A4A_CODES)('%s is plain words, not the code', (code) => {
    const words = describeMatchPageError({ message: code });
    expect(words).not.toContain('_');
    expect(words).toMatch(/\.$/);
  });

  it('anything else: try again', () => {
    expect(describeMatchPageError({ message: 'network down' })).toBe("That didn't go through. Try again.");
  });
});
