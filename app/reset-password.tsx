import { router } from 'expo-router';
import { useState } from 'react';

import {
  AuthError,
  AuthLink,
  AuthScreen,
  AuthSubtitle,
  AuthTitle,
  AuthWordmark,
  PasswordStrengthMeter,
} from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';
import { passwordError, useTouched } from '@/lib/auth-fields';
import { getPasswordLengthError } from '@/lib/password';

export default function ResetPasswordScreen() {
  const { session, updatePassword, endRecovery, recoveryError: linkError } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { touch, shown } = useTouched<'password' | 'confirmation'>();

  const passwordLengthError = getPasswordLengthError(password);

  async function submit() {
    if (busy) return;

    if (passwordLengthError) {
      setError(passwordLengthError);
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
        <AuthWordmark />
        <AuthTitle>Link expired</AuthTitle>
        <AuthSubtitle>{linkError}</AuthSubtitle>
        <Button label="Request a new link" onPress={() => router.replace('/forgot-password')} fullWidth />
      </AuthScreen>
    );
  }

  // Reachable if someone opens this route directly rather than via the email.
  if (!session) {
    return (
      <AuthScreen>
        <AuthWordmark />
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
      <AuthWordmark />
      <AuthTitle>New password</AuthTitle>
      <AuthSubtitle>Choose a new password for {session.user.email}.</AuthSubtitle>

      <TextField
        label="New password"
        value={password}
        onChangeText={setPassword}
        onBlur={touch('password')}
        // The length rule shows as soon as there's input, as before.
        error={passwordLengthError ?? shown('password', passwordError(password, { isNew: true }))}
        autoCapitalize="none"
        autoComplete="new-password"
        secureTextEntry
        textContentType="newPassword"
        editable={!busy}
      />

      <PasswordStrengthMeter password={password} />

      <TextField
        label="Confirm new password"
        value={confirmation}
        onChangeText={setConfirmation}
        onBlur={touch('confirmation')}
        error={shown('confirmation', confirmation.length === 0 ? 'Enter the password again.' : null)}
        autoCapitalize="none"
        autoComplete="new-password"
        secureTextEntry
        textContentType="newPassword"
        editable={!busy}
        onSubmitEditing={submit}
        returnKeyType="go"
      />

      {error ? <AuthError>{error}</AuthError> : null}

      <Button
        label="Update password"
        onPress={submit}
        disabled={password.length === 0 || confirmation.length === 0 || !!passwordLengthError}
        loading={busy}
        fullWidth
      />
    </AuthScreen>
  );
}
