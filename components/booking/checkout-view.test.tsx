import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { CheckoutView, type CheckoutViewProps } from '@/components/booking/checkout-view';
import { quoteFixture } from '@/lib/booking-search.fixtures';
import type { BookingQuote } from '@/lib/booking-search';

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

function props(quote: BookingQuote = quoteFixture(), overrides: Partial<CheckoutViewProps> = {}): CheckoutViewProps {
  return {
    venueName: 'Nuevo Campo',
    quote: { status: 'ready', data: quote },
    onRetry: jest.fn(),
    onPay: jest.fn(),
    paying: false,
    error: null,
    bookingHeld: false,
    now,
    ...overrides,
  };
}

const payButton = () => within(screen.getByTestId('sticky-action-bar')).getByRole('button');
const isDisabled = () => payButton().props.accessibilityState?.disabled === true;

describe('CheckoutView', () => {
  it('shows both prices exactly as the server sent them (6550 → €65.50, 680 → €6.80)', async () => {
    await render(<CheckoutView {...props()} />);
    expect(screen.getByRole('tab', { name: 'Pay for everyone: €65.50' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Each pays: €6.80 each' })).toBeTruthy();
  });

  it('Pay is disabled until who pays is chosen (there is no default mode)', async () => {
    await render(<CheckoutView {...props()} />);
    expect(isDisabled()).toBe(true);
  });

  it('pay for everyone: the breakdown and the sticky total are the server’s', async () => {
    const p = props();
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Pay for everyone: €65.50' }));
    expect(screen.getByText('€60.00')).toBeTruthy();
    expect(screen.getByText('€5.50')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay €65.50' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €65.50' }));
    expect(p.onPay).toHaveBeenCalledWith({
      mode: 'pay_all',
      pay: { method: 'card', acceptNonRefundable: false, useCredit: false },
    });
  });

  it('each pays needs "responsible" or "just my spot", each with its sentence', async () => {
    const p = props();
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Each pays: €6.80 each' }));
    expect(isDisabled()).toBe(true);
    expect(screen.getByText(/taken from your guarantee hold 2 hours after the match/)).toBeTruthy();
    expect(screen.getByText(/owes the venue themselves/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Just my spot' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €6.80' }));
    expect(p.onPay).toHaveBeenCalledWith({
      mode: 'each_pays_own_spot',
      pay: { method: 'card', acceptNonRefundable: false, useCredit: false },
    });
  });

  it('the responsible mode reaches onPay', async () => {
    const p = props();
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Each pays: €6.80 each' }));
    await fireEvent.press(screen.getByRole('tab', { name: "I'm responsible for the team" }));
    await fireEvent.press(payButton());
    expect(p.onPay).toHaveBeenCalledWith(expect.objectContaining({ mode: 'each_pays_responsible' }));
  });

  it('cash: the fee by card now and the pitch part at the venue, from the server', async () => {
    const p = props();
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Each pays: €6.80 each' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Just my spot' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Pay the pitch in cash at the venue' }));
    expect(screen.getByText('You pay the €0.80 service fee by card now and €6.00 in cash at the venue.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €0.80' }));
    expect(p.onPay).toHaveBeenCalledWith(expect.objectContaining({ pay: expect.objectContaining({ method: 'cash' }) }));
  });

  it('no cash when the server doesn’t allow it, or when paying for everyone', async () => {
    await render(<CheckoutView {...props(quoteFixture({ cash_allowed: false }))} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Each pays: €6.80 each' }));
    expect(screen.queryByRole('button', { name: 'Pay the pitch in cash at the venue' })).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'Pay for everyone: €65.50' }));
    expect(screen.queryByRole('button', { name: 'Pay the pitch in cash at the venue' })).toBeNull();
  });

  it('credit: the server’s amounts with credit, and no cash alongside it', async () => {
    const quote = quoteFixture({
      pay_all: { pitch_cents: 6000, fee_cents: 550, card_cents: 6550, with_credit: { credit_cents: 5000, fee_cents: 550, card_cents: 1550 } },
      each_pays: {
        ...quoteFixture().each_pays,
        mine: { pitch_cents: 600, fee_cents: 80, card_cents: 680, with_credit: { credit_cents: 600, fee_cents: 0, card_cents: 0 } },
      },
      credit: { available_cents: 5000, expires_at: '2027-11-01T10:00:00Z' },
    });
    const p = props(quote);
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Pay for everyone: €65.50' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Use my €50.00 credit' }));
    expect(screen.getByText('-€50.00')).toBeTruthy();
    // The sticky bar's label follows the breakdown: credit means "By card now".
    expect(within(screen.getByTestId('sticky-action-bar')).getByText('By card now')).toBeTruthy();
    expect(within(screen.getByTestId('sticky-action-bar')).queryByText('Total')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €15.50' }));
    expect(p.onPay).toHaveBeenCalledWith({ mode: 'pay_all', pay: { method: 'card', acceptNonRefundable: false, useCredit: true } });

    await fireEvent.press(screen.getByRole('tab', { name: 'Each pays: €6.80 each' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Just my spot' }));
    expect(screen.queryByRole('button', { name: 'Pay the pitch in cash at the venue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Book and save my card' })).toBeTruthy();
  });

  it('no credit option without credit at this venue', async () => {
    await render(<CheckoutView {...props()} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Pay for everyone: €65.50' }));
    expect(screen.queryByRole('button', { name: /Use my/ })).toBeNull();
  });

  it('shows the cancellation rules in three lines that hold in every mode', async () => {
    await render(<CheckoutView {...props()} />);
    expect(
      screen.getByText('Cancel for a full refund until 1 hour after paying or 6 hours before kickoff, whichever comes first.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'After that, until 6 hours before kickoff, €1.00 is kept for each player paid for and the rest becomes credit at this venue. Paying the pitch in cash, only the service fee is at stake.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Less than 6 hours before kickoff, there are no refunds.')).toBeTruthy();
  });

  it('once payment has started, says who pays is fixed and an unpaid booking is released after 15 minutes', async () => {
    await render(<CheckoutView {...props(undefined, { bookingHeld: true })} />);
    expect(
      screen.getByText("Who pays is fixed once payment starts. If you don't finish paying, the booking is released after 15 minutes."),
    ).toBeTruthy();
    expect(screen.queryByText(/pick the time again/)).toBeNull();
  });

  describe('the non-refundable notice', () => {
    it('appears at 5h59m before kickoff (the server’s non_refundable flag is set), and Pay is disabled until it is accepted', async () => {
      const p = props(quoteFixture({ non_refundable: true, kickoff_at: at(359), refunds_stop_at: at(-1) }));
      await render(<CheckoutView {...p} />);
      expect(screen.getByText('This booking is non-refundable')).toBeTruthy();
      await fireEvent.press(screen.getByRole('tab', { name: 'Pay for everyone: €65.50' }));
      expect(isDisabled()).toBe(true);
      await fireEvent.press(screen.getByRole('button', { name: 'I accept that this booking is non-refundable' }));
      expect(isDisabled()).toBe(false);
      await fireEvent.press(payButton());
      expect(p.onPay).toHaveBeenCalledWith({ mode: 'pay_all', pay: { method: 'card', acceptNonRefundable: true, useCredit: false } });
    });

    it('does not appear at 6h01m before kickoff (the server’s non_refundable flag is not set)', async () => {
      await render(<CheckoutView {...props(quoteFixture({ non_refundable: false, kickoff_at: at(361), refunds_stop_at: at(1) }))} />);
      expect(screen.queryByText('This booking is non-refundable')).toBeNull();
      await fireEvent.press(screen.getByRole('tab', { name: 'Pay for everyone: €65.50' }));
      expect(isDisabled()).toBe(false);
    });
  });

  it('a player in debt can’t pay, with one line saying why', async () => {
    await render(<CheckoutView {...props(quoteFixture({ in_debt: true, cash_allowed: false }))} />);
    expect(screen.getByText('You owe money to a venue. Pay it before booking.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Pay for everyone: €65.50' }));
    expect(isDisabled()).toBe(true);
  });

  it('the debt line links to "Pay what I owe"', async () => {
    const onPayOwed = jest.fn();
    await render(<CheckoutView {...props(quoteFixture({ in_debt: true, cash_allowed: false }), { onPayOwed })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pay what I owe' }));
    expect(onPayOwed).toHaveBeenCalledTimes(1);
  });

  it('no "Pay what I owe" link without a debt', async () => {
    await render(<CheckoutView {...props(quoteFixture(), { onPayOwed: jest.fn() })} />);
    expect(screen.queryByRole('button', { name: 'Pay what I owe' })).toBeNull();
  });

  it('shows a failed quote with a retry', async () => {
    const p = props(undefined, { quote: { status: 'error', message: 'That slot just filled up — pick another one.' } });
    await render(<CheckoutView {...p} />);
    expect(screen.getByText('That slot just filled up — pick another one.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetry).toHaveBeenCalled();
  });

  it('shows a payment error inline', async () => {
    await render(<CheckoutView {...props(undefined, { error: 'Card declined' })} />);
    expect(screen.getByText('Card declined')).toBeTruthy();
  });
});

describe('CheckoutView: Gipedo Pano (P8)', () => {
  const lions = { id: 't1', name: 'Lions' };
  const tigers = { id: 't2', name: 'Tigers' };

  it('isn’t offered to a player who captains no team', async () => {
    await render(<CheckoutView {...props(quoteFixture({ captain_teams: [] }))} />);
    expect(screen.queryByRole('tab', { name: /Gipedo Pano/ })).toBeNull();
  });

  it('a captain books it for their team: the server’s 6550 hold, card only', async () => {
    const p = props(quoteFixture({ captain_teams: [lions] }));
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Gipedo Pano: €65.50 held' }));
    expect(screen.getByText(/the losing team pays for the pitch/)).toBeTruthy();
    expect(screen.getByText('For Lions')).toBeTruthy();
    expect(screen.queryByText('Pay the pitch in cash at the venue')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Hold €65.50' }));
    expect(p.onPay).toHaveBeenCalledWith({
      mode: 'gipedo_pano',
      teamId: 't1',
      pay: { method: 'card', acceptNonRefundable: false, useCredit: false },
    });
  });

  it('with two teams, the captain picks one before paying', async () => {
    const p = props(quoteFixture({ captain_teams: [lions, tigers] }));
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Gipedo Pano: €65.50 held' }));
    expect(isDisabled()).toBe(true);
    await fireEvent.press(screen.getByRole('tab', { name: 'Tigers' }));
    await fireEvent.press(payButton());
    expect(p.onPay).toHaveBeenCalledWith(expect.objectContaining({ mode: 'gipedo_pano', teamId: 't2' }));
  });

  it('more than 6 days ahead: spec 13’s sentence, and no paying', async () => {
    const quote = quoteFixture({
      captain_teams: [lions],
      gipedo_pano: { pitch_cents: 6000, fee_cents: 550, hold_cents: 6550, available: false, unavailable_reason: 'gipedo_too_far_ahead' },
    });
    await render(<CheckoutView {...props(quote)} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Gipedo Pano: €65.50 held' }));
    expect(screen.getByText('Gipedo Pano can only be booked up to 6 days ahead.')).toBeTruthy();
    expect(isDisabled()).toBe(true);
  });

  it('no credit with Gipedo Pano, even with credit at the venue', async () => {
    const quote = quoteFixture({
      captain_teams: [lions],
      pay_all: { pitch_cents: 6000, fee_cents: 550, card_cents: 6550, with_credit: { credit_cents: 5000, fee_cents: 550, card_cents: 1550 } },
      credit: { available_cents: 5000, expires_at: '2027-11-01T00:00:00Z' },
    });
    await render(<CheckoutView {...props(quote)} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Gipedo Pano: €65.50 held' }));
    expect(screen.queryByText(/Use my €50.00 credit/)).toBeNull();
  });
});
