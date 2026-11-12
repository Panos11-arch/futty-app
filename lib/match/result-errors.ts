// Plain words for the codes submit_match_result, respond_to_match_result and
// the side functions raise (docs/specs/match-record.md sections 5.2 and 5.4).

const WORDS: Record<string, string> = {
  not_captain: 'Only a captain can enter the score.',
  result_window_closed: 'The time to enter or answer the result has passed.',
  result_already_submitted: 'The other side has already entered a score. Check it below.',
  already_answered: 'This score has already been answered.',
  not_allowed: 'Only the other side can accept or reject this score.',
  sides_locked: 'Sides are locked once a score is entered.',
  not_in_match: "You weren't in this match.",
  invalid_score: 'Enter a score of 0 or more for each side.',
  no_result_submitted: 'No score has been entered yet.',
  match_not_found: "We couldn't find this match.",
  invalid_answer: 'Choose accept or reject.',
};

/** Codes after which the match has moved on, so the screen should reload. */
export const STALE_RESULT_ERRORS = new Set([
  'result_window_closed',
  'result_already_submitted',
  'already_answered',
  'no_result_submitted',
]);

export function describeMatchResultError(error: { message: string }): string {
  return WORDS[error.message] ?? "That didn't go through. Try again.";
}
