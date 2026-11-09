// Places the booker's guarantee hold (docs/specs/13-payments-bookings.md,
// "When money is held and taken", step 3): an off-session hold on their saved
// card for the full pitch price. Used by run-payment-jobs (72 hours before
// kickoff, and retries until kickoff) and by stripe-webhook (at booking, when
// kickoff is closer, or right after the booker replaced their card).
// A failed hold is recorded and retried in 6 hours; it never cancels the
// booking. An intent left behind by a failure (requires_action,
// requires_payment_method) is cancelled so it can't hold money later.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from './db.ts';
import { idempotencyKeys } from './money.ts';
import { releaseOrQueue } from './release.ts';

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

/** Returns 'held', 'failed' (recorded; retried in 6 hours), 'released' (the
 *  booking was cancelled while it was placed: the hold was let go) or
 *  'retry' (no answer from Stripe: the next run tries again with the same key). */
export async function placeGuaranteeHold(
  deps: Deps,
  guarantee: DueGuarantee,
): Promise<'held' | 'failed' | 'released' | 'retry'> {
  const { stripe, db } = deps;
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
    const leftOver = error.raw?.payment_intent?.id ?? null;
    await rpc(db, 'guarantee_hold_failed', {
      p_guarantee_id: guarantee.guarantee_id,
      p_intent_id: leftOver,
      p_error: error.code ?? error.message ?? 'card_error',
      // The bank wants the booker present (3-D Secure).
      p_needs_action: error.code === 'authentication_required',
    });
    if (leftOver) await release(deps, guarantee, leftOver, 'guarantee_hold_failed');
    return 'failed';
  }

  if (intent.status !== 'requires_capture') {
    // e.g. requires_action: the bank wants the booker present (3-D Secure).
    await rpc(db, 'guarantee_hold_failed', {
      p_guarantee_id: guarantee.guarantee_id,
      p_intent_id: intent.id,
      p_error: intent.status,
      p_needs_action: intent.status === 'requires_action',
    });
    await release(deps, guarantee, intent.id, 'guarantee_hold_failed');
    return 'failed';
  }

  const placed = await rpc<{ result: string; reason?: string }>(db, 'guarantee_hold_placed', {
    p_guarantee_id: guarantee.guarantee_id,
    p_intent_id: intent.id,
    p_amount_cents: intent.amount_capturable,
  });
  if (placed.result === 'release') {
    await release(deps, guarantee, intent.id, placed.reason ?? 'booking_cancelled');
    return 'released';
  }
  return 'held';
}

function release(deps: Deps, guarantee: DueGuarantee, intentId: string, reason: string) {
  return releaseOrQueue(deps, { booking_id: guarantee.booking_id, guarantee_id: guarantee.guarantee_id, intent_id: intentId, reason });
}
