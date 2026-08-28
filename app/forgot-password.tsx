import { router } from 'expo-router';
import { useState } from 'react';

import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthScreen,
  AuthSubtitle,
  AuthTitle,
} from '@/components/auth-form';
import { useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (email.trim().length === 0 || busy) return;

    setBusy(true);
    setError(null);

    try {
      await requestPasswordReset(email.trim());
      // Supabase deliberately succeeds whether or not the address exists, so
      // this message must not imply the account was found either way.
      setSent(true);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <AuthTitle icon="key.fill">Reset password</AuthTitle>
      <AuthSubtitle>
        {sent
          ? 'If that address has an account, a reset link is on its way.'
          : 'Enter your email and we will send you a reset link.'}
      </AuthSubtitle>

      {sent ? (
        <AuthNotice>Open the link on this device so the app can pick it up.</AuthNotice>
      ) : (
        <>
          <AuthField
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!busy}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {error ? <AuthError>{error}</AuthError> : null}

          <AuthButton
            label="Send reset link"
            onPress={submit}
            disabled={email.trim().length === 0}
            busy={busy}
          />
        </>
      )}

      <AuthLink label="Back to sign in" onPress={() => router.replace('/sign-in')} />
    </AuthScreen>
  );
}
