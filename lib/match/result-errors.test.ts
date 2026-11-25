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
    // Decided 25 November: who played, and the lone captain's score correction.
    ['player_did_not_play', "A player who didn't play can't score or assist."],
    ['cannot_remove_check_in', 'They checked in at the venue, so they played.'],
    ['check_in_used', 'They voted for man of the match, so they played.'],
    ['check_in_closed', "Who played can't change after the result deadline."],
    ['score_locked', 'This score is final.'],
    // Levels like Playtomic (25 November): "Check the score".
    ['cannot_check_score', "Only the other side's players can check this score."],
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
    for (const code of ['cannot_remove_check_in', 'check_in_used', 'check_in_closed', 'score_locked']) {
      expect(STALE_RESULT_ERRORS.has(code)).toBe(true);
    }
    expect(STALE_RESULT_ERRORS.has('player_did_not_play')).toBe(false);
  });

  it('anything else gets a plain fallback, never the raw message', () => {
    expect(describeMatchResultError({ message: 'connection reset' })).toBe("That didn't go through. Try again.");
  });
});
