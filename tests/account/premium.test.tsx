import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import GoPremiumScreen from '@/app/account/premium';
import PremiumPlanScreen from '@/app/premium-plan';
import { PERSONAL_PREMIUM_SKU, PERSONAL_PREMIUM_SKUS, PREMIUM_PLUS_SKU } from '@/lib/premium';

const g = globalThis as { mockSearchParams?: Record<string, string> };
let mockProfile: Record<string, unknown>;
let mockSubscriptions: { id: string; displayPrice: string }[] = [];
let mockConnected = true;
const mockRequestPurchase = jest.fn();
const mockRestore = jest.fn();
const mockFetchProducts = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-iap', () => ({
  ErrorCode: { UserCancelled: 'user-cancelled' },
  deepLinkToSubscriptions: jest.fn(),
  useIAP: () => ({
    connected: mockConnected,
    subscriptions: mockSubscriptions,
    fetchProducts: mockFetchProducts,
    requestPurchase: mockRequestPurchase,
    finishTransaction: jest.fn(),
    restorePurchases: mockRestore,
  }),
}));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ ...mockProfile, reload: jest.fn() }) }));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ status: 'ready', teams: [], reload: jest.fn() }) }));
jest.mock('@/lib/use-rules', () => {
  const { SPEC_RULES: rules } = jest.requireActual<typeof import('@/lib/rules.fixtures')>('@/lib/rules.fixtures');
  return { useRules: () => ({ state: { status: 'ready', rules: { ...rules, premium_price_label: '€3.99' } } }) };
});

const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  g.mockSearchParams = { plan: 'personal' };
  mockProfile = { status: 'ready', profile: { is_premium: false } };
  mockSubscriptions = [];
  mockConnected = true;
  mockRequestPurchase.mockResolvedValue(undefined);
});
afterAll(() => {
  Platform.OS = originalOS;
});

// P1 (decided by Panos, 22 November): Basic, Premium and Premium Plus on one
// screen (image 22), the store's live prices, the current plan marked.
describe('Premium plan', () => {
  const both = () => [
    { id: PERSONAL_PREMIUM_SKU, displayPrice: '£2.79' },
    { id: PREMIUM_PLUS_SKU, displayPrice: '£4.49' },
  ];

  it('asks the store for both plans and shows the prices it returns, not hard-coded ones', async () => {
    mockSubscriptions = both();
    await render(<PremiumPlanScreen />);
    expect(mockFetchProducts).toHaveBeenCalledWith({ skus: PERSONAL_PREMIUM_SKUS, type: 'subs' });
    expect(screen.getByTestId('premium-price').props.children).toBe('£2.79/mo');
    expect(screen.getByText('£4.49/mo')).toBeTruthy();
    expect(screen.queryByText(/€4\.99|€7\.99|€3\.99/)).toBeNull();
  });

  it('before the store answers, the rules’ label stands in for Premium, and Plus waits', async () => {
    await render(<PremiumPlanScreen />);
    expect(screen.getByTestId('premium-price').props.children).toBe('€3.99/mo');
    expect(screen.queryByTestId('premium-plan-premium_plus')).toBeNull();
  });

  it('no Premium Plus product from the store (not on sale yet): only Basic and Premium, no broken Plus card', async () => {
    mockSubscriptions = [{ id: PERSONAL_PREMIUM_SKU, displayPrice: '€4.99' }];
    await render(<PremiumPlanScreen />);
    expect(screen.getByTestId('premium-plan-basic')).toBeTruthy();
    expect(screen.getByTestId('premium-plan-premium')).toBeTruthy();
    expect(screen.queryByTestId('premium-plan-premium_plus')).toBeNull();
    expect(screen.queryByText(/Premium Plus|No ads/)).toBeNull();
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(mockRequestPurchase).toHaveBeenCalledWith({ request: { apple: { sku: PERSONAL_PREMIUM_SKU } }, type: 'subs' });
  });

  it('a Basic player: Basic marked current; Upgrade buys Premium Plus with the same request', async () => {
    mockSubscriptions = both();
    await render(<PremiumPlanScreen />);
    expect(screen.getByTestId('premium-plan-basic').props.accessibilityLabel).toBe('Basic, Free, Current');
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(mockRequestPurchase).toHaveBeenCalledWith({ request: { apple: { sku: PREMIUM_PLUS_SKU } }, type: 'subs' });
  });

  it('a Premium player: Premium marked current, Upgrade to Plus', async () => {
    mockSubscriptions = both();
    mockProfile = { status: 'ready', profile: { is_premium: true, premium_tier: 'premium' } };
    await render(<PremiumPlanScreen />);
    expect(screen.getByTestId('premium-plan-premium').props.accessibilityLabel).toBe('Premium, £2.79/mo, Current');
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeTruthy();
  });

  it('a Premium Plus player: Plus marked current, Manage', async () => {
    mockSubscriptions = both();
    mockProfile = { status: 'ready', profile: { is_premium: true, premium_tier: 'premium_plus' } };
    await render(<PremiumPlanScreen />);
    expect(screen.getByTestId('premium-plan-premium_plus').props.accessibilityLabel).toBe('Premium Plus, £4.49/mo, Current');
    expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
  });

  it('Upgrade stays off until the store connects; Close works as before', async () => {
    mockConnected = false;
    await render(<PremiumPlanScreen />);
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(mockRequestPurchase).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('restores purchases when connected', async () => {
    await render(<PremiumPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Restore purchases' }));
    expect(mockRestore).toHaveBeenCalled();
  });

  it('off iOS: says so, no purchase button', async () => {
    Platform.OS = 'android';
    await render(<PremiumPlanScreen />);
    expect(screen.getByText('Purchasing is available on iOS only for now.')).toBeTruthy();
    expect(screen.queryByTestId('premium-action')).toBeNull();
  });
});

describe('Go Premium list', () => {
  it('loading shows a skeleton', async () => {
    mockProfile = { status: 'loading' };
    await render(<GoPremiumScreen />);
    expect(screen.getByTestId('premium-skeleton')).toBeTruthy();
  });

  it('lists Personal Premium with its rules price and opens the same plan page', async () => {
    const view = await render(<GoPremiumScreen />);
    expect(view.toJSON()).toMatchSnapshot();
    expect(screen.getByText('€3.99/mo')).toBeTruthy();
    expect(screen.getByText('Off')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Personal Premium, €3.99/mo, Off' }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({ pathname: '/premium-plan', params: { plan: 'personal', teamId: '' } })
    );
  });

  it('shows the App Store\'s live price once it loads, the same string as the plan sheet (F6)', async () => {
    mockSubscriptions = [{ id: PERSONAL_PREMIUM_SKU, displayPrice: '5,99 €' }];
    await render(<GoPremiumScreen />);
    expect(screen.getByText('5,99 €/mo')).toBeTruthy();
    expect(screen.queryByText('€3.99/mo')).toBeNull();
    expect(mockFetchProducts).toHaveBeenCalledWith({ skus: [PERSONAL_PREMIUM_SKU], type: 'subs' });
  });

  it('the plan sheet shows the very same string for that live price (F6)', async () => {
    mockSubscriptions = [{ id: PERSONAL_PREMIUM_SKU, displayPrice: '5,99 €' }];
    await render(<PremiumPlanScreen />);
    expect(screen.getByTestId('premium-price').props.children).toBe('5,99 €/mo');
  });

  it('while the store loads (or is not connected), the rules\' label stands in', async () => {
    mockConnected = false;
    await render(<GoPremiumScreen />);
    expect(screen.getByText('€3.99/mo')).toBeTruthy();
    expect(mockFetchProducts).not.toHaveBeenCalled();
  });

  it('shows the basic logo to a basic player (U9)', async () => {
    await render(<GoPremiumScreen />);
    expect(screen.getByTestId('futty-logo-basic')).toBeTruthy();
    expect(screen.queryByTestId('futty-logo-premium')).toBeNull();
  });

  it('shows the Premium logo to a Premium player (U9)', async () => {
    mockProfile = { status: 'ready', profile: { is_premium: true } };
    await render(<GoPremiumScreen />);
    expect(screen.getByTestId('futty-logo-premium')).toBeTruthy();
    expect(screen.queryByTestId('futty-logo-basic')).toBeNull();
  });
});

describe('Premium plan: manage and double taps', () => {
  it('Manage opens the App Store subscriptions page, as before', async () => {
    const { deepLinkToSubscriptions } = jest.requireMock<{ deepLinkToSubscriptions: jest.Mock }>('expo-iap');
    mockProfile = { status: 'ready', profile: { is_premium: true, premium_tier: 'premium' } };
    await render(<PremiumPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Manage' }));
    expect(deepLinkToSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('Upgrade asks the store once, however often it is tapped while the purchase is open', async () => {
    mockRequestPurchase.mockReturnValue(new Promise(() => {}));
    await render(<PremiumPlanScreen />);
    const upgrade = screen.getByTestId('premium-action');
    await fireEvent.press(upgrade);
    await fireEvent.press(upgrade);
    expect(mockRequestPurchase).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Restore purchases' }));
    expect(mockRestore).not.toHaveBeenCalled();
  });
});
