// Gives money back on one PaymentIntent, whatever state Stripe has it in,
// and writes it to the ledger (docs/specs/13-payments-bookings.md, "Every
// money movement happens once"):
//   held (requires_capture)  the hold is cancelled           -> 'cancelled'
//   taken (succeeded)        the capture is recorded (if it isn't yet) and
//                            what's left is refunded, keyed on the refund id -> 'refunded'
//   open, never paid         cancelled so it can't be paid later -> 'nothing'
//   already cancelled        recorded if a dead run didn't   -> 'nothing'
//   processing               can't be touched yet: an error, so it's retried
// A failure is never swallowed: releaseOrQueue puts it on the retry queue
// (money_releases), which run-payment-jobs works through until it succeeds.
// Safe to run any number of times, at once too: every Stripe call is keyed
// on the intent (and, for a refund, on what's left), and every movement is
// recorded once. If a whole run dies part-way, run-payment-jobs finds the
// cancelled booking again (bookings_with_money_to_release) and finishes it.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from './db.ts';
import { idempotencyKeys } from './money.ts';

export type Deps = { stripe: Stripe; db: Db };

export type ReleaseItem = {
  booking_id: string;
  share_id?: string | null;
  guarantee_id?: string | null;
  intent_id: string;
  /** Why the money goes back, e.g. 'booking_cancelled'. In the ledger. */
  reason: string;
};

export type ReleaseOutcome = 'cancelled' | 'refunded' | 'nothing';

/** Stripe's actual fee on a captured intent, from its charge's balance
 *  transaction (retrieve or capture with expand: latest_charge.balance_transaction). */
export function stripeFeeCents(intent: Stripe.PaymentIntent): number {
  const charge = intent.latest_charge as Stripe.Charge | string | null;
  const balance = typeof charge === 'object' && charge ? charge.balance_transaction : null;
  if (!balance || typeof balance !== 'object') throw new Error(`stripe_fee_unknown: ${intent.id}`);
  return balance.fee;
}

/** The service fee the intent carries in its metadata (set when it was
 *  created). Intents from before P4a carry none: 0. */
export function metadataFeeCents(intent: { metadata?: Record<string, string> | null }): number {
  const fee = Number(intent.metadata?.fee_cents ?? 0);
  return Number.isInteger(fee) && fee >= 0 ? fee : 0;
}

/** Releases one intent now. Throws on any Stripe or database failure. */
export async function releaseIntent({ stripe, db }: Deps, item: ReleaseItem): Promise<ReleaseOutcome> {
  const intent = await stripe.paymentIntents.retrieve(item.intent_id, { expand: ['latest_charge.balance_transaction'] });
  let outcome: ReleaseOutcome;

  if (intent.status === 'processing') {
    throw new Error(`intent_processing: ${intent.id}`);
  } else if (intent.status === 'canceled') {
    // Cancelled already, e.g. by a run that died before recording it: the
    // release is recorded from the hold in the ledger, once.
    await rpc(db, 'record_intent_cancelled', {
      p_booking_id: item.booking_id,
      p_share_id: item.share_id ?? null,
      p_guarantee_id: item.guarantee_id ?? null,
      p_intent_id: intent.id,
      p_reason: item.reason,
    });
    outcome = 'nothing';
  } else if (intent.status === 'requires_capture') {
    await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(intent.id) });
    await rpc(db, 'record_money_movement', {
      p_booking_id: item.booking_id,
      p_share_id: item.share_id ?? null,
      p_guarantee_id: item.guarantee_id ?? null,
      p_kind: 'cancel',
      p_amount_cents: intent.amount_capturable,
      p_stripe_intent_id: intent.id,
      p_stripe_id: intent.id,
      p_reason: item.reason,
    });
    outcome = 'cancelled';
  } else if (intent.status === 'succeeded') {
    await rpc(db, 'record_intent_capture', {
      p_booking_id: item.booking_id,
      p_share_id: item.share_id ?? null,
      p_guarantee_id: item.guarantee_id ?? null,
      p_intent_id: intent.id,
      p_amount_cents: intent.amount_received,
      p_fee_cents: metadataFeeCents(intent),
      p_stripe_fee_cents: stripeFeeCents(intent),
      p_reason: 'taken',
    });
    const charge = intent.latest_charge as Stripe.Charge;
    const left = charge.amount_captured - charge.amount_refunded;
    if (left > 0) {
      const refund = await stripe.refunds.create(
        // The same request whoever asks and why (the reason is in the
        // ledger), so two runs giving back the same money make one refund.
        { payment_intent: intent.id, amount: left, metadata: { booking_id: item.booking_id } },
        { idempotencyKey: idempotencyKeys.refund(intent.id, left) },
      );
      await recordRefund(db, intent.id, refund, item.reason);
    } else {
      // Refunded already: a run that died after Stripe refunded. Record any
      // refund the ledger doesn't have yet.
      const refunds = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
      for (const refund of refunds.data) await recordRefund(db, intent.id, refund, item.reason);
    }
    outcome = 'refunded';
  } else {
    await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(intent.id) });
    outcome = 'nothing';
  }

  await rpc(db, 'money_release_done', {
    p_booking_id: item.booking_id,
    p_share_id: item.share_id ?? null,
    p_guarantee_id: item.guarantee_id ?? null,
    p_intent_id: intent.id,
    p_outcome: outcome,
  });
  return outcome;
}

async function recordRefund(db: Db, intentId: string, refund: Stripe.Refund, reason: string) {
  if (refund.status === 'failed' || refund.status === 'canceled') return;
  await rpc(db, 'record_intent_refund', {
    p_intent_id: intentId,
    p_refund_id: refund.id,
    p_amount_cents: refund.amount,
    p_reason: reason,
  });
}

/** Releases one intent now, or puts it on the retry queue if that fails.
 *  Only a failure to queue is thrown. */
export async function releaseOrQueue(deps: Deps, item: ReleaseItem): Promise<ReleaseOutcome | 'queued'> {
  try {
    return await releaseIntent(deps, item);
  } catch (err) {
    console.error(`release of ${item.intent_id} failed, queued for retry:`, err);
    await rpc(deps.db, 'queue_money_release', {
      p_booking_id: item.booking_id,
      p_share_id: item.share_id ?? null,
      p_guarantee_id: item.guarantee_id ?? null,
      p_intent_id: item.intent_id,
      p_reason: item.reason,
      p_error: errorText(err),
    });
    return 'queued';
  }
}

/** run-payment-jobs: one more try at every queued release that's due; each
 *  attempt is logged, and a success takes it off the queue. */
export async function runReleaseQueue(deps: Deps) {
  const summary = { released: 0, failed: 0 };
  type Due = { release_id: string; booking_id: string; share_id: string | null; guarantee_id: string | null; stripe_intent_id: string; reason: string };
  for (const due of await rpc<Due[]>(deps.db, 'money_releases_due')) {
    try {
      const outcome = await releaseIntent(deps, {
        booking_id: due.booking_id,
        share_id: due.share_id,
        guarantee_id: due.guarantee_id,
        intent_id: due.stripe_intent_id,
        reason: due.reason,
      });
      await rpc(deps.db, 'money_release_attempted', { p_release_id: due.release_id, p_succeeded: true, p_outcome: outcome, p_error: null });
      summary.released += 1;
    } catch (err) {
      await rpc(deps.db, 'money_release_attempted', {
        p_release_id: due.release_id, p_succeeded: false, p_outcome: null, p_error: errorText(err),
      });
      summary.failed += 1;
    }
  }
  return summary;
}

type MoneyRow = { kind: 'share' | 'guarantee' | 'booking'; id: string; status: string; stripe_payment_intent_id: string | null };

/** Every bit of money on a cancelled booking goes back: each intent is
 *  released (or queued), and shares or a guarantee with no intent are closed. */
export async function releaseBookingMoney(deps: Deps, bookingId: string, reason: string) {
  const summary = { cancelled: 0, refunded: 0, nothing: 0, queued: 0 };
  for (const row of await rpc<MoneyRow[]>(deps.db, 'booking_money_to_release', { p_booking_id: bookingId })) {
    if (row.stripe_payment_intent_id) {
      const outcome = await releaseOrQueue(deps, {
        booking_id: bookingId,
        share_id: row.kind === 'share' ? row.id : null,
        guarantee_id: row.kind === 'guarantee' ? row.id : null,
        intent_id: row.stripe_payment_intent_id,
        reason,
      });
      summary[outcome] += 1;
    } else if (row.kind === 'share') {
      await rpc(deps.db, 'share_released', { p_share_id: row.id, p_new_status: 'cancelled' });
    } else if (row.kind === 'guarantee') {
      await rpc(deps.db, 'guarantee_released', { p_guarantee_id: row.id });
    }
  }
  return summary;
}

export function errorText(err: unknown): string {
  const e = err as { code?: string; message?: string };
  return [e?.code, e?.message ?? String(err)].filter(Boolean).join(': ');
}
