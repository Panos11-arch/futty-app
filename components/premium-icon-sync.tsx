// Once per launch, once the signed-in player's profile has loaded from the
// server, puts the right home-screen icon up for their is_premium
// (lib/premium-icon.ts). Renders nothing. Mounted in app/_layout.tsx for
// signed-in players.
import { useEffect } from 'react';

import { syncPremiumIcon } from '@/lib/premium-icon';
import { useProfile } from '@/lib/use-profile';

// Module-level, so signing out and in again (a remount) doesn't check twice.
let checkedThisLaunch = false;

/** For tests. */
export function resetPremiumIconSyncForTests() {
  checkedThisLaunch = false;
}

export function PremiumIconSync() {
  const profile = useProfile();
  const isPremium = profile.status === 'ready' ? profile.profile.is_premium === true : null;

  useEffect(() => {
    if (checkedThisLaunch || isPremium === null) return;
    checkedThisLaunch = true;
    void syncPremiumIcon('launch', isPremium);
  }, [isPremium]);

  return null;
}
