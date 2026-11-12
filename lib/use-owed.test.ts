import { renderHook, waitFor } from '@testing-library/react-native';

import type { PaymentSheet } from '@/lib/booking-checkout';

import {
  debtBlockMessage,
  debtReasonLabel,
  expiryLabel,
  owedBannerMessage,
  owedToName,
  owedWhen,
  payOwed,
  paymentActionLabel,
  updateGuaranteeCard,
  useCredit,
  useOwed,
  type Owed,
  type VenueCredit,
} from './use-owed';

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

  it('the Home banner mentions a failed payment when there is no debt', () => {
    const noDebt: Owed = { ...owed, blocked: false, debt_cents: 0, debts: [] };
    expect(owedBannerMessage(noDebt)).toBe("A payment didn't go through. Pay it to keep your spot.");
    expect(owedBannerMessage({ ...noDebt, payments: [] })).toBeNull();
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
