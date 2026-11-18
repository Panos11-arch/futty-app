// Hooks for the Streak card and other players' streak badges (A11): each
// gives loading, error (with reload) or ready, like the match hooks.
import { useLoad } from '@/lib/match/use-match-result';
import { getMyStreak, getPlayerStreakBadges, type MyStreak, type PlayerStreakBadges } from '@/lib/stats/streaks';

export function useMyStreak(userId: string | null | undefined) {
  const { state, reload } = useLoad<{ streak: MyStreak | null }>(
    userId
      ? async () => {
          const { streak, error } = await getMyStreak();
          return error ? { error: error.message } : { value: { streak } };
        }
      : null,
    userId ?? '',
  );
  return { ...state, reload };
}

export function usePlayerStreakBadges(profileId: string | null | undefined) {
  const { state, reload } = useLoad<{ badges: PlayerStreakBadges }>(
    profileId
      ? async () => {
          const { badges, error } = await getPlayerStreakBadges(profileId);
          return error ? { error: error.message } : { value: { badges } };
        }
      : null,
    profileId ?? '',
  );
  return { ...state, reload };
}
