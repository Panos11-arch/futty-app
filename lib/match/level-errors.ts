// Plain words for every code A5a's app functions raise (set_starting_level,
// set_match_competitive, balance_match_teams; docs/specs/match-record.md
// section 5.5). S13B: set_starting_level refuses a self-rating outside the
// range it expects (self_rating_out_of_range, the range in the detail). Kept apart
// from page-errors.ts: there not_captain and not_checked_in are about
// scorers and the vote.

const WORDS: Record<string, string> = {
  not_authenticated: 'Sign in again to carry on.',
  level_already_set: 'Your starting level is already set.',
  invalid_answer: 'Answer every question to get your level.',
  match_not_found: "We couldn't find this match.",
  not_captain: 'Only a captain can change this.',
  competitive_locked: 'This can only be changed before kickoff.',
  invalid_score: 'Pick a rating from 1 to 10.',
  self_rating_out_of_range: 'Pick a rating closer to your answers.',
  not_pickup: 'Teams can only be balanced in a pickup game.',
  not_booker: 'Only the person who booked can balance the teams.',
  sides_locked: 'Sides are locked once the score is entered.',
};

export const LEVEL_ERROR_CODES = Object.keys(WORDS);

/** Codes after which the match has moved on, so the page should reload. */
export const STALE_LEVEL_ERRORS = new Set([
  'competitive_locked',
  'sides_locked',
]);

export function describeLevelError(error: { message: string }): string {
  return WORDS[error.message] ?? "That didn't go through. Try again.";
}

/** The self-ratings set_starting_level allows, from its refusal's detail; null for any other error. */
export function selfRatingRange(error: { message: string; details?: string | null }): { low: number; high: number } | null {
  if (error.message !== 'self_rating_out_of_range' || !error.details) return null;
  try {
    const range = JSON.parse(error.details) as { low?: unknown; high?: unknown };
    if (typeof range.low !== 'number' || typeof range.high !== 'number') return null;
    return { low: range.low, high: range.high };
  } catch {
    return null;
  }
}

/** The line under the rating question when the pick is out of range (the range comes from the server). */
export const selfRatingRangeLine = ({ low, high }: { low: number; high: number }) =>
  `Based on your answers, pick between ${low} and ${high}.`;
