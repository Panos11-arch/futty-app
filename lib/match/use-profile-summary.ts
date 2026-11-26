// S8 Profile tab hooks: each loads one read from profile-summary-api and
// gives loading, error (with reload) or ready. Signed out, nothing loads.
import {
  getMyProfileRecent,
  getMyProfileSeason,
  getMyProfileSummary,
  type ProfileRecentGame,
  type ProfileSeason,
  type ProfileSummary,
} from '@/lib/match/profile-summary-api';
import { useLoad } from '@/lib/match/use-match-result';

export function useMyProfileSummary(userId: string | null | undefined) {
  const { state, reload } = useLoad<{ summary: ProfileSummary }>(
    userId
      ? async () => {
          const r = await getMyProfileSummary();
          return 'error' in r ? r : { value: { summary: r.value } };
        }
      : null,
    `summary|${userId}`,
  );
  return { ...state, reload };
}

export function useMyProfileSeason(userId: string | null | undefined, format: string | null) {
  const { state, reload } = useLoad<{ season: ProfileSeason }>(
    userId
      ? async () => {
          const r = await getMyProfileSeason(format);
          return 'error' in r ? r : { value: { season: r.value } };
        }
      : null,
    `season|${userId}|${format ?? 'all'}`,
  );
  return { ...state, reload };
}

export function useMyProfileRecent(userId: string | null | undefined, limit = 3) {
  const { state, reload } = useLoad<{ games: ProfileRecentGame[] }>(
    userId
      ? async () => {
          const r = await getMyProfileRecent(limit);
          return 'error' in r ? r : { value: { games: r.value } };
        }
      : null,
    `recent|${userId}|${limit}`,
  );
  return { ...state, reload };
}
