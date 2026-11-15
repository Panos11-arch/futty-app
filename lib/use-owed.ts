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
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

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

/** A payment to finish, before it became a debt:
 *  card_failed   the booker's guarantee card failed (before kickoff);
 *                amount_cents is the hold, not money owed
 *  payment_due   the player's share isn't paid yet (before kickoff)
 *  cash_unpaid   cash the venue hasn't ticked, after the match and before
 *                collection */
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

/** Calls `reload` each time the screen comes back into focus (not on the
 *  first focus, which loads anyway), while `when` is true. For screens that
 *  link to "Pay what I owe" and must check the debt again on return. */
export function useReloadOnReturn(reload: () => void, when = true) {
  const focusedOnce = useRef(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const whenRef = useRef(when);
  whenRef.current = when;
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current && whenRef.current) reloadRef.current();
      focusedOnce.current = true;
    }, []),
  );
}

/** Book's debt block (spec 13, "Debt"): the banner's words when my_owed says
 *  the player is blocked, else null (also while loading or on error, when
 *  book_slot still refuses a debtor). Checks again on return to the screen. */
export function useDebtBlock(): { message: string | null; blocked: boolean } {
  const owed = useOwed();
  useReloadOnReturn(owed.reload);
  // Only debt blocks booking; a payment to finish doesn't.
  const message = owed.state.status === 'ready' ? debtBlockMessage(owed.state.data) : null;
  return { message, blocked: message !== null };
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

// True in every booking mode. Spec 13's own cash wording ("…or [booker]
// will be charged for your spot" / "…or remain in debt to [venue]") needs
// my_owed to return the booking's payment_mode and booker name first.
const PAYMENT_WORDS: Record<OwedPayment['kind'], string> = {
  card_failed: 'Your guarantee card was declined. Update it so the hold can be retried. Your booking stays on.',
  payment_due: 'Your share isn’t paid yet.',
  cash_unpaid: 'Cash for your spot wasn’t ticked as paid. You can pay it by card now.',
};

export function paymentSentence(kind: OwedPayment['kind']): string {
  return PAYMENT_WORDS[kind];
}

/** The amount shown on a payment row as money to pay: never a guarantee's
 *  hold, which isn't owed. */
export function paymentAmountCents(payment: Pick<OwedPayment, 'kind' | 'amount_cents'>): number | null {
  return payment.kind === 'card_failed' ? null : payment.amount_cents;
}

/** "Hold: €60.00" for a failed guarantee, the server's hold amount. */
export function holdLabel(payment: Pick<OwedPayment, 'kind' | 'amount_cents'>): string | null {
  if (payment.kind !== 'card_failed' || payment.amount_cents === null) return null;
  return `Hold: ${formatEuros(payment.amount_cents)}`;
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
 *  The amount is the server's debt_cents. Without a debt, the sentence of
 *  the soonest payment to finish (my_owed lists them by kickoff). Null when
 *  nothing is owed. */
export function owedBannerMessage(owed: Owed): string | null {
  const blocking = debtBlockMessage(owed);
  if (blocking) return blocking;
  const first = owed.payments[0];
  return first ? paymentSentence(first.kind) : null;
}

// ---- Paying ----------------------------------------------------------------

/** One thing on "Pay what I owe" that can be paid. */
export type OwedItem = { type: 'debt'; debt: OwedDebt } | { type: 'payment'; payment: OwedPayment };

/** A stable key for an item, so the screen knows which one is paying. */
export function owedItemKey(item: OwedItem): string {
  return item.type === 'debt'
    ? `debt:${item.debt.debt_id}`
    : `${item.payment.kind}:${item.payment.booking_id}:${item.payment.share_id ?? ''}`;
}

/** What to pay: one debt, or one unticked cash part (by its share). */
export type OwedTarget = { debtId: string } | { shareId: string };

const GENERIC_ERROR = 'Something went wrong. Try again.';

// Every refusal pay-owed and update-guarantee-card can send (their own codes,
// the SQL functions they call, and the plain-text 401/400 bodies).
const ERRORS: Record<string, string> = {
  // pay-owed
  debt_or_share_required: 'This payment could not be found.',
  already_paid: 'This is already being paid.',
  debt_not_found: 'This debt could not be found.',
  not_your_debt: 'This debt isn’t yours.',
  debt_settled: 'This debt is already settled.',
  debt_changed: 'This debt just changed. Try again.',
  share_not_found: 'This payment could not be found.',
  not_your_share: 'This payment isn’t yours.',
  not_cash: 'This spot isn’t paid in cash, so there’s nothing to pay by card here.',
  share_not_paid: 'This spot’s service fee isn’t paid yet. Pay your share first.',
  cash_already_paid: 'The venue has already marked your cash as paid.',
  collection_started: 'Collection for this game has already run, so this can no longer be paid here.',
  match_not_over: 'This can be paid once the match has ended.',
  share_changed: 'This payment just changed. Try again.',
  // update-guarantee-card
  invalid_request: 'This booking could not be found.',
  not_found: 'This booking could not be found.',
  not_your_booking: 'Only the booker can update this guarantee card.',
  booking_cancelled: 'This booking was cancelled.',
  no_guarantee_to_update: 'This booking has no guarantee card to update.',
  guarantee_closed: 'This guarantee can no longer be changed.',
  no_saved_card: 'There’s no saved card on this booking to replace. Contact support.',
  // Both functions, before they run
  Unauthorized: 'Your session has ended. Sign in again.',
  'Invalid JSON body': GENERIC_ERROR,
};

/** A refusal from pay-owed or update-guarantee-card as a plain sentence.
 *  Never the raw code: an unknown one becomes a generic sentence. */
export function describeOwedError(code: string): string {
  return ERRORS[code] ?? GENERIC_ERROR;
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

async function refusal(error: unknown): Promise<PayOutcome> {
  const code = error ? await describeFunctionError(error) : '';
  return { status: 'error', message: describeOwedError(code) };
}

/** Pays one debt or cash part. The app sends only the id: pay-owed charges
 *  exactly what the database says is owed, with no fee. */
export async function payOwed(target: OwedTarget, sheet: PaymentSheet): Promise<PayOutcome> {
  const { data, error } = await supabase.functions.invoke<OwedPaymentResponse>('pay-owed', { body: target });
  if (error || !data?.clientSecret) return refusal(error);
  return present({ paymentIntentClientSecret: data.clientSecret }, sheet);
}

/** The booker replaces the card behind a failed guarantee. */
export async function updateGuaranteeCard(bookingId: string, sheet: PaymentSheet): Promise<PayOutcome> {
  const { data, error } = await supabase.functions.invoke<GuaranteeCardResponse>('update-guarantee-card', {
    body: { bookingId },
  });
  if (error || !data?.setupIntentClientSecret) return refusal(error);
  return present({ setupIntentClientSecret: data.setupIntentClientSecret }, sheet);
}

/** What tapping an item does. A share not paid yet is paid on Pay my share,
 *  priced by the server there. */
export type OwedAction =
  | { type: 'open_pay_share'; bookingId: string }
  | { type: 'update_card'; bookingId: string }
  | { type: 'pay'; target: OwedTarget }
  | { type: 'not_found' };

export function owedAction(item: OwedItem): OwedAction {
  if (item.type === 'debt') return { type: 'pay', target: { debtId: item.debt.debt_id } };
  const { payment } = item;
  if (payment.kind === 'payment_due') return { type: 'open_pay_share', bookingId: payment.booking_id };
  if (payment.kind === 'card_failed') return { type: 'update_card', bookingId: payment.booking_id };
  return payment.share_id ? { type: 'pay', target: { shareId: payment.share_id } } : { type: 'not_found' };
}

export const CARD_SAVED_MESSAGE = 'Card saved. Your guarantee is retried with it once Stripe confirms.';
export const PAYMENT_SENT_MESSAGE = 'Payment sent. It clears once Stripe confirms it.';
export const PAYMENT_NOT_FOUND_MESSAGE = 'This payment could not be found.';

export type OwedMessage = { tone: 'info' | 'danger'; text: string };

/** The result of tapping an item: opened Pay my share, or how paying went. */
export type OwedPayResult = { status: 'opened' } | { status: 'cancelled' } | { status: 'paid' | 'error'; message: string };

/** Taps one item: opens Pay my share, or pays (or saves a card) and says
 *  what happens next. */
export async function payOwedItem(
  item: OwedItem,
  sheet: PaymentSheet,
  openPayShare: (bookingId: string) => void,
): Promise<OwedPayResult> {
  const action = owedAction(item);
  if (action.type === 'open_pay_share') {
    openPayShare(action.bookingId);
    return { status: 'opened' };
  }
  if (action.type === 'not_found') return { status: 'error', message: PAYMENT_NOT_FOUND_MESSAGE };
  const outcome =
    action.type === 'update_card' ? await updateGuaranteeCard(action.bookingId, sheet) : await payOwed(action.target, sheet);
  if (outcome.status === 'paid') {
    return { status: 'paid', message: action.type === 'update_card' ? CARD_SAVED_MESSAGE : PAYMENT_SENT_MESSAGE };
  }
  return outcome;
}

/** "Pay what I owe"'s state: which item is paying, the message after it,
 *  and my_owed reloaded once paying finished or failed. */
export function usePayOwed({
  sheet,
  openPayShare,
  reload,
}: {
  sheet: PaymentSheet;
  openPayShare: (bookingId: string) => void;
  reload: () => void;
}) {
  const [payingKey, setPayingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<OwedMessage | null>(null);

  const pay = useCallback(
    async (item: OwedItem): Promise<OwedPayResult> => {
      const opens = owedAction(item).type === 'open_pay_share';
      if (!opens) {
        setPayingKey(owedItemKey(item));
        setMessage(null);
      }
      const result = await payOwedItem(item, sheet, openPayShare);
      if (opens) return result;
      setPayingKey(null);
      if (result.status === 'paid' || result.status === 'error') {
        setMessage({ tone: result.status === 'paid' ? 'info' : 'danger', text: result.message });
        reload();
      }
      return result;
    },
    [sheet, openPayShare, reload],
  );

  return { pay, payingKey, message };
}
