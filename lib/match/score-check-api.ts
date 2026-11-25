// Reads and writes for "Check the score" (decision 1l item 11). The app
// sends only the match id and Accept or Reject; the server checks the caller
// played on the side the booker isn't on, and the first answer wins.
import type { ScoreCheckState, ScoreToCheck } from '@/lib/match/score-check';
import { supabase } from '@/lib/supabase';

type ApiError = { message: string; details?: string | null };

/** ignored: someone answered first, or the 24 hours had passed. */
export type ScoreAnswer = { status: ScoreCheckState | 'none'; ignored: boolean };

export async function respondToMatchScore(
  matchId: string,
  accept: boolean
): Promise<{ result: ScoreAnswer | null; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('respond_to_match_score', { p_match_id: matchId, p_accept: accept });
  if (error) return { result: null, error };
  return { result: data as ScoreAnswer, error: null };
}

/** Home's "Check the score" cards: open checks the caller can answer. */
export async function getMyScoresToCheck(): Promise<{ scores: ScoreToCheck[]; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('get_my_scores_to_check');
  if (error) return { scores: [], error };
  return { scores: (data as ScoreToCheck[] | null) ?? [], error: null };
}
