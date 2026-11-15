// The server's money maths for Edge Functions (docs/specs/13-payments-bookings.md,
// "Prices and fees", "Booking modes"). Integer cents only. The database's
// copy is public.money_share (supabase/migrations/*_pay_modes_money.sql); the
// shares it writes are the source of truth, and the functions use this
// module to check an amount before it goes to Stripe and to build every
// idempotency key from our own ids.

export type BookingMode = 'pay_all' | 'each_pays_responsible' | 'each_pays_own_spot' | 'gipedo_pano';
export type PaymentMethod = 'card' | 'cash';

/** Service fee per player when each player pays their own share. */
export const FEE_EACH_PAYS_CENTS = 80;
/** Service fee per player when the booker pays for everyone in one payment. */
export const FEE_PAY_ALL_CENTS = 55;

const MODES: readonly BookingMode[] = ['pay_all', 'each_pays_responsible', 'each_pays_own_spot', 'gipedo_pano'];
const METHODS: readonly PaymentMethod[] = ['card', 'cash'];

export type ShareInput = {
  /** The pitch price for the game, from the venue's data. */
  pitchCents: number;
  /** Players the booking is for (10 for 5 v 5, 12 for 6 v 6, ...). */
  players: number;
  mode: BookingMode;
  isBooker: boolean;
  isPremium: boolean;
  method: PaymentMethod;
};

export type ShareAmounts = {
  /** Their part of the pitch: price / players, leftover cents on the booker. */
  pitchCents: number;
  /** Futty's service fee on this share. */
  feeCents: number;
  /** Charged to their card. */
  cardCents: number;
  /** Paid in cash at the venue. */
  cashCents: number;
};

/** One player's share. Same rules, same errors, as public.money_share. */
export function shareAmounts({ pitchCents, players, mode, isBooker, isPremium, method }: ShareInput): ShareAmounts {
  if (!Number.isInteger(pitchCents) || pitchCents < 0 || !Number.isInteger(players) || players < 1) {
    throw new Error('invalid_money_input');
  }
  if (!MODES.includes(mode)) throw new Error('invalid_payment_mode');
  if (!METHODS.includes(method)) throw new Error('invalid_payment_method');
  if ((mode === 'pay_all' || mode === 'gipedo_pano') && method === 'cash') throw new Error('cash_not_allowed');

  let pitch: number;
  let fee: number;
  if (mode === 'pay_all' || mode === 'gipedo_pano') {
    // The booker's one payment covers the pitch and a fee per player; a
    // Premium booker's own spot is the only fee-free one. In Gipedo Pano
    // each captain's hold is that payment (isBooker: a captain's hold).
    pitch = isBooker ? pitchCents : 0;
    fee = isBooker ? FEE_PAY_ALL_CENTS * (players - (isPremium ? 1 : 0)) : 0;
  } else {
    pitch = Math.floor(pitchCents / players) + (isBooker ? pitchCents % players : 0);
    fee = isPremium ? 0 : FEE_EACH_PAYS_CENTS;
  }

  return method === 'cash'
    ? { pitchCents: pitch, feeCents: fee, cardCents: fee, cashCents: pitch }
    : { pitchCents: pitch, feeCents: fee, cardCents: pitch + fee, cashCents: 0 };
}

/** What a share's card payment must be, from the breakdown the database
 *  stored: the fee alone for a cash player; otherwise the pitch part less
 *  any venue credit paying for it, plus the fee. */
export function cardChargeCents(
  share: { pitch_cents: number; fee_cents: number; payment_method: PaymentMethod; credit_cents?: number | null },
): number {
  if (share.payment_method === 'cash') return share.fee_cents;
  return share.pitch_cents - (share.credit_cents ?? 0) + share.fee_cents;
}

export type CreditPayment = { creditCents: number; feeCents: number; cardCents: number };

/** Paying a share's pitch part with venue credit (spec 13, "Venue credit"):
 *  as much credit as covers it; no service fee when credit covers it all;
 *  otherwise the rest by card plus the share's normal fee (80, or 0 for a
 *  Premium player; 55 per player when the booker pays for everyone).
 *  Same rules as public.money_credit_payment. */
export function creditPayment(pitchCents: number, feeCents: number, creditAvailableCents: number): CreditPayment {
  for (const value of [pitchCents, feeCents, creditAvailableCents]) {
    if (!Number.isInteger(value) || value < 0) throw new Error('invalid_money_input');
  }
  const creditCents = Math.min(pitchCents, creditAvailableCents);
  if (creditCents === pitchCents) return { creditCents, feeCents: 0, cardCents: 0 };
  return { creditCents, feeCents, cardCents: pitchCents - creditCents + feeCents };
}

/** Kept per player when a share is cancelled from 1 hour after paying until
 *  6 hours before kickoff; also what the booker pays per other player whose
 *  payment was taken when they cancel the whole team (spec 13). */
export const CANCEL_KEEP_PER_PLAYER_CENTS = 100;

/** The booker's charge for cancelling the whole team: 100 per other player
 *  whose payment was already taken. Same as public.cancellation_plan. */
export function wholeTeamCancelFeeCents(takenOtherPlayers: number): number {
  if (!Number.isInteger(takenOtherPlayers) || takenOtherPlayers < 0) throw new Error('invalid_money_input');
  return CANCEL_KEEP_PER_PLAYER_CENTS * takenOtherPlayers;
}

/** Every Stripe idempotency key, built from our row ids, so a retried call
 *  is the same request to Stripe and money never moves twice. A key names
 *  everything the request carries (amount, method, timing), so a retry with
 *  different parameters is a new request, never a clash with the old one. */
export const idempotencyKeys = {
  /** A share's PaymentIntent, for one amount, method and capture method,
   *  replacing previousIntentId (cancelled first). A Gipedo Pano opponent
   *  who offers again after a lapsed or withdrawn offer reuses their share
   *  row, so each offer after the first is its own attempt (offerAttempt,
   *  from the share): a new request, never Stripe replaying the old one. */
  shareIntent: ({ shareId, amountCents, method, captureMethod, previousIntentId, offerAttempt }: {
    shareId: string;
    amountCents: number;
    method: PaymentMethod;
    captureMethod: 'manual' | 'automatic';
    previousIntentId: string | null;
    offerAttempt?: number | null;
  }) => `share-${shareId}${offerAttempt && offerAttempt > 1 ? `-offer-${offerAttempt}` : ''}-${amountCents}-${method}-${captureMethod}-after-${previousIntentId ?? 'none'}`,
  /** A share of a booking from before P4a (one amount, one method). */
  legacyShareIntent: (shareId: string, previousIntentId: string | null) => `share-${shareId}-after-${previousIntentId ?? 'none'}`,
  /** Taking a held share. */
  capture: (shareId: string) => `capture-share-${shareId}`,
  /** Cancelling (releasing) any PaymentIntent. */
  cancelIntent: (intentId: string) => `cancel-${intentId}`,
  /** Refunding what's left on an intent. Not keyed on the reason: two runs
   *  giving back the same money (a cancellation and the job finishing it)
   *  are the same refund. */
  refund: (intentId: string, amountCents: number) => `refund-${intentId}-${amountCents}`,
  /** The booker's guarantee hold on one card; each retry after a failure is
   *  a new attempt, and a new card is a new request. */
  guaranteeHold: (guaranteeId: string, paymentMethodId: string, attempt: number) =>
    `guarantee-${guaranteeId}-${paymentMethodId}-attempt-${attempt}`,
  /** The booker replacing their guarantee card; a new key once a new card is saved. */
  guaranteeCard: (guaranteeId: string, currentPaymentMethodId: string | null) =>
    `guarantee-card-${guaranteeId}-after-${currentPaymentMethodId ?? 'none'}`,
  customer: (profileId: string) => `customer-${profileId}`,
  /** The booker's charge for cancelling the whole team, one attempt
   *  (attempt 1 on-session when they confirm; each retry a new request). */
  cancelFee: (feeId: string, attempt: number) => `cancel-fee-${feeId}-attempt-${attempt}`,
  /** Saving a card for a share with nothing to charge. Keyed on the share's
   *  last SetupIntent too, so a new attempt after one was cancelled (credit
   *  set aside for 15 minutes and given back) is a new SetupIntent, not a
   *  replay of the cancelled one. */
  shareCardSetup: (
    shareId: string,
    method: PaymentMethod,
    previousIntentId: string | null,
    previousSetupIntentId: string | null = null,
  ) =>
    `setup-share-${shareId}-${method}-after-${previousIntentId ?? 'none'}` +
    (previousSetupIntentId ? `-setup-${previousSetupIntentId}` : ''),
  /** A short game's top-up (P4c), charged off-session once: a retry after
   *  no answer from Stripe is the same request. */
  topUp: (itemId: string) => `top-up-${itemId}`,
  /** Taking what's unpaid from the booker's guarantee hold at collection. */
  collectGuarantee: (collectionId: string) => `collect-guarantee-${collectionId}`,
  /** Taking what a Gipedo Pano settlement says from a captain's hold (one
   *  settlement per hold, one amount each). */
  gipedoCapture: (settlementId: string, amountCents: number) => `gipedo-capture-${settlementId}-${amountCents}`,
  /** Releasing a captain's hold whose Gipedo Pano settlement takes nothing. */
  gipedoRelease: (settlementId: string) => `gipedo-release-${settlementId}`,
  /** Paying a debt, or a cash part after the match, by card: one amount,
   *  replacing previousIntentId (cancelled first). */
  owed: (kind: 'debt' | 'cash', id: string, amountCents: number, previousIntentId: string | null) =>
    `owed-${kind}-${id}-${amountCents}-after-${previousIntentId ?? 'none'}`,
};
