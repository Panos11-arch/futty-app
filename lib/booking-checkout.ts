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

/** A booker's share that's held ('authorized') or taken ('paid'). */
const PAID_SHARE = new Set(['authorized', 'paid']);

/** Pays one share: asks the server for the payment, then shows the sheet
 *  (Apple Pay / Google Pay on top, the card form below). */
export async function payShare(shareId: string, pay: PayOptions, sheet: PaymentSheet): Promise<PayOutcome & { code?: string }> {
  const { data, error } = await createSharePayment(shareId, pay);
  if (error || !data) {
    const code = error ? await describeFunctionError(error) : 'Something went wrong.';
    // Cash refused for a player in debt (share_payment_plan): card still works.
    if (code === 'player_in_debt' && pay.method === 'cash') {
      return { status: 'error', message: 'Settle what you owe first, or pay by card.', code };
    }
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

/** Errors after which the pitch list is out of date (Booking v2): it's
 *  loaded again, so a pitch taken since is no longer shown. */
const PITCH_GONE = new Set(['pitch_not_free', 'invalid_pitch_choice', 'slot_blocked']);

type SlotChoice = {
  slot: Slot;
  mode: PaymentMode;
  teamId?: string;
  /** Booking v2 (B2): the chosen pitch or combination, and the kind. */
  pitchIds?: string[];
  kind?: 'whole' | 'half';
  /** B1d: Losers pay (a half pitch). */
  losersPay?: boolean;
  pay: PayOptions;
  bookingId: string | null;
};

/** Books the slot with the chosen mode (once: a retry passes the booking it
 *  already made) and pays the booker's own share: in Gipedo Pano, the
 *  captain's hold, for the team they chose. The booking is returned for the
 *  next retry, or null when there is none to retry. pitchTaken: the chosen
 *  pitch was taken meanwhile, so the screen reloads the pitch list. */
export async function payForSlot(
  { slot, mode, teamId, pitchIds, kind, losersPay, pay, bookingId }: SlotChoice,
  sheet: PaymentSheet,
): Promise<PayOutcome & { bookingId: string | null; pitchTaken?: true }> {
  let id = bookingId;
  if (!id) {
    const { data, error } = await bookSlot({
      ...slot,
      mode,
      ...(teamId ? { teamId } : {}),
      ...(pitchIds ? { pitchIds } : {}),
      ...(kind ? { kind } : {}),
      ...(losersPay ? { losersPay } : {}),
    });
    if (error || !data) {
      const code = error?.message ?? 'Could not create the booking.';
      const detail = (error as { details?: string | null } | null)?.details;
      return {
        status: 'error',
        message: describeBookingErrorMessage(code, detail),
        bookingId: null,
        ...(PITCH_GONE.has(code) ? { pitchTaken: true as const } : {}),
      };
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
  // Held or taken: already paid. Any other state (cancelled, refunded) can't
  // be paid, so the next tap books again.
  if (PAID_SHARE.has(mine.status)) return { status: 'paid', bookingId: id };
  if (mine.status !== 'pending') {
    return { status: 'error', message: 'This booking can no longer be paid. Tap Pay to book this time again.', bookingId: null };
  }

  const outcome = await payShare(mine.id, pay, sheet);
  const gone = outcome.status === 'error' && outcome.code !== undefined && BOOKING_GONE.has(outcome.code);
  const { code: _code, ...rest } = outcome as PayOutcome & { code?: string };
  return { ...rest, bookingId: gone ? null : id };
}
