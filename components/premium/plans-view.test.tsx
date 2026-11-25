import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { PlansView, type PlansViewProps } from '@/components/premium/plans-view';
import { premiumPlans, type PremiumTier } from '@/lib/premium';
import { SPEC_RULES } from '@/lib/rules.fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const prices = { premium_monthly_v2: '€4.99', premium_plus_monthly: '€7.99' };

function props(tier: PremiumTier, over: Partial<PlansViewProps> = {}): PlansViewProps {
  return {
    plans: premiumPlans({ rules: SPEC_RULES, prices, tier }),
    tier,
    busy: false,
    error: null,
    purchasable: true,
    connected: true,
    onUpgrade: jest.fn(),
    onManage: jest.fn(),
    onRestore: jest.fn(),
    onClose: jest.fn(),
    ...over,
  };
}

describe('PlansView (P1, image 22)', () => {
  it('Basic, Premium and Premium Plus side by side with the store’s prices; labels only', async () => {
    await render(<PlansView {...props('basic')} />);
    expect(screen.getByText('Choose your plan')).toBeTruthy();
    expect(within(screen.getByTestId('premium-plan-basic')).getByText('Free')).toBeTruthy();
    expect(screen.getByTestId('premium-price').props.children).toBe('€4.99/mo');
    const plus = within(screen.getByTestId('premium-plan-premium_plus'));
    expect(plus.getByText('€7.99/mo')).toBeTruthy();
    expect(plus.getByText('Everything in Premium')).toBeTruthy();
    expect(plus.getByText('No ads')).toBeTruthy();
    expect(screen.getByText('No service fee on your own spot')).toBeTruthy();
    // Nothing promised that a player can't have today.
    expect(screen.queryByText(/lives|Banner ads|Google Play/i)).toBeNull();
  });

  it('a Basic player: Basic marked current, Premium Plus picked, Upgrade buys it', async () => {
    const p = props('basic');
    await render(<PlansView {...p} />);
    expect(within(screen.getByTestId('premium-plan-basic')).getByText('Current')).toBeTruthy();
    expect(screen.getByTestId('premium-plan-premium_plus').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(p.onUpgrade).toHaveBeenCalledWith('premium_plus_monthly');
    await fireEvent.press(screen.getByTestId('premium-plan-premium'));
    expect(within(screen.getByTestId('premium-action')).getByText('Upgrade')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(p.onUpgrade).toHaveBeenLastCalledWith('premium_monthly_v2');
  });

  it('a Premium player: Premium marked current; Upgrade to Plus; Manage on Premium', async () => {
    const p = props('premium');
    await render(<PlansView {...p} />);
    expect(within(screen.getByTestId('premium-plan-premium')).getByText('Current')).toBeTruthy();
    expect(within(screen.getByTestId('premium-action')).getByText('Upgrade')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('premium-plan-premium'));
    expect(within(screen.getByTestId('premium-action')).getByText('Manage')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(p.onManage).toHaveBeenCalled();
  });

  it('a Premium Plus player: Plus marked current, Manage; a downgrade to Premium is Manage too', async () => {
    const p = props('premium_plus');
    await render(<PlansView {...p} />);
    expect(within(screen.getByTestId('premium-plan-premium_plus')).getByText('Current')).toBeTruthy();
    expect(within(screen.getByTestId('premium-action')).getByText('Manage')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('premium-plan-premium'));
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(p.onManage).toHaveBeenCalled();
    expect(p.onUpgrade).not.toHaveBeenCalled();
  });

  it('no Premium Plus product from the store: only Basic and Premium, no empty Plus card', async () => {
    const p = props('basic', { plans: premiumPlans({ rules: SPEC_RULES, prices: { premium_monthly_v2: '€4.99' }, tier: 'basic' }) });
    await render(<PlansView {...p} />);
    expect(screen.queryByTestId('premium-plan-premium_plus')).toBeNull();
    expect(screen.queryByText(/Premium Plus|No ads/)).toBeNull();
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(p.onUpgrade).toHaveBeenCalledWith('premium_monthly_v2');
  });

  it('Basic picked by a Basic player: no button', async () => {
    await render(<PlansView {...props('basic')} />);
    await fireEvent.press(screen.getByTestId('premium-plan-basic'));
    expect(screen.queryByTestId('premium-action')).toBeNull();
  });

  it('Upgrade waits for the store to connect; Restore purchases and Close', async () => {
    const p = props('basic', { connected: false });
    await render(<PlansView {...p} />);
    expect(screen.getByTestId('premium-action').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('premium-action'));
    expect(p.onUpgrade).not.toHaveBeenCalled();
    expect(screen.getByTestId('premium-restore').props.accessibilityState).toMatchObject({ disabled: true });
    const ready = props('basic');
    await render(<PlansView {...ready} />);
    await fireEvent.press(screen.getByTestId('premium-restore'));
    expect(ready.onRestore).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(ready.onClose).toHaveBeenCalled();
  });

  it('off iOS: one line, no buy button; an error shows in one line', async () => {
    await render(<PlansView {...props('basic', { purchasable: false })} />);
    expect(screen.getByText('Purchasing is available on iOS only for now.')).toBeTruthy();
    expect(screen.queryByTestId('premium-action')).toBeNull();
    await render(<PlansView {...props('basic', { error: 'Apple could not verify this purchase.' })} />);
    expect(screen.getByText('Apple could not verify this purchase.')).toBeTruthy();
  });

  it('loading the player: skeletons, nothing marked', async () => {
    await render(<PlansView {...props('basic', { tier: null })} />);
    expect(screen.getByTestId('premium-plans-loading')).toBeTruthy();
    expect(screen.queryByTestId('premium-action')).toBeNull();
  });
});
