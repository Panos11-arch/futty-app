import { useEffect, useState } from 'react';

import { AuthError, AuthLink, AuthScreen, AuthSubtitle, AuthTitle, AuthWordmark } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { useAppLock } from '@/lib/app-lock';
import { useAuth } from '@/lib/auth';

export function LockScreen() {
  const { unlock, label } = useAppLock();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function attempt() {
    if (busy) return;

    setBusy(true);
    setFailed(false);

    try {
      const ok = await unlock();
      if (!ok) setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // Prompt straight away rather than making the user tap first; the button below
  // is the retry path after a cancel or a failed scan.
  useEffect(() => {
    attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthScreen>
      <AuthWordmark />
      <AuthTitle>Locked</AuthTitle>
      <AuthSubtitle>Unlock with {label} to get back in.</AuthSubtitle>

      {failed ? <AuthError>Not recognised. Try again, or sign out.</AuthError> : null}

      <Button label={`Unlock with ${label}`} onPress={attempt} loading={busy} fullWidth />

      <AuthLink label="Sign out instead" onPress={signOut} disabled={busy} />
    </AuthScreen>
  );
}
