import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

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
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { colors, space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-errors';
import { emailError, passwordError, usernameError, useTouched } from '@/lib/auth-fields';
import { getPasswordLengthError } from '@/lib/password';
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
  const { touch, shown, reset } = useTouched<'email' | 'username' | 'password'>();

  const isSignUp = mode === 'sign-up';
  const passwordLengthError = isSignUp ? getPasswordLengthError(password) : null;
  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    !passwordLengthError &&
    (!isSignUp || username.trim().length > 0);

  function switchMode() {
    setMode(isSignUp ? 'sign-in' : 'sign-up');
    setError(null);
    reset();
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

        if (passwordLengthError) {
          setError(passwordLengthError);
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
      <AuthWordmark />
      <AuthTitle>{isSignUp ? 'Create account' : 'Welcome back'}</AuthTitle>
      <AuthSubtitle>
        {isSignUp
          ? 'Pick a username and sign up with your email.'
          : 'Sign in to pick up where you left off.'}
      </AuthSubtitle>

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        onBlur={touch('email')}
        error={shown('email', emailError(email))}
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
          />
        </>
      ) : null}

      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        onBlur={touch('password')}
        // The length rule shows as soon as there's input, as before.
        error={passwordLengthError ?? shown('password', passwordError(password, { isNew: isSignUp }))}
        autoCapitalize="none"
        autoComplete={isSignUp ? 'new-password' : 'current-password'}
        secureTextEntry
        textContentType={isSignUp ? 'newPassword' : 'password'}
        editable={!busy}
        onSubmitEditing={submit}
        returnKeyType="go"
      />

      {isSignUp ? <PasswordStrengthMeter password={password} /> : null}

      <View style={styles.toggleRow}>
        <Text variant="body">Remember my email</Text>
        <Switch
          accessibilityLabel="Remember my email"
          value={rememberEmail}
          onValueChange={setRememberEmail}
          disabled={busy}
          trackColor={{ false: colors.border, true: colors.brand }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.border}
        />
      </View>

      {error ? <AuthError>{error}</AuthError> : null}

      <Button
        label={isSignUp ? 'Sign up' : 'Sign in'}
        onPress={submit}
        disabled={!canSubmit}
        loading={busy}
        fullWidth
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
    gap: space.md,
    minHeight: MIN_TOUCH,
  },
});
