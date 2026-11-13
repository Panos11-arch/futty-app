// Sign in with Apple and Google (P13), and the profile setup a new user of
// either goes through. Supabase Auth only: no native Google SDK, and no Apple
// or Google secret ever lives in the app.
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Profile setup
// ---------------------------------------------------------------------------

const setupDoneListeners = new Set<() => void>();

/** Called by app/choose-username.tsx once the username is saved, so the root
 *  layout's guard lets the user into the app without another round trip. */
export function markProfileSetupDone() {
  setupDoneListeners.forEach((listener) => listener());
}

/**
 * True once we know the signed-in user's profile has no username: a new Apple
 * or Google user (an email user picks one on the sign-up form). The root
 * layout then shows only app/choose-username.tsx.
 *
 * False while loading and on a failed read: a slow or broken network must not
 * lock an existing user out of the app or flash a blank screen at them.
 */
export function useNeedsProfileSetup(userId: string | null): boolean {
  const [needsFor, setNeedsFor] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error) return;
        setNeedsFor(data?.username ? null : userId);
      });

    const onDone = () => setNeedsFor(null);
    setupDoneListeners.add(onDone);

    return () => {
      active = false;
      setupDoneListeners.delete(onDone);
    };
  }, [userId]);

  return userId !== null && needsFor === userId;
}
