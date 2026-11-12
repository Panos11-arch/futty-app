// Hooks for the profile sections (A3b-2b): each loads one view and gives
// loading, error (with reload) or ready.
import {
  getHeadToHead,
  getMyTeammates,
  getPlayerForm,
  getPlayerRecentMatches,
  getPublicNames,
  getTeamForm,
  type Teammate,
} from '@/lib/match/profile-api';
import type { FormResult, HeadToHeadRow, PlayerRecentMatchRow } from '@/lib/match/types';
import { useLoad } from '@/lib/match/use-match-result';

export function usePlayerForm(profileId: string | null | undefined) {
  const { state, reload } = useLoad<{ form: FormResult[] }>(
    profileId
      ? async () => {
          const { form, error } = await getPlayerForm(profileId);
          return error ? { error: error.message } : { value: { form } };
        }
      : null,
    profileId ?? '',
  );
  return { ...state, reload };
}

export function useTeamForm(teamId: string | null | undefined) {
  const { state, reload } = useLoad<{ form: FormResult[] }>(
    teamId
      ? async () => {
          const { form, error } = await getTeamForm(teamId);
          return error ? { error: error.message } : { value: { form } };
        }
      : null,
    teamId ?? '',
  );
  return { ...state, reload };
}

export function usePlayerRecentMatches(profileId: string | null | undefined, limit = 10) {
  const { state, reload } = useLoad<{ rows: PlayerRecentMatchRow[] }>(
    profileId
      ? async () => {
          const { rows, error } = await getPlayerRecentMatches(profileId, limit);
          return error ? { error: error.message } : { value: { rows } };
        }
      : null,
    `${profileId}|${limit}`,
  );
  return { ...state, reload };
}

/** Null teamId or opponentId: nothing to compare, stays loading and is not shown. */
export function useHeadToHead(teamId: string | null | undefined, opponentTeamId: string | null | undefined) {
  const { state, reload } = useLoad<{ record: HeadToHeadRow | null }>(
    teamId && opponentTeamId
      ? async () => {
          const { record, error } = await getHeadToHead(teamId, opponentTeamId);
          return error ? { error: error.message } : { value: { record } };
        }
      : null,
    `${teamId}|${opponentTeamId}`,
  );
  return { ...state, reload };
}

export type NamedTeammate = Teammate & { name: string };

/** The signed-in player's "players you play with most", with names. */
export function useMyTeammates(limit = 5) {
  const { state, reload } = useLoad<{ teammates: NamedTeammate[] }>(async () => {
    const { rows, error } = await getMyTeammates(limit);
    if (error) return { error: error.message };
    const { names, error: namesError } = await getPublicNames(rows.map((r) => r.teammate_profile_id));
    if (namesError) return { error: namesError.message };
    return { value: { teammates: rows.map((r) => ({ ...r, name: names[r.teammate_profile_id] ?? 'Player' })) } };
  }, String(limit));
  return { ...state, reload };
}
