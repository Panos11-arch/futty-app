// The payment timing job (docs/specs/13-payments-bookings.md, "When money is
// held and taken"), for bookings made since P4a:
//   1. takes (captures) every share held 60 minutes ago or more;
//   2. places every booker's guarantee hold that is due (72 hours before
//      kickoff, or a retry 6 hours after a failure).
// Which ones are due is decided in the database, in Cyprus time.
import { type Db, rpc } from '../_shared/db.ts';
import { type DueGuarantee, placeGuaranteeHold } from '../_shared/guarantee.ts';
import { idempotencyKeys } from '../_shared/money.ts';
import type Stripe from 'npm:stripe@^22';

export type Deps = { stripe: Stripe; db: Db };

type DueShare = { share_id: string; booking_id: string; stripe_payment_intent_id: string; amount_cents: number };

export async function runPaymentJobs(deps: Deps) {
  const summary = { captured: 0, captureFailed: 0, held: 0, holdFailed: 0 };

  for (const share of await rpc<DueShare[]>(deps.db, 'shares_due_for_capture')) {
    try {
      // The same key on every run: if a run dies after Stripe captured, the
      // next run's capture is the same request, not a second charge.
      const intent = await deps.stripe.paymentIntents.capture(share.stripe_payment_intent_id, {}, {
        idempotencyKey: idempotencyKeys.capture(share.share_id),
      });
      await rpc(deps.db, 'share_captured', { p_share_id: share.share_id, p_amount_cents: intent.amount_received });
      summary.captured += 1;
    } catch (err) {
      // Left 'authorized': the next run tries again.
      console.error(`run-payment-jobs: capture failed for share ${share.share_id}:`, err);
      summary.captureFailed += 1;
    }
  }

  for (const guarantee of await rpc<DueGuarantee[]>(deps.db, 'guarantees_due_for_hold', {})) {
    const result = await placeGuaranteeHold(deps, guarantee);
    if (result === 'held') summary.held += 1;
    if (result === 'failed') summary.holdFailed += 1;
  }

  return summary;
}
