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
  return { data: { user: { id: 'u1', identities: providers.map((provider) => ({ provider })) } } };
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
      body: { appleAuthorizationCode: 'fresh-code' },
    });
  });

  it('an Apple account linked to email still revokes', async () => {
    mockGetUser.mockResolvedValue(userWith('email', 'apple'));
    mockGetAppleDeletionCode.mockResolvedValue('fresh-code');
    await deleteMyAccount();
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', {
      body: { appleAuthorizationCode: 'fresh-code' },
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

  it('an Apple account off iOS is pointed at the iPhone app', async () => {
    Platform.OS = 'android';
    mockGetUser.mockResolvedValue(userWith('apple'));
    await expect(deleteMyAccount()).resolves.toMatch(/on your iPhone/);
    expect(mockGetAppleDeletionCode).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each([['google'], ['email']])('a %s account deletes without the Apple sheet', async (provider) => {
    mockGetUser.mockResolvedValue(userWith(provider));
    await expect(deleteMyAccount()).resolves.toBeNull();
    expect(mockGetAppleDeletionCode).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', undefined);
  });

  it("the server's error is shown", async () => {
    mockGetUser.mockResolvedValue(userWith('google'));
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'You still have upcoming games.' } });
    await expect(deleteMyAccount()).resolves.toBe('You still have upcoming games.');
  });
});
