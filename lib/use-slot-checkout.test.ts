import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { PaymentSheet } from './booking-checkout';
import type { Slot } from './booking-search';
import { useSlotCheckout } from './use-slot-checkout';

const mockPayForSlot = jest.fn();
const mockFetchCheckoutData = jest.fn();
const mockFetchFreePitches = jest.fn();
const mockReplace = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();

jest.mock('@/lib/booking-checkout', () => ({ payForSlot: (...a: unknown[]) => mockPayForSlot(...a) }));
jest.mock('@/lib/booking-v2', () => ({
  fetchCheckoutData: (...a: unknown[]) => mockFetchCheckoutData(...a),
  fetchFreePitches: (...a: unknown[]) => mockFetchFreePitches(...a),
}));
jest.mock('expo-router', () => ({ router: { replace: (...a: unknown[]) => mockReplace(...a) } }));
jest.mock('@/lib/haptics', () => ({ haptic: { success: () => mockSuccess(), error: () => mockError() } }));
jest.mock('@/lib/use-owed', () => ({ useReloadOnReturn: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const slot = { venueId: 'v1', day: '2026-11-26', start: '20:00', end: '21:00', format: '5-a-side', playersPerSide: 5 as const };
const sheet: PaymentSheet = { init: jest.fn(), present: jest.fn() };
const choice = {
  mode: 'pay_all' as const,
  kind: 'whole' as const,
  pitchIds: ['p2'],
  pay: { method: 'card' as const, acceptNonRefundable: false, useCredit: false },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchCheckoutData.mockResolvedValue({ quote: { in_debt: false }, credit: null });
  mockFetchFreePitches.mockResolvedValue([]);
});

describe('useSlotCheckout', () => {
  it('nothing loads without a slot', async () => {
    const { result } = await renderHook(() => useSlotCheckout(null, sheet));
    expect(result.current.quote).toEqual({ status: 'loading' });
    expect(mockFetchCheckoutData).not.toHaveBeenCalled();
  });

  it('loads the server\'s quote and free pitches for the slot', async () => {
    const { result } = await renderHook(() => useSlotCheckout(slot, sheet));
    await waitFor(() => expect(result.current.quote.status).toBe('ready'));
    expect(mockFetchCheckoutData).toHaveBeenCalledWith(slot);
    expect(mockFetchFreePitches).toHaveBeenCalledWith(slot);
  });

  it('paid: a success haptic and on to the screen after paying', async () => {
    mockPayForSlot.mockResolvedValue({ status: 'paid', bookingId: 'b1' });
    const { result } = await renderHook(() => useSlotCheckout(slot, sheet));
    await act(async () => {
      await result.current.pay(choice);
    });
    expect(mockPayForSlot).toHaveBeenCalledWith({ slot, ...choice, bookingId: null }, sheet);
    expect(mockSuccess).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/booking-after-pay', params: { bookingId: 'b1', from: 'pay' } });
    expect(result.current.bookingHeld).toBe(true);
  });

  it('an error: the message, an error haptic, the same booking next time, and the pitches again when one was taken', async () => {
    mockPayForSlot.mockResolvedValue({ status: 'error', message: 'Pitch 2 is no longer free. Pick another.', bookingId: 'b1', pitchTaken: true });
    const { result } = await renderHook(() => useSlotCheckout(slot, sheet));
    await waitFor(() => expect(result.current.pitches.status).toBe('ready'));
    await act(async () => {
      await result.current.pay(choice);
    });
    expect(result.current.error).toBe('Pitch 2 is no longer free. Pick another.');
    expect(result.current.paying).toBe(false);
    expect(mockError).toHaveBeenCalled();
    expect(mockFetchFreePitches).toHaveBeenCalledTimes(2);
    mockPayForSlot.mockResolvedValue({ status: 'cancelled', bookingId: 'b1' });
    await act(async () => {
      await result.current.pay(choice);
    });
    expect(mockPayForSlot).toHaveBeenLastCalledWith({ slot, ...choice, bookingId: 'b1' }, sheet);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('another slot (the time changed on the venue page): the held booking and its error are forgotten', async () => {
    mockPayForSlot.mockResolvedValue({ status: 'error', message: 'Card declined.', bookingId: 'b1' });
    const { result, rerender } = await renderHook(({ s }: { s: Slot }) => useSlotCheckout(s, sheet), {
      initialProps: { s: slot as Slot },
    });
    await act(async () => {
      await result.current.pay(choice);
    });
    expect(result.current.bookingHeld).toBe(true);
    const later = { ...slot, start: '21:00', end: '22:00' };
    await rerender({ s: later });
    await waitFor(() => expect(result.current.bookingHeld).toBe(false));
    expect(result.current.error).toBeNull();
    mockPayForSlot.mockResolvedValue({ status: 'cancelled', bookingId: 'b2' });
    await act(async () => {
      await result.current.pay(choice);
    });
    expect(mockPayForSlot).toHaveBeenLastCalledWith({ slot: later, ...choice, bookingId: null }, sheet);
  });
});
