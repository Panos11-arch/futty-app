// Venue credit set aside for a payment that's never finished goes back
// (docs/specs/13-payments-bookings.md, "Venue credit"; P4b), so a player's
// credit never stays locked. run-payment-jobs, for every share whose
// payment set credit aside 15 minutes ago or more and is still unpaid:
//   - checks the intent (or SetupIntent) at Stripe: one that's held,
//     processing or paid is left to its webhook, which spends the credit;
//   - otherwise marks it as the job's (credit_release_started) and cancels
//     it, keyed on its id, so it can never be paid with credit that has
//     gone back. Only a cancel the job marked may reopen a booking; any
//     other cancelled hold leaves the booking as it is and alerts the
//     founders (release_share_credit_reservation);
//   - then releases the credit (release_share_credit_reservation, which
//     does nothing if the share's payment changed meanwhile). A hold that
//     landed between the check and the cancel is undone there as well: the
//     share is unpaid again and its spent credit comes back.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from './db.ts';
import { idempotencyKeys } from './money.ts';

export type Deps = { stripe: Stripe; db: Db };

type Reservation = {
  share_id: string;
  booking_id: string;
  stripe_payment_intent_id: string | null;
  stripe_setup_intent_id: string | null;
};

const PAID_OR_PAYING = new Set(['requires_capture', 'processing', 'succeeded']);

/** What happened to each: released, left to its webhook (paying), or failed (next run). */
export async function releaseUnfinishedCreditReservations(deps: Deps) {
  const summary = { released: 0, left: 0, failed: 0 };
  for (const r of await rpc<Reservation[]>(deps.db, 'credit_reservations_to_release')) {
    try {
      if (r.stripe_payment_intent_id) {
        const intent = await deps.stripe.paymentIntents.retrieve(r.stripe_payment_intent_id);
        if (PAID_OR_PAYING.has(intent.status)) {
          summary.left += 1;
          continue;
        }
        if (intent.status !== 'canceled') {
          // Marked first, so the cancelled event that follows is known to
          // be ours: only this job's cancel may reopen the booking. Not the
          // share's payment any more: a new one started, next run looks again.
          if (!await rpc<boolean>(deps.db, 'credit_release_started', { p_share_id: r.share_id, p_intent_id: intent.id })) {
            summary.left += 1;
            continue;
          }
          await deps.stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(intent.id) });
        }
      } else if (r.stripe_setup_intent_id) {
        const setupIntent = await deps.stripe.setupIntents.retrieve(r.stripe_setup_intent_id);
        if (setupIntent.status === 'succeeded' || setupIntent.status === 'processing') {
          summary.left += 1;
          continue;
        }
        if (setupIntent.status !== 'canceled') {
          await deps.stripe.setupIntents.cancel(setupIntent.id, {}, {
            idempotencyKey: idempotencyKeys.cancelIntent(setupIntent.id),
          });
        }
      }
      // The intent is cancelled at Stripe now, so any hold on it is gone. If
      // the player confirmed between the check and the cancel, the webhook
      // may already have marked the share held and spent the credit: the
      // database undoes that too (p_hold_released) and gives the credit back.
      await rpc(deps.db, 'release_share_credit_reservation', {
        p_share_id: r.share_id,
        p_intent_id: r.stripe_payment_intent_id ?? r.stripe_setup_intent_id,
        p_hold_released: r.stripe_payment_intent_id !== null,
      });
      summary.released += 1;
    } catch (err) {
      // Still set aside: found again next run.
      console.error(`credit reservation on share ${r.share_id}: release failed, retried next run:`, err);
      summary.failed += 1;
    }
  }
  return summary;
}
