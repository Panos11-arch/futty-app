// S10A: plain words for the codes the tournament functions raise
// (20261127130200_match_s10a_tournament_play.sql; match-record.md 1o). Each
// is one line of at most 10 words: what happened, and what to do.

const WORDS: Record<string, string> = {
  // Captains: registration and squads.
  not_authenticated: 'Sign in to do this.',
  not_captain: 'Only the team’s captain can do this.',
  tournament_not_found: 'We couldn’t find this tournament.',
  registration_closed: 'Sign-up for this tournament is closed.',
  deadline_passed: 'The sign-up deadline has passed. Contact the organiser.',
  already_registered: 'This team is already in the tournament.',
  tournament_full: 'This tournament is full.',
  invalid_kit_colour: 'Pick a kit colour.',
  squad_size: 'Pick the right number of players for the squad.',
  not_team_member: 'Only your team’s players can be in the squad.',
  player_in_other_squad: 'A player is already in another squad. Remove them.',
  not_registered: 'This team isn’t in the tournament.',
  // Admins.
  not_admin: 'Only Futty admins can do this.',
  invalid_status: 'Not possible at this stage of the tournament.',
  teams_missing: 'The groups need all 16 teams. Wait for sign-ups.',
  invalid_groups: 'Each group needs 4 different teams. Check the groups.',
  fixture_not_found: 'We couldn’t find this match.',
  fixture_completed: 'This match has a result. Correct the result instead.',
  invalid_kickoff: 'Pick a valid kick-off time.',
  teams_not_set: 'Both teams aren’t known yet.',
  next_round_played: 'The next round has started. This can’t change now.',
  draw_needed: 'A tie needs the organiser’s draw first.',
  final_not_played: 'Play the final before closing the tournament.',
  format_locked: 'Teams have signed up, so the format can’t change.',
  unsupported_structure: 'Only 16-team tournaments are supported.',
  invalid_tournament: 'Add a name and an area.',
  invalid_entry_fee: 'Enter an entry fee of 0 or more.',
  invalid_match_minutes: 'Match length must be 15 to 300 minutes.',
  invalid_dates: 'The end date can’t be before the start date.',
  invalid_venue: 'We couldn’t find that venue.',
  // Results the organiser enters.
  invalid_score: 'Enter a score of 0 or more for each side.',
  shootout_required: 'A drawn knockout game needs the penalty shootout score.',
  invalid_shootout: 'That shootout score isn’t possible. Check it.',
  shootout_not_allowed: 'Penalties only count in a drawn knockout game.',
};

export const TOURNAMENT_ERROR_CODES = Object.keys(WORDS);

export function describeTournamentError(error: { message: string }): string {
  return WORDS[error.message] ?? 'That didn’t go through. Try again.';
}
