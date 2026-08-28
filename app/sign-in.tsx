import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLink,
  AuthScreen,
  AuthSubtitle,
  AuthTitle,
} from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';
import { preferences } from '@/lib/preferences';
import { USERNAME_PATTERN, USERNAME_RULES_MESSAGE } from '@/lib/username';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const { signIn, signUp, isUsernameAvailable } = useAuth();

  const rememberedEmail = preferences.getRememberedEmail();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState(rememberedEmail ?? '');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [rememberEmail, setRememberEmail] = useState(rememberedEmail !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'sign-up';
  const canSubmit =
    email.trim().length > 0 && password.length > 0 && (!isSignUp || username.trim().length > 0);

  function switchMode() {
    setMode(isSignUp ? 'sign-in' : 'sign-up');
    setError(null);
  }

  async function submit() {
    if (!canSubmit || busy) return;

    setBusy(true);
    setError(null);

    // Written before the request: a successful sign-in unmounts this screen via
    // the route guards, so anything after the await may never run.
    preferences.setRememberedEmail(rememberEmail ? email.trim() : null);

    try {
      if (isSignUp) {
        const trimmedUsername = username.trim();

        if (!USERNAME_PATTERN.test(trimmedUsername)) {
          setError(USERNAME_RULES_MESSAGE);
          return;
        }

        // Checked up front for a clear message. The unique index is the real
        // guard — see the race handling in supabase/schema.sql.
        if (!(await isUsernameAvailable(trimmedUsername))) {
          setError(`"${trimmedUsername}" is already taken.`);
          return;
        }

        const { needsEmailConfirmation } = await signUp({
          email: email.trim(),
          password,
          username: trimmedUsername,
          fullName,
        });

        if (needsEmailConfirmation) {
          router.push({
            pathname: '/confirm-email',
            params: { email: email.trim() },
          });
          setPassword('');
          return;
        }
      } else {
        await signIn(email.trim(), password);
      }
      // On success the auth listener updates the session and the root layout
      // swaps this screen out, so there is nothing to navigate here.
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <AuthTitle icon={isSignUp ? 'sparkles' : 'hand.wave.fill'}>
        {isSignUp ? 'Create account' : 'Welcome back'}
      </AuthTitle>
      <AuthSubtitle>
        {isSignUp
          ? 'Pick a username and sign up with your email.'
          : 'Sign in to pick up where you left off.'}
      </AuthSubtitle>

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
      />

      {isSignUp ? (
        <>
          <AuthField
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            autoCapitalize="none"
            autoComplete="username-new"
            autoCorrect={false}
            editable={!busy}
          />
          <AuthField
            value={fullName}
            onChangeText={setFullName}
            placeholder="Full name (optional)"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            editable={!busy}
          />
        </>
      ) : null}

      <AuthField
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        autoCapitalize="none"
        autoComplete={isSignUp ? 'new-password' : 'current-password'}
        secureTextEntry
        textContentType={isSignUp ? 'newPassword' : 'password'}
        editable={!busy}
        onSubmitEditing={submit}
        returnKeyType="go"
      />

      <View style={styles.toggleRow}>
        <ThemedText>Remember my email</ThemedText>
        <Switch value={rememberEmail} onValueChange={setRememberEmail} disabled={busy} />
      </View>

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthButton
        label={isSignUp ? 'Sign up' : 'Sign in'}
        onPress={submit}
        disabled={!canSubmit}
        busy={busy}
      />

      <AuthLink
        label={isSignUp ? 'Already have an account? Sign in' : 'No account yet? Sign up'}
        onPress={switchMode}
        disabled={busy}
      />

      {isSignUp ? null : (
        <AuthLink
          label="Forgot your password?"
          onPress={() => router.push('/forgot-password')}
          disabled={busy}
        />
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
