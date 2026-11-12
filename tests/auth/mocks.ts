// Shared mocks for the sign-in and onboarding tests (U6): no Supabase
// client, no native icon view, a fake router and a fake useAuth.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
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
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));

/** A promise the test settles by hand, to hold a request in flight. */
export function pending<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
