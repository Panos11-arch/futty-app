import { describeMatchResultError, MATCH_RESULT_ERROR_CODES, STALE_RESULT_ERRORS } from '@/lib/match/result-errors';

describe('describeMatchResultError', () => {
  it.each([
    ['not_captain', 'Only a captain can log the score.'],
    ['result_window_closed', 'The time to log this score has passed.'],
    ['not_your_player', "You can only log your own side's players."],
    ['score_mismatch', 'Goals must add up to the score. Check them.'],
    ['too_many_assists', 'More assists than goals. Remove one.'],
    ['stats_required', "Your side's score changed. Log its goals again."],
    ['scorers_window_closed', 'The time to correct this has passed.'],
    ['match_not_found', "We couldn't find this match."],
  ])('%s', (code, words) => {
    expect(describeMatchResultError({ message: code })).toBe(words);
  });

  it('every error is one line of at most 10 words (spec 15, 0.7)', () => {
    for (const code of MATCH_RESULT_ERROR_CODES) {
      const words = describeMatchResultError({ message: code });
      expect(words).not.toContain('\n');
      expect(words.split(/\s+/).length).toBeLessThanOrEqual(10);
    }
  });

  it('stale codes reload the screen', () => {
    expect(STALE_RESULT_ERRORS.has('result_window_closed')).toBe(true);
    expect(STALE_RESULT_ERRORS.has('score_mismatch')).toBe(false);
  });

  it('anything else gets a plain fallback, never the raw message', () => {
    expect(describeMatchResultError({ message: 'connection reset' })).toBe("That didn't go through. Try again.");
  });
});
