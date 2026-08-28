import { supabase } from '@/lib/supabase';

export type FriendlyMatchStatus = 'pending_score' | 'confirmed' | 'locked';

export type FriendlyMatch = {
  id: string;
  squad_post_id: string;
  home_team_id: string;
  away_team_id: string;
  status: FriendlyMatchStatus;
  score_attempts: number;
  /** Set once status is 'confirmed' — the score both sides agreed on. */
  home_score: number | null;
  away_score: number | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
  post: {
    scheduled_at: string;
    format: string;
    venue_booking_id: string | null;
    venue: { id: string; name: string; city: string } | null;
  } | null;
};

const FRIENDLY_MATCH_SELECT = `
  id, squad_post_id, home_team_id, away_team_id, status, score_attempts, home_score, away_score,
  home_team:teams!friendly_matches_home_team_id_fkey(id, name),
  away_team:teams!friendly_matches_away_team_id_fkey(id, name),
  post:squad_posts(scheduled_at, format, venue_booking_id, venue:venues(id, name, city))
`;

/** Every friendly match involving any of the given teams — pass every team
 *  the signed-in user belongs to (any role) to show "my friendlies". */
export async function listFriendlyMatchesForTeams(teamIds: string[]) {
  if (teamIds.length === 0) {
    return { data: [] as FriendlyMatch[], error: null };
  }

  const list = teamIds.join(',');
  const { data, error } = await supabase
    .from('friendly_matches')
    .select(FRIENDLY_MATCH_SELECT)
    .or(`home_team_id.in.(${list}),away_team_id.in.(${list})`);

  return { data: (data ?? []) as unknown as FriendlyMatch[], error };
}

export type FriendlyMatchScore = {
  id: string;
  friendly_match_id: string;
  submitted_by_team_id: string;
  submitted_by_profile_id: string | null;
  home_score: number;
  away_score: number;
  submitted_at: string;
};

export async function listFriendlyMatchScores(matchId: string) {
  return supabase
    .from('friendly_match_scores')
    .select('id, friendly_match_id, submitted_by_team_id, submitted_by_profile_id, home_score, away_score, submitted_at')
    .eq('friendly_match_id', matchId)
    .order('submitted_at', { ascending: false });
}

export async function submitFriendlyScore(matchId: string, homeScore: number, awayScore: number) {
  return supabase.rpc('submit_friendly_score', {
    p_match_id: matchId,
    p_home_score: homeScore,
    p_away_score: awayScore,
  });
}
