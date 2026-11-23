// Money helpers for Edge Functions (docs/specs/13-payments-bookings.md).
// Integer cents only. The money maths itself is in the database
// (public.money_share and friends), reading every fee and time limit from
// public.app_rules (P10); there is no copy of it here. The shares the
// database writes are the source of truth: this module only checks an
// amount from a share's stored breakdown before it goes to Stripe, and
// builds every idempotency key from our own ids.

export type BookingMode = 'pay_all' | 'each_pays_responsible' | 'each_pays_own_spot' | 'gipedo_pano';
export type PaymentMethod = 'card' | 'cash';

/** What a share's card payment must be, from the breakdown the database
 *  stored: the fee alone for a cash player; otherwise the pitch part less
 *  any venue credit paying for it, plus the fee. */
export function cardChargeCents(
  share: { pitch_cents: number; fee_cents: number; payment_method: PaymentMethod; credit_cents?: number | null },
): number {
  if (share.payment_method === 'cash') return share.fee_cents;
  return share.pitch_cents - (share.credit_cents ?? 0) + share.fee_cents;
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
  /** Booking v2 (B1c): "Pay the whole pitch and play", the other half's one
   *  payment: one amount, replacing previousIntentId (cancelled first). */
  otherHalf: (paymentId: string, amountCents: number, previousIntentId: string | null) =>
    `other-half-${paymentId}-${amountCents}-after-${previousIntentId ?? 'none'}`,
  /** P4d: one transfer to a venue (one payout row, one amount): a retry
   *  after no answer is the same transfer, never a second one. */
  payout: (payoutId: string) => `payout-${payoutId}`,
  /** P4d: a venue's Stripe Express account, created once per venue in each
   *  Stripe mode (a test-mode account is replaced on live keys). */
  connectAccount: (venueId: string, livemode: boolean) => `connect-account-${venueId}-${livemode ? 'live' : 'test'}`,
};
