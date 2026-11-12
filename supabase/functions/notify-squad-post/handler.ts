// Who notify-squad-post pushes to for a new squad post.
//
// A 'players' post goes to the poster's followers. An 'opposition' post
// ("Need opposition") goes to nobody from here: the team's followers get
// followed_team_opponent_wanted through send_notification, from the
// squad_posts trigger in 20261112000801_match_followed_teams.sql (A3b).
// Pushing here too would reach them twice.

export type SquadPostRecord = {
  id: string;
  venue_id: string;
  type: 'players' | 'opposition';
  posted_by: string | null;
  team_id: string | null;
  players_needed: number | null;
};

export type FollowerTarget = { targetType: 'player'; targetId: string };

export function followerTarget(post: SquadPostRecord): FollowerTarget | null {
  if (post.type !== 'players' || !post.posted_by) return null;
  return { targetType: 'player', targetId: post.posted_by };
}
