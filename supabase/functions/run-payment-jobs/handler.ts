// The payment timing job (docs/specs/13-payments-bookings.md, "When money is
// held and taken"), for bookings made since P4a:
//   1. takes (captures) every share whose free hour is over (60 minutes
//      after its hold, or 6 hours before kickoff if that's sooner);
//   2. cancels every booking whose booker didn't complete payment within 15
//      minutes, releasing its pitches and any money on it;
//   3. places every booker's guarantee hold that is due (72 hours before
//      kickoff, or a retry 6 hours after a failure, until kickoff);
//   4. retries every release or refund that failed before.
// Which ones are due is decided in the database, in Cyprus time.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from '../_shared/db.ts';
import { type DueGuarantee, placeGuaranteeHold } from '../_shared/guarantee.ts';
import { idempotencyKeys } from '../_shared/money.ts';
import { releaseBookingMoney, releaseOrQueue, runReleaseQueue, stripeFeeCents } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };

type DueShare = { share_id: string; booking_id: string; stripe_payment_intent_id: string; amount_cents: number };
type Expiring = { booking_id: string; booker_intent_id: string | null };

// The booker's payment went through (or is going through): its webhook
// decides, by the time Stripe says it happened.
const PAID_OR_PAYING = new Set(['requires_capture', 'processing', 'succeeded']);

export async function runPaymentJobs(deps: Deps) {
  const summary = {
    captured: 0, captureFailed: 0, refunded: 0,
    expired: 0,
    held: 0, holdFailed: 0,
    released: 0, releaseFailed: 0,
  };

  for (const share of await rpc<DueShare[]>(deps.db, 'shares_due_for_capture')) {
    try {
      // The same key on every run: if a run dies after Stripe captured, the
      // next run's capture is the same request, not a second charge.
      const intent = await deps.stripe.paymentIntents.capture(
        share.stripe_payment_intent_id,
        { expand: ['latest_charge.balance_transaction'] },
        { idempotencyKey: idempotencyKeys.capture(share.share_id) },
      );
      const result = await rpc<{ result: string; reason?: string }>(deps.db, 'share_captured', {
        p_share_id: share.share_id,
        p_amount_cents: intent.amount_received,
        p_stripe_fee_cents: stripeFeeCents(intent),
      });
      if (result.result === 'refund') {
        // The booking was cancelled while this was being taken.
        await releaseOrQueue(deps, {
          booking_id: share.booking_id, share_id: share.share_id, intent_id: intent.id, reason: result.reason ?? 'booking_cancelled',
        });
        summary.refunded += 1;
      } else {
        summary.captured += 1;
      }
    } catch (err) {
      // Left 'authorized': the next run tries again.
      console.error(`run-payment-jobs: capture failed for share ${share.share_id}:`, err);
      summary.captureFailed += 1;
    }
  }

  for (const booking of await rpc<Expiring[]>(deps.db, 'bookings_past_payment_window')) {
    try {
      if (booking.booker_intent_id) {
        const intent = await deps.stripe.paymentIntents.retrieve(booking.booker_intent_id);
        if (PAID_OR_PAYING.has(intent.status)) continue;
        if (intent.status !== 'canceled') {
          // So it can't be paid after the window.
          await deps.stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(intent.id) });
        }
      }
      if (await rpc<boolean>(deps.db, 'expire_unpaid_booking', { p_booking_id: booking.booking_id })) {
        await releaseBookingMoney(deps, booking.booking_id, 'payment_window_expired');
        summary.expired += 1;
      }
    } catch (err) {
      // Left as it is: the next run looks again.
      console.error(`run-payment-jobs: payment window check failed for booking ${booking.booking_id}:`, err);
    }
  }

  for (const guarantee of await rpc<DueGuarantee[]>(deps.db, 'guarantees_due_for_hold', {})) {
    const result = await placeGuaranteeHold(deps, guarantee);
    if (result === 'held') summary.held += 1;
    if (result === 'failed') summary.holdFailed += 1;
  }

  const queue = await runReleaseQueue(deps);
  summary.released = queue.released;
  summary.releaseFailed = queue.failed;

  return summary;
}
