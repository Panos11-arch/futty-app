import { describeLevelError, LEVEL_ERROR_CODES } from '@/lib/match/level-errors';

// Every code A5a's app functions raise
// (supabase/migrations/20261117192224_match_levels_functions.sql).
const A5A_CODES = [
  'not_authenticated',
  'level_already_set',
  'invalid_answer',
  'match_not_found',
  'not_captain',
  'competitive_locked',
  'not_checked_in',
  'match_not_confirmed',
  'rating_closed',
  'cannot_rate_self',
  'player_not_eligible',
  'invalid_score',
  'already_rated',
  'not_pickup',
  'not_booker',
  'sides_locked',
];

describe('describeLevelError', () => {
  it('has words for every A5a code', () => {
    expect([...LEVEL_ERROR_CODES].sort()).toEqual([...A5A_CODES].sort());
  });

  it.each(A5A_CODES)('%s is plain words, not the code', (code) => {
    const words = describeLevelError({ message: code });
    expect(words).not.toContain('_');
    expect(words).toMatch(/\.$/);
  });

  it('rating refusals say what happened', () => {
    expect(describeLevelError({ message: 'rating_closed' })).toBe('Ratings for this match have closed.');
    expect(describeLevelError({ message: 'already_rated' })).toBe("You've already rated this player.");
    expect(describeLevelError({ message: 'cannot_rate_self' })).toBe("You can't rate yourself.");
  });

  it('anything else: try again', () => {
    expect(describeLevelError({ message: 'network down' })).toBe("That didn't go through. Try again.");
  });
});
