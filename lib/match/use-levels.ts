// Hooks for levels and ratings (A5b): each gives loading, error (with
// reload) or ready, like the other match hooks.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useNeedsProfileSetup } from '@/lib/auth-providers';
import { shouldOfferStartingLevel, type MatchRatings, type PlayerLevel } from '@/lib/match/levels';
import { getMatchRatings, getPlayerLevel } from '@/lib/match/levels-api';
import { useLoad } from '@/lib/match/use-match-result';
import type { AvatarLook } from '@/lib/avatar';

export function usePlayerLevel(profileId: string | null | undefined) {
  const { state, reload } = useLoad<{ level: PlayerLevel | null }>(
    profileId
      ? async () => {
          const { level, error } = await getPlayerLevel(profileId);
          return error ? { error: error.message } : { value: { level } };
        }
      : null,
    profileId ?? ''
  );
  return { ...state, reload };
}

/** get_match_ratings with names; only loaded when `enabled`. */
export function useMatchRatings(matchId: string | undefined, enabled: boolean) {
  const { state, reload } = useLoad<{ ratings: MatchRatings; names: Record<string, string>; kits: Record<string, AvatarLook | null> }>(
    enabled && matchId
      ? async () => {
          const { ratings, names, kits, error } = await getMatchRatings(matchId);
          if (error || !ratings) return { error: error?.message ?? 'match_not_found' };
          return { value: { ratings, names, kits } };
        }
      : null,
    `${matchId}|${enabled}`
  );
  return { ...state, reload };
}

/** "Offered the starting questions on this device", per user. Not trusted for anything: it only stops a repeat. */
const offeredKey = (userId: string) => `futty.starting_level_offered.${userId}`;

async function readOffered(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(offeredKey(userId))) === 'true';
  } catch {
    // Unreadable: treat as offered, so a broken store never re-prompts on every focus.
    return true;
  }
}

async function storeOffered(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(offeredKey(userId), 'true');
  } catch {
    // Losing it only means one more offer.
  }
}

export const STARTING_LEVEL_ROUTE = '/starting-level';

/**
 * Home calls this: opens the five starting questions once per device for a
 * player with no questionnaire level (decision 1f.2, "offered once after
 * sign-up"). It waits while the P13 profile setup is pending or a password
 * recovery is under way, and pushes only while Home is focused; otherwise it
 * tries again the next time Home is focused. Skipping leaves the server's
 * provisional default.
 */
export function useStartingLevelOffer() {
  const { user, isRecovering } = useAuth();
  const userId = user?.id ?? null;
  const focused = useIsFocused();
  const profileSetup = useNeedsProfileSetup(userId && !isRecovering ? userId : null);
  const level = usePlayerLevel(userId);
  const [offered, setOffered] = useState<{ userId: string; value: boolean } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    readOffered(userId).then((value) => {
      if (active) setOffered({ userId, value });
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const alreadyOffered = !userId || offered?.userId !== userId ? 'loading' : offered.value;
  const offer =
    userId !== null &&
    shouldOfferStartingLevel({ focused, profileSetup, recovering: isRecovering, alreadyOffered, level });

  useEffect(() => {
    if (!offer || !userId) return;
    setOffered({ userId, value: true });
    storeOffered(userId);
    router.push(STARTING_LEVEL_ROUTE);
  }, [offer, userId]);
}
