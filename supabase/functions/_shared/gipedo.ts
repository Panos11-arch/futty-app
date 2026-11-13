// Gipedo Pano jobs (docs/specs/13-payments-bookings.md, "Gipedo Pano"; P8),
// run by run-payment-jobs every minute:
//   1. an opponent's offer whose hold wasn't placed within 15 minutes
//      lapses and the post reopens (gipedo_lapse_offers);
//   2. 24 hours before kickoff with no opponent, the post closes and the
//      booking captain chooses: play as normal or cancel free
//      (gipedo_no_opponent_due); with no choice by 6 hours before kickoff it
//      is cancelled free (gipedo_auto_cancel_due). A cancelled booking's hold
//      is released by the job's usual release step;
//   3. every match with a final result settles its holds
//      (gipedo_settle_from_results);
//   4. each settlement due is carried out at Stripe: what it says is taken
//      from the hold (a partial capture, amount_to_capture) and the rest
//      released, or the whole hold released when it pays nothing. A hold
//      that is already gone (expired) is reported 'gone': the database turns
//      what it should have paid into a debt. A failure is tried again after
//      a back-off (gipedo_settlement_failed).
// The database decides what is due and what each hold pays; every Stripe
// call is keyed on our settlement id, so a retry never moves money
// twice. One item failing never stops the others.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from './db.ts';
import { idempotencyKeys } from './money.ts';
import { errorText, stripeFeeCents } from './release.ts';

export type Deps = { stripe: Stripe; db: Db };

export type DueSettlement = {
  settlement_id: string;
  booking_id: string;
  share_id: string;
  stripe_payment_intent_id: string | null;
  capture_cents: number;
  hold_live: boolean;
};

type Outcome = 'captured' | 'released' | 'gone';

const EXPAND = ['latest_charge.balance_transaction'];

export async function runGipedoJobs(deps: Deps) {
  const summary = { lapsed: 0, noOpponent: 0, autoCancelled: 0, settled: 0, captured: 0, released: 0, gone: 0, failed: 0 };

  // Each step on its own: one failing never stops the next.
  for (const [key, fn] of [
    ['lapsed', 'gipedo_lapse_offers'],
    ['noOpponent', 'gipedo_no_opponent_due'],
    ['autoCancelled', 'gipedo_auto_cancel_due'],
    ['settled', 'gipedo_settle_from_results'],
  ] as const) {
    try {
      summary[key] = await rpc<number>(deps.db, fn);
    } catch (err) {
      console.error(`gipedo: ${fn} failed:`, err);
    }
  }

  for (const due of await rpc<DueSettlement[]>(deps.db, 'gipedo_settlements_due')) {
    try {
      summary[await carryOut(deps, due)] += 1;
    } catch (err) {
      console.error(`gipedo: settlement ${due.settlement_id} failed:`, err);
      summary.failed += 1;
      try {
        await rpc(deps.db, 'gipedo_settlement_failed', { p_settlement_id: due.settlement_id, p_error: errorText(err) });
      } catch (recordErr) {
        console.error(`gipedo: couldn't record the failure of settlement ${due.settlement_id}:`, recordErr);
      }
    }
  }
  return summary;
}

/** One settlement at Stripe, then recorded. When a call fails, the intent
 *  is looked up: one already taken (a run that died) or already gone
 *  (expired) is recorded as it is; anything else is retried later. */
async function carryOut(deps: Deps, due: DueSettlement): Promise<Outcome> {
  const intentId = due.stripe_payment_intent_id;
  if (!due.hold_live || !intentId) return await done(deps, due, 'gone');

  if (due.capture_cents > 0) {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await deps.stripe.paymentIntents.capture(
        intentId,
        { amount_to_capture: due.capture_cents, expand: EXPAND },
        { idempotencyKey: idempotencyKeys.gipedoCapture(due.settlement_id, due.capture_cents) },
      );
    } catch (err) {
      intent = await deps.stripe.paymentIntents.retrieve(intentId, { expand: EXPAND });
      if (intent.status === 'canceled') return await done(deps, due, 'gone');
      if (intent.status !== 'succeeded') throw err;
    }
    if (intent.amount_received !== due.capture_cents) {
      throw new Error(`gipedo_amount_mismatch: ${intent.id} took ${intent.amount_received}, expected ${due.capture_cents}`);
    }
    return await done(deps, due, 'captured', intent.amount_received, stripeFeeCents(intent));
  }

  try {
    await deps.stripe.paymentIntents.cancel(intentId, {}, { idempotencyKey: idempotencyKeys.gipedoRelease(due.settlement_id) });
  } catch (err) {
    const intent = await deps.stripe.paymentIntents.retrieve(intentId);
    if (intent.status !== 'canceled') throw err;
  }
  return await done(deps, due, 'released');
}

async function done(deps: Deps, due: DueSettlement, outcome: Outcome, amountCents?: number, stripeFeeCents?: number) {
  await rpc(deps.db, 'gipedo_settlement_done', {
    p_settlement_id: due.settlement_id,
    p_outcome: outcome,
    p_amount_cents: amountCents ?? null,
    p_stripe_fee_cents: stripeFeeCents ?? null,
  });
  return outcome;
}
