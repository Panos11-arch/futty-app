import type { PostgrestError } from '@supabase/supabase-js';

/** Maps the plain-text exceptions raised by supabase/legacy/squads.sql. */
export function describeSquadError(error: PostgrestError) {
  switch (error.message) {
    case 'not_authenticated':
      return 'Sign in again to continue.';
    case 'team_required':
      return 'Pick which of your teams is playing.';
    case 'not_captain':
      return 'Only a team captain can do that.';
    case 'players_needed_required':
      return 'Say how many more players you need.';
    case 'invalid_post_type':
      return 'Not a valid post type.';
    case 'post_not_found':
      return 'That post no longer exists.';
    case 'not_a_players_post':
      return 'That post is not looking for players.';
    case 'not_an_opposition_post':
      return 'That post is not looking for opposition.';
    case 'post_closed':
      return 'This post is no longer open.';
    case 'squad_full':
      return 'This squad is already full.';
    case 'already_joined':
      return "You've already joined this squad.";
    case 'cannot_offer_own_post':
      return "You can't offer to play your own post.";
    case 'not_joined':
      return "You haven't joined this squad.";
    case 'not_your_post':
      return "That's not your post to cancel.";
    case 'not_matched':
      return "This post isn't matched yet.";
    case 'too_late_to_cancel':
      return "Too close to kickoff to cancel now.";
    case 'invalid_payment_mode':
      return 'Not a valid payment mode for that post type.';
    case 'not_venue_owner':
      return 'Only a venue owner account can add a house player.';
    case 'not_your_venue':
      return "You can only add house players to bookings at a venue you own.";
    case 'not_linked_to_booking':
      return "This post isn't linked to a real booking.";
    case 'name_required':
      return 'Enter a name.';
    default:
      return error.message;
  }
}
