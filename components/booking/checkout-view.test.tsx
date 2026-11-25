import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { CheckoutView, type CheckoutViewProps } from '@/components/booking/checkout-view';
import type { CheckoutData, FreePitch } from '@/lib/booking-v2';
import { checkoutDataFixture, pitchesFixture, premiumQuoteV2Fixture, quoteV2Fixture } from '@/lib/booking-v2.fixtures';
import { primeRules } from '@/lib/rules.fixtures';

// Spec 13's rules as the migration's defaults (P10): the text below reads them.
beforeEach(() => {
  primeRules();
});

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const now = new Date('2026-11-23T08:00:00Z');

function props(data: CheckoutData = checkoutDataFixture(), overrides: Partial<CheckoutViewProps> = {}): CheckoutViewProps {
  return {
    venueName: 'Kamares Sports Centre',
    quote: { status: 'ready', data },
    pitches: { status: 'ready', data: pitchesFixture() },
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
const selected = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.selected === true;
const card = { method: 'card' as const, acceptNonRefundable: false, useCredit: false };

describe('CheckoutView (Booking v2)', () => {
  it('heads with the day and time, then the venue, the chosen pitch, the format and the length', async () => {
    await render(<CheckoutView {...props()} />);
    expect(screen.getByText('Thu 26 Nov · 20:00')).toBeTruthy();
    expect(screen.getByText('Kamares Sports Centre · Pitch 2 · 5-a-side · 60 min')).toBeTruthy();
  });

  describe('the pitch list', () => {
    it('lists the free pitches with name, indoor or outdoor, surface and the server’s price; the first is preselected', async () => {
      await render(<CheckoutView {...props()} />);
      const first = within(screen.getByTestId('checkout-pitch-1'));
      expect(first.getByText('Pitch 2')).toBeTruthy();
      expect(first.getByText('Outdoor · Artificial grass')).toBeTruthy();
      expect(first.getByText('€40.00')).toBeTruthy();
      expect(within(screen.getByTestId('checkout-pitch-2')).getByText('Indoor · Artificial grass')).toBeTruthy();
      expect(selected('checkout-pitch-1')).toBe(true);
      expect(selected('checkout-pitch-2')).toBe(false);
    });

    it('tapping another pitch chooses it, and that pitch is booked', async () => {
      const p = props();
      await render(<CheckoutView {...p} />);
      await fireEvent.press(screen.getByTestId('checkout-pitch-2'));
      expect(selected('checkout-pitch-2')).toBe(true);
      expect(screen.getByText('Kamares Sports Centre · Pitch 3 · 5-a-side · 60 min')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
      await fireEvent.press(payButton());
      expect(p.onPay).toHaveBeenCalledWith({ mode: 'pay_all', kind: 'whole', pitchIds: ['p3'], pay: card });
    });

    it('a combination is listed by its venue name ("Pitch 1 + 2")', async () => {
      const combo: FreePitch = { pitch_ids: ['p1', 'p2'], label: 'Pitch 1 + 2', kind: 'combination', surface: null, indoor: false, price_cents: 9000 };
      await render(<CheckoutView {...props(undefined, { pitches: { status: 'ready', data: [combo] } })} />);
      expect(within(screen.getByTestId('checkout-pitch-1')).getByText('Pitch 1 + 2')).toBeTruthy();
      expect(within(screen.getByTestId('checkout-pitch-1')).getByText('€90.00')).toBeTruthy();
    });

    it('a pitch taken since is gone when the list comes back, and the first free one is chosen', async () => {
      const p = props();
      await render(<CheckoutView {...p} />);
      expect(selected('checkout-pitch-1')).toBe(true);
      await screen.rerender(
        <CheckoutView
          {...p}
          pitches={{ status: 'ready', data: pitchesFixture().slice(1) }}
          error="Pitch 2 is no longer free. Pick another."
        />,
      );
      expect(screen.queryByText('Pitch 2')).toBeNull();
      expect(within(screen.getByTestId('checkout-pitch-1')).getByText('Pitch 3')).toBeTruthy();
      expect(selected('checkout-pitch-1')).toBe(true);
      expect(within(screen.getByTestId('checkout-error')).getByText('Pitch 2 is no longer free. Pick another.')).toBeTruthy();
    });

    it('no free pitch: says so, and Pay stays off', async () => {
      await render(<CheckoutView {...props(undefined, { pitches: { status: 'ready', data: [] } })} />);
      expect(within(screen.getByTestId('checkout-pitches-empty')).getByText('No pitch is free at this time. Pick another time.')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
      expect(isDisabled()).toBe(true);
    });
  });

  describe('whole or half pitch', () => {
    it('two big choices with one line each; whole pitch to start with', async () => {
      await render(<CheckoutView {...props()} />);
      expect(within(screen.getByTestId('checkout-kind-whole')).getByText('Whole pitch')).toBeTruthy();
      expect(within(screen.getByTestId('checkout-kind-whole')).getByText('You bring both teams.')).toBeTruthy();
      expect(within(screen.getByTestId('checkout-kind-half')).getByText('Half pitch')).toBeTruthy();
      expect(within(screen.getByTestId('checkout-kind-half')).getByText('Opponents pay half.')).toBeTruthy();
      expect(selected('checkout-kind-whole')).toBe(true);
    });

    it('"Half pitch" is hidden while the server says half pitches aren’t available', async () => {
      const quote = quoteV2Fixture({ half: { ...quoteV2Fixture().half, available: false } });
      await render(<CheckoutView {...props(checkoutDataFixture(quote))} />);
      expect(screen.queryByTestId('checkout-kind-half')).toBeNull();
      expect(screen.queryByText('Half pitch')).toBeNull();
      expect(screen.getByTestId('checkout-kind-whole')).toBeTruthy();
    });
  });

  describe('the ways to pay, each with its server price', () => {
    it('example 1: whole pitch, pay for everyone, €45.50', async () => {
      const p = props();
      await render(<CheckoutView {...p} />);
      const all = within(screen.getByTestId('checkout-who-pay-all'));
      expect(all.getByText('Pay for everyone')).toBeTruthy();
      expect(all.getByText('€45.50')).toBeTruthy();
      expect(all.getByText('You pay the whole pitch now.')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
      expect(within(screen.getByTestId('checkout-price')).getByText('€40.00')).toBeTruthy();
      expect(within(screen.getByTestId('checkout-price')).getByText('€5.50')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Pay €45.50' })).toBeTruthy();
      await fireEvent.press(payButton());
      expect(p.onPay).toHaveBeenCalledWith({ mode: 'pay_all', kind: 'whole', pitchIds: ['p2'], pay: card });
    });

    it('example 2: whole pitch, pay for myself, €4.80 each, and one line about the €40.00 hold', async () => {
      const p = props();
      await render(<CheckoutView {...p} />);
      const mine = within(screen.getByTestId('checkout-who-each-pays'));
      expect(mine.getByText('Pay for myself')).toBeTruthy();
      expect(mine.getByText('€4.80 each')).toBeTruthy();
      expect(mine.getByText('You pay your share. You cover unpaid spots.')).toBeTruthy();
      expect(screen.queryByTestId('checkout-guarantee')).toBeNull();
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      expect(within(screen.getByTestId('checkout-guarantee')).getByText(
        'We hold €40.00 on your card for unpaid spots, taken 2 hours after the game.',
      )).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Pay €4.80' }));
      expect(p.onPay).toHaveBeenCalledWith({ mode: 'each_pays_responsible', kind: 'whole', pitchIds: ['p2'], pay: card });
    });

    it('example 4: half pitch, pay for everyone, €22.75 for your team’s half', async () => {
      const p = props();
      await render(<CheckoutView {...p} />);
      await fireEvent.press(screen.getByTestId('checkout-kind-half'));
      const all = within(screen.getByTestId('checkout-who-pay-all'));
      expect(all.getByText('€22.75')).toBeTruthy();
      expect(all.getByText("You pay your team's half now.")).toBeTruthy();
      await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
      await fireEvent.press(screen.getByRole('button', { name: 'Pay €22.75' }));
      expect(p.onPay).toHaveBeenCalledWith({ mode: 'pay_all', kind: 'half', pitchIds: ['p2'], pay: card });
    });

    it('example 5: half pitch, pay for myself, €4.80 each and his side’s €20.00 held', async () => {
      const p = props();
      await render(<CheckoutView {...p} />);
      await fireEvent.press(screen.getByTestId('checkout-kind-half'));
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      expect(within(screen.getByTestId('checkout-guarantee')).getByText(
        'We hold €20.00 on your card for unpaid spots, taken 2 hours after the game.',
      )).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Pay €4.80' }));
      expect(p.onPay).toHaveBeenCalledWith({ mode: 'each_pays_responsible', kind: 'half', pitchIds: ['p2'], pay: card });
    });

    it('example 11: a Premium booker sees €44.95 for everyone and pays €4.00 for myself', async () => {
      await render(<CheckoutView {...props(checkoutDataFixture(premiumQuoteV2Fixture()))} />);
      expect(within(screen.getByTestId('checkout-who-pay-all')).getByText('€44.95')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      expect(screen.getByRole('button', { name: 'Pay €4.00' })).toBeTruthy();
    });

    it('Pay is off until a way to pay is chosen (no default)', async () => {
      await render(<CheckoutView {...props()} />);
      expect(isDisabled()).toBe(true);
    });

    it('no "I’m responsible", no "Just my spot", no Losers pay or Gipedo Pano, and no tick box', async () => {
      await render(<CheckoutView {...props()} />);
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      expect(screen.queryByText(/responsible for the team/)).toBeNull();
      expect(screen.queryByText(/Just my spot/)).toBeNull();
      expect(screen.queryByText(/Losers pay|Gipedo/)).toBeNull();
      expect(screen.queryByTestId('checkout-who-gipedo')).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
    });
  });

  describe('cash', () => {
    it('a switch on a whole pitch paying for myself: €0.80 now and €4.00 at the venue (example 3)', async () => {
      const p = props();
      await render(<CheckoutView {...p} />);
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      await fireEvent(screen.getByTestId('checkout-cash'), 'valueChange', true);
      expect(screen.getByText('You pay the €0.80 service fee by card now and €4.00 in cash at the venue.')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Pay €0.80' }));
      expect(p.onPay).toHaveBeenCalledWith({
        mode: 'each_pays_responsible',
        kind: 'whole',
        pitchIds: ['p2'],
        pay: { ...card, method: 'cash' },
      });
    });

    it('never on a half pitch, never when paying for everyone, never when the server says no', async () => {
      await render(<CheckoutView {...props()} />);
      await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
      expect(screen.queryByTestId('checkout-cash')).toBeNull();
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      expect(screen.getByTestId('checkout-cash')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('checkout-kind-half'));
      expect(screen.queryByTestId('checkout-cash')).toBeNull();
    });

    it('switched on, then a half pitch chosen: the payment is by card', async () => {
      const p = props();
      await render(<CheckoutView {...p} />);
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      await fireEvent(screen.getByTestId('checkout-cash'), 'valueChange', true);
      await fireEvent.press(screen.getByTestId('checkout-kind-half'));
      await fireEvent.press(payButton());
      expect(p.onPay).toHaveBeenCalledWith(expect.objectContaining({ kind: 'half', pay: card }));
    });

    it('not offered while the server doesn’t allow cash', async () => {
      await render(<CheckoutView {...props(checkoutDataFixture(quoteV2Fixture({ cash_allowed: false })))} />);
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      expect(screen.queryByTestId('checkout-cash')).toBeNull();
    });
  });

  describe('credit, as today, on a whole pitch', () => {
    const withCredit = () =>
      checkoutDataFixture(quoteV2Fixture(), {
        available_cents: 3000,
        expires_at: '2027-11-01T10:00:00Z',
        with_credit: {
          pay_all: { credit_cents: 3000, fee_cents: 550, card_cents: 1550 },
          pay_for_myself: { credit_cents: 400, fee_cents: 0, card_cents: 0 },
        },
      });

    it('paying for everyone: the server’s amounts with credit', async () => {
      const p = props(withCredit());
      await render(<CheckoutView {...p} />);
      await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
      await fireEvent.press(screen.getByTestId('checkout-credit'));
      expect(within(screen.getByTestId('checkout-price')).getByText('-€30.00')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Pay €15.50' }));
      expect(p.onPay).toHaveBeenCalledWith({
        mode: 'pay_all',
        kind: 'whole',
        pitchIds: ['p2'],
        pay: { ...card, useCredit: true },
      });
    });

    it('paying for myself: the server’s amounts with credit, and no cash alongside it', async () => {
      const p = props(withCredit());
      await render(<CheckoutView {...p} />);
      await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
      await fireEvent.press(screen.getByTestId('checkout-credit'));
      expect(within(screen.getByTestId('checkout-price')).getByText('-€4.00')).toBeTruthy();
      expect(screen.queryByTestId('checkout-cash')).toBeNull();
      await fireEvent.press(payButton());
      expect(p.onPay).toHaveBeenCalledWith({
        mode: 'each_pays_responsible',
        kind: 'whole',
        pitchIds: ['p2'],
        pay: { ...card, useCredit: true },
      });
    });

    it('not on a half pitch', async () => {
      await render(<CheckoutView {...props(withCredit())} />);
      await fireEvent.press(screen.getByTestId('checkout-kind-half'));
      await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
      expect(screen.queryByTestId('checkout-credit')).toBeNull();
    });
  });

  it('the cancellation line, and "Rules" opens the three cancellation rules', async () => {
    await render(<CheckoutView {...props()} />);
    expect(within(screen.getByTestId('checkout-cancellation')).getByText(
      "Free to cancel for 1 hour after paying, if it's more than 6 hours before kickoff.",
    )).toBeTruthy();
    expect(screen.queryByText('Less than 6 hours before kickoff, there are no refunds.')).toBeNull();
    await fireEvent.press(screen.getByTestId('checkout-rules'));
    expect(screen.getByText('Less than 6 hours before kickoff, there are no refunds.')).toBeTruthy();
  });

  it('kickoff under 6 hours away: the non-refundable notice must be accepted first', async () => {
    const p = props(checkoutDataFixture(quoteV2Fixture({ non_refundable: true })));
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    expect(isDisabled()).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'I accept that this booking is non-refundable' }));
    await fireEvent.press(payButton());
    expect(p.onPay).toHaveBeenCalledWith(expect.objectContaining({ pay: { ...card, acceptNonRefundable: true } }));
  });

  it('a booking already held fixes the pitch, the kind and the way to pay', async () => {
    const p = props();
    await render(<CheckoutView {...p} />);
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    await screen.rerender(<CheckoutView {...p} bookingHeld />);
    await fireEvent.press(screen.getByTestId('checkout-pitch-2'));
    await fireEvent.press(screen.getByTestId('checkout-kind-half'));
    await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
    expect(selected('checkout-pitch-1')).toBe(true);
    expect(selected('checkout-kind-whole')).toBe(true);
    expect(selected('checkout-who-pay-all')).toBe(true);
  });

  it('in debt: the banner, and Pay stays off', async () => {
    await render(<CheckoutView {...props(checkoutDataFixture(quoteV2Fixture({ in_debt: true, cash_allowed: false })))} />);
    expect(screen.getByText('You owe money to a venue. Pay it before booking.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    expect(isDisabled()).toBe(true);
  });

  it('keeps the weather strip’s testID', async () => {
    await render(<CheckoutView {...props(undefined, { weather: <></> })} />);
    expect(screen.getByTestId('checkout-weather')).toBeTruthy();
  });

  it('loading and error states', async () => {
    const onRetry = jest.fn();
    await render(<CheckoutView {...props(undefined, { quote: { status: 'error', message: 'No connection' }, onRetry })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

// S5: the payment sheet on the venue page (04-payment-sheet). The pitch is
// chosen on the venue's Book tab; the sheet's own title is the day and time.
describe('CheckoutView: the payment sheet (S5)', () => {
  const sheetProps = (overrides: Partial<CheckoutViewProps> = {}) =>
    props(undefined, { variant: 'sheet', pitchKey: 'p3', ...overrides });
  const sheetPay = () => screen.getByTestId('checkout-pay');

  it('no pitch list and no sticky bar: the venue page chose the pitch, and the sheet titles itself', async () => {
    await render(<CheckoutView {...sheetProps()} />);
    expect(screen.queryByTestId('checkout-pitch-1')).toBeNull();
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull();
    expect(screen.queryByText('Thu 26 Nov · 20:00')).toBeNull();
    expect(screen.getByText('Kamares Sports Centre · Pitch 3 · 5-a-side · 60 min')).toBeTruthy();
  });

  it('"Pitch" heads whole or half, then "Who pays"; Pay books the chosen pitch', async () => {
    const p = sheetProps();
    await render(<CheckoutView {...p} />);
    expect(screen.getByText('Pitch')).toBeTruthy();
    expect(screen.getByText('Who pays')).toBeTruthy();
    expect(sheetPay().props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    expect(within(sheetPay()).getByText('Pay €45.50')).toBeTruthy();
    await fireEvent.press(sheetPay());
    expect(p.onPay).toHaveBeenCalledWith({ mode: 'pay_all', kind: 'whole', pitchIds: ['p3'], pay: card });
  });

  it('the cancellation line and Rules stay', async () => {
    await render(<CheckoutView {...sheetProps()} />);
    expect(screen.getByTestId('checkout-cancellation')).toBeTruthy();
    expect(screen.getByTestId('checkout-rules')).toBeTruthy();
  });

  it('the chosen pitch taken since: says so, and Pay stays off', async () => {
    await render(<CheckoutView {...sheetProps({ pitchKey: 'p9', error: null })} />);
    expect(within(screen.getByTestId('checkout-pitch-gone')).getByText('This pitch was just taken. Pick another.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    expect(sheetPay().props.accessibilityState?.disabled).toBe(true);
  });
});

// B1d (spec 13 "Losers pay"): a half pitch's Losers pay, with the server's holds.
describe('CheckoutView: Losers pay', () => {
  it('offered on a half pitch only; the ways to pay show the holds (7a €45.50, 8a €9.60 each)', async () => {
    const onPay = jest.fn();
    await render(<CheckoutView {...props(checkoutDataFixture(), { onPay })} />);
    expect(screen.queryByTestId('checkout-losers-pay')).toBeNull();
    await fireEvent.press(screen.getByTestId('checkout-kind-half'));
    await fireEvent(screen.getByTestId('checkout-losers-pay'), 'valueChange', true);
    expect(within(screen.getByTestId('checkout-who-pay-all')).getByText('€45.50')).toBeTruthy();
    expect(within(screen.getByTestId('checkout-who-each-pays')).getByText('€9.60 each')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
    expect(screen.getByTestId('checkout-losers-pay-line')).toBeTruthy();
    expect(screen.queryByTestId('checkout-guarantee')).toBeNull();
    await fireEvent.press(payButton());
    expect(onPay).toHaveBeenCalledWith(expect.objectContaining({ mode: 'each_pays_responsible', kind: 'half', losersPay: true }));
  });

  // QA 24 November, T1 and T2: a hold reads as a hold.
  it('Pay for everyone: the whole pitch is held; Hold €45.50, held until the result', async () => {
    await render(<CheckoutView {...props()} />);
    await fireEvent.press(screen.getByTestId('checkout-kind-half'));
    await fireEvent(screen.getByTestId('checkout-losers-pay'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    const pfe = within(screen.getByTestId('checkout-who-pay-all'));
    expect(pfe.getByText('The whole pitch is held until the result.')).toBeTruthy();
    expect(pfe.queryByText(/team's half/)).toBeNull();
    const bar = within(screen.getByTestId('sticky-action-bar'));
    expect(bar.getByText('Hold €45.50')).toBeTruthy();
    expect(bar.getByText('Held until the result.')).toBeTruthy();
    expect(bar.queryByText('Total')).toBeNull();
    expect(bar.queryByText(/^Pay /)).toBeNull();
  });

  it('Pay for myself: Hold €9.60, held until the result', async () => {
    await render(<CheckoutView {...props()} />);
    await fireEvent.press(screen.getByTestId('checkout-kind-half'));
    await fireEvent(screen.getByTestId('checkout-losers-pay'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('checkout-who-each-pays'));
    const bar = within(screen.getByTestId('sticky-action-bar'));
    expect(bar.getByText('Hold €9.60')).toBeTruthy();
    expect(bar.getByText('Held until the result.')).toBeTruthy();
  });

  it('a normal booking keeps Pay and Total', async () => {
    await render(<CheckoutView {...props()} />);
    await fireEvent.press(screen.getByTestId('checkout-kind-half'));
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    const bar = within(screen.getByTestId('sticky-action-bar'));
    expect(bar.getByText('Pay €22.75')).toBeTruthy();
    expect(bar.getByText('Total')).toBeTruthy();
  });

  it('off: a normal half pitch, and no losersPay sent', async () => {
    const onPay = jest.fn();
    await render(<CheckoutView {...props(checkoutDataFixture(), { onPay })} />);
    await fireEvent.press(screen.getByTestId('checkout-kind-half'));
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    expect(within(screen.getByTestId('checkout-who-pay-all')).getByText('€22.75')).toBeTruthy();
    await fireEvent.press(payButton());
    expect(onPay.mock.calls[0][0].losersPay).toBeUndefined();
  });
});
