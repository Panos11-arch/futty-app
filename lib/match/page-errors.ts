// Plain words for every code set_match_goals, cast_motm_vote,
// set_match_lineup and get_match_page raise (docs/specs/match-record.md
// section 5.3, A4a). Kept apart from result-errors.ts: there not_captain is
// about entering the score.

const WORDS: Record<string, string> = {
  match_not_found: "We couldn't find this match.",
  not_in_match: 'Only players on that side can be picked. Reload to see the latest squad.',
  not_captain: "Only that side's captain can change this.",
  invalid_side: "Choose which side you're entering.",
  match_not_confirmed: 'This match has no confirmed score, so there are no scorers or vote.',
  scorers_window_closed: 'The time to add scorers has passed.',
  invalid_goals: "Check the scorers: an assist needs a scorer and can't be the scorer.",
  score_mismatch: 'The number of goals must match the score.',
  not_checked_in: 'Only players who checked in can vote.',
  voting_closed: 'Voting has closed.',
  cannot_vote_for_self: "You can't vote for yourself.",
  nominee_not_eligible: 'You can only vote for a player who checked in.',
  already_voted: "You've already voted.",
  lineup_locked: 'Lineups lock at kickoff.',
  unknown_formation: "That formation isn't available for this game.",
  invalid_position: "That position isn't in this formation.",
  duplicate_player: 'A player can only fill one position.',
};

export const MATCH_PAGE_ERROR_CODES = Object.keys(WORDS);

/** Codes after which the match has moved on, so the page should reload. */
export const STALE_PAGE_ERRORS = new Set([
  'match_not_confirmed',
  'scorers_window_closed',
  'voting_closed',
  'already_voted',
  'lineup_locked',
  'not_in_match',
]);

export function describeMatchPageError(error: { message: string }): string {
  return WORDS[error.message] ?? "That didn't go through. Try again.";
}
