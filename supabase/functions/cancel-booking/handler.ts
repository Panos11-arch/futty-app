// Cancels a booking and gives the money back: releases every hold that
// was never taken, refunds every share that was taken, and releases the
// booker's guarantee hold. The rules of who may cancel and when are
// today's (cancel_booking_for); P4b replaces them with spec 13's
// cancellation table.
//
// Order matters: cancel_booking_for runs first, with the verified caller, so
// a refused cancellation never touches money. Every Stripe call carries an
// idempotency key from our ids and every release and refund is written to
// the money ledger.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { idempotencyKeys } from '../_shared/money.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Result = { status: number; body: Record<string, unknown> };

/** A row of public.booking_money_to_release. */
type MoneyRow = {
  kind: 'share' | 'guarantee' | 'booking';
  id: string;
  status: string;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
};

const REASON = 'booking_cancelled';

export async function cancelBooking(deps: Deps, callerId: string, bookingId: string): Promise<Result> {
  let previousStatus: string;
  try {
    previousStatus = await rpc<string>(deps.db, 'cancel_booking_for', { p_booking_id: bookingId, p_profile_id: callerId });
  } catch (err) {
    if (!(err instanceof DbError)) throw err;
    return { status: 400, body: { error: err.message } };
  }

  const record = (row: MoneyRow, kind: 'cancel' | 'refund') =>
    rpc(deps.db, 'record_money_movement', {
      p_booking_id: bookingId,
      p_share_id: row.kind === 'share' ? row.id : null,
      p_guarantee_id: row.kind === 'guarantee' ? row.id : null,
      p_kind: kind,
      p_amount_cents: row.amount_cents,
      p_stripe_id: row.stripe_payment_intent_id,
      p_reason: REASON,
    });
  const cancelIntent = (intentId: string) =>
    deps.stripe.paymentIntents.cancel(intentId, {}, { idempotencyKey: idempotencyKeys.cancelIntent(intentId) });

  let refunded = false;
  let released = false;

  for (const row of await rpc<MoneyRow[]>(deps.db, 'booking_money_to_release', { p_booking_id: bookingId })) {
    try {
      if (row.kind === 'share') {
        if (row.status === 'authorized' && row.stripe_payment_intent_id) {
          await cancelIntent(row.stripe_payment_intent_id);
          await record(row, 'cancel');
          released = true;
        } else if (row.status === 'paid' && row.stripe_payment_intent_id) {
          await deps.stripe.refunds.create(
            { payment_intent: row.stripe_payment_intent_id },
            { idempotencyKey: idempotencyKeys.refundShare(row.id) },
          );
          await record(row, 'refund');
          refunded = true;
        } else if (row.status === 'pending' && row.stripe_payment_intent_id) {
          // Started paying but never finished: cancel the intent so it can't
          // complete later. No money was held, so nothing to record.
          await cancelIntent(row.stripe_payment_intent_id).catch(() => {});
        }
        await rpc(deps.db, 'share_released', {
          p_share_id: row.id,
          p_new_status: row.status === 'paid' ? 'refunded' : 'cancelled',
        });
      } else if (row.kind === 'guarantee') {
        if (row.status === 'held' && row.stripe_payment_intent_id) {
          await cancelIntent(row.stripe_payment_intent_id);
          await record(row, 'cancel');
          released = true;
        }
        await rpc(deps.db, 'guarantee_released', { p_guarantee_id: row.id });
      } else if (previousStatus === 'confirmed' && row.stripe_payment_intent_id) {
        // A booking from before split payments, paid as one intent.
        await deps.stripe.refunds.create(
          { payment_intent: row.stripe_payment_intent_id },
          { idempotencyKey: idempotencyKeys.refundBooking(bookingId) },
        );
        await record(row, 'refund');
        refunded = true;
      }
    } catch (err) {
      // Keep going: one Stripe failure must not leave everyone else's card
      // held. This one stays as it was, for follow-up.
      console.error(`cancel-booking: Stripe action failed for ${row.kind} ${row.id}:`, err);
    }
  }

  return { status: 200, body: { cancelled: true, refunded, released } };
}
