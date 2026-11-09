// Places the booker's guarantee hold (docs/specs/13-payments-bookings.md,
// "When money is held and taken", step 3): an off-session hold on their saved
// card for the full pitch price. Used by run-payment-jobs (72 hours before
// kickoff, and retries until kickoff) and by stripe-webhook (at booking, when
// kickoff is closer, or right after the booker replaced their card).
//
// What Stripe answers decides what happens:
//   - the hold is on the card: recorded ('held');
//   - a problem with the booker's card (declined, 3-D Secure needed, or the
//     card removed, detached or not theirs): a failed hold, recorded, the
//     booker told once, retried in 6 hours until kickoff; it never cancels
//     the booking ('failed');
//   - no answer (network, Stripe down or overloaded, anything else): not the
//     booker's fault and maybe placed after all, so nobody is told, it's
//     tried again after a back-off (1, 5, 15, 60 minutes, then hourly), and
//     before that try Stripe is checked for an intent carrying this
//     guarantee's id, so a hold that went through is recorded, never placed
//     twice and never lost ('retry'). After kickoff, or on a cancelled
//     booking, it's only looked up ('checked').
// An intent left behind (requires_action, requires_payment_method) is
// cancelled so it can't hold money later.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from './db.ts';
import { idempotencyKeys } from './money.ts';
import { errorText, releaseOrQueue } from './release.ts';

/** A row of public.guarantees_due_for_hold. */
export type DueGuarantee = {
  guarantee_id: string;
  booking_id: string;
  profile_id: string;
  amount_cents: number;
  stripe_customer_id: string;
  stripe_payment_method_id: string;
  attempts: number;
  /** Tries since Stripe last answered; above 0, Stripe is checked first. */
  api_errors?: number;
  /** When the guarantee was made: no intent of it can be older. */
  created_at?: string;
  /** After kickoff or on a cancelled booking: look it up, never place one. */
  check_only?: boolean;
};

export type Deps = { stripe: Stripe; db: Db };

export type HoldResult = 'held' | 'failed' | 'released' | 'retry' | 'checked';

type StripeErrorLike = {
  type?: string;
  code?: string;
  param?: string;
  message?: string;
  raw?: { payment_intent?: { id?: string } };
};

// Invalid requests that are about the booker's card, not about our request.
const CARD_PROBLEM_PARAMS = new Set(['payment_method', 'customer']);
const CARD_PROBLEM_CODES = new Set([
  'payment_method_unexpected_state',
  'payment_method_not_available',
  'payment_method_unactivated',
  'payment_method_invalid_parameter',
]);

/** The booker's card said no, or can't be used: a failed hold, theirs to fix. */
function isCardProblem(error: StripeErrorLike): boolean {
  if (error.type === 'StripeCardError') return true;
  return error.type === 'StripeInvalidRequestError' &&
    (CARD_PROBLEM_PARAMS.has(error.param ?? '') || CARD_PROBLEM_CODES.has(error.code ?? ''));
}

function cardProblemText(error: StripeErrorLike): string {
  if (error.type === 'StripeCardError') return error.code ?? error.message ?? 'card_error';
  const what = error.code ?? error.message ?? 'invalid_request';
  return error.param && !CARD_PROBLEM_CODES.has(error.code ?? '') ? `${error.param}: ${what}` : what;
}

export async function placeGuaranteeHold(deps: Deps, guarantee: DueGuarantee): Promise<HoldResult> {
  const { stripe, db } = deps;

  if ((guarantee.api_errors ?? 0) > 0 || guarantee.check_only) {
    let found: Stripe.PaymentIntent[];
    try {
      found = await guaranteeIntentsAtStripe(stripe, guarantee);
    } catch (err) {
      return await noAnswer(deps, guarantee, err);
    }
    for (const leftOver of found.filter((i) => !['requires_capture', 'canceled', 'succeeded'].includes(i.status))) {
      await release(deps, guarantee, leftOver.id, 'guarantee_hold_failed');
    }
    const [held, ...extra] = found.filter((i) => i.status === 'requires_capture');
    for (const duplicate of extra) await release(deps, guarantee, duplicate.id, 'duplicate_guarantee_hold');
    if (held) return await recordHeld(deps, guarantee, held);
    if (guarantee.check_only) {
      await rpc(db, 'guarantee_hold_check_cleared', { p_guarantee_id: guarantee.guarantee_id });
      return 'checked';
    }
  }

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
    }, {
      idempotencyKey: idempotencyKeys.guaranteeHold(
        guarantee.guarantee_id,
        guarantee.stripe_payment_method_id,
        guarantee.attempts + 1,
      ),
    });
  } catch (err) {
    const error = err as StripeErrorLike;
    if (!isCardProblem(error)) return await noAnswer(deps, guarantee, err);
    const leftOver = error.raw?.payment_intent?.id ?? null;
    await rpc(db, 'guarantee_hold_failed', {
      p_guarantee_id: guarantee.guarantee_id,
      p_intent_id: leftOver,
      p_error: cardProblemText(error),
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

  return await recordHeld(deps, guarantee, intent);
}

async function recordHeld(deps: Deps, guarantee: DueGuarantee, intent: Stripe.PaymentIntent): Promise<HoldResult> {
  const placed = await rpc<{ result: string; reason?: string }>(deps.db, 'guarantee_hold_placed', {
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

/** No answer from Stripe: tried again after the back-off, the booker not told. */
async function noAnswer(deps: Deps, guarantee: DueGuarantee, err: unknown): Promise<HoldResult> {
  console.error(`guarantee ${guarantee.guarantee_id}: no answer from Stripe, retrying after a back-off:`, err);
  await rpc(deps.db, 'guarantee_hold_errored', { p_guarantee_id: guarantee.guarantee_id, p_error: errorText(err) });
  return 'retry';
}

/** Every PaymentIntent at Stripe for this guarantee: on the booker's
 *  customer, made since the guarantee, carrying its id. A list, not a
 *  search, so an intent made a moment ago is in it. */
async function guaranteeIntentsAtStripe(stripe: Stripe, guarantee: DueGuarantee): Promise<Stripe.PaymentIntent[]> {
  const since = guarantee.created_at ? Math.floor(Date.parse(guarantee.created_at) / 1000) : undefined;
  const found: Stripe.PaymentIntent[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.paymentIntents.list({
      customer: guarantee.stripe_customer_id,
      ...(since !== undefined ? { created: { gte: since } } : {}),
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const intent of page.data) {
      if (intent.metadata?.kind === 'guarantee' && intent.metadata?.guarantee_id === guarantee.guarantee_id) found.push(intent);
    }
    if (!page.has_more || page.data.length === 0) return found;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

function release(deps: Deps, guarantee: DueGuarantee, intentId: string, reason: string) {
  return releaseOrQueue(deps, { booking_id: guarantee.booking_id, guarantee_id: guarantee.guarantee_id, intent_id: intentId, reason });
}
