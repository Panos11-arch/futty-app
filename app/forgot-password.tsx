import { AuthError } from '@supabase/supabase-js';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import {
  AuthButton,
  AuthError as AuthErrorText,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthScreen,
  AuthSubtitle,
  AuthTitle,
} from '@/components/auth-form';
import { useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';

const RESEND_COOLDOWN_SECONDS = 60;

// Module-level rather than component state: this screen remounts every time
// the user navigates back to it, and without this a quick "back, then send
// again" would forget the cooldown and walk straight into Supabase's
// over_email_send_rate_limit error.
let cooldownUntil = 0;

function secondsRemaining() {
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(secondsRemaining);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(secondsRemaining()), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function submit() {
    if (email.trim().length === 0 || busy || cooldown > 0) return;

    setBusy(true);
    setError(null);

    try {
      await requestPasswordReset(email.trim());
      // Supabase deliberately succeeds whether or not the address exists, so
      // this message must not imply the account was found either way.
      setSent(true);
      cooldownUntil = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (cause) {
      // Supabase's mailer only allows a couple of sends per hour, so this
      // fires the moment someone re-submits too soon. That's not really a
      // failure from the user's point of view — an email already went out —
      // so treat it as success-with-a-wait rather than an alarming error.
      if (cause instanceof AuthError && cause.code === 'over_email_send_rate_limit') {
        setSent(true);
        cooldownUntil = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
        setCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        setError(describeAuthError(cause));
      }
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
        <>
          <AuthNotice>Open the link on this device so the app can pick it up.</AuthNotice>
          {cooldown > 0 ? (
            <AuthNotice>You can request another link in {cooldown}s.</AuthNotice>
          ) : (
            <AuthLink label="Resend link" onPress={submit} />
          )}
        </>
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

          {error ? <AuthErrorText>{error}</AuthErrorText> : null}

          <AuthButton
            label={cooldown > 0 ? `Try again in ${cooldown}s` : 'Send reset link'}
            onPress={submit}
            disabled={email.trim().length === 0 || cooldown > 0}
            busy={busy}
          />
        </>
      )}

      <AuthLink label="Back to sign in" onPress={() => router.replace('/sign-in')} />
    </AuthScreen>
  );
}
