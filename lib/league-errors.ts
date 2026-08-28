import type { PostgrestError } from '@supabase/supabase-js';

import { FIXTURE_SCHEDULING_WINDOW_DAYS } from '@/lib/fixtures';

/** Maps the plain-text exceptions raised by supabase/teams.sql and
 *  supabase/leagues.sql to what the button should say. */
export function describeLeagueError(error: PostgrestError) {
  switch (error.message) {
    case 'not_authenticated':
      return 'Sign in again to continue.';
    case 'name_required':
      return 'Give the team a name.';
    case 'not_captain':
      return 'Only the team captain can do that.';
    case 'league_not_found':
      return 'That league no longer exists.';
    case 'league_full':
      return 'This league is at capacity.';
    case 'season_in_progress':
      return "This league's season has already started — it isn't taking new signups.";
    case 'league_not_open':
      return 'This league is not open for registration right now.';
    case 'already_joined':
      return 'Your team is already registered in this league.';
    case 'not_a_participant':
      return 'Only a captain with a team in this league can do that.';
    case 'not_in_signup':
      return 'This league has already moved past signup.';
    case 'not_an_open_league':
      return 'Only capacity-limited Open Leagues split into divisions.';
    case 'not_in_season':
      return "This league's season hasn't started yet.";
    case 'not_open_for_new_division':
      return 'This league is not currently forming new divisions.';
    case 'pool_empty':
      return 'No teams are waiting in the pool yet.';
    case 'pool_too_small':
      return 'Needs at least 4 teams in the pool before a new division can form.';
    case 'not_an_open_league_pyramid':
      return 'This league has no divisions to promote or relegate between.';
    case 'divisions_not_found':
      return 'Division 1 and Division 2 could not be found for this league.';
    case 'team_premium_required':
      return 'This format needs Team Premium — enable it for this team first.';
    case 'roster_incomplete':
      return 'Add your full squad before registering for a league.';
    case 'already_have_team_in_league':
      return "You already have a team registered in this league — one team per captain per league.";
    case 'not_a_premium_format':
      return 'Team Premium only applies to 9-a-side and 11-a-side.';
    case 'fixture_not_found':
      return 'That fixture no longer exists.';
    case 'date_out_of_range':
      return `Pick a date within the next ${FIXTURE_SCHEDULING_WINDOW_DAYS} days.`;
    case 'venue_not_found':
      return 'Pick a pitch from the list.';
    case 'message_required':
      return 'Write a message first.';
    case 'match_not_found':
      return 'That match no longer exists.';
    case 'score_not_open':
      return 'This match already has a final score.';
    case 'not_on_team':
      return 'Only players on one of the two teams can log this score.';
    case 'too_early':
      return "You can log the score once the match's kickoff time has passed.";
    case 'schedule_not_agreed':
      return 'Both captains need to agree a date and pitch before logging a score.';
    case 'score_locked':
      return "The captains couldn't agree on a score after 3 tries — this fixture is locked.";
    case 'already_completed':
      return 'This fixture already has a final score.';
    case 'window_not_elapsed':
      return `Wait until ${FIXTURE_SCHEDULING_WINDOW_DAYS} days have passed since this fixture appeared.`;
    case 'already_scheduled':
      return 'This fixture already has an agreed (or completed) schedule.';
    default:
      return error.message;
  }
}
