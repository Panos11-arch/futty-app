import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthProvider, isOAuthCallbackUrl, useAuth } from '@/lib/auth';

let mockUrl: string | null = null;
jest.mock('expo-linking', () => ({
  useURL: () => mockUrl,
  createURL: (path: string) => `futtyapp://${path}`,
}));

const mockSetSession = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
      setSession: (...args: unknown[]) => mockSetSession(...args),
    },
  },
}));

function Probe() {
  const { isRecovering } = useAuth();
  return <Text>{isRecovering ? 'recovering' : 'not recovering'}</Text>;
}

async function renderWithUrl(url: string) {
  mockUrl = url;
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await act(async () => {});
}

const TOKENS = '#access_token=a&refresh_token=r&type=bearer';

beforeEach(() => {
  jest.clearAllMocks();
  mockSetSession.mockResolvedValue({ error: null });
});

describe('recovery deep links', () => {
  it('a Google sign-in redirect (auth/callback) with tokens does not start recovery', async () => {
    await renderWithUrl(`futtyapp://auth/callback${TOKENS}`);
    expect(screen.getByText('not recovering')).toBeTruthy();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('a reset-password link with tokens still starts recovery', async () => {
    await renderWithUrl(`futtyapp://reset-password${TOKENS}`);
    expect(screen.getByText('recovering')).toBeTruthy();
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  });
});

describe('isOAuthCallbackUrl', () => {
  it.each([
    ['futtyapp://auth/callback#access_token=a', true],
    ['futtyapp://auth/callback?error=x', true],
    ['exp://192.168.1.2:8081/--/auth/callback#access_token=a', true],
    ['futtyapp://reset-password#access_token=a', false],
    ['futtyapp://#access_token=a', false],
    ['futtyapp://auth/callbacks', false],
  ])('%s → %s', (url, expected) => {
    expect(isOAuthCallbackUrl(url)).toBe(expected);
  });
});
