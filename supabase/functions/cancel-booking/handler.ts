// Cancels a booking and gives the money back: every hold that was never
// taken is released, every payment that was taken is refunded (including
// one taken at the very moment of cancelling), and the booker's guarantee
// hold is released. The rules of who may cancel and when are today's
// (cancel_booking_for); P4b replaces them with spec 13's cancellation table.
//
// Order matters: cancel_booking_for runs first, with the verified caller, so
// a refused cancellation never touches money. Every Stripe call carries an
// idempotency key from our ids and every release and refund is written to
// the money ledger. A Stripe failure is never swallowed: that release goes
// on the retry queue, which run-payment-jobs works through until it succeeds.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { releaseBookingMoney } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Result = { status: number; body: Record<string, unknown> };

export async function cancelBooking(deps: Deps, callerId: string, bookingId: string): Promise<Result> {
  try {
    await rpc<string>(deps.db, 'cancel_booking_for', { p_booking_id: bookingId, p_profile_id: callerId });
  } catch (err) {
    if (!(err instanceof DbError)) throw err;
    return { status: 400, body: { error: err.message } };
  }

  const money = await releaseBookingMoney(deps, bookingId, 'booking_cancelled');
  return {
    status: 200,
    body: {
      cancelled: true,
      refunded: money.refunded > 0,
      released: money.cancelled > 0,
      // Still going back: retried until Stripe confirms.
      pending: money.queued > 0,
    },
  };
}
