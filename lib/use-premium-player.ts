import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { isPremiumPlayer } from '@/lib/premium';
import { useProfile } from '@/lib/use-profile';

/**
 * Whether the signed-in player is on Premium, for things that change look
 * with it (the Card button, the Futty logo). The server decides
 * (isPremiumPlayer). Basic until the profile first loads; after that it keeps
 * the last answer while a refetch loads, so nothing flickers. It refetches
 * whenever its screen comes back into focus, so it changes right after a
 * Premium purchase.
 */
export function usePremiumPlayer(): boolean {
  const profile = useProfile();
  const { reload } = profile;
  const [last, setLast] = useState(false);
  const now = isPremiumPlayer(profile);
  if (now !== null && now !== last) setLast(now);

  // useProfile already loads on mount; refetch only when the screen comes back.
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) reload();
      mounted.current = true;
    }, [reload])
  );

  return now ?? last;
}
