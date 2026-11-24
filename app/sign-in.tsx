import * as AppleAuthentication from 'expo-apple-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { radius, space } from '@/constants/futty-theme';
import { useTheme } from '@/lib/theme';
import { clearHandedOffEmail, handedOffEmail, useAuth } from '@/lib/auth';
import { describeAuthError, EmailTakenError, RESEND_NEEDS_EMAIL_MESSAGE } from '@/lib/auth-errors';
import { signInWithApple, signInWithGoogle, useAppleSignInAvailable } from '@/lib/auth-providers';
import { emailError, passwordError, usernameError, useTouched } from '@/lib/auth-fields';
import { getPasswordLengthError } from '@/lib/password';
import { preferences } from '@/lib/preferences';
import { USERNAME_PATTERN, USERNAME_RULES_MESSAGE } from '@/lib/username';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const { colors } = useTheme();
  const { signIn, signUp, isUsernameAvailable, resendConfirmation, linkError, clearLinkError } =
    useAuth();
  // Set by confirm-email (lib/auth.tsx signInHref). On web the email comes
  // through memory instead, so it never sits in the address bar.
  const params = useLocalSearchParams<{ mode?: string; email?: string }>();

  const rememberedEmail = preferences.getRememberedEmail();

  const [mode, setMode] = useState<Mode>(params.mode === 'sign-up' ? 'sign-up' : 'sign-in');
  const [email, setEmail] = useState(
    () => params.email ?? handedOffEmail() ?? rememberedEmail ?? ''
  );
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [rememberEmail, setRememberEmail] = useState(rememberedEmail !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { touch, shown, reset } = useTouched<'email' | 'username' | 'password'>();
  const appleAvailable = useAppleSignInAvailable();

  useEffect(() => {
    clearHandedOffEmail();
  }, []);

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
    clearLinkError();
    reset();
  }

  // An expired or used email link (lib/auth.tsx): send a fresh one.
  async function resendLink() {
    if (busy) return;
    const address = email.trim();
    if (emailError(address)) {
      setError(RESEND_NEEDS_EMAIL_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await resendConfirmation(address);
      clearLinkError();
      router.push({ pathname: '/confirm-email', params: { email: address } });
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!canSubmit || busy) return;

    setBusy(true);
    setError(null);
    clearLinkError();

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
      // Already registered: Supabase sent nothing, so there is nothing to
      // confirm. Offer sign-in with the same email instead.
      if (cause instanceof EmailTakenError) {
        setMode('sign-in');
        setPassword('');
        reset();
      }
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  // Apple or Google (P13). A cancel shows nothing; a new user is sent to
  // choose-username by the root layout's guard.
  async function continueWith(signInWithProvider: typeof signInWithApple) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithProvider();
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
        testID="sign-in-email"
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
        testID="sign-in-password"
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

      {error || linkError ? (
        <View testID="sign-in-error">
          <AuthError>{error ?? linkError}</AuthError>
        </View>
      ) : null}

      {linkError ? (
        <AuthLink label="Resend confirmation email" onPress={resendLink} disabled={busy} />
      ) : null}

      <Button
        testID="sign-in-submit"
        label={isSignUp ? 'Sign up' : 'Sign in'}
        onPress={submit}
        disabled={!canSubmit}
        loading={busy}
        fullWidth
      />

      <Text variant="callout" tone="inkMuted" style={styles.or}>
        or
      </Text>
      {appleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={radius.control}
          style={styles.appleButton}
          onPress={() => continueWith(signInWithApple)}
        />
      ) : null}
      <Button
        label="Continue with Google"
        variant="secondary"
        onPress={() => continueWith(signInWithGoogle)}
        disabled={busy}
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
  or: { textAlign: 'center' },
  appleButton: { width: '100%', height: MIN_TOUCH },
});
