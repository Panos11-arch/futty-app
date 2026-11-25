// Reads and writes for logging after the game (S13B). The app sends the
// match id, both scores and the caller's sides' goals and assists per
// player; the server decides who may log which side, refuses players
// outside it, compares the two captains' scores and computes the ratings.
import type { MatchLog, Score, SideStats } from '@/lib/match/log-score';
import type { Side } from '@/lib/match/types';
import { supabase } from '@/lib/supabase';

type ApiError = { message: string; details?: string | null };

/** The logging screens' data, or null for match_not_found. */
export async function getMatchLog(matchId: string): Promise<{ log: MatchLog | null; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('get_match_log', { p_match_id: matchId });
  if (error) {
    if (error.message === 'match_not_found') return { log: null, error: null };
    return { log: null, error };
  }
  return { log: (data as MatchLog | null) ?? null, error: null };
}

export type LogResult = { status: 'confirmed' | 'waiting' | 'mismatch' | 'disputed'; tries: number; maxTries: number };

/** Logs both scores; stats only for the sides the caller writes (omitted when only the other side's score changed). */
export async function logMatchResult(
  matchId: string,
  score: Score,
  stats: Partial<Record<Side, SideStats>>
): Promise<{ result: LogResult | null; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('log_match_result', {
    p_match_id: matchId,
    p_side_a_score: score.a,
    p_side_b_score: score.b,
    p_stats: stats,
  });
  if (error) return { result: null, error };
  return { result: data as LogResult, error: null };
}

/**
 * A correction of the caller's sides' goals, assists and who played, for 24
 * hours after confirmation. A lone captain may send a new score too (decided
 * 25 November); the server refuses it for two captains (score_locked).
 */
export async function setMatchStats(
  matchId: string,
  stats: Partial<Record<Side, SideStats>>,
  score?: Score
): Promise<{ error: ApiError | null }> {
  const args = score
    ? { p_match_id: matchId, p_stats: stats, p_side_a_score: score.a, p_side_b_score: score.b }
    : { p_match_id: matchId, p_stats: stats };
  const { error } = await supabase.rpc('set_match_stats', args);
  return { error: error ?? null };
}

/** A game on Home's "Log the score": the caller still owes his score, or the captains' scores differ. */
export type MatchToLog = {
  matchId: string;
  kickoffAt: string;
  labelA: string;
  labelB: string;
  state: 'log' | 'mismatch';
};

export async function getMyMatchesToLog(): Promise<{ matches: MatchToLog[]; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('get_my_matches_to_log');
  if (error) return { matches: [], error };
  return { matches: (data as MatchToLog[] | null) ?? [], error: null };
}
