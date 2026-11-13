// Profile setup for a new Apple or Google user (P13): the username an email
// user picks on the sign-up form. The root layout shows only this screen
// while the signed-in profile has no username.
import { useState } from 'react';

import { AuthError, AuthLink, AuthScreen, AuthSubtitle, AuthTitle, AuthWordmark } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';
import { usernameError, useTouched } from '@/lib/auth-fields';
import { saveProfileSetup } from '@/lib/auth-providers';
import { USERNAME_PATTERN, USERNAME_RULES_MESSAGE } from '@/lib/username';

export default function ChooseUsernameScreen() {
  const { user, signOut, isUsernameAvailable } = useAuth();

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { touch, shown } = useTouched<'username'>();

  const canSubmit = username.trim().length > 0;

  async function submit() {
    if (!canSubmit || busy || !user) return;

    const trimmed = username.trim();
    if (!USERNAME_PATTERN.test(trimmed)) {
      setError(USERNAME_RULES_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Checked up front for a clear message; the unique index is the real guard.
      if (!(await isUsernameAvailable(trimmed))) {
        setError(`"${trimmed}" is already taken.`);
        return;
      }
      // On success the root layout's guard swaps this screen for the app.
      const failure = await saveProfileSetup(user.id, trimmed, fullName);
      if (failure) setError(failure);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <AuthWordmark />
      <AuthTitle>Pick a username</AuthTitle>
      <AuthSubtitle>This is how other players find you.</AuthSubtitle>

      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        onBlur={touch('username')}
        error={shown('username', usernameError(username))}
        autoCapitalize="none"
        autoComplete="username-new"
        autoCorrect={false}
        editable={!busy}
      />
      <TextField
        label="Full name (optional)"
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        editable={!busy}
        onSubmitEditing={submit}
        returnKeyType="go"
      />

      {error ? <AuthError>{error}</AuthError> : null}

      <Button label="Continue" onPress={submit} disabled={!canSubmit} loading={busy} fullWidth />

      <AuthLink label="Sign out" onPress={() => signOut().catch(() => {})} disabled={busy} />
    </AuthScreen>
  );
}
