import './mocks';

import { act, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import PremiumPlanScreen from '@/app/premium-plan';
import { PremiumIconSync, resetPremiumIconSyncForTests } from '@/components/premium-icon-sync';
import { PERSONAL_PREMIUM_SKU } from '@/lib/premium';
import { syncPremiumIcon, syncPremiumIconAfterPurchase } from '@/lib/premium-icon';

// The Premium app icon: switched only once the server confirms a purchase,
// and checked once per launch against the server's is_premium.
const g = globalThis as { mockSearchParams?: Record<string, string> };
let mockProfile: Record<string, unknown>;
let mockIapOptions: {
  onPurchaseSuccess: (purchase: { productId: string; transactionId?: string }) => Promise<void>;
  onPurchaseError: (error: { code: string; message: string }) => void;
};
let mockVerify: { data: { active: boolean } | null; error: unknown };
const mockFinish = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-iap', () => ({
  ErrorCode: { UserCancelled: 'user-cancelled' },
  deepLinkToSubscriptions: jest.fn(),
  useIAP: (options: typeof mockIapOptions) => {
    mockIapOptions = options;
    return {
      connected: true,
      subscriptions: [],
      fetchProducts: jest.fn(),
      requestPurchase: jest.fn(),
      finishTransaction: mockFinish,
      restorePurchases: jest.fn(),
    };
  },
}));
jest.mock('@/lib/premium', () => ({
  ...jest.requireActual<typeof import('@/lib/premium')>('@/lib/premium'),
  verifyPurchaseOnServer: jest.fn(async () => mockVerify),
}));
jest.mock('@/lib/premium-icon', () => ({
  syncPremiumIcon: jest.fn(async () => 'unchanged'),
  syncPremiumIconAfterPurchase: jest.fn(async () => 'premium'),
}));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ ...mockProfile, reload: jest.fn() }) }));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ status: 'ready', teams: [], reload: jest.fn() }) }));
jest.mock('@/lib/use-rules', () => {
  const { SPEC_RULES: rules } = jest.requireActual<typeof import('@/lib/rules.fixtures')>('@/lib/rules.fixtures');
  return { useRules: () => ({ state: { status: 'ready', rules } }) };
});

const afterPurchase = syncPremiumIconAfterPurchase as jest.Mock;
const atLaunch = syncPremiumIcon as jest.Mock;
const purchase = { productId: PERSONAL_PREMIUM_SKU, transactionId: 't1' };

const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  g.mockSearchParams = { plan: 'personal' };
  mockProfile = { status: 'ready', profile: { id: 'u1', is_premium: false } };
  mockVerify = { data: { active: true }, error: null };
  resetPremiumIconSyncForTests();
});
afterAll(() => {
  Platform.OS = originalOS;
});

describe('Premium icon after a purchase', () => {
  it('switches once the server confirms the purchase, after the transaction is finished and the screen closed', async () => {
    await render(<PremiumPlanScreen />);
    await act(() => mockIapOptions.onPurchaseSuccess(purchase));
    expect(afterPurchase).toHaveBeenCalledTimes(1);
    expect(mockFinish.mock.invocationCallOrder[0]).toBeLessThan(afterPurchase.mock.invocationCallOrder[0]);
    expect((router.back as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(afterPurchase.mock.invocationCallOrder[0]);
  });

  it('not when the server doesn’t confirm it', async () => {
    mockVerify = { data: { active: false }, error: null };
    await render(<PremiumPlanScreen />);
    await act(() => mockIapOptions.onPurchaseSuccess(purchase));
    expect(afterPurchase).not.toHaveBeenCalled();
  });

  it('not when verification fails', async () => {
    mockVerify = { data: null, error: new Error('verify failed') };
    await render(<PremiumPlanScreen />);
    await act(() => mockIapOptions.onPurchaseSuccess(purchase));
    expect(afterPurchase).not.toHaveBeenCalled();
  });

  it('not for a purchase that was only started, or failed in the store', async () => {
    await render(<PremiumPlanScreen />);
    await act(async () => mockIapOptions.onPurchaseError({ code: 'user-cancelled', message: 'Cancelled' }));
    await act(async () => mockIapOptions.onPurchaseError({ code: 'unknown', message: 'Payment declined' }));
    await act(() => mockIapOptions.onPurchaseSuccess({ productId: PERSONAL_PREMIUM_SKU }));
    expect(afterPurchase).not.toHaveBeenCalled();
  });

  it('not for another product', async () => {
    await render(<PremiumPlanScreen />);
    await act(() => mockIapOptions.onPurchaseSuccess({ productId: 'something_else', transactionId: 't2' }));
    expect(afterPurchase).not.toHaveBeenCalled();
  });
});

describe('PremiumIconSync at launch', () => {
  it('waits for the server’s profile, then checks once with its is_premium', async () => {
    mockProfile = { status: 'loading' };
    const view = await render(<PremiumIconSync />);
    expect(atLaunch).not.toHaveBeenCalled();

    mockProfile = { status: 'ready', profile: { id: 'u1', is_premium: true } };
    await view.rerender(<PremiumIconSync />);
    expect(atLaunch).toHaveBeenCalledWith('launch', true);
  });

  it('a basic player: checked with is_premium false (back to standard if Premium ended)', async () => {
    await render(<PremiumIconSync />);
    expect(atLaunch).toHaveBeenCalledWith('launch', false);
  });

  it('once per launch, however often it renders or remounts', async () => {
    const view = await render(<PremiumIconSync />);
    mockProfile = { status: 'ready', profile: { id: 'u1', is_premium: true } };
    await view.rerender(<PremiumIconSync />);
    await view.unmount();
    await render(<PremiumIconSync />);
    expect(atLaunch).toHaveBeenCalledTimes(1);
  });

  it('never on a profile that failed to load', async () => {
    mockProfile = { status: 'error', message: 'offline' };
    await render(<PremiumIconSync />);
    expect(atLaunch).not.toHaveBeenCalled();
  });
});
