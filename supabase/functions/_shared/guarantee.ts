// Places the booker's guarantee hold (docs/specs/13-payments-bookings.md,
// "When money is held and taken", step 3): an off-session hold on their saved
// card for the full pitch price. Used by run-payment-jobs (72 hours before
// kickoff, and retries) and by stripe-webhook (at booking, when kickoff is
// closer). A failed hold is recorded and retried in 6 hours; it never
// cancels the booking.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from './db.ts';
import { idempotencyKeys } from './money.ts';

/** A row of public.guarantees_due_for_hold. */
export type DueGuarantee = {
  guarantee_id: string;
  booking_id: string;
  profile_id: string;
  amount_cents: number;
  stripe_customer_id: string;
  stripe_payment_method_id: string;
  attempts: number;
};

export type Deps = { stripe: Stripe; db: Db };

type StripeErrorLike = { type?: string; code?: string; message?: string; raw?: { payment_intent?: { id?: string } } };

/** Returns 'held', 'failed' (recorded; retried in 6 hours) or 'retry' (no
 *  answer from Stripe: the next run tries again with the same key). */
export async function placeGuaranteeHold({ stripe, db }: Deps, guarantee: DueGuarantee): Promise<'held' | 'failed' | 'retry'> {
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create({
      amount: guarantee.amount_cents,
      currency: 'eur',
      customer: guarantee.stripe_customer_id,
      payment_method: guarantee.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      capture_method: 'manual',
      metadata: { kind: 'guarantee', guarantee_id: guarantee.guarantee_id, booking_id: guarantee.booking_id },
    }, { idempotencyKey: idempotencyKeys.guaranteeHold(guarantee.guarantee_id, guarantee.attempts + 1) });
  } catch (err) {
    const error = err as StripeErrorLike;
    // Only a card error is a real "no": anything else (network, Stripe down)
    // may have placed the hold, so the same key must be retried.
    if (error.type !== 'StripeCardError') {
      console.error(`guarantee ${guarantee.guarantee_id}: no answer from Stripe, retrying next run:`, err);
      return 'retry';
    }
    await rpc(db, 'guarantee_hold_failed', {
      p_guarantee_id: guarantee.guarantee_id,
      p_intent_id: error.raw?.payment_intent?.id ?? null,
      p_error: error.code ?? error.message ?? 'card_error',
    });
    return 'failed';
  }

  if (intent.status !== 'requires_capture') {
    // e.g. requires_action: the bank wants the booker present (3-D Secure).
    await rpc(db, 'guarantee_hold_failed', {
      p_guarantee_id: guarantee.guarantee_id,
      p_intent_id: intent.id,
      p_error: intent.status,
    });
    return 'failed';
  }

  await rpc(db, 'guarantee_hold_placed', {
    p_guarantee_id: guarantee.guarantee_id,
    p_intent_id: intent.id,
    p_amount_cents: intent.amount_capturable,
  });
  return 'held';
}
