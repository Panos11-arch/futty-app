// Plain words for the codes log_match_result, set_match_stats and the side
// functions raise (S13B; docs/specs/match-record.md decision 1l, sections
// 5.2 and 5.4). Each is one line: what happened, and what to do.

const WORDS: Record<string, string> = {
  not_captain: 'Only a captain can log the score.',
  result_window_closed: 'The time to log this score has passed.',
  sides_locked: 'Sides are locked once a score is logged.',
  not_in_match: "You weren't in this match.",
  invalid_score: 'Enter a score of 0 or more for each side.',
  match_not_found: "We couldn't find this match.",
  not_your_player: "You can only log your own side's players.",
  score_mismatch: 'Goals must add up to the score. Check them.',
  too_many_assists: 'More assists than goals. Remove one.',
  stats_required: "Your side's score changed. Log its goals again.",
  invalid_stats: 'Check the goals and assists, then try again.',
  match_not_confirmed: 'This match has no confirmed score yet.',
  scorers_window_closed: 'The time to correct this has passed.',
  // Decided 25 November: who played, and the lone captain's score correction.
  player_did_not_play: "A player who didn't play can't score or assist.",
  cannot_remove_check_in: 'They checked in at the venue, so they played.',
  check_in_used: 'They voted for man of the match, so they played.',
  check_in_closed: "Who played can't change after the result deadline.",
  score_locked: 'This score is final.',
};

export const MATCH_RESULT_ERROR_CODES = Object.keys(WORDS);

/** Codes after which the match has moved on, so the screen should reload. */
export const STALE_RESULT_ERRORS = new Set([
  'result_window_closed',
  'stats_required',
  'match_not_confirmed',
  'scorers_window_closed',
  'not_your_player',
  'cannot_remove_check_in',
  'check_in_used',
  'check_in_closed',
  'score_locked',
]);

export function describeMatchResultError(error: { message: string }): string {
  return WORDS[error.message] ?? "That didn't go through. Try again.";
}
