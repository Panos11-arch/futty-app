import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import GoPremiumScreen from '@/app/account/premium';
import PremiumPlanScreen from '@/app/premium-plan';
import { PERSONAL_PREMIUM_SKU } from '@/lib/premium';

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

describe('Premium plan', () => {
  it('shows the price the App Store returns, not a hard-coded one', async () => {
    mockSubscriptions = [{ id: PERSONAL_PREMIUM_SKU, displayPrice: '£2.79' }];
    const view = await render(<PremiumPlanScreen />);
    expect(screen.getByTestId('premium-price').props.children).toBe('£2.79/mo');
    expect(screen.queryByText(/€4\.99|€3\.99/)).toBeNull();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('before the store answers, the rules’ label stands in (never a constant in the app)', async () => {
    await render(<PremiumPlanScreen />);
    expect(screen.getByTestId('premium-price').props.children).toBe('€3.99/mo');
  });

  it('one Card, plain perks, one primary Button that subscribes with the same request', async () => {
    await render(<PremiumPlanScreen />);
    expect(screen.queryByText(/FUTTY PREMIUM/)).toBeNull();
    expect(screen.getByText('No service fee on your own spot')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Subscribe' }));
    expect(mockRequestPurchase).toHaveBeenCalledWith({ request: { apple: { sku: PERSONAL_PREMIUM_SKU } }, type: 'subs' });
    expect(mockFetchProducts).toHaveBeenCalledWith({ skus: [PERSONAL_PREMIUM_SKU], type: 'subs' });
  });

  it('Subscribe stays off until the store connects; Restore and Close work as before', async () => {
    mockConnected = false;
    await render(<PremiumPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Subscribe' }));
    expect(mockRequestPurchase).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('restores purchases when connected', async () => {
    await render(<PremiumPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Restore purchases' }));
    expect(mockRestore).toHaveBeenCalled();
  });

  it('already Premium: manage instead of subscribe', async () => {
    mockProfile = { status: 'ready', profile: { is_premium: true } };
    await render(<PremiumPlanScreen />);
    expect(screen.getByRole('button', { name: 'Manage or cancel subscription' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull();
  });

  it('off iOS: says so, no purchase button', async () => {
    Platform.OS = 'android';
    await render(<PremiumPlanScreen />);
    expect(screen.getByText('Purchasing is available on iOS only for now.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull();
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
    await fireEvent.press(screen.getByRole('button', { name: 'Personal Premium' }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({ pathname: '/premium-plan', params: { plan: 'personal', teamId: '' } })
    );
  });
});
