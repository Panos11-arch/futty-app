import { describeTournamentError, TOURNAMENT_ERROR_CODES } from '@/lib/match/tournament-errors';

describe('describeTournamentError', () => {
  it.each([
    ['not_captain', 'Only the team’s captain can do this.'],
    ['registration_closed', 'Sign-up for this tournament is closed.'],
    ['deadline_passed', 'The sign-up deadline has passed. Contact the organiser.'],
    ['already_registered', 'This team is already in the tournament.'],
    ['tournament_full', 'This tournament is full.'],
    ['squad_size', 'Pick the right number of players for the squad.'],
    ['player_in_other_squad', 'A player is already in another squad. Remove them.'],
    ['not_admin', 'Only Futty admins can do this.'],
    ['teams_missing', 'The groups need all 16 teams. Wait for sign-ups.'],
    ['next_round_played', 'The next round has started. This can’t change now.'],
    ['draw_needed', 'A tie needs the organiser’s draw first.'],
    ['final_not_played', 'Play the final before closing the tournament.'],
    ['shootout_required', 'A drawn knockout game needs the penalty shootout score.'],
  ])('%s', (code, words) => {
    expect(describeTournamentError({ message: code })).toBe(words);
  });

  it('an unknown code falls back to one line', () => {
    expect(describeTournamentError({ message: 'boom' })).toBe('That didn’t go through. Try again.');
  });

  it('every error is one line of at most 10 words (spec 15, 0.7)', () => {
    for (const code of TOURNAMENT_ERROR_CODES) {
      const words = describeTournamentError({ message: code });
      expect(words).not.toContain('\n');
      expect(words.split(/\s+/).length).toBeLessThanOrEqual(10);
    }
  });
});
