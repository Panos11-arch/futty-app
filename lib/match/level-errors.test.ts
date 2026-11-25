import {
  describeLevelError,
  LEVEL_ERROR_CODES,
  selfRatingRange,
  selfRatingRangeLine,
} from '@/lib/match/level-errors';

// Every code the level functions the app calls raise
// (supabase/migrations/20261117192224_match_levels_functions.sql, and
// 20261125100200_match_levels_ten.sql: self_rating_out_of_range). The 1-10
// rating calls are gone (S13B).
const A5A_CODES = [
  'not_authenticated',
  'level_already_set',
  'invalid_answer',
  'match_not_found',
  'not_captain',
  'competitive_locked',
  'invalid_score',
  'self_rating_out_of_range',
  'not_pickup',
  'not_booker',
  'sides_locked',
];

describe('selfRatingRange', () => {
  it('reads the range from the refusal', () => {
    expect(selfRatingRange({ message: 'self_rating_out_of_range', details: '{"low": 2, "high": 4}' })).toEqual({
      low: 2,
      high: 4,
    });
    expect(selfRatingRangeLine({ low: 2, high: 4 })).toBe('Based on your answers, pick between 2 and 4.');
  });

  it('nothing for any other error, a missing or broken detail', () => {
    expect(selfRatingRange({ message: 'level_already_set', details: '{"low": 2, "high": 4}' })).toBeNull();
    expect(selfRatingRange({ message: 'self_rating_out_of_range' })).toBeNull();
    expect(selfRatingRange({ message: 'self_rating_out_of_range', details: 'nope' })).toBeNull();
    expect(selfRatingRange({ message: 'self_rating_out_of_range', details: '{"low": "2"}' })).toBeNull();
  });
});

describe('describeLevelError', () => {
  it('has words for every A5a code', () => {
    expect([...LEVEL_ERROR_CODES].sort()).toEqual([...A5A_CODES].sort());
  });

  it.each(A5A_CODES)('%s is plain words, not the code', (code) => {
    const words = describeLevelError({ message: code });
    expect(words).not.toContain('_');
    expect(words).toMatch(/\.$/);
  });

  it('a self-rating out of range, without its detail, still says what to do', () => {
    expect(describeLevelError({ message: 'self_rating_out_of_range' })).toBe('Pick a rating closer to your answers.');
  });

  it('anything else: try again', () => {
    expect(describeLevelError({ message: 'network down' })).toBe("That didn't go through. Try again.");
  });
});
