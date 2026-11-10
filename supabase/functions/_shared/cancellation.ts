// The Stripe side of a cancellation (docs/specs/13-payments-bookings.md,
// "Cancellations and refunds"). The database decides everything
// (cancel_booking_internal writes one line per share, with the work it
// still needs); this only moves the money it was told to, once:
//   release  the hold is cancelled (or a payment taken in the free hour is
//            refunded): release.ts, which records it in the ledger
//   capture  a share still only held whose money is kept is taken first;
//            then the database issues the credit it quoted
//   refund   a share given back after the booker or venue cancelled, once
//            the player chose card or didn't choose within 48 hours
// and charges the booker's extra charge for cancelling the whole team.
// Every Stripe call is keyed on our ids, so a retry is the same request. A
// failure is never swallowed: the line (or charge) is tried again by
// run-payment-jobs after a back-off.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from './db.ts';
import { cardProblemText, isCardProblem, type StripeErrorLike } from './guarantee.ts';
import { idempotencyKeys } from './money.ts';
import { errorText, releaseIntent, releaseOrQueue, stripeFeeCents } from './release.ts';

export type Deps = { stripe: Stripe; db: Db };

/** A row of public.cancellation_work / cancellation_line_work. */
export type CancellationWork = {
  line_id: string;
  kind: 'release' | 'capture' | 'refund';
  booking_id: string;
  share_id: string | null;
  guarantee_id: string | null;
  stripe_intent_id: string | null;
  amount_cents: number;
  reason: string;
  attempts: number;
};

export type WorkSummary = { done: number; failed: number };

/** Does one line's Stripe work and records it. Throws on any failure. */
async function doLine(deps: Deps, line: CancellationWork) {
  const item = {
    booking_id: line.booking_id,
    share_id: line.share_id,
    guarantee_id: line.guarantee_id,
    intent_id: line.stripe_intent_id ?? '',
    reason: line.reason,
  };

  if (line.kind === 'release') {
    const outcome = line.stripe_intent_id ? await releaseIntent(deps, item) : 'nothing';
    await rpc(deps.db, 'cancellation_line_done', { p_line_id: line.line_id, p_outcome: outcome });
    return;
  }

  if (line.kind === 'refund') {
    // Claimed in the database first: the line is locked and checked again
    // (no credit chosen; the 48 hours over, or card chosen), and card is
    // recorded as the choice, so a credit choice can't race this refund.
    const claimed = await rpc<boolean>(deps.db, 'cancellation_claim_refund', { p_line_id: line.line_id });
    if (!claimed) return;
    // Credit that paid for the share goes back in the database; only a card
    // payment needs Stripe.
    const outcome = line.stripe_intent_id && line.amount_cents > 0 ? await releaseIntent(deps, item) : 'nothing';
    await rpc(deps.db, 'cancellation_line_refunded', { p_line_id: line.line_id, p_outcome: outcome });
    return;
  }

  // capture: the same key as run-payment-jobs' capture of this share, so the
  // two can never take it twice.
  const intentId = line.stripe_intent_id!;
  let intent = await deps.stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge.balance_transaction'] });
  if (intent.status === 'canceled') {
    // The hold is gone (it expired or was cancelled): the card part can
    // never be taken. Recorded, and the line is finished: the credit that
    // paid for the share above the €1 goes back, and it isn't retried.
    await rpc(deps.db, 'record_intent_cancelled', {
      p_booking_id: line.booking_id,
      p_share_id: line.share_id,
      p_guarantee_id: null,
      p_intent_id: intentId,
      p_reason: 'cancellation_hold_gone',
    });
    await rpc(deps.db, 'cancellation_line_not_taken', { p_line_id: line.line_id });
    return;
  }
  if (intent.status === 'requires_capture') {
    intent = await deps.stripe.paymentIntents.capture(
      intentId,
      { expand: ['latest_charge.balance_transaction'] },
      { idempotencyKey: idempotencyKeys.capture(line.share_id!) },
    );
  }
  if (intent.status !== 'succeeded') throw new Error(`cannot_take: ${intentId} is ${intent.status}`);
  await rpc(deps.db, 'cancellation_line_captured', {
    p_line_id: line.line_id,
    p_amount_cents: intent.amount_received,
    p_stripe_fee_cents: stripeFeeCents(intent),
  });
}

/** One line now; a failure is logged on the line for the job to retry. */
export async function runCancellationLine(deps: Deps, line: CancellationWork): Promise<boolean> {
  try {
    await doLine(deps, line);
    return true;
  } catch (err) {
    console.error(`cancellation line ${line.line_id} (${line.kind}) failed, retried later:`, err);
    await rpc(deps.db, 'cancellation_line_failed', { p_line_id: line.line_id, p_error: errorText(err) });
    return false;
  }
}

/** One cancellation's work (cancel-booking, right after cancelling), or,
 *  with null, every line that's due (run-payment-jobs). */
export async function runCancellationWork(deps: Deps, cancellationId: string | null): Promise<WorkSummary> {
  const summary: WorkSummary = { done: 0, failed: 0 };
  const lines = await rpc<CancellationWork[]>(deps.db, 'cancellation_work', { p_cancellation_id: cancellationId });
  for (const line of lines) {
    if (await runCancellationLine(deps, line)) summary.done += 1;
    else summary.failed += 1;
  }
  return summary;
}

/** A row of public.cancellation_fee_to_charge. */
type FeeToCharge = {
  fee_id: string;
  booking_id: string;
  cancellation_id: string;
  profile_id: string;
  amount_cents: number;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  attempt: number;
  off_session: boolean;
  previous_intent_id: string | null;
};

export type FeeResult =
  | { status: 'paid' | 'failed' | 'retry' | 'none' | 'processing' }
  | { status: 'requires_action'; clientSecret: string | null };

/** The booker's extra charge for cancelling the whole team. The first try
 *  is on-session (the booker just confirmed it in the app): if the bank asks
 *  for 3-D Secure, the app is given the client secret to show it. Later
 *  tries are off-session. A card problem is the booker's to fix (told once,
 *  retried in 6 hours); no answer from Stripe is tried again soon. The
 *  last try's intent is checked first: one that went through is recorded,
 *  one still open is cancelled so it can never be paid as well. */
export async function chargeCancellationFee(deps: Deps, feeId: string): Promise<FeeResult> {
  const { stripe, db } = deps;
  const [fee] = await rpc<FeeToCharge[]>(db, 'cancellation_fee_to_charge', { p_fee_id: feeId });
  if (!fee) return { status: 'none' };

  try {
    if (fee.previous_intent_id) {
      const previous = await stripe.paymentIntents.retrieve(fee.previous_intent_id, {
        expand: ['latest_charge.balance_transaction'],
      });
      if (previous.status === 'succeeded') return await recordPaid(deps, fee, previous);
      if (previous.status === 'processing') return { status: 'processing' };
      if (previous.status !== 'canceled') {
        try {
          await stripe.paymentIntents.cancel(previous.id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(previous.id) });
        } catch (err) {
          const now = await stripe.paymentIntents.retrieve(previous.id, { expand: ['latest_charge.balance_transaction'] });
          if (now.status === 'succeeded') return await recordPaid(deps, fee, now);
          throw err;
        }
      }
    }
  } catch (err) {
    return await noAnswer(deps, fee, err);
  }

  if (!fee.stripe_customer_id || !fee.stripe_payment_method_id) {
    await attempted(db, fee.fee_id, null, 'failed', 'no_saved_card');
    return { status: 'failed' };
  }

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create({
      amount: fee.amount_cents,
      currency: 'eur',
      customer: fee.stripe_customer_id,
      payment_method: fee.stripe_payment_method_id,
      confirm: true,
      off_session: fee.off_session,
      expand: ['latest_charge.balance_transaction'],
      metadata: {
        kind: 'cancel_fee',
        fee_id: fee.fee_id,
        booking_id: fee.booking_id,
        cancellation_id: fee.cancellation_id,
        // All of it is Futty's.
        fee_cents: String(fee.amount_cents),
      },
    }, { idempotencyKey: idempotencyKeys.cancelFee(fee.fee_id, fee.attempt) });
  } catch (err) {
    const error = err as StripeErrorLike;
    if (!isCardProblem(error)) return await noAnswer(deps, fee, err);
    const leftOver = error.raw?.payment_intent?.id ?? null;
    await attempted(db, fee.fee_id, leftOver, 'failed', cardProblemText(error));
    return { status: 'failed' };
  }

  if (intent.status === 'succeeded') return await recordPaid(deps, fee, intent);
  if (intent.status === 'processing') {
    // The webhook says when it lands.
    await attempted(db, fee.fee_id, intent.id, 'error', 'processing');
    return { status: 'processing' };
  }
  if (intent.status === 'requires_action' && !fee.off_session) {
    await attempted(db, fee.fee_id, intent.id, 'requires_action', null);
    return { status: 'requires_action', clientSecret: intent.client_secret };
  }
  await attempted(db, fee.fee_id, intent.id, 'failed', intent.status);
  return { status: 'failed' };
}

async function recordPaid(deps: Deps, fee: FeeToCharge, intent: Stripe.PaymentIntent): Promise<FeeResult> {
  const result = await rpc<{ result: string; reason?: string }>(deps.db, 'cancellation_fee_paid', {
    p_fee_id: fee.fee_id,
    p_intent_id: intent.id,
    p_amount_cents: intent.amount_received,
    p_stripe_fee_cents: stripeFeeCents(intent),
  });
  if (result.result === 'refund') {
    await releaseOrQueue(deps, { booking_id: fee.booking_id, intent_id: intent.id, reason: result.reason ?? 'refused' });
  }
  return { status: 'paid' };
}

async function noAnswer(deps: Deps, fee: FeeToCharge, err: unknown): Promise<FeeResult> {
  console.error(`cancellation fee ${fee.fee_id}: no answer from Stripe, retrying after a back-off:`, err);
  await attempted(deps.db, fee.fee_id, null, 'error', errorText(err));
  return { status: 'retry' };
}

function attempted(db: Db, feeId: string, intentId: string | null, outcome: string, error: string | null) {
  return rpc(db, 'cancellation_fee_attempted', { p_fee_id: feeId, p_intent_id: intentId, p_outcome: outcome, p_error: error });
}

/** run-payment-jobs: every extra charge due for another try (until kickoff). */
export async function runCancellationFees(deps: Deps) {
  const summary = { paid: 0, failed: 0, retry: 0 };
  for (const { fee_id } of await rpc<{ fee_id: string }[]>(deps.db, 'cancellation_fees_due')) {
    const result = await chargeCancellationFee(deps, fee_id);
    if (result.status === 'paid') summary.paid += 1;
    else if (result.status === 'retry' || result.status === 'processing') summary.retry += 1;
    else if (result.status === 'failed' || result.status === 'requires_action') summary.failed += 1;
  }
  return summary;
}
