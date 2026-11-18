// Streaks and streak badges (A11, docs/specs/match-record.md decision 1i).
// The server works out the streak and awards the badges; the app only shows
// what get_my_streak and get_player_streak_badges return.
import { supabase } from '@/lib/supabase';

export type StreakBadgeKey = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'champion';

/** One of the six levels on the caller's own Streak card, earned or not. */
export type StreakBadgeLevel = {
  badge: StreakBadgeKey;
  label: string;
  weeks: number;
  earned: boolean;
  awardedAt: string | null;
};

export type MyStreak = {
  current: number;
  best: number;
  /** Earned badges show in colour only while this is true. */
  isPremium: boolean;
  badges: StreakBadgeLevel[];
};

export type EarnedStreakBadge = { badge: StreakBadgeKey; label: string; weeks: number; awardedAt: string };

/** Another player's earned badges; in colour only while that player is Premium. */
export type PlayerStreakBadges = { inColour: boolean; badges: EarnedStreakBadge[] };

type RpcError = { message: string } | null;

export async function getMyStreak(): Promise<{ streak: MyStreak | null; error: RpcError }> {
  const { data, error } = await supabase.rpc('get_my_streak');
  if (error) return { streak: null, error };
  return { streak: (data as MyStreak | null) ?? null, error: null };
}

export async function getPlayerStreakBadges(
  profileId: string,
): Promise<{ badges: PlayerStreakBadges; error: RpcError }> {
  const { data, error } = await supabase.rpc('get_player_streak_badges', { p_profile_id: profileId });
  const badges = (data as PlayerStreakBadges | null) ?? { inColour: false, badges: [] };
  return { badges, error: error ?? null };
}

/** "1 week", "3 weeks". */
export function weeksLabel(n: number): string {
  return n === 1 ? '1 week' : `${n} weeks`;
}
