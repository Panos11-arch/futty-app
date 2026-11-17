// Loads the match page, the squad (members only) and the formation presets,
// with the same loading/error/ready states as the result screen.
import { useAuth } from '@/lib/auth';
import type { MatchPage, RosterPlayer } from '@/lib/match/page';
import { getFormationPresets, getMatchPage, getMatchRoster } from '@/lib/match/page-api';
import { useLoad } from '@/lib/match/use-match-result';

/** `page` is null when the match doesn't exist or the viewer may not see it yet. */
export function useMatchPage(matchId: string | undefined) {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const { state, reload } = useLoad<{ page: MatchPage | null }>(
    viewerId && matchId
      ? async () => {
          const { page, error } = await getMatchPage(matchId);
          return error ? { error: error.message } : { value: { page } };
        }
      : null,
    `${viewerId}|${matchId}`
  );
  return { ...state, reload };
}

/** The squad with names and check-ins; only loaded when `enabled` (the viewer is in the match). */
export function useMatchRoster(matchId: string | undefined, enabled: boolean) {
  const { state, reload } = useLoad<{ roster: RosterPlayer[] }>(
    enabled && matchId
      ? async () => {
          const { roster, error } = await getMatchRoster(matchId);
          return error ? { error: error.message } : { value: { roster } };
        }
      : null,
    `${matchId}|${enabled}`
  );
  return { ...state, reload };
}

export function useFormationPresets(playersPerSide: number | null) {
  const { state, reload } = useLoad<{ formations: string[] }>(
    playersPerSide
      ? async () => {
          const { formations, error } = await getFormationPresets(playersPerSide);
          return error ? { error: error.message } : { value: { formations } };
        }
      : null,
    String(playersPerSide)
  );
  return { ...state, reload };
}
