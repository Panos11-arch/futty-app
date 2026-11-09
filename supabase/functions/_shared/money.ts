// The server's money maths for Edge Functions (docs/specs/13-payments-bookings.md,
// "Prices and fees", "Booking modes"). Integer cents only. The database's
// copy is public.money_share (supabase/migrations/*_pay_modes_money.sql); the
// shares it writes are the source of truth, and the functions use this
// module to check an amount before it goes to Stripe and to build every
// idempotency key from our own ids.

export type BookingMode = 'pay_all' | 'each_pays_responsible' | 'each_pays_own_spot';
export type PaymentMethod = 'card' | 'cash';

/** Service fee per player when each player pays their own share. */
export const FEE_EACH_PAYS_CENTS = 80;
/** Service fee per player when the booker pays for everyone in one payment. */
export const FEE_PAY_ALL_CENTS = 55;

const MODES: readonly BookingMode[] = ['pay_all', 'each_pays_responsible', 'each_pays_own_spot'];
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
  if (mode === 'pay_all' && method === 'cash') throw new Error('cash_not_allowed');

  let pitch: number;
  let fee: number;
  if (mode === 'pay_all') {
    // The booker's one payment covers the pitch and a fee per player; a
    // Premium booker's own spot is the only fee-free one.
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
 *  stored: the fee alone for a cash player, pitch part + fee otherwise. */
export function cardChargeCents(share: { pitch_cents: number; fee_cents: number; payment_method: PaymentMethod }): number {
  return share.payment_method === 'cash' ? share.fee_cents : share.pitch_cents + share.fee_cents;
}

/** Every Stripe idempotency key, built from our row ids, so a retried call
 *  is the same request to Stripe and money never moves twice. A key names
 *  everything the request carries (amount, method, timing), so a retry with
 *  different parameters is a new request, never a clash with the old one. */
export const idempotencyKeys = {
  /** A share's PaymentIntent, for one amount, method and capture method,
   *  replacing previousIntentId (cancelled first). */
  shareIntent: ({ shareId, amountCents, method, captureMethod, previousIntentId }: {
    shareId: string;
    amountCents: number;
    method: PaymentMethod;
    captureMethod: 'manual' | 'automatic';
    previousIntentId: string | null;
  }) => `share-${shareId}-${amountCents}-${method}-${captureMethod}-after-${previousIntentId ?? 'none'}`,
  /** A share of a booking from before P4a (one amount, one method). */
  legacyShareIntent: (shareId: string, previousIntentId: string | null) => `share-${shareId}-after-${previousIntentId ?? 'none'}`,
  /** Taking a held share. */
  capture: (shareId: string) => `capture-share-${shareId}`,
  /** Cancelling (releasing) any PaymentIntent. */
  cancelIntent: (intentId: string) => `cancel-${intentId}`,
  /** Refunding what's left on an intent, for one reason. */
  refund: (intentId: string, reason: string, amountCents: number) => `refund-${intentId}-${reason}-${amountCents}`,
  /** The booker's guarantee hold; each retry after a failure is a new attempt. */
  guaranteeHold: (guaranteeId: string, attempt: number) => `guarantee-${guaranteeId}-attempt-${attempt}`,
  /** The booker replacing their guarantee card; a new key once a new card is saved. */
  guaranteeCard: (guaranteeId: string, currentPaymentMethodId: string | null) =>
    `guarantee-card-${guaranteeId}-after-${currentPaymentMethodId ?? 'none'}`,
  customer: (profileId: string) => `customer-${profileId}`,
  /** Saving a card for a share with nothing to charge. */
  shareCardSetup: (shareId: string, method: PaymentMethod, previousIntentId: string | null) =>
    `setup-share-${shareId}-${method}-after-${previousIntentId ?? 'none'}`,
};
