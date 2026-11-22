import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { Platform } from 'react-native';

import {
  EmailTakenError,
  LINK_EXPIRED_MESSAGE,
  LINK_FAILED_MESSAGE,
} from '@/lib/auth-errors';
import { clearHasUsername } from '@/lib/profile-setup-flag';
import { supabase } from '@/lib/supabase';

/** Hand-rolled rather than URLSearchParams, whose React Native polyfill has
 *  historically been incomplete. The fragment format is simple enough. */
function parseFragment(fragment: string) {
  const out: Record<string, string> = {};

  for (const pair of fragment.split('&')) {
    if (!pair) continue;
    const separator = pair.indexOf('=');
    const key = separator === -1 ? pair : pair.slice(0, separator);
    const value = separator === -1 ? '' : pair.slice(separator + 1);
    out[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }

  return out;
}

export type SignUpParams = {
  email: string;
  password: string;
  username?: string;
  fullName?: string;
};

type SignUpResult = {
  /** True when Supabase withheld the session pending email confirmation. */
  needsEmailConfirmation: boolean;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** True until the persisted session has been read off disk. */
  initializing: boolean;
  /**
   * True while a password-recovery session is active. The user is technically
   * signed in at that point, so without this the route guards would drop them
   * into the app before they had set a new password.
   */
  isRecovering: boolean;
  /** Set when a native recovery deep link is expired or already used. */
  recoveryError: string | null;
  /** Set when a native sign-up or email-change link is expired, used or fails.
   *  Shown on the sign-in screen with a way to resend. */
  linkError: string | null;
  clearLinkError: () => void;
  signUp: (params: SignUpParams) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  isUsernameAvailable: (username: string) => Promise<boolean>;
  beginRecovery: () => void;
  endRecovery: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** The path Google sign-in redirects back to (lib/auth-providers.ts). That
 *  flow reads its own redirect, so the email-link handler below skips it. */
export const OAUTH_CALLBACK_PATH = 'auth/callback';

/** True for futtyapp://auth/callback and the exp://…/--/auth/callback dev form. */
export function isOAuthCallbackUrl(url: string) {
  return new RegExp(`(^|/)${OAUTH_CALLBACK_PATH}$`).test(url.split(/[?#]/)[0]);
}

/** Email-link types that sign the user in (the guards then route them on). */
const SIGN_IN_LINK_TYPES = new Set(['signup', 'email_change']);

export type AuthLink =
  | { kind: 'none' }
  | { kind: 'session'; type: string; accessToken: string; refreshToken: string }
  | { kind: 'error'; code: string | null; description: string; forRecovery: boolean };

/**
 * Reads an emailed Supabase link (implicit flow: tokens in the fragment).
 * Google's auth/callback is not an email link and reads its own redirect, so
 * it is 'none' here. An error on the reset-password path belongs to the
 * reset screen; any other error belongs to the sign-in screen.
 */
export function parseAuthLink(url: string): AuthLink {
  if (isOAuthCallbackUrl(url)) return { kind: 'none' };

  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return { kind: 'none' };
  const params = parseFragment(url.slice(hashIndex + 1));

  if (params.error_description || params.error) {
    return {
      kind: 'error',
      code: params.error_code || null,
      description: params.error_description || params.error,
      forRecovery: /(^|\/)reset-password$/.test(url.slice(0, hashIndex).split('?')[0]),
    };
  }

  if (!params.access_token || !params.refresh_token || !params.type) return { kind: 'none' };
  return {
    kind: 'session',
    type: params.type,
    accessToken: params.access_token,
    refreshToken: params.refresh_token,
  };
}

type SignInMode = 'sign-in' | 'sign-up';

/** The confirm-email screen's email, handed to sign-in in memory on web so it
 *  never lands in the address bar or browser history. */
let handedOff: string | null = null;

export function handedOffEmail() {
  return handedOff;
}

export function clearHandedOffEmail() {
  handedOff = null;
}

/** The sign-in route in a given mode with the email filled in. Native passes
 *  the email as a route param; web keeps it out of the URL. */
export function signInHref(mode: SignInMode, email?: string) {
  if (Platform.OS === 'web') {
    handedOff = email ?? null;
    return { pathname: '/sign-in' as const, params: { mode } };
  }
  return { pathname: '/sign-in' as const, params: email ? { mode, email } : { mode } };
}

/** Where Supabase should send the user after they click an emailed link. */
export function authRedirectTo(path: string) {
  // A stable callback is required by Supabase's redirect allowlist. Without
  // an explicit scheme, Expo Go can generate an exp:// URL that changes with
  // the current dev server and is rejected by Supabase.
  return Linking.createURL(path, { scheme: 'futtyapp' });
}

/**
 * Writes the caller's own `profiles` row. Upserted rather than inserted so it
 * stays correct alongside the `on auth.users` trigger in supabase/schema.sql —
 * whichever runs second is a no-op instead of a duplicate-key error.
 */
async function ensureProfile(user: User, params: SignUpParams) {
  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
      username: params.username?.trim() || null,
      full_name: params.fullName?.trim() || null,
    },
    { onConflict: 'id' }
  );

  if (error) throw error;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const [linkError, setLinkError] = useState<string | null>(null);

  // Native companion to `detectSessionInUrl`. Supabase sends emailed links
  // back with tokens in the URL fragment; supabase-js reads those off
  // `window.location` on web, but there is no such URL on native, so exchange
  // them for a session by hand. Lives here — always mounted — rather than in
  // a screen: the screens only render once the route guards let them
  // through, and while the app-lock screen is up (see app/_layout.tsx)
  // nothing under it mounts, so a hook parked in a screen would never see the
  // link.
  //
  // The URL is read with getInitialURL and the 'url' event, not useURL, so it
  // and its tokens live only in this call and are never kept in React state.
  // Nothing here logs a URL or a token.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;

    function handle(url: string | null) {
      if (!active || !url) return;
      const link = parseAuthLink(url);

      if (link.kind === 'error') {
        // Supabase reports expired or already-used links this way.
        if (link.forRecovery) setRecoveryError(link.description);
        else setLinkError(LINK_EXPIRED_MESSAGE);
        return;
      }
      if (link.kind !== 'session') return;

      const isRecovery = link.type === 'recovery';
      // Only type=recovery is a password reset. Anything else that isn't a
      // sign-in link is ignored rather than guessed at.
      if (!isRecovery && !SIGN_IN_LINK_TYPES.has(link.type)) return;

      // Set before the exchange: the moment a session lands the route guards
      // re-evaluate, and without it they would treat a recovery as a normal
      // sign-in and drop the user straight into the app.
      if (isRecovery) setIsRecovering(true);
      else setLinkError(null);

      supabase.auth
        .setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        .then(({ error: sessionError }) => {
          if (!sessionError || !active) return;
          if (isRecovery) setRecoveryError(sessionError.message);
          else setLinkError(LINK_FAILED_MESSAGE);
        });
    }

    Linking.getInitialURL().then(handle, () => {});
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setInitializing(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);

      // Fired on web, where supabase-js consumes the recovery link itself.
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovering(true);
      }
      if (event === 'SIGNED_OUT') {
        setIsRecovering(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const beginRecovery = useCallback(() => setIsRecovering(true), []);
  const endRecovery = useCallback(() => setIsRecovering(false), []);
  const clearLinkError = useCallback(() => setLinkError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      isRecovering,
      recoveryError,
      linkError,
      clearLinkError,
      beginRecovery,
      endRecovery,

      async signUp(params) {
        const username = params.username?.trim() || undefined;
        const fullName = params.fullName?.trim() || undefined;

        const { data, error } = await supabase.auth.signUp({
          email: params.email,
          password: params.password,
          options: {
            // With confirmation enabled there is no session at sign-up, so the
            // client cannot write these to `profiles` itself. Stashing them in
            // user metadata lets the database trigger copy them across.
            data: { username: username ?? null, full_name: fullName ?? null },
            emailRedirectTo: authRedirectTo('/'),
          },
        });
        if (error) throw error;

        // An email that already has a confirmed account: Supabase answers
        // with a user that has no identities and sends no email.
        if (data.user && !data.session && data.user.identities?.length === 0) {
          throw new EmailTakenError();
        }

        // Only reachable with confirmation disabled, where a session comes back
        // immediately and RLS will accept the write.
        if (data.session && data.user) {
          await ensureProfile(data.user, params);
        }

        return { needsEmailConfirmation: !data.session };
      },

      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },

      async signOut() {
        // The next person on this device must not inherit "has a username" (P13).
        if (session) await clearHasUsername(session.user.id);
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },

      async resendConfirmation(email) {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: authRedirectTo('/') },
        });
        if (error) throw error;
      },

      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectTo('/reset-password'),
        });
        if (error) throw error;
      },

      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      },

      async isUsernameAvailable(username) {
        const { data, error } = await supabase.rpc('is_username_available', {
          candidate: username,
        });
        if (error) throw error;
        return data === true;
      },
    }),
    [
      session,
      initializing,
      isRecovering,
      recoveryError,
      linkError,
      clearLinkError,
      beginRecovery,
      endRecovery,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }
  return context;
}
