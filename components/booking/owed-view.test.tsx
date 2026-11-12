import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { OwedView, type OwedViewProps } from '@/components/booking/owed-view';
import type { Owed, VenueCredit } from '@/lib/use-owed';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const owed: Owed = {
  blocked: true,
  debt_cents: 1360,
  debts: [
    {
      debt_id: 'd1',
      owed_to: 'venue',
      venue_id: 'v1',
      venue_name: 'Nuevo Campo',
      booking_id: 'b1',
      amount_cents: 680,
      reason: 'unpaid_share',
      created_at: '2026-11-10T20:00:00Z',
    },
    {
      debt_id: 'd2',
      owed_to: 'futty',
      venue_id: null,
      venue_name: null,
      booking_id: 'b2',
      amount_cents: 680,
      reason: 'cancellation_fee',
      created_at: '2026-11-11T20:00:00Z',
    },
  ],
  payments: [
    {
      kind: 'card_failed',
      booking_id: 'b3',
      share_id: null,
      venue_name: 'Lefkothea',
      booking_day: '2026-11-14',
      start_time: '19:00:00',
      amount_cents: 6000,
    },
    {
      kind: 'cash_unpaid',
      booking_id: 'b4',
      share_id: 's4',
      venue_name: 'Nuevo Campo',
      booking_day: '2026-11-11',
      start_time: '20:00:00',
      amount_cents: 600,
    },
  ],
};

const credit: VenueCredit[] = [
  {
    venue_id: 'v1',
    venue_name: 'Nuevo Campo',
    available_cents: 1100,
    credits: [
      { credit_id: 'c1', remaining_cents: 500, expires_at: '2027-03-01T10:00:00Z' },
      { credit_id: 'c2', remaining_cents: 600, expires_at: '2027-11-11T22:30:00Z' },
    ],
  },
  {
    venue_id: 'v2',
    venue_name: 'Lefkothea',
    available_cents: 250,
    credits: [{ credit_id: 'c3', remaining_cents: 250, expires_at: '2027-06-20T09:00:00Z' }],
  },
];

function props(overrides: Partial<OwedViewProps> = {}): OwedViewProps {
  return {
    owed: { status: 'ready', data: owed },
    credit: { status: 'ready', data: credit },
    onRetryOwed: jest.fn(),
    onRetryCredit: jest.fn(),
    onPay: jest.fn(),
    payingKey: null,
    message: null,
    ...overrides,
  };
}

describe('Pay what I owe', () => {
  it('shows the server’s total and each debt’s amount unchanged (680 -> €6.80)', async () => {
    await render(<OwedView {...props()} />);
    expect(screen.getByText('You owe €13.60')).toBeTruthy();
    const venueDebt = within(screen.getByTestId('debt-d1'));
    expect(venueDebt.getByText('Nuevo Campo')).toBeTruthy();
    expect(venueDebt.getByText('Your share was never paid')).toBeTruthy();
    expect(venueDebt.getByText('€6.80')).toBeTruthy();
    expect(venueDebt.getByRole('button', { name: 'Pay €6.80' })).toBeTruthy();
    expect(within(screen.getByTestId('debt-d2')).getByText('Futty')).toBeTruthy();
  });

  it('adds no fee: no service fee line, and the button pays exactly the debt', async () => {
    await render(<OwedView {...props()} />);
    expect(screen.queryByText(/Service fee/)).toBeNull();
    expect(screen.queryByText('€7.60')).toBeNull();
    expect(screen.getByText(/Paying adds no service fee/)).toBeTruthy();
  });

  it('pays the debt that was tapped', async () => {
    const p = props();
    await render(<OwedView {...p} />);
    await fireEvent.press(within(screen.getByTestId('debt-d1')).getByRole('button', { name: 'Pay €6.80' }));
    expect(p.onPay).toHaveBeenCalledWith({ type: 'debt', debt: owed.debts[0] });
  });

  it('lists each payment that didn’t go through with its own action', async () => {
    const p = props();
    await render(<OwedView {...p} />);
    expect(screen.getByText('Payments to finish')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Update card' }));
    expect(p.onPay).toHaveBeenLastCalledWith({ type: 'payment', payment: owed.payments[0] });
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €6.00 by card' }));
    expect(p.onPay).toHaveBeenLastCalledWith({ type: 'payment', payment: owed.payments[1] });
  });

  it('a failed guarantee shows its hold small and labelled, never as money owed (6000 -> Hold: €60.00)', async () => {
    await render(<OwedView {...props()} />);
    const row = within(screen.getByTestId('payment-card_failed:b3:'));
    expect(row.getByText('Hold: €60.00')).toBeTruthy();
    expect(row.queryByText('€60.00')).toBeNull();
    expect(row.getByText(/Your booking stays on\./)).toBeTruthy();
  });

  it('unticked cash shows the server’s amount and words true in both modes', async () => {
    await render(<OwedView {...props()} />);
    const row = within(screen.getByTestId('payment-cash_unpaid:b4:s4'));
    expect(row.getByText('€6.00')).toBeTruthy();
    expect(row.getByText('Cash for your spot wasn’t ticked as paid. You can pay it by card now.')).toBeTruthy();
  });

  it('disables every pay button while one is paying', async () => {
    const p = props({ payingKey: 'debt:d1' });
    await render(<OwedView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Update card' }));
    expect(p.onPay).not.toHaveBeenCalled();
  });

  it('says so when nothing is owed', async () => {
    await render(<OwedView {...props({ owed: { status: 'ready', data: { blocked: false, debt_cents: 0, debts: [], payments: [] } } })} />);
    expect(screen.getByText('You don’t owe anything.')).toBeTruthy();
    expect(screen.queryByText('Payments to finish')).toBeNull();
  });

  it('shows the message after paying', async () => {
    await render(<OwedView {...props({ message: { tone: 'info', text: 'Payment sent. It clears once Stripe confirms it.' } })} />);
    expect(screen.getByText('Payment sent. It clears once Stripe confirms it.')).toBeTruthy();
  });

  it('shows a skeleton while loading and a retry on error', async () => {
    const p = props({ owed: { status: 'loading' } });
    const view = await render(<OwedView {...p} />);
    expect(screen.getByTestId('owed-skeleton')).toBeTruthy();
    await view.rerender(<OwedView {...p} owed={{ status: 'error', message: 'Could not load.' }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetryOwed).toHaveBeenCalled();
  });
});

describe('credit', () => {
  it('shows each venue with its credit and each expiry, as the server sent them', async () => {
    await render(<OwedView {...props()} />);
    const nuevo = within(screen.getByTestId('credit-v1'));
    expect(nuevo.getByText('Nuevo Campo')).toBeTruthy();
    expect(nuevo.getByText('€11.00')).toBeTruthy();
    expect(nuevo.getByText('Expires 1 Mar 2027')).toBeTruthy();
    expect(nuevo.getByText('€5.00')).toBeTruthy();
    expect(nuevo.getByText('Expires 12 Nov 2027')).toBeTruthy();
    expect(nuevo.getByText('€6.00')).toBeTruthy();
    const lefkothea = within(screen.getByTestId('credit-v2'));
    expect(lefkothea.getByText('Lefkothea')).toBeTruthy();
    expect(lefkothea.getAllByText('€2.50')).toHaveLength(2);
    expect(lefkothea.getByText('Expires 20 Jun 2027')).toBeTruthy();
  });

  it('says so when there is no credit', async () => {
    await render(<OwedView {...props({ credit: { status: 'ready', data: [] } })} />);
    expect(screen.getByText('No credit right now.')).toBeTruthy();
  });
});
