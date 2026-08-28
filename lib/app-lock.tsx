import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { authenticate, getBiometricSupport } from '@/lib/biometrics';
import { preferences } from '@/lib/preferences';

/** Grace period so switching apps briefly — or the biometric sheet itself
 *  taking focus — does not immediately re-lock. */
const LOCK_AFTER_BACKGROUND_MS = 10_000;

type AppLockContextValue = {
  /** Hardware present and something enrolled. */
  supported: boolean;
  label: string;
  enabled: boolean;
  /** True only when there is actually a session worth protecting. */
  locked: boolean;
  /** Returns false if the user failed or dismissed the confirmation prompt. */
  setEnabled: (next: boolean) => Promise<boolean>;
  unlock: () => Promise<boolean>;
};

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function AppLockProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();

  const [supported, setSupported] = useState(false);
  const [label, setLabel] = useState('biometrics');
  const [enabled, setEnabled] = useState(() => preferences.isBiometricLockEnabled());
  // Cold start counts as a lock event, so seed from the stored preference.
  const [locked, setLocked] = useState(() => preferences.isBiometricLockEnabled());
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    getBiometricSupport().then((support) => {
      if (!active) return;

      setSupported(support.available);
      setLabel(support.label);

      // Biometrics may have been removed at the OS level since the preference
      // was set. Never leave someone stranded behind a check they can no longer
      // satisfy — there is no password fallback here to rescue them.
      if (!support.available) setLocked(false);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;

        if (enabled && supported && since !== null && Date.now() - since > LOCK_AFTER_BACKGROUND_MS) {
          setLocked(true);
        }
      } else if (state === 'background') {
        backgroundedAt.current = Date.now();
      }
    });

    return () => subscription.remove();
  }, [enabled, supported]);

  const unlock = useCallback(async () => {
    const ok = await authenticate('Unlock futty');
    if (ok) setLocked(false);
    return ok;
  }, []);

  const changeEnabled = useCallback(
    async (next: boolean) => {
      if (next) {
        // Make the user pass the check once before switching it on, so a broken
        // or unfamiliar scanner surfaces now rather than at next launch.
        const ok = await authenticate('Confirm to turn on app lock');
        if (!ok) return false;
      }

      preferences.setBiometricLockEnabled(next);
      setEnabled(next);
      setLocked(false);
      return true;
    },
    []
  );

  const value = useMemo<AppLockContextValue>(
    () => ({
      supported,
      label,
      enabled,
      // Locking a signed-out app would just hide the sign-in screen behind a
      // prompt that protects nothing.
      locked: locked && enabled && supported && !!session,
      setEnabled: changeEnabled,
      unlock,
    }),
    [supported, label, enabled, locked, session, changeEnabled, unlock]
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock() {
  const context = useContext(AppLockContext);
  if (!context) {
    throw new Error('useAppLock must be used inside an <AppLockProvider>.');
  }
  return context;
}
