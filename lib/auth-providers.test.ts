import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';

import {
  getAppleDeletionCode,
  markProfileSetupDone,
  parseOAuthRedirect,
  saveAppleName,
  saveProfileSetup,
  signInWithApple,
  signInWithGoogle,
  useNeedsProfileSetup,
} from '@/lib/auth-providers';

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-nonce',
  digestStringAsync: jest.fn(async (_algorithm: string, data: string) => `sha256(${data})`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `futtyapp://${path}`,
  useURL: () => null,
}));

const mockProfileRead = jest.fn();
const mockProfileUpdate = jest.fn();
const mockAuth = {
  signInWithIdToken: jest.fn(),
  signInWithOAuth: jest.fn(),
  setSession: jest.fn(),
};
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...a: unknown[]) => mockAuth.signInWithIdToken(...a),
      signInWithOAuth: (...a: unknown[]) => mockAuth.signInWithOAuth(...a),
      setSession: (...a: unknown[]) => mockAuth.setSession(...a),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => mockProfileRead() }) }),
      update: (values: unknown) => ({
        // Awaitable (saveProfileSetup) or narrowed with .is() (saveAppleName).
        eq: (_c: string, id: string) => ({
          is: (column: string, value: unknown) => mockProfileUpdate(values, id, column, value),
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(mockProfileUpdate(values, id)).then(resolve, reject),
        }),
      }),
    }),
  },
}));

const FLAG = (userId: string) => `futty.has_username.${userId}`;

const signInAsync = AppleAuthentication.signInAsync as jest.Mock;
const openAuthSessionAsync = WebBrowser.openAuthSessionAsync as jest.Mock;
const cancelled = Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockProfileUpdate.mockResolvedValue({ error: null });
  mockAuth.signInWithIdToken.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockAuth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://auth/authorize' }, error: null });
  mockAuth.setSession.mockResolvedValue({ error: null });
});

describe('signInWithApple', () => {
  const credential = {
    identityToken: 'id-token',
    authorizationCode: 'code',
    fullName: { givenName: 'Dimitris', familyName: 'Malas' },
  };

  it('sends Apple the hashed nonce and Supabase the raw one, creating the session', async () => {
    signInAsync.mockResolvedValue(credential);
    await expect(signInWithApple()).resolves.toEqual({ status: 'signed-in' });
    expect(signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'sha256(raw-nonce)' }));
    expect(mockAuth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'id-token',
      nonce: 'raw-nonce',
    });
  });

  it("saves the name from Apple's first sign-in, only into an empty full_name", async () => {
    signInAsync.mockResolvedValue(credential);
    await signInWithApple();
    expect(mockProfileUpdate).toHaveBeenCalledWith({ full_name: 'Dimitris Malas' }, 'u1', 'full_name', null);
  });

  it('a later sign-in (no name from Apple) writes nothing', async () => {
    signInAsync.mockResolvedValue({ ...credential, fullName: { givenName: null, familyName: null } });
    await signInWithApple();
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('cancelling is not an error', async () => {
    signInAsync.mockRejectedValue(cancelled);
    await expect(signInWithApple()).resolves.toEqual({ status: 'cancelled' });
    expect(mockAuth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('a Supabase error is thrown for the screen to show', async () => {
    signInAsync.mockResolvedValue(credential);
    mockAuth.signInWithIdToken.mockResolvedValue({ data: {}, error: new Error('Invalid nonce') });
    await expect(signInWithApple()).rejects.toThrow('Invalid nonce');
  });

  it('a missing identity token is an error', async () => {
    signInAsync.mockResolvedValue({ ...credential, identityToken: null });
    await expect(signInWithApple()).rejects.toThrow('Apple did not return a sign-in token');
  });
});

describe('saveAppleName', () => {
  it('joins whichever parts Apple sent', async () => {
    await saveAppleName('u1', { givenName: ' Dimitris ', familyName: null } as never);
    expect(mockProfileUpdate).toHaveBeenCalledWith({ full_name: 'Dimitris' }, 'u1', 'full_name', null);
  });

  it('a failed write does not fail the sign-in', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockProfileUpdate.mockResolvedValue({ error: { message: 'nope' } });
    await expect(saveAppleName('u1', { givenName: 'D', familyName: 'M' } as never)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('getAppleDeletionCode', () => {
  it("returns Apple's fresh authorization code", async () => {
    signInAsync.mockResolvedValue({ authorizationCode: 'fresh-code' });
    await expect(getAppleDeletionCode()).resolves.toBe('fresh-code');
  });

  it('null when the user cancels', async () => {
    signInAsync.mockRejectedValue(cancelled);
    await expect(getAppleDeletionCode()).resolves.toBeNull();
  });

  it('other errors are thrown', async () => {
    signInAsync.mockRejectedValue(new Error('boom'));
    await expect(getAppleDeletionCode()).rejects.toThrow('boom');
  });
});

describe('signInWithGoogle', () => {
  it('opens Supabase OAuth in an auth session and sets the session from the fragment', async () => {
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'futtyapp://auth/callback#access_token=at&refresh_token=rt&token_type=bearer',
    });
    await expect(signInWithGoogle()).resolves.toEqual({ status: 'signed-in' });
    expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'futtyapp://auth/callback', skipBrowserRedirect: true },
    });
    expect(openAuthSessionAsync).toHaveBeenCalledWith('https://auth/authorize', 'futtyapp://auth/callback');
    expect(mockAuth.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it.each(['cancel', 'dismiss'])('a %s from the browser is not an error', async (type) => {
    openAuthSessionAsync.mockResolvedValue({ type });
    await expect(signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
    expect(mockAuth.setSession).not.toHaveBeenCalled();
  });

  it("Supabase's error_description is thrown for the screen to show", async () => {
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'futtyapp://auth/callback#error=access_denied&error_description=Email+not+verified',
    });
    await expect(signInWithGoogle()).rejects.toThrow('Email not verified');
  });
});

describe('parseOAuthRedirect', () => {
  it('reads the tokens from the fragment', () => {
    expect(parseOAuthRedirect('futtyapp://auth/callback#access_token=a%2Bb&refresh_token=r')).toEqual({
      tokens: { access_token: 'a+b', refresh_token: 'r' },
    });
  });

  it('reads error_description from the fragment or the query', () => {
    expect(parseOAuthRedirect('futtyapp://auth/callback#error_description=Denied+by+user')).toEqual({
      error: 'Denied by user',
    });
    expect(parseOAuthRedirect('futtyapp://auth/callback?error=server_error&error_description=Oops')).toEqual({
      error: 'Oops',
    });
  });

  it('no tokens and no error is still an error', () => {
    expect(parseOAuthRedirect('futtyapp://auth/callback')).toEqual({
      error: 'Google sign-in did not finish. Try again.',
    });
  });
});

describe('useNeedsProfileSetup', () => {
  async function hook(userId: string | null) {
    const result = await renderHook(() => useNeedsProfileSetup(userId));
    await act(async () => {});
    return result.result;
  }

  it('a new Apple or Google user (no username) needs profile setup', async () => {
    mockProfileRead.mockResolvedValue({ data: { username: null }, error: null });
    expect((await hook('u1')).current).toBe(true);
  });

  it('a user with a username does not', async () => {
    mockProfileRead.mockResolvedValue({ data: { username: 'dimitris' }, error: null });
    expect((await hook('u1')).current).toBe(false);
  });

  it('a missing profile row needs profile setup', async () => {
    mockProfileRead.mockResolvedValue({ data: null, error: null });
    expect((await hook('u1')).current).toBe(true);
  });

  it('is loading until the profile has been read', async () => {
    mockProfileRead.mockReturnValue(new Promise(() => {}));
    expect((await hook('u1')).current).toBe('loading');
  });

  it('signed out: false, and no read', async () => {
    expect((await hook(null)).current).toBe(false);
    expect(mockProfileRead).not.toHaveBeenCalled();
  });

  it('turns false as soon as the username is saved', async () => {
    mockProfileRead.mockResolvedValue({ data: { username: null }, error: null });
    const result = await hook('u1');
    expect(result.current).toBe(true);
    await act(async () => markProfileSetupDone());
    expect(result.current).toBe(false);
  });

  describe('the stored "has a username" flag (existing users offline)', () => {
    it('a read that shows a username stores the flag for that user', async () => {
      mockProfileRead.mockResolvedValue({ data: { username: 'dimitris' }, error: null });
      await hook('u1');
      expect(await AsyncStorage.getItem(FLAG('u1'))).toBe('true');
    });

    it('a stored user is let in at once, even while the read keeps failing', async () => {
      await AsyncStorage.setItem(FLAG('u1'), 'true');
      mockProfileRead.mockResolvedValue({ data: null, error: { message: 'offline' } });
      expect((await hook('u1')).current).toBe(false);
    });

    it("another user's flag does not count", async () => {
      await AsyncStorage.setItem(FLAG('someone-else'), 'true');
      mockProfileRead.mockReturnValue(new Promise(() => {}));
      expect((await hook('u1')).current).toBe('loading');
    });

    it('the background re-check still wins: no username after all sends them to setup and clears the flag', async () => {
      await AsyncStorage.setItem(FLAG('u1'), 'true');
      let answer!: (value: unknown) => void;
      mockProfileRead.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const result = await hook('u1');
      expect(result.current).toBe(false);

      await act(async () => answer({ data: { username: null }, error: null }));
      expect(result.current).toBe(true);
      expect(await AsyncStorage.getItem(FLAG('u1'))).toBeNull();
    });

    it('a no-username answer from the server is not overridden by a slower flag read', async () => {
      mockProfileRead.mockResolvedValue({ data: { username: null }, error: null });
      const result = await hook('u1');
      expect(result.current).toBe(true);
    });

    it('saving the username in setup stores the flag', async () => {
      mockProfileRead.mockResolvedValue({ data: { username: null }, error: null });
      await hook('u1');
      await act(async () => markProfileSetupDone());
      expect(await AsyncStorage.getItem(FLAG('u1'))).toBe('true');
    });
  });

  describe('a failed read', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('stays loading and retries until a read succeeds', async () => {
      mockProfileRead
        .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({ data: { username: null }, error: null });

      const result = await hook('u1');
      expect(result.current).toBe('loading');
      expect(mockProfileRead).toHaveBeenCalledTimes(1);

      await act(async () => jest.runOnlyPendingTimers());
      expect(result.current).toBe('loading');
      expect(mockProfileRead).toHaveBeenCalledTimes(2);

      await act(async () => jest.runOnlyPendingTimers());
      expect(mockProfileRead).toHaveBeenCalledTimes(3);
      expect(result.current).toBe(true);
    });

    it('stops retrying once unmounted', async () => {
      mockProfileRead.mockResolvedValue({ data: null, error: { message: 'offline' } });
      const { unmount } = await renderHook(() => useNeedsProfileSetup('u1'));
      await act(async () => {});
      await unmount();
      await act(async () => jest.runAllTimers());
      expect(mockProfileRead).toHaveBeenCalledTimes(1);
    });
  });
});

describe('saveProfileSetup', () => {
  it('saves the username and a typed full name, then lets the user in', async () => {
    mockProfileRead.mockResolvedValue({ data: { username: null }, error: null });
    const { result } = await renderHook(() => useNeedsProfileSetup('u1'));
    await act(async () => {});
    expect(result.current).toBe(true);

    await act(async () => {
      await expect(saveProfileSetup('u1', 'new_player', ' Dimitris Malas ')).resolves.toBeNull();
    });
    expect(mockProfileUpdate).toHaveBeenCalledWith({ username: 'new_player', full_name: 'Dimitris Malas' }, 'u1');
    expect(result.current).toBe(false);
  });

  it('a blank full name keeps the name Apple or Google gave', async () => {
    await saveProfileSetup('u1', 'new_player', '  ');
    expect(mockProfileUpdate).toHaveBeenCalledWith({ username: 'new_player' }, 'u1');
  });

  it('a username taken since the check is reported, not thrown', async () => {
    mockProfileUpdate.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    await expect(saveProfileSetup('u1', 'taken', '')).resolves.toBe('"taken" is already taken.');
  });

  it('any other error is reported', async () => {
    mockProfileUpdate.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    await expect(saveProfileSetup('u1', 'x_y_z', '')).resolves.toBe('permission denied');
  });
});
