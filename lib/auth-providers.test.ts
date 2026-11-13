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

beforeEach(() => {
  jest.clearAllMocks();
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

  it('a failed read lets the user in rather than locking them out', async () => {
    mockProfileRead.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect((await hook('u1')).current).toBe(false);
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
});
