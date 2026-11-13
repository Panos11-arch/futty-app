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

/** Retry delays for a failed profile read: doubling from the first, up to the cap. */
const PROFILE_READ_RETRY_FIRST_MS = 1_000;
const PROFILE_READ_RETRY_MAX_MS = 30_000;

/**
 * Whether the signed-in user's profile has no username yet: a new Apple or
 * Google user (an email user picks one on the sign-up form). The root layout
 * then shows only app/choose-username.tsx.
 *
 * 'loading' until the profile has been read, and while a failed read is being
 * retried: the root layout holds a loading screen until it knows, so a user
 * with no username never reaches (tabs). False when signed out.
 */
export function useNeedsProfileSetup(userId: string | null): boolean | 'loading' {
  const [known, setKnown] = useState<{ userId: string; needs: boolean } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = PROFILE_READ_RETRY_FIRST_MS;

    const retry = () => {
      if (!active) return;
      retryTimer = setTimeout(read, retryDelay);
      retryDelay = Math.min(retryDelay * 2, PROFILE_READ_RETRY_MAX_MS);
    };

    function read() {
      supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!active) return;
          if (error) return retry();
          setKnown({ userId: userId as string, needs: !data?.username });
        }, retry);
    }

    read();

    const onDone = () => setKnown({ userId, needs: false });
    setupDoneListeners.add(onDone);

    return () => {
      active = false;
      clearTimeout(retryTimer);
      setupDoneListeners.delete(onDone);
    };
  }, [userId]);

  if (!userId) return false;
  if (known?.userId !== userId) return 'loading';
  return known.needs;
}
