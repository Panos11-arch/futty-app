import { act, renderHook, waitFor } from '@testing-library/react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';

import type { PaymentSheet } from '@/lib/booking-checkout';

import {
  CARD_SAVED_MESSAGE,
  debtBlockMessage,
  debtReasonLabel,
  describeOwedError,
  expiryLabel,
  holdLabel,
  owedAction,
  owedBannerMessage,
  owedItemKey,
  owedToName,
  owedWhen,
  PAYMENT_NOT_FOUND_MESSAGE,
  PAYMENT_SENT_MESSAGE,
  payOwed,
  payOwedItem,
  paymentActionLabel,
  paymentAmountCents,
  paymentSentence,
  updateGuaranteeCard,
  useCredit,
  useDebtBlock,
  useOwed,
  usePayOwed,
  useReloadOnReturn,
  type Owed,
  type OwedItem,
  type OwedPayment,
  type VenueCredit,
} from './use-owed';

// useFocusEffect: runs the callback on mount (the first focus); a test calls
// mockFocus.current() to come back to the screen.
const mockFocus: { current: (() => void) | null } = { current: null };
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    mockFocus.current = cb;
    useEffect(() => {
      cb();
    }, [cb]);
  },
}));

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

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
      kind: 'payment_due',
      booking_id: 'b3',
      share_id: 's3',
      venue_name: 'Lefkothea',
      booking_day: '2026-11-14',
      start_time: '19:00:00',
      amount_cents: 580,
    },
  ],
};

const cardFailed: OwedPayment = {
  kind: 'card_failed',
  booking_id: 'b5',
  share_id: null,
  venue_name: 'Lefkothea',
  booking_day: '2026-11-15',
  start_time: '18:00:00',
  amount_cents: 6000,
};

const cashUnpaid: OwedPayment = {
  kind: 'cash_unpaid',
  booking_id: 'b4',
  share_id: 's4',
  venue_name: 'Nuevo Campo',
  booking_day: '2026-11-11',
  start_time: '20:00:00',
  amount_cents: 600,
};

const credit: VenueCredit[] = [
  {
    venue_id: 'v1',
    venue_name: 'Nuevo Campo',
    available_cents: 1100,
    credits: [{ credit_id: 'c1', remaining_cents: 1100, expires_at: '2027-11-11T22:30:00Z' }],
  },
];

function sheet(present: Awaited<ReturnType<PaymentSheet['present']>> = {}): PaymentSheet & {
  init: jest.Mock;
  present: jest.Mock;
} {
  return { init: jest.fn(async () => ({})), present: jest.fn(async () => present) };
}

beforeEach(() => {
  mockRpc.mockReset();
  mockInvoke.mockReset();
});

describe('useOwed (contract 6)', () => {
  it('returns my_owed exactly as the server sent it', async () => {
    mockRpc.mockResolvedValue({ data: owed, error: null });
    const { result } = await renderHook(() => useOwed());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mockRpc).toHaveBeenCalledWith('my_owed');
    expect(result.current.state).toEqual({ status: 'ready', data: owed });
  });

  it('reports an error when my_owed fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not_authenticated' } });
    const { result } = await renderHook(() => useOwed());
    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });
});

describe('useCredit', () => {
  it('returns my_credit exactly as the server sent it', async () => {
    mockRpc.mockResolvedValue({ data: credit, error: null });
    const { result } = await renderHook(() => useCredit());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: credit }));
    expect(mockRpc).toHaveBeenCalledWith('my_credit');
  });

  it('no credit is an empty list', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = await renderHook(() => useCredit());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: [] }));
  });
});

describe('words', () => {
  it('names who the debt is owed to', () => {
    expect(owedToName(owed.debts[0])).toBe('Nuevo Campo');
    expect(owedToName(owed.debts[1])).toBe('Futty');
  });

  it('puts each reason into words', () => {
    expect(debtReasonLabel('cancellation_fee')).toBe('Charge for cancelling the whole team');
    expect(debtReasonLabel('unpaid_share')).toBe('Your share was never paid');
  });

  it('the Book banner shows the server’s total only when blocked (1360 -> €13.60)', () => {
    expect(debtBlockMessage(owed)).toBe('You owe €13.60. Pay it before booking.');
    expect(debtBlockMessage({ ...owed, blocked: false })).toBeNull();
  });

  it('without a debt, the Home banner uses the soonest payment’s own neutral sentence', () => {
    const noDebt: Owed = { ...owed, blocked: false, debt_cents: 0, debts: [] };
    expect(owedBannerMessage(noDebt)).toBe('Your share isn’t paid yet.');
    expect(owedBannerMessage({ ...noDebt, payments: [cardFailed] })).toBe(paymentSentence('card_failed'));
    expect(owedBannerMessage({ ...noDebt, payments: [] })).toBeNull();
  });

  it('a share not paid yet says only that, never that a payment failed or the spot is at risk', () => {
    expect(paymentSentence('payment_due')).toBe('Your share isn’t paid yet.');
  });

  it('unticked cash: words true in both modes (no debt, no booker charge promised)', () => {
    const words = paymentSentence('cash_unpaid');
    expect(words).toBe('Cash for your spot wasn’t ticked as paid. You can pay it by card now.');
    expect(words).not.toMatch(/debt|charged/i);
  });

  it('a failed guarantee: the booking stays on (spec 13: a failed hold never cancels it)', () => {
    expect(paymentSentence('card_failed')).toBe(
      'Your guarantee card was declined. Update it so the hold can be retried. Your booking stays on.',
    );
  });

  it('a failed guarantee’s amount is labelled as the hold, never as money owed (6000 -> Hold: €60.00)', () => {
    expect(holdLabel(cardFailed)).toBe('Hold: €60.00');
    expect(paymentAmountCents(cardFailed)).toBeNull();
    expect(holdLabel({ kind: 'card_failed', amount_cents: null })).toBeNull();
    expect(holdLabel({ kind: 'cash_unpaid', amount_cents: 600 })).toBeNull();
    expect(paymentAmountCents({ kind: 'cash_unpaid', amount_cents: 600 })).toBe(600);
    expect(paymentAmountCents({ kind: 'payment_due', amount_cents: 580 })).toBe(580);
  });

  it('labels each payment’s button with the server’s amount', () => {
    expect(paymentActionLabel({ kind: 'payment_due', amount_cents: 580 })).toBe('Pay €5.80');
    expect(paymentActionLabel({ kind: 'cash_unpaid', amount_cents: 600 })).toBe('Pay €6.00 by card');
    expect(paymentActionLabel({ kind: 'cash_unpaid', amount_cents: null })).toBe('Pay by card');
    expect(paymentActionLabel({ kind: 'card_failed', amount_cents: 6000 })).toBe('Update card');
  });

  describe.each(['America/New_York', 'Asia/Tokyo', 'UTC'])('with the phone in %s', (zone) => {
    const original = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = zone;
    });
    afterAll(() => {
      process.env.TZ = original;
    });

    it('shows the expiry as the Cyprus date', () => {
      // 22:30 UTC on 11 Nov is 00:30 on 12 Nov in Cyprus.
      expect(expiryLabel('2027-11-11T22:30:00Z')).toBe('Expires 12 Nov 2027');
    });

    it('shows a payment’s game in Cyprus time', () => {
      expect(owedWhen(owed.payments[0])).toBe('Sat 14 Nov · 19:00');
    });
  });
});

describe('payOwed', () => {
  it('sends only the debt id, and charges exactly what the server returns with no fee', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret', amountCents: 680 }, error: null });
    const s = sheet();
    await expect(payOwed({ debtId: 'd1' }, s)).resolves.toEqual({ status: 'paid' });
    expect(mockInvoke).toHaveBeenCalledWith('pay-owed', { body: { debtId: 'd1' } });
    expect(s.init).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentClientSecret: 'pi_secret' }));
    // The app never sends an amount or a fee.
    const body = mockInvoke.mock.calls[0][1].body;
    expect(Object.keys(body)).toEqual(['debtId']);
  });

  it('pays an unticked cash part by its share', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret', amountCents: 600 }, error: null });
    await payOwed({ shareId: 's9' }, sheet());
    expect(mockInvoke).toHaveBeenCalledWith('pay-owed', { body: { shareId: 's9' } });
  });

  it('closing the sheet is a cancel, not an error', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret' }, error: null });
    await expect(payOwed({ debtId: 'd1' }, sheet({ error: { code: 'Canceled', message: 'x' } }))).resolves.toEqual({
      status: 'cancelled',
    });
  });

  it('puts the server’s refusal into words', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('debt_settled') });
    const s = sheet();
    await expect(payOwed({ debtId: 'd1' }, s)).resolves.toEqual({
      status: 'error',
      message: 'This debt is already settled.',
    });
    expect(s.init).not.toHaveBeenCalled();
  });
});

describe('updateGuaranteeCard', () => {
  it('saves a new card with the server’s SetupIntent', async () => {
    mockInvoke.mockResolvedValue({ data: { setupIntentClientSecret: 'seti_secret' }, error: null });
    const s = sheet();
    await expect(updateGuaranteeCard('b1', s)).resolves.toEqual({ status: 'paid' });
    expect(mockInvoke).toHaveBeenCalledWith('update-guarantee-card', { body: { bookingId: 'b1' } });
    expect(s.init).toHaveBeenCalledWith(expect.objectContaining({ setupIntentClientSecret: 'seti_secret' }));
  });

  it('puts the server’s refusal into words', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('guarantee_closed') });
    await expect(updateGuaranteeCard('b1', sheet())).resolves.toEqual({
      status: 'error',
      message: 'This guarantee can no longer be changed.',
    });
  });
});

describe('describeOwedError: no raw code reaches the player', () => {
  // Every refusal pay-owed and update-guarantee-card can send: their own
  // codes, the SQL functions they call, and their plain-text 401/400 bodies.
  const payOwedCodes = [
    'debt_or_share_required',
    'already_paid',
    'debt_not_found',
    'not_your_debt',
    'debt_settled',
    'debt_changed',
    'share_not_found',
    'not_your_share',
    'not_cash',
    'share_not_paid',
    'cash_already_paid',
    'booking_cancelled',
    'collection_started',
    'match_not_over',
    'share_changed',
  ];
  const guaranteeCardCodes = [
    'invalid_request',
    'not_found',
    'not_your_booking',
    'booking_cancelled',
    'no_guarantee_to_update',
    'guarantee_closed',
    'no_saved_card',
  ];
  const plainText = ['Unauthorized', 'Invalid JSON body'];

  it.each([...payOwedCodes, ...guaranteeCardCodes, ...plainText])('%s is a plain sentence', (code) => {
    const words = describeOwedError(code);
    expect(words).not.toBe(code);
    expect(words).not.toMatch(/_/);
    expect(words).toMatch(/^[A-Z].*\.$/);
  });

  it('an unknown code becomes a generic sentence, not the code', () => {
    expect(describeOwedError('something_new')).toBe('Something went wrong. Try again.');
    expect(describeOwedError('')).toBe('Something went wrong. Try again.');
  });

  it('reads the code from the function’s JSON body', async () => {
    const response = new Response(JSON.stringify({ error: 'no_saved_card' }), { status: 409 });
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) });
    await expect(updateGuaranteeCard('b1', sheet())).resolves.toEqual({
      status: 'error',
      message: 'There’s no saved card on this booking to replace. Contact support.',
    });
  });

  it('a missing client secret is a generic error', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await expect(payOwed({ debtId: 'd1' }, sheet())).resolves.toEqual({
      status: 'error',
      message: 'Something went wrong. Try again.',
    });
  });
});

describe('what tapping an item does', () => {
  const debtItem: OwedItem = { type: 'debt', debt: owed.debts[0] };
  const dueItem: OwedItem = { type: 'payment', payment: owed.payments[0] };
  const cardItem: OwedItem = { type: 'payment', payment: cardFailed };
  const cashItem: OwedItem = { type: 'payment', payment: cashUnpaid };
  const cashNoShare: OwedItem = { type: 'payment', payment: { ...cashUnpaid, share_id: null } };

  it('maps each item to its action', () => {
    expect(owedAction(debtItem)).toEqual({ type: 'pay', target: { debtId: 'd1' } });
    expect(owedAction(dueItem)).toEqual({ type: 'open_pay_share', bookingId: 'b3' });
    expect(owedAction(cardItem)).toEqual({ type: 'update_card', bookingId: 'b5' });
    expect(owedAction(cashItem)).toEqual({ type: 'pay', target: { shareId: 's4' } });
    expect(owedAction(cashNoShare)).toEqual({ type: 'not_found' });
  });

  it('keys items stably', () => {
    expect(owedItemKey(debtItem)).toBe('debt:d1');
    expect(owedItemKey(cardItem)).toBe('card_failed:b5:');
    expect(owedItemKey(cashItem)).toBe('cash_unpaid:b4:s4');
  });

  it('a share not paid yet opens Pay my share, priced there, and calls nothing', async () => {
    const open = jest.fn();
    await expect(payOwedItem(dueItem, sheet(), open)).resolves.toEqual({ status: 'opened' });
    expect(open).toHaveBeenCalledWith('b3');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('a debt is paid by its id, then says it clears once Stripe confirms', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret' }, error: null });
    await expect(payOwedItem(debtItem, sheet(), jest.fn())).resolves.toEqual({
      status: 'paid',
      message: PAYMENT_SENT_MESSAGE,
    });
    expect(mockInvoke).toHaveBeenCalledWith('pay-owed', { body: { debtId: 'd1' } });
  });

  it('unticked cash is paid by its share', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret' }, error: null });
    await payOwedItem(cashItem, sheet(), jest.fn());
    expect(mockInvoke).toHaveBeenCalledWith('pay-owed', { body: { shareId: 's4' } });
  });

  it('a failed guarantee saves a new card, then says the hold is retried', async () => {
    mockInvoke.mockResolvedValue({ data: { setupIntentClientSecret: 'seti_secret' }, error: null });
    await expect(payOwedItem(cardItem, sheet(), jest.fn())).resolves.toEqual({
      status: 'paid',
      message: CARD_SAVED_MESSAGE,
    });
    expect(mockInvoke).toHaveBeenCalledWith('update-guarantee-card', { body: { bookingId: 'b5' } });
  });

  it('a cash row without a share is an error, and calls nothing', async () => {
    await expect(payOwedItem(cashNoShare, sheet(), jest.fn())).resolves.toEqual({
      status: 'error',
      message: PAYMENT_NOT_FOUND_MESSAGE,
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  describe('usePayOwed', () => {
    it('marks the item paying, then shows the message and reloads my_owed', async () => {
      let resolve!: (v: unknown) => void;
      mockInvoke.mockReturnValue(new Promise((r) => (resolve = r)));
      const reload = jest.fn();
      const s = sheet();
      const { result } = await renderHook(() => usePayOwed({ sheet: s, openPayShare: jest.fn(), reload }));
      let done!: Promise<unknown>;
      await act(async () => {
        done = result.current.pay(debtItem);
      });
      expect(result.current.payingKey).toBe('debt:d1');
      await act(async () => {
        resolve({ data: { clientSecret: 'pi_secret' }, error: null });
        await done;
      });
      expect(result.current.payingKey).toBeNull();
      expect(result.current.message).toEqual({ tone: 'info', text: PAYMENT_SENT_MESSAGE });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('a refusal shows as danger and reloads my_owed', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: new Error('debt_settled') });
      const reload = jest.fn();
      const s = sheet();
      const { result } = await renderHook(() => usePayOwed({ sheet: s, openPayShare: jest.fn(), reload }));
      await act(async () => {
        await result.current.pay(debtItem);
      });
      expect(result.current.message).toEqual({ tone: 'danger', text: 'This debt is already settled.' });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('closing the sheet changes nothing', async () => {
      mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret' }, error: null });
      const reload = jest.fn();
      const s = sheet({ error: { code: 'Canceled', message: 'x' } });
      const { result } = await renderHook(() => usePayOwed({ sheet: s, openPayShare: jest.fn(), reload }));
      await act(async () => {
        await result.current.pay(debtItem);
      });
      expect(result.current.message).toBeNull();
      expect(result.current.payingKey).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });

    it('a share not paid yet only opens Pay my share', async () => {
      const reload = jest.fn();
      const openPayShare = jest.fn();
      const s = sheet();
      const { result } = await renderHook(() => usePayOwed({ sheet: s, openPayShare, reload }));
      await act(async () => {
        await result.current.pay(dueItem);
      });
      expect(openPayShare).toHaveBeenCalledWith('b3');
      expect(result.current.payingKey).toBeNull();
      expect(result.current.message).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });
  });
});

describe('Book’s debt block', () => {
  it('blocks with the server’s total when my_owed says blocked (1360 -> €13.60)', async () => {
    mockRpc.mockResolvedValue({ data: owed, error: null });
    const { result } = await renderHook(() => useDebtBlock());
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current.message).toBe('You owe €13.60. Pay it before booking.');
  });

  it('a payment to finish alone doesn’t block booking', async () => {
    mockRpc.mockResolvedValue({ data: { ...owed, blocked: false, debt_cents: 0, debts: [] }, error: null });
    const { result } = await renderHook(() => useDebtBlock());
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(result.current).toEqual({ message: null, blocked: false });
  });

  it('checks my_owed again on return from "Pay what I owe", and unblocks once paid', async () => {
    mockRpc.mockResolvedValueOnce({ data: owed, error: null });
    const { result } = await renderHook(() => useDebtBlock());
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(mockRpc).toHaveBeenCalledTimes(1);
    mockRpc.mockResolvedValueOnce({ data: { blocked: false, debt_cents: 0, debts: [], payments: [] }, error: null });
    await act(async () => {
      mockFocus.current!();
    });
    await waitFor(() => expect(result.current.blocked).toBe(false));
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

describe('useReloadOnReturn', () => {
  it('reloads on each return, not on the first focus, and only while asked to', async () => {
    const reload = jest.fn();
    const { rerender } = await renderHook(({ when }: { when: boolean }) => useReloadOnReturn(reload, when), {
      initialProps: { when: true },
    });
    expect(reload).not.toHaveBeenCalled();
    await act(async () => {
      mockFocus.current!();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    await rerender({ when: false });
    await act(async () => {
      mockFocus.current!();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
