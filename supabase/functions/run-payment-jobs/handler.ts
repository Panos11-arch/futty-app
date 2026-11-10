// The payment timing job (docs/specs/13-payments-bookings.md, "When money is
// held and taken"), for bookings made since P4a:
//   1. takes (captures) every share whose free hour is over (60 minutes
//      after its hold, or 6 hours before kickoff if that's sooner); a failed
//      capture is tried again after 1, 5, 15, 60 minutes, then hourly, and
//      the third failure raises an admin alert (share_capture_failed);
//   2. cancels every booking whose booker didn't complete payment within 15
//      minutes, releasing its pitches and any money on it. What the booker
//      started (a payment, or a card saved with a SetupIntent) is checked at
//      Stripe first and judged by Stripe's event time;
//   3. finishes giving back the money on every cancelled booking that still
//      has some (a release run that died part-way);
//   4. places every booker's guarantee hold that is due (72 hours before
//      kickoff, or a retry 6 hours after a failure, until kickoff), and
//      looks up at Stripe any hold that got no answer;
//   5. retries every release or refund that failed before;
//   6. cancellations (P4b): finishes any Stripe work a cancellation left
//      (a hold to release, a kept share to take), sends the card refund to
//      every player who didn't choose credit within 48 hours, retries the
//      booker's whole-team charge every 6 hours until the original
//      kickoff, and expires venue credit 12 months after it was issued;
//   7. gives back venue credit set aside for a payment not completed within
//      15 minutes (the intent is cancelled at Stripe first).
// Which ones are due is decided in the database, in Cyprus time. One item
// failing never stops the others.
import type Stripe from 'npm:stripe@^22';
import { type Db, rpc } from '../_shared/db.ts';
import { type DueGuarantee, placeGuaranteeHold } from '../_shared/guarantee.ts';
import { runCancellationFees, runCancellationWork } from '../_shared/cancellation.ts';
import { releaseUnfinishedCreditReservations } from '../_shared/credit.ts';
import { idempotencyKeys } from '../_shared/money.ts';
import { errorText, releaseBookingMoney, releaseOrQueue, runReleaseQueue, stripeFeeCents } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };

type DueShare = { share_id: string; booking_id: string; stripe_payment_intent_id: string; amount_cents: number };
type Expiring = {
  booking_id: string;
  booker_share_id?: string | null;
  booker_intent_id: string | null;
  booker_setup_intent_id?: string | null;
  booked_at?: string;
};

// The booker's payment went through (or is going through): its webhook
// decides, by the time Stripe says it happened.
const PAID_OR_PAYING = new Set(['requires_capture', 'processing', 'succeeded']);

export async function runPaymentJobs(deps: Deps) {
  const summary = {
    captured: 0, captureFailed: 0, refunded: 0,
    expired: 0,
    resumed: 0,
    held: 0, holdFailed: 0, holdRetry: 0,
    released: 0, releaseFailed: 0,
    cancellationDone: 0, cancellationFailed: 0,
    feePaid: 0, feeFailed: 0, feeRetry: 0,
    creditExpired: 0,
    creditReleased: 0,
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
      // Left 'authorized', tried again after its back-off.
      console.error(`run-payment-jobs: capture failed for share ${share.share_id}:`, err);
      summary.captureFailed += 1;
      try {
        await rpc(deps.db, 'share_capture_failed', { p_share_id: share.share_id, p_error: errorText(err) });
      } catch (recordErr) {
        console.error(`run-payment-jobs: couldn't record the failed capture of share ${share.share_id}:`, recordErr);
      }
    }
  }

  for (const booking of await rpc<Expiring[]>(deps.db, 'bookings_past_payment_window')) {
    try {
      if (await expireIfUnpaid(deps, booking)) summary.expired += 1;
    } catch (err) {
      // Left as it is: the next run looks again.
      console.error(`run-payment-jobs: payment window check failed for booking ${booking.booking_id}:`, err);
    }
  }

  for (const { booking_id } of await rpc<{ booking_id: string }[]>(deps.db, 'bookings_with_money_to_release')) {
    try {
      await releaseBookingMoney(deps, booking_id, 'booking_cancelled');
      summary.resumed += 1;
    } catch (err) {
      // Still on the booking: found again next run.
      console.error(`run-payment-jobs: finishing the release of booking ${booking_id} failed:`, err);
    }
  }

  for (const guarantee of await rpc<DueGuarantee[]>(deps.db, 'guarantees_due_for_hold', {})) {
    try {
      const result = await placeGuaranteeHold(deps, guarantee);
      if (result === 'held') summary.held += 1;
      if (result === 'failed') summary.holdFailed += 1;
      if (result === 'retry') summary.holdRetry += 1;
    } catch (err) {
      console.error(`run-payment-jobs: guarantee ${guarantee.guarantee_id} failed:`, err);
    }
  }

  const queue = await runReleaseQueue(deps);
  summary.released = queue.released;
  summary.releaseFailed = queue.failed;

  // One part failing never stops the others.
  try {
    const work = await runCancellationWork(deps, null);
    summary.cancellationDone = work.done;
    summary.cancellationFailed = work.failed;
  } catch (err) {
    console.error('run-payment-jobs: cancellation work failed:', err);
  }
  try {
    const fees = await runCancellationFees(deps);
    summary.feePaid = fees.paid;
    summary.feeFailed = fees.failed;
    summary.feeRetry = fees.retry;
  } catch (err) {
    console.error('run-payment-jobs: cancellation charges failed:', err);
  }
  try {
    // Safe on every run: only credit past its expiry, once.
    summary.creditExpired = await rpc<number>(deps.db, 'expire_venue_credits');
  } catch (err) {
    console.error('run-payment-jobs: expiring credit failed:', err);
  }
  try {
    summary.creditReleased = (await releaseUnfinishedCreditReservations(deps)).released;
  } catch (err) {
    console.error('run-payment-jobs: releasing unfinished credit failed:', err);
  }

  return summary;
}

/** A booking past its 15-minute window: what the booker started is checked
 *  at Stripe; a payment that went through is left to its webhook, a card
 *  saved in time counts by Stripe's event time. Otherwise whatever the
 *  booker started is cancelled, so it can't complete late, and the booking
 *  expires. Returns whether it expired. */
async function expireIfUnpaid(deps: Deps, booking: Expiring): Promise<boolean> {
  if (booking.booker_intent_id) {
    const intent = await deps.stripe.paymentIntents.retrieve(booking.booker_intent_id);
    if (PAID_OR_PAYING.has(intent.status)) return false;
    if (intent.status !== 'canceled') {
      await deps.stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(intent.id) });
    }
  } else if (booking.booker_setup_intent_id) {
    const setupIntent = await deps.stripe.setupIntents.retrieve(booking.booker_setup_intent_id);
    if (setupIntent.status === 'processing') return false;
    if (setupIntent.status === 'succeeded') return await settleSavedCard(deps, booking, setupIntent);
    if (setupIntent.status !== 'canceled') {
      await deps.stripe.setupIntents.cancel(setupIntent.id, {}, { idempotencyKey: idempotencyKeys.cancelIntent(setupIntent.id) });
    }
  }

  if (await rpc<boolean>(deps.db, 'expire_unpaid_booking', { p_booking_id: booking.booking_id })) {
    await releaseBookingMoney(deps, booking.booking_id, 'payment_window_expired');
    return true;
  }
  return false;
}

/** The booker saved their card: settled exactly as the webhook would, at
 *  the time of Stripe's setup_intent.succeeded event. Inside the window it
 *  counts; after it, the booking expires and its money goes back. */
async function settleSavedCard(deps: Deps, booking: Expiring, setupIntent: Stripe.SetupIntent): Promise<boolean> {
  const at = await savedAt(deps.stripe, setupIntent.id, booking.booked_at);
  if (!at) return false; // Stripe hasn't listed the event yet: next run.
  const pm = setupIntent.payment_method;
  const result = await rpc<{ result: string }>(deps.db, 'share_card_saved', {
    p_share_id: booking.booker_share_id,
    p_setup_intent_id: setupIntent.id,
    p_payment_method_id: typeof pm === 'string' ? pm : pm?.id ?? null,
    p_at: at,
  });
  if (result.result !== 'expired') return false;
  await releaseBookingMoney(deps, booking.booking_id, 'payment_window_expired');
  return true;
}

/** When Stripe says this SetupIntent succeeded: its setup_intent.succeeded
 *  event, made since the booking. */
async function savedAt(stripe: Stripe, setupIntentId: string, bookedAt: string | undefined): Promise<string | null> {
  const since = bookedAt ? Math.floor(Date.parse(bookedAt) / 1000) : undefined;
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.events.list({
      type: 'setup_intent.succeeded',
      ...(since !== undefined ? { created: { gte: since } } : {}),
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const event = page.data.find((e) => (e.data.object as { id?: string }).id === setupIntentId);
    if (event) return new Date(event.created * 1000).toISOString();
    if (!page.has_more || page.data.length === 0) return null;
    startingAfter = page.data[page.data.length - 1].id;
  }
}
