import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { OwedBanner } from '@/components/home/owed-banner';
import { type Owed, type OwedDebt, type OwedPayment, paymentSentence } from '@/lib/use-owed';

// The focus effect is captured so a test can come back to Home.
let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (effect: () => void) =>
      useEffect(() => {
        mockFocus = effect;
        effect();
      }, [effect]),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const nothingOwed: Owed = { blocked: false, debt_cents: 0, debts: [], payments: [] };
let mockState: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Owed } = {
  status: 'loading',
};
const mockReload = jest.fn();
// Only the hook is faked: the banner's words come from the real helpers.
jest.mock('@/lib/use-owed', () => ({
  ...jest.requireActual('@/lib/use-owed'),
  useOwed: () => ({ state: mockState, reload: mockReload }),
}));

const debt = (over: Partial<OwedDebt> = {}): OwedDebt => ({
  debt_id: 'd1',
  owed_to: 'venue',
  venue_id: 'v1',
  venue_name: 'Nuevo Campo',
  booking_id: 'b1',
  amount_cents: 600,
  reason: 'cash_unpaid',
  created_at: '2026-11-14T20:00:00.000Z',
  ...over,
});
const payment = (over: Partial<OwedPayment> = {}): OwedPayment => ({
  kind: 'payment_due',
  booking_id: 'b1',
  share_id: null,
  venue_name: 'English School',
  booking_day: '2026-11-20',
  start_time: '19:00:00',
  amount_cents: 680,
  ...over,
});

describe('Home owed banner', () => {
  beforeEach(() => {
    mockReload.mockClear();
    jest.mocked(router.push).mockClear();
  });

  it('loading: nothing, never a skeleton (Home is never blocked by it)', async () => {
    mockState = { status: 'loading' };
    await render(<OwedBanner refreshSignal={0} />);
    expect(screen.queryByTestId('owed-banner')).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  it('an error: nothing (Home stays usable)', async () => {
    mockState = { status: 'error', message: 'offline' };
    await render(<OwedBanner refreshSignal={0} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('nothing owed: hidden', async () => {
    mockState = { status: 'ready', data: nothingOwed };
    await render(<OwedBanner refreshSignal={0} />);
    expect(screen.queryByTestId('owed-banner')).toBeNull();
  });

  it("a debt: the server's amount to the cent and its venue", async () => {
    mockState = { status: 'ready', data: { ...nothingOwed, blocked: true, debt_cents: 600, debts: [debt()] } };
    await render(<OwedBanner refreshSignal={0} />);
    expect(screen.getByTestId('owed-banner')).toBeTruthy();
    expect(screen.getByText('You owe €6.00. Pay it before booking.')).toBeTruthy();
    expect(screen.getByText('Nuevo Campo')).toBeTruthy();
  });

  it('debts to two places name neither', async () => {
    mockState = {
      status: 'ready',
      data: {
        ...nothingOwed,
        blocked: true,
        debt_cents: 1300,
        debts: [debt(), debt({ debt_id: 'd2', owed_to: 'futty', venue_id: null, venue_name: null, amount_cents: 700 })],
      },
    };
    await render(<OwedBanner refreshSignal={0} />);
    expect(screen.getByText('You owe €13.00. Pay it before booking.')).toBeTruthy();
    expect(screen.queryByText('Nuevo Campo')).toBeNull();
  });

  it('an unpaid spot: its sentence and venue', async () => {
    mockState = { status: 'ready', data: { ...nothingOwed, payments: [payment()] } };
    await render(<OwedBanner refreshSignal={0} />);
    expect(screen.getByText(paymentSentence('payment_due'))).toBeTruthy();
    expect(screen.getByText('English School')).toBeTruthy();
  });

  it('Pay what I owe opens the pay screen', async () => {
    mockState = { status: 'ready', data: { ...nothingOwed, payments: [payment()] } };
    await render(<OwedBanner refreshSignal={0} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pay what I owe' }));
    expect(router.push).toHaveBeenCalledWith('/account/payments/owed');
  });

  it('checks again on return to Home and on pull to refresh, not on first load', async () => {
    mockState = { status: 'ready', data: nothingOwed };
    await render(<OwedBanner refreshSignal={0} />);
    expect(mockReload).not.toHaveBeenCalled();
    await act(async () => mockFocus!());
    expect(mockReload).toHaveBeenCalledTimes(1);
    await screen.rerender(<OwedBanner refreshSignal={1} />);
    expect(mockReload).toHaveBeenCalledTimes(2);
  });
});
