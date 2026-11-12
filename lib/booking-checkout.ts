// What happens when the player taps Pay (P5). The server prices everything:
// book_slot makes the booking and the booker's share from the venue's data,
// create-share-payment makes the Stripe payment for exactly that share. The
// app sends only the player's choices (mode, card or cash, credit, the
// non-refundable acceptance) and never an amount. The share changes state
// only when Stripe's verified webhook says the money was held or taken.
import { bookSlot, type PaymentMode } from '@/lib/booking-actions';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { createSharePayment, listBookingShares, type SharePaymentOptions } from '@/lib/booking-shares';
import type { Slot } from '@/lib/booking-search';
import { describeFunctionError } from '@/lib/edge-functions';
import { walletPayOptions } from '@/lib/wallet-pay';

/** Stripe's payment sheet (usePaymentSheet), passed in so tests need no Stripe. */
type IntentSecret =
  | { paymentIntentClientSecret: string; setupIntentClientSecret?: undefined }
  | { setupIntentClientSecret: string; paymentIntentClientSecret?: undefined };

export type PaymentSheet = {
  init: (params: IntentSecret & { merchantDisplayName: string } & typeof walletPayOptions) => Promise<{ error?: { message: string } }>;
  present: () => Promise<{ error?: { code: string; message: string } }>;
};

export type PayOptions = Required<SharePaymentOptions>;

export type PayOutcome = { status: 'paid' } | { status: 'cancelled' } | { status: 'error'; message: string };

/** Errors after which the booking is gone: the next Pay books again. */
const BOOKING_GONE = new Set(['payment_window_closed', 'booking_cancelled']);

/** Pays one share: asks the server for the payment, then shows the sheet
 *  (Apple Pay / Google Pay on top, the card form below). */
export async function payShare(shareId: string, pay: PayOptions, sheet: PaymentSheet): Promise<PayOutcome & { code?: string }> {
  const { data, error } = await createSharePayment(shareId, pay);
  if (error || !data) {
    const code = error ? await describeFunctionError(error) : 'Something went wrong.';
    return { status: 'error', message: describeBookingErrorMessage(code), code };
  }
  if (!data.clientSecret && !data.setupIntentClientSecret) return { status: 'paid' };

  const secret: IntentSecret = data.clientSecret
    ? { paymentIntentClientSecret: data.clientSecret }
    : { setupIntentClientSecret: data.setupIntentClientSecret! };
  const { error: initError } = await sheet.init({ merchantDisplayName: 'Futty', ...walletPayOptions, ...secret });
  if (initError) return { status: 'error', message: initError.message };

  const { error: presentError } = await sheet.present();
  if (presentError) {
    return presentError.code === 'Canceled' ? { status: 'cancelled' } : { status: 'error', message: presentError.message };
  }
  return { status: 'paid' };
}

/** Books the slot with the chosen mode (once: a retry passes the booking it
 *  already made) and pays the booker's own share. The booking is returned
 *  for the next retry, or null when there is none to retry. */
export async function payForSlot(
  { slot, mode, pay, bookingId }: { slot: Slot; mode: PaymentMode; pay: PayOptions; bookingId: string | null },
  sheet: PaymentSheet,
): Promise<PayOutcome & { bookingId: string | null }> {
  let id = bookingId;
  if (!id) {
    const { data, error } = await bookSlot({ ...slot, mode });
    if (error || !data) {
      return { status: 'error', message: describeBookingErrorMessage(error?.message ?? 'Could not create the booking.'), bookingId: null };
    }
    const booking = data as unknown as { id: string; amount_cents: number };
    // A free venue: confirmed at once, nothing to pay.
    if (booking.amount_cents === 0) return { status: 'paid', bookingId: booking.id };
    id = booking.id;
  }

  const { data: shares, error: sharesError } = await listBookingShares(id);
  if (sharesError) return { status: 'error', message: describeBookingErrorMessage(sharesError.message), bookingId: id };
  const mine = ((shares ?? []) as { id: string; is_booker: boolean; status: string }[]).find((s) => s.is_booker);
  if (!mine) return { status: 'error', message: 'Could not find your spot in this booking.', bookingId: id };
  if (mine.status !== 'pending') return { status: 'paid', bookingId: id };

  const outcome = await payShare(mine.id, pay, sheet);
  const gone = outcome.status === 'error' && outcome.code !== undefined && BOOKING_GONE.has(outcome.code);
  const { code: _code, ...rest } = outcome as PayOutcome & { code?: string };
  return { ...rest, bookingId: gone ? null : id };
}
