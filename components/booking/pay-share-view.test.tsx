import { fireEvent, render, screen } from '@testing-library/react-native';

import { PayShareView, type PayShareViewProps } from '@/components/booking/pay-share-view';
import { detailFixture } from '@/lib/booking-search.fixtures';
import type { PayShareData } from '@/lib/booking-search';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const now = new Date('2026-11-16T08:00:00Z');
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const terms = { fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 };

function props(data: Partial<PayShareData> = {}, overrides: Partial<PayShareViewProps> = {}): PayShareViewProps {
  return {
    data: { status: 'ready', data: { detail: detailFixture(), blocked: false, cancellation: terms, ...data } },
    onRetry: jest.fn(),
    onPay: jest.fn(),
    paying: false,
    error: null,
    now,
    ...overrides,
  };
}

const isDisabled = (name: string | RegExp) => screen.getByRole('button', { name }).props.accessibilityState?.disabled === true;

describe('PayShareView', () => {
  it('shows the player’s own share exactly as the server sent it (680 → €6.80)', async () => {
    const p = props();
    await render(<PayShareView {...p} />);
    expect(screen.getByText('Nuevo Campo')).toBeTruthy();
    expect(screen.getByText('€6.00')).toBeTruthy();
    expect(screen.getByText('€0.80')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €6.80' }));
    expect(p.onPay).toHaveBeenCalledWith({ method: 'card', acceptNonRefundable: false, useCredit: false });
  });

  it('a share already chosen as cash: the server’s card and cash amounts', async () => {
    await render(
      <PayShareView {...props({ detail: detailFixture({ me: { payment_method: 'cash', amount_cents: 80, cash_cents: 600 } }) })} />,
    );
    expect(screen.getByText('You pay the €0.80 service fee by card now and €6.00 in cash at the venue.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay €0.80' })).toBeTruthy();
  });

  it('card only: the app offers no cash choice, even in an each-pays booking', async () => {
    const p = props({ detail: detailFixture({ booking: { payment_mode: 'each_pays_own_spot' } }) });
    await render(<PayShareView {...p} />);
    expect(screen.queryByRole('button', { name: /cash/i })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €6.80' }));
    expect(p.onPay).toHaveBeenCalledWith({ method: 'card', acceptNonRefundable: false, useCredit: false });
  });

  it('a player who owes money (my_owed blocked) sees the debt line and can’t pay', async () => {
    const p = props({ blocked: true });
    await render(<PayShareView {...p} />);
    expect(screen.getByText('You owe money to a venue. Pay it before booking.')).toBeTruthy();
    expect(isDisabled('Pay €6.80')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €6.80' }));
    expect(p.onPay).not.toHaveBeenCalled();
  });

  it('no debt line when the player owes nothing', async () => {
    await render(<PayShareView {...props()} />);
    expect(screen.queryByText('You owe money to a venue. Pay it before booking.')).toBeNull();
    expect(isDisabled('Pay €6.80')).toBe(false);
  });

  it('the notice appears at 5h59m before kickoff (past the server’s refunds_stop_at) and must be accepted', async () => {
    const p = props({ detail: detailFixture({ booking: { kickoff_at: at(359), refunds_stop_at: at(-1) } }) });
    await render(<PayShareView {...p} />);
    expect(screen.getByText('This booking is non-refundable')).toBeTruthy();
    expect(isDisabled('Pay €6.80')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'I accept that this booking is non-refundable' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €6.80' }));
    expect(p.onPay).toHaveBeenCalledWith({ method: 'card', acceptNonRefundable: true, useCredit: false });
  });

  it('no notice at 6h01m before kickoff (before the server’s refunds_stop_at)', async () => {
    await render(<PayShareView {...props({ detail: detailFixture({ booking: { kickoff_at: at(361), refunds_stop_at: at(1) } }) })} />);
    expect(screen.queryByText('This booking is non-refundable')).toBeNull();
    expect(isDisabled('Pay €6.80')).toBe(false);
  });

  it.each([
    ['authorized', 'Your payment is held.'],
    ['paid', 'Paid.'],
    ['covered', 'The booker paid for your spot.'],
  ])('nothing to pay when the share is %s', async (status, text) => {
    await render(<PayShareView {...props({ detail: detailFixture({ me: { status } }) })} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
  });

  it('a player with no spot in the booking', async () => {
    await render(<PayShareView {...props({ detail: detailFixture({ me: null }) })} />);
    expect(screen.getByText('You don’t have a spot in this booking.')).toBeTruthy();
  });

  it('shows the checkout cancellation rules in three lines', async () => {
    await render(<PayShareView {...props()} />);
    expect(screen.getByText(/whichever comes first\.$/)).toBeTruthy();
    expect(screen.getByText(/is kept for each player paid for/)).toBeTruthy();
    expect(screen.getByText('Less than 6 hours before kickoff, there are no refunds.')).toBeTruthy();
  });

  it('shows a failed load with a retry', async () => {
    const p = props({}, { data: { status: 'error', message: 'Network down' } });
    await render(<PayShareView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetry).toHaveBeenCalled();
  });
});
