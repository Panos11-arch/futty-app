import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';

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
import { useTheme } from '@/lib/theme';
import { signInHref, useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';

export default function ConfirmEmailScreen() {
  const { colors } = useTheme();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const { session, resendConfirmation } = useAuth();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendCount, setSendCount] = useState(0);

  // The link in the email signs the user in (lib/auth.tsx). Once the session
  // lands, the root layout's guards take this screen away and route the user
  // on to choose-username or Home; until then, show that it's happening.
  if (session) {
    return (
      <AuthScreen>
        <AuthWordmark />
        <ActivityIndicator color={colors.positive} accessibilityLabel="Signing you in" />
      </AuthScreen>
    );
  }

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
        We sent a link to <Text variant="headline">{email ?? 'your email'}</Text>. Open it on this
        phone.
      </AuthSubtitle>

      {error ? <AuthError>{error}</AuthError> : null}
      {notice ? (
        <AuthNotice>
          {notice}
          {sendCount > 1 ? ` (sent ${sendCount} times)` : ''}
        </AuthNotice>
      ) : null}

      <Button
        label="Resend email"
        onPress={resend}
        disabled={!email}
        loading={busy}
        fullWidth
      />

      <AuthLink
        label="Use a different email"
        onPress={() => router.replace(signInHref('sign-up', email))}
        disabled={busy}
      />

      <AuthLink
        label="Opened it on another device? Sign in"
        onPress={() => router.replace(signInHref('sign-in', email))}
        disabled={busy}
      />
    </AuthScreen>
  );
}
