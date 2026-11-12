import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import {
  AuthError,
  AuthLink,
  AuthNotice,
  AuthScreen,
  AuthSubtitle,
  AuthTitle,
  AuthWordmark,
} from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';

export default function ConfirmEmailScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const { resendConfirmation } = useAuth();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendCount, setSendCount] = useState(0);

  // No artificial cooldown — resend as often as you like. The button is only
  // disabled while a request is in flight, to stop a double tap sending twice.
  // Supabase still enforces its own per-hour cap server side.
  async function resend() {
    if (!email || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await resendConfirmation(email);
      setSendCount((count) => count + 1);
      setNotice('Sent. Check your inbox, and your spam folder.');
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <AuthWordmark />
      <AuthTitle>Check your inbox</AuthTitle>
      <AuthSubtitle>
        We sent a confirmation link to{' '}
        <Text variant="headline">{email ?? 'your email address'}</Text>. Click it, then come back and sign in.
      </AuthSubtitle>

      {error ? <AuthError>{error}</AuthError> : null}
      {notice ? (
        <AuthNotice>
          {notice}
          {sendCount > 1 ? ` (sent ${sendCount} times)` : ''}
        </AuthNotice>
      ) : null}

      <Button
        label="I've confirmed, sign in"
        onPress={() => router.replace('/sign-in')}
        disabled={busy}
        fullWidth
      />

      <Button
        label="Resend confirmation email"
        variant="secondary"
        onPress={resend}
        disabled={!email}
        loading={busy}
        fullWidth
      />

      <AuthLink label="Use a different email" onPress={() => router.replace('/sign-in')} />
    </AuthScreen>
  );
}
