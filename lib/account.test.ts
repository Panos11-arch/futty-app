import { Platform } from 'react-native';

import { deleteMyAccount } from '@/lib/account';

const mockGetUser = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

const mockGetAppleDeletionCode = jest.fn();
jest.mock('@/lib/auth-providers', () => ({
  getAppleDeletionCode: () => mockGetAppleDeletionCode(),
}));

jest.mock('@/lib/edge-functions', () => ({
  describeFunctionError: (error: { message: string }) => error.message,
}));

function userWith(...providers: string[]) {
  return { data: { user: { id: 'u1', identities: providers.map((provider) => ({ provider })) } }, error: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  mockInvoke.mockResolvedValue({ data: { deleted: true }, error: null });
});

describe('deleteMyAccount', () => {
  it('an Apple account confirms with Apple and sends the code for the revoke step', async () => {
    mockGetUser.mockResolvedValue(userWith('apple'));
    mockGetAppleDeletionCode.mockResolvedValue('fresh-code');
    await expect(deleteMyAccount()).resolves.toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', {
      body: { appleAuthorizationCode: 'fresh-code', platform: 'ios' },
    });
  });

  it('an Apple account linked to email still revokes', async () => {
    mockGetUser.mockResolvedValue(userWith('email', 'apple'));
    mockGetAppleDeletionCode.mockResolvedValue('fresh-code');
    await deleteMyAccount();
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', {
      body: { appleAuthorizationCode: 'fresh-code', platform: 'ios' },
    });
  });

  it('cancelling the Apple sheet deletes nothing', async () => {
    mockGetUser.mockResolvedValue(userWith('apple'));
    mockGetAppleDeletionCode.mockResolvedValue(null);
    await expect(deleteMyAccount()).resolves.toBe('Confirm with Apple to delete your account.');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('an Apple error deletes nothing and is shown', async () => {
    mockGetUser.mockResolvedValue(userWith('apple'));
    mockGetAppleDeletionCode.mockRejectedValue(new Error('Apple is unavailable'));
    await expect(deleteMyAccount()).resolves.toBe('Apple is unavailable');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each([['android'], ['web']])(
    'an Apple account on %s is deleted without the Apple sheet (the server skips the revoke and logs it)',
    async (os) => {
      Platform.OS = os as typeof Platform.OS;
      mockGetUser.mockResolvedValue(userWith('apple'));
      await expect(deleteMyAccount()).resolves.toBeNull();
      expect(mockGetAppleDeletionCode).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith('delete-account', { body: { platform: os } });
    }
  );

  it('the account cannot be read (offline): a network error, and nothing is sent', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('Network request failed') });
    await expect(deleteMyAccount()).resolves.toBe(
      'Could not reach Futty. Check your internet connection and try again.'
    );
    expect(mockGetAppleDeletionCode).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('getUser throwing is the same network error', async () => {
    mockGetUser.mockRejectedValue(new TypeError('Network request failed'));
    await expect(deleteMyAccount()).resolves.toMatch(/Could not reach Futty/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each([['google'], ['email']])('a %s account deletes without the Apple sheet', async (provider) => {
    mockGetUser.mockResolvedValue(userWith(provider));
    await expect(deleteMyAccount()).resolves.toBeNull();
    expect(mockGetAppleDeletionCode).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', { body: { platform: 'ios' } });
  });

  it("the server's error is shown", async () => {
    mockGetUser.mockResolvedValue(userWith('google'));
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'You still have upcoming games.' } });
    await expect(deleteMyAccount()).resolves.toBe('You still have upcoming games.');
  });
});
