import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { markProfileSetupDone, useNeedsProfileSetup } from '@/lib/auth-providers';

const mockProfileRead = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => mockProfileRead() }) }),
    }),
  },
}));

const FLAG = (userId: string) => `futty.has_username.${userId}`;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

async function hook(userId: string | null) {
  const result = await renderHook(() => useNeedsProfileSetup(userId));
  await act(async () => {});
  return result.result;
}

describe('useNeedsProfileSetup', () => {
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
