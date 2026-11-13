// Sign in with Apple and Google (P13), and the profile setup a new user of
// either goes through. Supabase Auth only: no native Google SDK, and no Apple
// or Google secret ever lives in the app.
import { useEffect, useState } from 'react';

import { clearHasUsername, hasStoredUsername, storeHasUsername } from '@/lib/profile-setup-flag';
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
 *
 * A user this device has already seen with a username (lib/profile-setup-flag)
 * is let in at once, so an existing user isn't held offline; the read still
 * runs in the background and its answer wins.
 */
export function useNeedsProfileSetup(userId: string | null): boolean | 'loading' {
  const [known, setKnown] = useState<{ userId: string; needs: boolean } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const id = userId;
    let active = true;
    // Once the server has answered, the stored flag no longer counts.
    let answered = false;
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
        .eq('id', id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!active) return;
          if (error) return retry();
          answered = true;
          const needs = !data?.username;
          setKnown({ userId: id, needs });
          if (needs) clearHasUsername(id);
          else storeHasUsername(id);
        }, retry);
    }

    hasStoredUsername(id).then((stored) => {
      if (active && stored && !answered) setKnown({ userId: id, needs: false });
    });
    read();

    const onDone = () => {
      answered = true;
      setKnown({ userId: id, needs: false });
      storeHasUsername(id);
    };
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
