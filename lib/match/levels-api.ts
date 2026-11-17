// Reads and writes for levels, ratings, competitive or casual and balance
// teams (docs/specs/match-record.md section 5.5, A5a). Every write sends ids
// and answers only; the server works out every level, rating and side.
import type { BalancedTeams, MatchRatings, PlayerLevel, StartingAnswers } from '@/lib/match/levels';
import { getPublicNames } from '@/lib/match/profile-api';
import { supabase } from '@/lib/supabase';

type ApiError = { message: string };

type LevelRow = {
  level: number | string;
  provisional: boolean;
  reliability_pct: number;
  competitive_matches: number;
  source: PlayerLevel['source'];
};

/** A player's level, or null when they have none yet. */
export async function getPlayerLevel(profileId: string): Promise<{ level: PlayerLevel | null; error: ApiError | null }> {
  const { data, error } = await supabase
    .from('player_levels')
    .select('level, provisional, reliability_pct, competitive_matches, source')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) return { level: null, error };
  const row = data as LevelRow | null;
  if (!row) return { level: null, error: null };
  return {
    level: {
      level: Number(row.level),
      provisional: row.provisional,
      reliabilityPct: row.reliability_pct,
      competitiveMatches: row.competitive_matches,
      source: row.source,
    },
    error: null,
  };
}

export function setStartingLevel(answers: StartingAnswers) {
  return supabase.rpc('set_starting_level', {
    p_years: answers.years,
    p_highest: answers.highest,
    p_frequency: answers.frequency,
    p_position: answers.position,
    p_self_rating: Number(answers.selfRating),
  });
}

export function setMatchCompetitive(matchId: string, competitive: boolean) {
  return supabase.rpc('set_match_competitive', { p_match_id: matchId, p_competitive: competitive });
}

export function rateMatchPlayer(matchId: string, playerId: string, score: number) {
  return supabase.rpc('rate_match_player', { p_match_id: matchId, p_player_id: playerId, p_score: score });
}

export async function balanceMatchTeams(matchId: string): Promise<{ result: BalancedTeams | null; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('balance_match_teams', { p_match_id: matchId });
  if (error) return { result: null, error };
  return { result: data as BalancedTeams, error: null };
}

/** The ratings section, with names for the players the server returned (public profile names only). */
export async function getMatchRatings(
  matchId: string
): Promise<{ ratings: MatchRatings | null; names: Record<string, string>; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('get_match_ratings', { p_match_id: matchId });
  if (error) return { ratings: null, names: {}, error };
  const ratings = data as MatchRatings;
  const { names, error: namesError } = await getPublicNames(ratings.players.map((p) => p.profileId));
  if (namesError) return { ratings: null, names: {}, error: namesError };
  return { ratings, names, error: null };
}
