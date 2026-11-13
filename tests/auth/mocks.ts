// Shared mocks for the sign-in and onboarding tests (U6): no Supabase
// client, no native icon view, a fake router and a fake useAuth.
// Sign in with Apple and Google (P13) go through the real lib/auth-providers,
// so these screens get a Supabase client with the calls it makes.
export const mockSupabase = {
  auth: { signInWithIdToken: jest.fn(), signInWithOAuth: jest.fn(), setSession: jest.fn() },
  profileUpdate: jest.fn(),
  profileUpsert: jest.fn(),
};
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: mockSupabase.auth,
    from: () => ({
      update: (values: unknown) => ({
        eq: () => ({ is: () => mockSupabase.profileUpdate(values) }),
      }),
      upsert: (values: unknown) => mockSupabase.profileUpsert(values),
    }),
  },
}));

// Native modules: Apple's button and sheet, the hashing, and the auth browser.
export const mockApple = { isAvailableAsync: jest.fn(async () => false), signInAsync: jest.fn() };
jest.mock('expo-apple-authentication', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    isAvailableAsync: () => mockApple.isAvailableAsync(),
    signInAsync: (options: unknown) => mockApple.signInAsync(options),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { BLACK: 2 },
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Continue with Apple', onPress }),
  };
});
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-nonce',
  digestStringAsync: async (_algorithm: string, data: string) => `sha256(${data})`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
export const mockWebBrowser = { openAuthSessionAsync: jest.fn() };
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockWebBrowser.openAuthSessionAsync(...args),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('@/lib/preferences', () => ({
  preferences: { getRememberedEmail: jest.fn(() => null), setRememberedEmail: jest.fn() },
}));

export const mockAuth = {
  session: null as null | { user: { email: string } },
  recoveryError: null as string | null,
  signIn: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(),
  isUsernameAvailable: jest.fn(),
  requestPasswordReset: jest.fn(),
  resendConfirmation: jest.fn(),
  updatePassword: jest.fn(),
  endRecovery: jest.fn(),
};
jest.mock('@/lib/auth', () => ({
  useAuth: () => mockAuth,
  OAUTH_CALLBACK_PATH: jest.requireActual<typeof import('@/lib/auth')>('@/lib/auth').OAUTH_CALLBACK_PATH,
}));

/** A promise the test settles by hand, to hold a request in flight. */
export function pending<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `futtyapp://${path.replace(/^\//, '')}`,
  useURL: () => null,
}));
