// Plain words for every code A5a's app functions raise (set_starting_level,
// set_match_competitive, rate_match_player, get_match_ratings,
// balance_match_teams; docs/specs/match-record.md section 5.5). Kept apart
// from page-errors.ts: there not_captain and not_checked_in are about
// scorers and the vote.

const WORDS: Record<string, string> = {
  not_authenticated: 'Sign in again to carry on.',
  level_already_set: 'Your starting level is already set.',
  invalid_answer: 'Answer every question to get your level.',
  match_not_found: "We couldn't find this match.",
  not_captain: 'Only a captain can change this.',
  competitive_locked: 'This can only be changed before kickoff.',
  not_checked_in: 'Only players who checked in can rate.',
  match_not_confirmed: 'Players can be rated once the result is confirmed.',
  rating_closed: 'Ratings for this match have closed.',
  cannot_rate_self: "You can't rate yourself.",
  player_not_eligible: 'You can only rate players who checked in.',
  invalid_score: 'Pick a rating from 1 to 10.',
  already_rated: "You've already rated this player.",
  not_pickup: 'Teams can only be balanced in a pickup game.',
  not_booker: 'Only the person who booked can balance the teams.',
  sides_locked: 'Sides are locked once the score is entered.',
};

export const LEVEL_ERROR_CODES = Object.keys(WORDS);

/** Codes after which the match has moved on, so the page should reload. */
export const STALE_LEVEL_ERRORS = new Set([
  'competitive_locked',
  'rating_closed',
  'already_rated',
  'match_not_confirmed',
  'player_not_eligible',
  'sides_locked',
]);

export function describeLevelError(error: { message: string }): string {
  return WORDS[error.message] ?? "That didn't go through. Try again.";
}
