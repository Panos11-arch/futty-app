// What the player owes and their venue credit (P5c; spec 13 "Cash, debt and
// venue credit" and "Booking screens"; contract 6 in docs/specs/06-coding.md).
//
// Everything comes from the server: my_owed() for debts and payments that
// didn't go through, my_credit() for credit per venue. This file only picks
// the server's fields and puts them into words. It never adds, splits or
// works out an amount: a total shown is the server's debt_cents.
//
// Paying: pay-owed charges exactly one debt (or one unticked cash part) for
// the amount in the database, with no fee added (Futty absorbs Stripe's
// cost). update-guarantee-card replaces the card behind a booker's failed
// guarantee. Either way the debt or payment clears only when Stripe's
// verified webhook says so, so the app never says "cleared" itself.
import type { PaymentSheet, PayOutcome } from '@/lib/booking-checkout';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { useLoad } from '@/lib/booking-search';
import { cyprusWallTime, CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import { describeFunctionError } from '@/lib/edge-functions';
import { formatMatchWhen } from '@/lib/match/format';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';
import { walletPayOptions } from '@/lib/wallet-pay';

// ---- What the server returns -----------------------------------------------

/** Why a debt exists (public.venue_debts.reason). */
export type DebtReason = 'unpaid_share' | 'cash_unpaid' | 'top_up_failed' | 'guarantee_not_held' | 'cancellation_fee';

/** One unsettled debt, to a venue or to Futty. */
export type OwedDebt = {
  debt_id: string;
  owed_to: 'venue' | 'futty';
  venue_id: string | null;
  venue_name: string | null;
  booking_id: string;
  amount_cents: number;
  reason: DebtReason;
  created_at: string;
};

/** A payment that didn't go through, before it became a debt:
 *  card_failed   the booker's guarantee card failed (before kickoff)
 *  payment_due   the player's share isn't paid (before kickoff)
 *  cash_unpaid   cash the venue hasn't ticked, after the match and before
 *                collection ("Pay €6.00 by card now, or …") */
export type OwedPayment = {
  kind: 'card_failed' | 'payment_due' | 'cash_unpaid';
  booking_id: string;
  share_id: string | null;
  venue_name: string;
  booking_day: string;
  start_time: string;
  amount_cents: number | null;
};

/** my_owed(). `blocked`: any debt, which blocks booking everywhere. */
export type Owed = {
  blocked: boolean;
  debt_cents: number;
  debts: OwedDebt[];
  payments: OwedPayment[];
};

/** One venue in my_credit(): what can be spent there now, and each credit
 *  with its expiry (soonest first). */
export type VenueCredit = {
  venue_id: string;
  venue_name: string;
  available_cents: number;
  credits: { credit_id: string; remaining_cents: number; expires_at: string }[];
};

// ---- Loading ---------------------------------------------------------------

export async function fetchOwed(): Promise<Owed> {
  const { data, error } = await supabase.rpc('my_owed');
  if (error) throw new Error(describeBookingErrorMessage(error.message));
  return data as Owed;
}

export async function fetchCredit(): Promise<VenueCredit[]> {
  const { data, error } = await supabase.rpc('my_credit');
  if (error) throw new Error(describeBookingErrorMessage(error.message));
  return (data ?? []) as VenueCredit[];
}

/** Contract 6: what the player owes and any failed payment, as the server
 *  says. `state` is loading, error or ready with my_owed's data. */
export function useOwed() {
  return useLoad('my_owed', fetchOwed);
}

/** The player's credit per venue, as my_credit says. */
export function useCredit() {
  return useLoad('my_credit', fetchCredit);
}

/** True when there's anything to show: a debt or a payment to finish. */
export function hasAnythingOwed(owed: Owed): boolean {
  return owed.debts.length > 0 || owed.payments.length > 0;
}

// ---- Words -----------------------------------------------------------------

const REASONS: Record<DebtReason, string> = {
  unpaid_share: 'Your share was never paid',
  cash_unpaid: 'Cash not paid at the venue',
  top_up_failed: 'The short-game top-up was declined',
  guarantee_not_held: 'Your guarantee card was declined',
  cancellation_fee: 'Charge for cancelling the whole team',
};

/** "Nuevo Campo" or "Futty". */
export function owedToName(debt: Pick<OwedDebt, 'owed_to' | 'venue_name'>): string {
  return debt.owed_to === 'futty' ? 'Futty' : (debt.venue_name ?? 'The venue');
}

export function debtReasonLabel(reason: DebtReason): string {
  return REASONS[reason] ?? 'Unpaid';
}

/** "Sat 14 Nov · 19:00", in Cyprus time. */
export function owedWhen(payment: Pick<OwedPayment, 'booking_day' | 'start_time'>): string {
  return formatMatchWhen(cyprusWallTime(payment.booking_day, payment.start_time).toISOString());
}

const PAYMENT_WORDS: Record<OwedPayment['kind'], string> = {
  card_failed: 'Your guarantee card was declined. Update it to keep the booking.',
  payment_due: "Your payment didn't go through. Pay to keep your spot.",
  cash_unpaid: 'The venue hasn’t marked your cash as paid. Pay by card now, or it becomes a debt to the venue.',
};

export function paymentSentence(kind: OwedPayment['kind']): string {
  return PAYMENT_WORDS[kind];
}

/** The button on a payment row: "Update card", "Pay €6.80". */
export function paymentActionLabel(payment: Pick<OwedPayment, 'kind' | 'amount_cents'>): string {
  if (payment.kind === 'card_failed') return 'Update card';
  if (payment.kind === 'payment_due') return payment.amount_cents !== null ? `Pay ${formatEuros(payment.amount_cents)}` : 'Pay my share';
  return payment.amount_cents !== null ? `Pay ${formatEuros(payment.amount_cents)} by card` : 'Pay by card';
}

const expiryFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "Expires 12 Nov 2027", the Cyprus date. */
export function expiryLabel(expiresAt: string): string {
  return `Expires ${expiryFormat.format(new Date(expiresAt))}`;
}

/** Book's banner: only when my_owed says the player is blocked by debt
 *  (spec 13, "Debt"). The amount is the server's debt_cents. */
export function debtBlockMessage(owed: Owed): string | null {
  if (!owed.blocked) return null;
  return owed.debt_cents > 0
    ? `You owe ${formatEuros(owed.debt_cents)}. Pay it before booking.`
    : 'You owe money. Pay it before booking.';
}

/** The banner for anything owed (Book uses it when blocked; Home can too).
 *  The amount is the server's debt_cents. Null when nothing is owed. */
export function owedBannerMessage(owed: Owed): string | null {
  const blocking = debtBlockMessage(owed);
  if (blocking) return blocking;
  if (owed.payments.length > 0) return "A payment didn't go through. Pay it to keep your spot.";
  return null;
}

// ---- Paying ----------------------------------------------------------------

/** What to pay: one debt, or one unticked cash part (by its share). */
export type OwedTarget = { debtId: string } | { shareId: string };

const ERRORS: Record<string, string> = {
  debt_settled: 'This debt is already settled.',
  already_paid: 'This is already being paid.',
  debt_changed: 'This debt just changed. Try again.',
  debt_not_found: 'This debt could not be found.',
  share_not_found: 'This payment could not be found.',
  not_your_debt: 'This debt isn’t yours.',
  not_your_share: 'This payment isn’t yours.',
  cash_already_paid: 'The venue has already marked your cash as paid.',
  booking_cancelled: 'This booking was cancelled.',
  no_guarantee_to_update: 'This booking has no guarantee card to update.',
  guarantee_closed: 'This guarantee can no longer be changed.',
};

export function describeOwedError(code: string): string {
  return ERRORS[code] ?? describeBookingErrorMessage(code);
}

type OwedPaymentResponse = { clientSecret?: string | null; amountCents?: number };
type GuaranteeCardResponse = { setupIntentClientSecret?: string | null };

async function present(
  secret: { paymentIntentClientSecret: string } | { setupIntentClientSecret: string },
  sheet: PaymentSheet,
): Promise<PayOutcome> {
  const { error: initError } = await sheet.init({ merchantDisplayName: 'Futty', ...walletPayOptions, ...secret });
  if (initError) return { status: 'error', message: initError.message };
  const { error } = await sheet.present();
  if (error) return error.code === 'Canceled' ? { status: 'cancelled' } : { status: 'error', message: error.message };
  return { status: 'paid' };
}

/** Pays one debt or cash part. The app sends only the id: pay-owed charges
 *  exactly what the database says is owed, with no fee. */
export async function payOwed(target: OwedTarget, sheet: PaymentSheet): Promise<PayOutcome> {
  const { data, error } = await supabase.functions.invoke<OwedPaymentResponse>('pay-owed', { body: target });
  if (error || !data?.clientSecret) {
    const code = error ? await describeFunctionError(error) : 'Something went wrong.';
    return { status: 'error', message: describeOwedError(code) };
  }
  return present({ paymentIntentClientSecret: data.clientSecret }, sheet);
}

/** The booker replaces the card behind a failed guarantee. */
export async function updateGuaranteeCard(bookingId: string, sheet: PaymentSheet): Promise<PayOutcome> {
  const { data, error } = await supabase.functions.invoke<GuaranteeCardResponse>('update-guarantee-card', {
    body: { bookingId },
  });
  if (error || !data?.setupIntentClientSecret) {
    const code = error ? await describeFunctionError(error) : 'Something went wrong.';
    return { status: 'error', message: describeOwedError(code) };
  }
  return present({ setupIntentClientSecret: data.setupIntentClientSecret }, sheet);
}
