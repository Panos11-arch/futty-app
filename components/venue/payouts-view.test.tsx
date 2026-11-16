import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { PayoutsView, type PayoutsViewProps } from '@/components/venue/payouts-view';
import { overview, payoutDetail } from '@/lib/payouts.fixtures';

// The payout sheet is a Modal: load it with the file, not in the first test.
loadWithFile(Modal, PayoutsView);

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

function props(overrides: Partial<PayoutsViewProps> = {}): PayoutsViewProps {
  return {
    state: { status: 'ready', data: overview() },
    venueName: 'Nuevo Campo',
    onRetry: jest.fn(),
    onStripe: jest.fn(async () => null),
    onOpenPayout: jest.fn(async () => ({ detail: payoutDetail() })),
    ...overrides,
  };
}

describe('PayoutsView: onboarding', () => {
  it('not set up: one button opens Stripe onboarding', async () => {
    const p = props({ state: { status: 'ready', data: overview({ account: { status: 'not_started', venue_live: true, requirements_due: 0 }, payouts: [], can_receive: false, ready_cents: 6000 }) } });
    await render(<PayoutsView {...p} />);
    expect(screen.getByText('€60.00 is waiting for payouts to start at your venue.')).toBeTruthy();
    expect(screen.getByText(/No payouts yet/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Set up payouts' }));
    expect(p.onStripe).toHaveBeenCalledWith('onboard');
  });

  it('ready: the Stripe dashboard, for bank payouts', async () => {
    const p = props();
    await render(<PayoutsView {...p} />);
    expect(screen.getByText('Payouts are on')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Stripe dashboard' }));
    expect(p.onStripe).toHaveBeenCalledWith('dashboard');
  });

  it("Stripe's refusal is shown", async () => {
    const p = props({ onStripe: jest.fn(async () => "Stripe didn't answer. Try again in a minute.") });
    await render(<PayoutsView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Stripe dashboard' }));
    expect(await screen.findByText("Stripe didn't answer. Try again in a minute.")).toBeTruthy();
  });

  it('disconnected: no button, told to contact Futty', async () => {
    await render(<PayoutsView {...props({ state: { status: 'ready', data: overview({ account: { status: 'disconnected', venue_live: true, requirements_due: 0 } }) } })} />);
    expect(screen.getByText(/Contact Futty to connect it again/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Stripe dashboard' })).toBeNull();
  });
});

describe('PayoutsView: payouts and what each booking paid', () => {
  it('lists payouts with the server amounts and status', async () => {
    await render(<PayoutsView {...props()} />);
    expect(screen.getByTestId('payout-po2')).toBeTruthy();
    expect(screen.getByText('€58.95')).toBeTruthy();
    expect(screen.getByText('Sent to Stripe · Tue 17 Nov, 23:05 · and 1 earlier booking')).toBeTruthy();
    expect(screen.getByText('Waiting for card payments to clear · Mon 16 Nov, 22:00')).toBeTruthy();
  });

  it("tapping a payout shows each booking it covered: this payout's part and what the booking paid", async () => {
    const p = props();
    await render(<PayoutsView {...p} />);
    await fireEvent.press(screen.getByTestId('payout-po2'));
    expect(p.onOpenPayout).toHaveBeenCalledWith('po2');
    expect(await screen.findByText('Payout of €58.95')).toBeTruthy();
    expect(screen.getByTestId('payout-booking-b2')).toBeTruthy();
    expect(screen.getByText('In this payout: €60.00')).toBeTruthy();
    expect(screen.getByText('In this payout: -€1.05')).toBeTruthy();
    expect(screen.getAllByText('You owe Futty for this booking').length).toBe(1);
    expect(screen.getAllByText('Paid by players in the app').length).toBe(2);
  });

  it("a payout that can't be loaded says so", async () => {
    await render(<PayoutsView {...props({ onOpenPayout: jest.fn(async () => ({ error: 'That payout could not be found.' })) })} />);
    await fireEvent.press(screen.getByTestId('payout-po1'));
    expect(await screen.findByText('That payout could not be found.')).toBeTruthy();
  });

  it('bookings from before Futty payouts are listed as such, with no payout', async () => {
    const data = overview({ before_payouts: [{ booking_id: 'b0', label: 'Nuevo Campo on Friday 6 Nov at 19:00', venue_cents: 6000 }] });
    await render(<PayoutsView {...props({ state: { status: 'ready', data } })} />);
    expect(screen.getByText('Before Futty payouts')).toBeTruthy();
    expect(screen.getByTestId('before-payouts-b0')).toBeTruthy();
    expect(screen.getByText('Before Futty payouts: not sent through Futty')).toBeTruthy();
    expect(screen.getByText(/made before Futty payouts started at your venue/)).toBeTruthy();
  });

  it("payouts not started at the venue: its bookings are all before Futty payouts", async () => {
    const data = overview({
      payouts_from: null, payouts: [],
      before_payouts: [{ booking_id: 'b0', label: 'Nuevo Campo on Friday 6 Nov at 19:00', venue_cents: 6000 }],
    });
    await render(<PayoutsView {...props({ state: { status: 'ready', data } })} />);
    expect(screen.getByText('Payouts start when your venue is live')).toBeTruthy();
    expect(screen.getByText(/haven't started at your venue yet/)).toBeTruthy();
  });

  it('waiting for card payments to clear: said so, not "within minutes"', async () => {
    const data = overview({ sending_cents: 5895, waiting_for_balance_cents: 5895 });
    await render(<PayoutsView {...props({ state: { status: 'ready', data } })} />);
    expect(screen.getByText(/waiting for players' card payments to clear in Stripe/)).toBeTruthy();
    expect(screen.queryByText(/minute/)).toBeNull();
  });

  it('owed to Futty: told it comes off the next payout', async () => {
    await render(<PayoutsView {...props({ state: { status: 'ready', data: overview({ owed_to_futty_cents: 105 }) } })} />);
    expect(screen.getByText(/You owe Futty €1.05/)).toBeTruthy();
  });

  it('loading and error states', async () => {
    const p = props({ state: { status: 'error', message: "Payouts couldn't be loaded. Try again." } });
    await render(<PayoutsView {...p} />);
    expect(screen.getByText("Payouts couldn't be loaded. Try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetry).toHaveBeenCalled();
  });
});
