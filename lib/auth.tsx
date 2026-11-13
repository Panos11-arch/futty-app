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
 *  flow reads its own redirect, so the recovery-link handler below skips it. */
export const OAUTH_CALLBACK_PATH = 'auth/callback';

/** True for futtyapp://auth/callback and the exp://…/--/auth/callback dev form. */
export function isOAuthCallbackUrl(url: string) {
  return new RegExp(`(^|/)${OAUTH_CALLBACK_PATH}$`).test(url.split(/[?#]/)[0]);
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

  // Native companion to `detectSessionInUrl`. Supabase returns recovery tokens
  // in the deep link's URL fragment; supabase-js reads those off
  // `window.location` on web, but there is no such URL on native, so exchange
  // them for a session by hand. Lives here — always mounted — rather than in
  // the reset-password screen itself: that screen only renders once the route
  // guards let it through, and while the app-lock screen is up (see
  // app/_layout.tsx) nothing under it mounts, so a hook parked in the screen
  // would never see the link and the user would fall back into their old
  // session after unlocking instead of landing on the reset flow.
  const recoveryUrl = Linking.useURL();

  useEffect(() => {
    if (Platform.OS === 'web' || !recoveryUrl) return;
    // A Google sign-in's tokens are not a recovery link.
    if (isOAuthCallbackUrl(recoveryUrl)) return;

    const hashIndex = recoveryUrl.indexOf('#');
    if (hashIndex === -1) return;

    const params = parseFragment(recoveryUrl.slice(hashIndex + 1));

    // Supabase reports expired or already-used links this way.
    if (params.error_description) {
      setRecoveryError(params.error_description);
      return;
    }

    if (!params.access_token || !params.refresh_token) return;

    // Set this before the exchange: the moment a session lands the route
    // guards re-evaluate, and without it they would treat this as a normal
    // sign-in and drop the user straight into the app.
    setIsRecovering(true);

    supabase.auth
      .setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      })
      .then(({ error: sessionError }) => {
        if (sessionError) setRecoveryError(sessionError.message);
      });
  }, [recoveryUrl]);

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

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      isRecovering,
      recoveryError,
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
    [session, initializing, isRecovering, recoveryError, beginRecovery, endRecovery]
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
