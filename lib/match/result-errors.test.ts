import { describeMatchResultError } from '@/lib/match/result-errors';

describe('describeMatchResultError', () => {
  it.each([
    ['not_captain', 'Only a captain can enter the score.'],
    ['result_window_closed', 'The time to enter or answer the result has passed.'],
    ['result_already_submitted', 'The other side has already entered a score. Check it below.'],
    ['already_answered', 'This score has already been answered.'],
    ['not_allowed', 'Only the other side can accept or reject this score.'],
    ['sides_locked', 'Sides are locked once a score is entered.'],
    ['not_in_match', "You weren't in this match."],
    ['invalid_score', 'Enter a score of 0 or more for each side.'],
    ['no_result_submitted', 'No score has been entered yet.'],
    ['match_not_found', "We couldn't find this match."],
    ['invalid_answer', 'Choose accept or reject.'],
  ])('%s', (code, words) => {
    expect(describeMatchResultError({ message: code })).toBe(words);
  });

  it('anything else gets a plain fallback, never the raw message', () => {
    expect(describeMatchResultError({ message: 'connection reset' })).toBe("That didn't go through. Try again.");
  });
});
