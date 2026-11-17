import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { getPlayerLevel } from '@/lib/match/levels-api';
import { useStartingLevelOffer } from '@/lib/match/use-levels';

let mockFocused = true;
let mockProfileSetup: boolean | 'loading' = false;
let mockRecovering = false;

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/lib/auth', () => {
  const user = { id: 'me' };
  return { useAuth: () => ({ user, isRecovering: mockRecovering }) };
});
jest.mock('@/lib/auth-providers', () => ({ useNeedsProfileSetup: () => mockProfileSetup }));
jest.mock('@/lib/match/levels-api', () => ({ getPlayerLevel: jest.fn(), getMatchRatings: jest.fn() }));

const push = router.push as jest.Mock;
const levelOf = getPlayerLevel as jest.Mock;

/** Lets the level read and the stored flag settle. */
const settle = () => act(async () => {});

beforeEach(async () => {
  mockFocused = true;
  mockProfileSetup = false;
  mockRecovering = false;
  push.mockReset();
  levelOf.mockReset().mockResolvedValue({ level: null, error: null });
  await AsyncStorage.clear();
});

describe('useStartingLevelOffer', () => {
  it('opens the questions once for a player with no level, on Home', async () => {
    await renderHook(() => useStartingLevelOffer());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/starting-level'));
    expect(push).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('futty.starting_level_offered.me')).toBe('true');
  });

  it('profile setup pending: no push, then it offers once setup is done', async () => {
    mockProfileSetup = true;
    const hook = await renderHook(() => useStartingLevelOffer());
    await settle();
    mockProfileSetup = 'loading';
    await hook.rerender({});
    await settle();
    expect(push).not.toHaveBeenCalled();

    mockProfileSetup = false;
    await hook.rerender({});
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it('Home not focused: no push, then it offers the next time Home is focused', async () => {
    mockFocused = false;
    const hook = await renderHook(() => useStartingLevelOffer());
    await settle();
    expect(push).not.toHaveBeenCalled();

    mockFocused = true;
    await hook.rerender({});
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it('during a password recovery: no push', async () => {
    mockRecovering = true;
    await renderHook(() => useStartingLevelOffer());
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it('already offered on this device (skipped before): no push', async () => {
    await AsyncStorage.setItem('futty.starting_level_offered.me', 'true');
    await renderHook(() => useStartingLevelOffer());
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it('already answered: no push', async () => {
    levelOf.mockResolvedValue({
      level: { level: 3.4, provisional: true, reliabilityPct: 0, competitiveMatches: 0, source: 'questionnaire' },
      error: null,
    });
    await renderHook(() => useStartingLevelOffer());
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it('refocusing after the offer never pushes again', async () => {
    const hook = await renderHook(() => useStartingLevelOffer());
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    mockFocused = false;
    await hook.rerender({});
    mockFocused = true;
    await hook.rerender({});
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
  });
});
