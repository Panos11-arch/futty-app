import { router } from 'expo-router';
import { useState } from 'react';

import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLink,
  AuthScreen,
  AuthSubtitle,
  AuthTitle,
} from '@/components/auth-form';
import { useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';

const MIN_PASSWORD_LENGTH = 6;

export default function ResetPasswordScreen() {
  const { session, updatePassword, endRecovery, recoveryError: linkError } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await updatePassword(password);
      // Clearing recovery mode hands the (already valid) session back to the
      // route guards, which drop the user into the app.
      endRecovery();
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (linkError) {
    return (
      <AuthScreen>
        <AuthTitle>Link expired</AuthTitle>
        <AuthSubtitle>{linkError}</AuthSubtitle>
        <AuthButton
          label="Request a new link"
          onPress={() => router.replace('/forgot-password')}
        />
      </AuthScreen>
    );
  }

  // Reachable if someone opens this route directly rather than via the email.
  if (!session) {
    return (
      <AuthScreen>
        <AuthTitle>Open your reset link</AuthTitle>
        <AuthSubtitle>
          This screen needs the link from your reset email. Open that link on this device to
          continue.
        </AuthSubtitle>
        <AuthLink label="Back to sign in" onPress={() => router.replace('/sign-in')} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <AuthTitle icon="key.fill">New password</AuthTitle>
      <AuthSubtitle>Choose a new password for {session.user.email}.</AuthSubtitle>

      <AuthField
        value={password}
        onChangeText={setPassword}
        placeholder="New password"
        autoCapitalize="none"
        autoComplete="new-password"
        secureTextEntry
        textContentType="newPassword"
        editable={!busy}
      />

      <AuthField
        value={confirmation}
        onChangeText={setConfirmation}
        placeholder="Confirm new password"
        autoCapitalize="none"
        autoComplete="new-password"
        secureTextEntry
        textContentType="newPassword"
        editable={!busy}
        onSubmitEditing={submit}
        returnKeyType="go"
      />

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthButton
        label="Update password"
        onPress={submit}
        disabled={password.length === 0 || confirmation.length === 0}
        busy={busy}
      />
    </AuthScreen>
  );
}
