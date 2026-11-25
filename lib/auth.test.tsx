import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthProvider, isOAuthCallbackUrl, parseAuthLink, useAuth } from '@/lib/auth';
import { EmailTakenError } from '@/lib/auth-errors';

let mockInitialUrl: string | null = null;
let mockUrlListener: ((event: { url: string }) => void) | null = null;
const mockRemoveListener = jest.fn();
jest.mock('expo-linking', () => ({
  getInitialURL: () => Promise.resolve(mockInitialUrl),
  addEventListener: (_type: string, handler: (event: { url: string }) => void) => {
    mockUrlListener = handler;
    return { remove: mockRemoveListener };
  },
  createURL: (path: string) => `futtyapp://${path}`,
}));

const mockSetSession = jest.fn();
const mockSignOut = jest.fn();
const mockSignUp = jest.fn();
let mockSession: { user: { id: string } } | null = null;
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
      setSession: (...args: unknown[]) => mockSetSession(...args),
      signOut: () => mockSignOut(),
      signUp: (...args: unknown[]) => mockSignUp(...args),
    },
  },
}));

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return (
    <>
      <Text>{auth.isRecovering ? 'recovering' : 'not recovering'}</Text>
      <Text>{`link error: ${auth.linkError ?? 'none'}`}</Text>
      <Text>{`recovery error: ${auth.recoveryError ?? 'none'}`}</Text>
    </>
  );
}

async function renderWithUrl(url: string | null) {
  mockInitialUrl = url;
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await act(async () => {});
}

const tokens = (type: string) => `#access_token=a&refresh_token=r&expires_in=3600&token_type=bearer&type=${type}`;

beforeEach(async () => {
  jest.clearAllMocks();
  mockSetSession.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
  mockSession = null;
  mockInitialUrl = null;
  mockUrlListener = null;
  await AsyncStorage.clear();
});

describe('signOut', () => {
  it("clears this user's stored has-a-username flag, and only theirs", async () => {
    mockSession = { user: { id: 'u1' } };
    await AsyncStorage.multiSet([
      ['futty.has_username.u1', 'true'],
      ['futty.has_username.u2', 'true'],
    ]);
    await renderWithUrl(null);

    await act(async () => auth.signOut());
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('futty.has_username.u1')).toBeNull();
    expect(await AsyncStorage.getItem('futty.has_username.u2')).toBe('true');
  });
});

describe('signUp', () => {
  const params = { email: 'taken@futty.cy', password: 'long enough', username: 'new_player' };

  it('asks for the confirmation link to come back to the app', async () => {
    mockSignUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [{}] }, session: null }, error: null });
    await renderWithUrl(null);
    await act(async () => {
      await auth.signUp(params);
    });
    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ emailRedirectTo: 'futtyapp:///' }),
      })
    );
  });

  it('sends the date of birth in the metadata for the server to check (S12, A1)', async () => {
    mockSignUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [{}] }, session: null }, error: null });
    await renderWithUrl(null);
    await act(async () => {
      await auth.signUp({ ...params, fullName: 'New Player', dateOfBirth: '2000-05-05' });
    });
    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          data: { username: 'new_player', full_name: 'New Player', date_of_birth: '2000-05-05' },
        }),
      })
    );
  });

  it('a new email needs confirmation', async () => {
    mockSignUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [{}] }, session: null }, error: null });
    await renderWithUrl(null);
    let result: unknown;
    await act(async () => {
      result = await auth.signUp(params);
    });
    expect(result).toEqual({ needsEmailConfirmation: true });
  });

  it('an email that already has an account (no identities, no email sent) throws EmailTakenError', async () => {
    mockSignUp.mockResolvedValue({ data: { user: { id: 'fake', identities: [] }, session: null }, error: null });
    await renderWithUrl(null);
    let thrown: unknown;
    await act(async () => {
      thrown = await auth.signUp(params).catch((cause) => cause);
    });
    expect(thrown).toBeInstanceOf(EmailTakenError);
  });
});

describe('email links', () => {
  it('a sign-up confirmation link sets the session and does not start recovery', async () => {
    await renderWithUrl(`futtyapp:///${tokens('signup')}`);
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    expect(screen.getByText('not recovering')).toBeTruthy();
  });

  it('an email-change link sets the session and does not start recovery', async () => {
    await renderWithUrl(`futtyapp:///${tokens('email_change')}`);
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    expect(screen.getByText('not recovering')).toBeTruthy();
  });

  it('a recovery link starts recovery and sets the session (reset-password still opens)', async () => {
    await renderWithUrl(`futtyapp://reset-password${tokens('recovery')}`);
    expect(screen.getByText('recovering')).toBeTruthy();
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  });

  it('tokens without type=recovery never start recovery, even on reset-password', async () => {
    await renderWithUrl(`futtyapp://reset-password#access_token=a&refresh_token=r&type=bearer`);
    expect(screen.getByText('not recovering')).toBeTruthy();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('a Google sign-in redirect (auth/callback) is skipped', async () => {
    await renderWithUrl(`futtyapp://auth/callback${tokens('recovery')}`);
    expect(screen.getByText('not recovering')).toBeTruthy();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('a link that arrives while the app is open is handled too', async () => {
    await renderWithUrl(null);
    await act(async () => mockUrlListener?.({ url: `futtyapp:///${tokens('signup')}` }));
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    expect(screen.getByText('not recovering')).toBeTruthy();
  });

  it('an expired sign-up link sets a short link error for the sign-in screen', async () => {
    await renderWithUrl(
      'futtyapp:///#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    );
    expect(screen.getByText('link error: This link has expired. Request a new one.')).toBeTruthy();
    expect(screen.getByText('recovery error: none')).toBeTruthy();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('an expired reset link still goes to the reset-password screen', async () => {
    await renderWithUrl(
      'futtyapp://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    );
    expect(screen.getByText('recovery error: Email link is invalid or has expired')).toBeTruthy();
    expect(screen.getByText('link error: none')).toBeTruthy();
  });

  it('a sign-up link whose session fails shows a link error', async () => {
    mockSetSession.mockResolvedValue({ error: new Error('Invalid Refresh Token') });
    await renderWithUrl(`futtyapp:///${tokens('signup')}`);
    expect(screen.getByText("link error: This link didn't work. Request a new one.")).toBeTruthy();
  });

  it('clearLinkError clears it', async () => {
    await renderWithUrl('futtyapp:///#error=access_denied&error_code=otp_expired&error_description=x');
    await act(async () => auth.clearLinkError());
    expect(screen.getByText('link error: none')).toBeTruthy();
  });
});

describe('parseAuthLink', () => {
  it.each([
    ['futtyapp:///', { kind: 'none' }],
    ['futtyapp:///#access_token=a', { kind: 'none' }],
    ['futtyapp://auth/callback#access_token=a&refresh_token=r&type=signup', { kind: 'none' }],
    [
      'futtyapp:///#access_token=a&refresh_token=r&type=signup',
      { kind: 'session', type: 'signup', accessToken: 'a', refreshToken: 'r' },
    ],
    [
      'futtyapp://reset-password#access_token=a&refresh_token=r&type=recovery',
      { kind: 'session', type: 'recovery', accessToken: 'a', refreshToken: 'r' },
    ],
    [
      'futtyapp:///#error=access_denied&error_code=otp_expired&error_description=Gone',
      { kind: 'error', code: 'otp_expired', description: 'Gone', forRecovery: false },
    ],
    [
      'exp://192.168.1.2:8081/--/reset-password#error_description=Gone',
      { kind: 'error', code: null, description: 'Gone', forRecovery: true },
    ],
  ])('%s', (url, expected) => {
    expect(parseAuthLink(url)).toEqual(expected);
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
