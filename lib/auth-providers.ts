// Sign in with Apple and Google (P13), and the profile setup a new user of
// either goes through. Supabase Auth only: no native Google SDK, and no Apple
// or Google secret ever lives in the app.
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { OAUTH_CALLBACK_PATH } from '@/lib/auth';
import { clearHasUsername, hasStoredUsername, storeHasUsername } from '@/lib/profile-setup-flag';
import { supabase } from '@/lib/supabase';

/** A cancelled sheet or browser is not an error: the screen shows nothing. */
export type ProviderSignInResult = { status: 'signed-in' } | { status: 'cancelled' };

function isAppleCancel(cause: unknown) {
  return (cause as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED';
}

// ---------------------------------------------------------------------------
// Apple (iOS only)
// ---------------------------------------------------------------------------

/** Only iOS 13+ devices can show the native Apple button. */
export function useAppleSignInAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((yes) => {
        if (active) setAvailable(yes);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return available;
}

/**
 * Apple sends the name only on the very first sign-in, so it is saved then.
 * Only fills an empty full_name: never overwrites one the user has set.
 */
export async function saveAppleName(
  userId: string,
  fullName: AppleAuthentication.AppleAuthenticationFullName | null
) {
  const name = [fullName?.givenName, fullName?.familyName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  if (!name) return;

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: name })
    .eq('id', userId)
    .is('full_name', null);
  // The account exists and is signed in; a lost name is not worth failing
  // the sign-in over. The user can add it on the next screen or in their profile.
  if (error) console.warn('Could not save the name from Apple:', error.message);
}

/**
 * Native Sign in with Apple, then Supabase's signInWithIdToken. Apple gets
 * the SHA-256 of a random nonce and Supabase the raw nonce, so a stolen
 * identity token can't be replayed.
 */
export async function signInWithApple(): Promise<ProviderSignInResult> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (cause) {
    if (isAppleCancel(cause)) return { status: 'cancelled' };
    throw cause;
  }

  if (!credential.identityToken) {
    throw new Error('Apple did not return a sign-in token. Try again.');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  if (data.user) await saveAppleName(data.user.id, credential.fullName);
  return { status: 'signed-in' };
}

/**
 * Asks the user to confirm with Apple once more, for account deletion: the
 * server swaps this short-lived code for a token and revokes it with Apple
 * (App Review Guideline 5.1.1(v)). Null when the user cancels.
 */
export async function getAppleDeletionCode(): Promise<string | null> {
  try {
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    if (!credential.authorizationCode) {
      throw new Error('Apple did not return a confirmation code. Try again.');
    }
    return credential.authorizationCode;
  } catch (cause) {
    if (isAppleCancel(cause)) return null;
    throw cause;
  }
}

// ---------------------------------------------------------------------------
// Google (Supabase OAuth in an auth session, no native SDK)
// ---------------------------------------------------------------------------

export type OAuthRedirect =
  | { tokens: { access_token: string; refresh_token: string } }
  | { error: string };

/**
 * Reads the redirect Supabase sends back after Google: tokens (or an error)
 * in the URL fragment, as with the app's other auth links. Errors can also
 * come back in the query string.
 */
export function parseOAuthRedirect(url: string): OAuthRedirect {
  const params: Record<string, string> = {};
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const parts = [
    queryIndex === -1 ? '' : url.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex),
    hashIndex === -1 ? '' : url.slice(hashIndex + 1),
  ];

  for (const part of parts) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const separator = pair.indexOf('=');
      const key = separator === -1 ? pair : pair.slice(0, separator);
      const value = separator === -1 ? '' : pair.slice(separator + 1);
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }

  if (params.error_description || params.error) {
    return { error: params.error_description || params.error };
  }
  if (params.access_token && params.refresh_token) {
    return { tokens: { access_token: params.access_token, refresh_token: params.refresh_token } };
  }
  return { error: 'Google sign-in did not finish. Try again.' };
}

export async function signInWithGoogle(): Promise<ProviderSignInResult> {
  const redirectTo = Linking.createURL(OAUTH_CALLBACK_PATH, { scheme: 'futtyapp' });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return { status: 'cancelled' };

  const redirect = parseOAuthRedirect(result.url);
  if ('error' in redirect) throw new Error(redirect.error);

  const { error: sessionError } = await supabase.auth.setSession(redirect.tokens);
  if (sessionError) throw sessionError;
  return { status: 'signed-in' };
}

// ---------------------------------------------------------------------------
// Profile setup
// ---------------------------------------------------------------------------

const setupDoneListeners = new Set<() => void>();

/** Called by app/choose-username.tsx once the username is saved, so the root
 *  layout's guard lets the user into the app without another round trip. */
export function markProfileSetupDone() {
  setupDoneListeners.forEach((listener) => listener());
}

/**
 * Saves the username a new Apple or Google user picks (app/choose-username.tsx),
 * and the full name only when they typed one, so the name Apple or Google
 * gave stays otherwise. Returns an error message, or null on success.
 */
export async function saveProfileSetup(
  userId: string,
  username: string,
  fullName: string
): Promise<string | null> {
  const name = fullName.trim();
  const { error } = await supabase
    .from('profiles')
    .update(name ? { username, full_name: name } : { username })
    .eq('id', userId);

  // profiles_username_lower_key: someone took it since the availability check.
  if (error?.code === '23505') return `"${username}" is already taken.`;
  if (error) return error.message;

  markProfileSetupDone();
  return null;
}

/** Retry delays for a failed profile read: doubling from the first, up to the cap. */
const PROFILE_READ_RETRY_FIRST_MS = 1_000;
const PROFILE_READ_RETRY_MAX_MS = 30_000;

/**
 * Whether the signed-in user's profile has no username yet: a new Apple or
 * Google user (an email user picks one on the sign-up form). The root layout
 * then shows only app/choose-username.tsx.
 *
 * 'loading' until the profile has been read, and while a failed read is being
 * retried: the root layout holds a loading screen until it knows, so a user
 * with no username never reaches (tabs). False when signed out.
 *
 * A user this device has already seen with a username (lib/profile-setup-flag)
 * is let in at once, so an existing user isn't held offline; the read still
 * runs in the background and its answer wins.
 */
export function useNeedsProfileSetup(userId: string | null): boolean | 'loading' {
  const [known, setKnown] = useState<{ userId: string; needs: boolean } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const id = userId;
    let active = true;
    // Once the server has answered, the stored flag no longer counts.
    let answered = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = PROFILE_READ_RETRY_FIRST_MS;

    const retry = () => {
      if (!active) return;
      retryTimer = setTimeout(read, retryDelay);
      retryDelay = Math.min(retryDelay * 2, PROFILE_READ_RETRY_MAX_MS);
    };

    function read() {
      supabase
        .from('profiles')
        .select('username')
        .eq('id', id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!active) return;
          if (error) return retry();
          answered = true;
          const needs = !data?.username;
          setKnown({ userId: id, needs });
          if (needs) clearHasUsername(id);
          else storeHasUsername(id);
        }, retry);
    }

    hasStoredUsername(id).then((stored) => {
      if (active && stored && !answered) setKnown({ userId: id, needs: false });
    });
    read();

    const onDone = () => {
      answered = true;
      setKnown({ userId: id, needs: false });
      storeHasUsername(id);
    };
    setupDoneListeners.add(onDone);

    return () => {
      active = false;
      clearTimeout(retryTimer);
      setupDoneListeners.delete(onDone);
    };
  }, [userId]);

  if (!userId) return false;
  if (known?.userId !== userId) return 'loading';
  return known.needs;
}
