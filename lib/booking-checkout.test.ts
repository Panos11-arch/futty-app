import { payForSlot, payShare, type PaymentSheet } from './booking-checkout';

const mockBookSlot = jest.fn();
const mockListShares = jest.fn();
const mockCreateSharePayment = jest.fn();
jest.mock('@/lib/booking-actions', () => ({ bookSlot: (...a: unknown[]) => mockBookSlot(...a) }));
jest.mock('@/lib/booking-shares', () => ({
  listBookingShares: (...a: unknown[]) => mockListShares(...a),
  createSharePayment: (...a: unknown[]) => mockCreateSharePayment(...a),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const slot = { venueId: 'v1', day: '2026-11-16', start: '19:00', end: '20:00', format: '5-a-side', playersPerSide: 5 as const };
const card = { method: 'card' as const, acceptNonRefundable: false, useCredit: false };

function sheet(present: Awaited<ReturnType<PaymentSheet['present']>> = {}): PaymentSheet & {
  init: jest.Mock;
  present: jest.Mock;
} {
  return { init: jest.fn().mockResolvedValue({}), present: jest.fn().mockResolvedValue(present) };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockBookSlot.mockResolvedValue({ data: { id: 'b1', amount_cents: 6000 }, error: null });
  mockListShares.mockResolvedValue({
    data: [{ id: 's1', profile_id: 'u1', is_booker: true, status: 'pending', amount_cents: 6550 }],
    error: null,
  });
  mockCreateSharePayment.mockResolvedValue({ data: { clientSecret: 'pi_secret' }, error: null });
});

describe('payForSlot', () => {
  it.each(['pay_all', 'each_pays_responsible', 'each_pays_own_spot'] as const)(
    'books with the chosen mode %s, then pays the booker’s own share',
    async (mode) => {
      const s = sheet();
      const outcome = await payForSlot({ slot, mode, pay: card, bookingId: null }, s);
      expect(mockBookSlot).toHaveBeenCalledWith({ ...slot, mode });
      expect(mockCreateSharePayment).toHaveBeenCalledWith('s1', card);
      expect(s.init).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentClientSecret: 'pi_secret' }));
      expect(outcome).toEqual({ status: 'paid', bookingId: 'b1' });
    },
  );

  it('passes cash, credit and the non-refundable acceptance to the server', async () => {
    const pay = { method: 'cash' as const, acceptNonRefundable: true, useCredit: false };
    await payForSlot({ slot, mode: 'each_pays_own_spot', pay, bookingId: null }, sheet());
    expect(mockCreateSharePayment).toHaveBeenCalledWith('s1', pay);
  });

  it('a retry reuses the booking it already made', async () => {
    await payForSlot({ slot, mode: 'pay_all', pay: card, bookingId: 'b1' }, sheet());
    expect(mockBookSlot).not.toHaveBeenCalled();
    expect(mockListShares).toHaveBeenCalledWith('b1');
  });

  it('closing the sheet keeps the booking for a retry', async () => {
    const outcome = await payForSlot({ slot, mode: 'pay_all', pay: card, bookingId: null }, sheet({ error: { code: 'Canceled', message: 'x' } }));
    expect(outcome).toEqual({ status: 'cancelled', bookingId: 'b1' });
  });

  it('a refused booking shows the server’s reason and keeps no booking', async () => {
    mockBookSlot.mockResolvedValue({ data: null, error: { message: 'slot_full' } });
    const outcome = await payForSlot({ slot, mode: 'pay_all', pay: card, bookingId: null }, sheet());
    expect(outcome).toEqual({ status: 'error', message: expect.stringMatching(/filled up/), bookingId: null });
  });

  it('a closed payment window drops the booking so the next tap books again', async () => {
    mockCreateSharePayment.mockResolvedValue({ data: null, error: new Error('payment_window_closed') });
    const outcome = await payForSlot({ slot, mode: 'pay_all', pay: card, bookingId: 'b1' }, sheet());
    expect(outcome).toMatchObject({ status: 'error', bookingId: null });
  });

  it.each(['authorized', 'paid'])('a booker share already %s counts as paid', async (status) => {
    mockListShares.mockResolvedValue({ data: [{ id: 's1', is_booker: true, status }], error: null });
    const s = sheet();
    expect(await payForSlot({ slot, mode: 'pay_all', pay: card, bookingId: 'b1' }, s)).toEqual({ status: 'paid', bookingId: 'b1' });
    expect(mockCreateSharePayment).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'refunded', 'covered'])('a booker share that is %s is an error and stays on checkout', async (status) => {
    mockListShares.mockResolvedValue({ data: [{ id: 's1', is_booker: true, status }], error: null });
    const outcome = await payForSlot({ slot, mode: 'pay_all', pay: card, bookingId: 'b1' }, sheet());
    expect(outcome).toEqual({ status: 'error', message: expect.stringMatching(/can no longer be paid/), bookingId: null });
    expect(mockCreateSharePayment).not.toHaveBeenCalled();
  });

  it('a free venue is booked with nothing to pay', async () => {
    mockBookSlot.mockResolvedValue({ data: { id: 'b2', amount_cents: 0 }, error: null });
    const s = sheet();
    expect(await payForSlot({ slot, mode: 'pay_all', pay: card, bookingId: null }, s)).toEqual({ status: 'paid', bookingId: 'b2' });
    expect(s.init).not.toHaveBeenCalled();
  });
});

describe('payShare', () => {
  it('saves the card when there is nothing to charge', async () => {
    mockCreateSharePayment.mockResolvedValue({ data: { setupIntentClientSecret: 'seti_secret' }, error: null });
    const s = sheet();
    expect(await payShare('s1', card, s)).toEqual({ status: 'paid' });
    expect(s.init).toHaveBeenCalledWith(expect.objectContaining({ setupIntentClientSecret: 'seti_secret' }));
  });

  it('shows Stripe’s message when the sheet fails', async () => {
    expect(await payShare('s1', card, sheet({ error: { code: 'Failed', message: 'Card declined' } }))).toEqual({
      status: 'error',
      message: 'Card declined',
    });
  });
});

describe('payForSlot: Gipedo Pano (P8)', () => {
  it('books for the chosen team, then holds the captain’s card', async () => {
    const s = sheet();
    const outcome = await payForSlot({ slot, mode: 'gipedo_pano', teamId: 't1', pay: card, bookingId: null }, s);
    expect(mockBookSlot).toHaveBeenCalledWith({ ...slot, mode: 'gipedo_pano', teamId: 't1' });
    expect(mockCreateSharePayment).toHaveBeenCalledWith('s1', card);
    expect(outcome).toEqual({ status: 'paid', bookingId: 'b1' });
  });
});
