import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import {
  AuthButton,
  AuthError,
  AuthLink,
  AuthNotice,
  AuthScreen,
  AuthSubtitle,
  AuthTitle,
} from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
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
      <AuthTitle icon="envelope.fill">Check your inbox</AuthTitle>
      <AuthSubtitle>
        We sent a confirmation link to{' '}
        <ThemedText type="defaultSemiBold">{email ?? 'your email address'}</ThemedText>. Click it,
        then come back and sign in.
      </AuthSubtitle>

      {error ? <AuthError>{error}</AuthError> : null}
      {notice ? (
        <AuthNotice>
          {notice}
          {sendCount > 1 ? ` (sent ${sendCount} times)` : ''}
        </AuthNotice>
      ) : null}

      <AuthButton
        label="I've confirmed — sign in"
        onPress={() => router.replace('/sign-in')}
        disabled={busy}
      />

      <AuthButton
        label="Resend confirmation email"
        variant="secondary"
        onPress={resend}
        disabled={!email}
        busy={busy}
      />

      <AuthLink label="Use a different email" onPress={() => router.replace('/sign-in')} />
    </AuthScreen>
  );
}
