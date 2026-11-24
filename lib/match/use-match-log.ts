// Hooks for logging after the game (S13B): loading, error (with reload) or
// ready, like the other match hooks.
import { useAuth } from '@/lib/auth';
import type { MatchLog } from '@/lib/match/log-score';
import { getMatchLog, getMyMatchesToLog, type MatchToLog } from '@/lib/match/log-score-api';
import { useLoad } from '@/lib/match/use-match-result';

/** get_match_log; `log` is null when the match doesn't exist or can't be seen. */
export function useMatchLog(matchId: string | undefined) {
  const { state, reload } = useLoad<{ log: MatchLog | null }>(
    matchId
      ? async () => {
          const { log, error } = await getMatchLog(matchId);
          return error ? { error: error.message } : { value: { log } };
        }
      : null,
    matchId ?? ''
  );
  return { ...state, reload };
}

/** Home's "Log the score": the viewer's games still waiting for his score. */
export function useMyMatchesToLog() {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const { state, reload } = useLoad<{ matches: MatchToLog[] }>(
    viewerId
      ? async () => {
          const { matches, error } = await getMyMatchesToLog();
          return error ? { error: error.message } : { value: { matches } };
        }
      : null,
    viewerId ?? ''
  );
  return { ...state, reload };
}
