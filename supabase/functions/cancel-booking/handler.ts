// Cancels a spot, a whole team or (venue staff) a booking, exactly as the
// quote the caller confirmed said (docs/specs/13-payments-bookings.md,
// "Cancellations and refunds"):
//   1. cancel_booking_internal, with the verified caller and the quote they
//      were shown (public.cancellation_quote), decides and records
//      everything in one transaction, and refuses (quote_changed) if what
//      would happen now isn't what they were shown;
//   2. the Stripe work it leaves is done at once: holds released, held
//      shares whose money is kept taken first, then credited (refunds wait
//      for the player's card-or-credit choice, choose-cancellation-refund);
//   3. the booker's extra charge for cancelling the whole team is taken
//      on-session, now that they've confirmed it. If their bank asks for
//      3-D Secure, the app gets the client secret to show it; if it fails,
//      the cancellation still stands and the charge is retried.
// Anything that fails here is retried by run-payment-jobs. Bookings from
// before P4a keep the old rules (cancel_booking_for) and release all their
// money as before.
import type Stripe from 'npm:stripe@^22';
import { chargeCancellationFee, runCancellationWork } from '../_shared/cancellation.ts';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { releaseBookingMoney } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Result = { status: number; body: Record<string, unknown> };
export type Scope = 'my_spot' | 'whole_team' | 'venue';
export type Body = { bookingId?: string; scope?: Scope; quote?: string };

const SCOPES = new Set<Scope>(['my_spot', 'whole_team', 'venue']);
const ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  not_your_booking: 403,
  not_your_venue: 403,
  not_in_booking: 403,
  quote_changed: 409,
  already_cancelled: 409,
};

type Plan = {
  legacy?: boolean;
  cancellation_id?: string;
  fee_id?: string | null;
  booker_fee?: { amount_cents: number; players: number } | null;
  [key: string]: unknown;
};

export async function cancelBooking(deps: Deps, callerId: string, body: Body): Promise<Result> {
  const scope = body.scope ?? 'whole_team';
  if (!body.bookingId || !SCOPES.has(scope)) return { status: 400, body: { error: 'invalid_request' } };

  let plan: Plan;
  try {
    plan = await rpc<Plan>(deps.db, 'cancel_booking_internal', {
      p_booking_id: body.bookingId,
      p_scope: scope,
      p_profile_id: callerId,
      p_expected_quote: body.quote ?? null,
    });
  } catch (err) {
    return refusal(err);
  }

  if (plan.legacy) return await cancelLegacyBooking(deps, callerId, body.bookingId, scope);

  const work = await runCancellationWork(deps, plan.cancellation_id!);
  const fee = plan.fee_id ? await chargeCancellationFee(deps, plan.fee_id) : null;
  const { legacy: _legacy, ...quote } = plan;
  return {
    status: 200,
    body: {
      cancelled: true,
      cancellationId: plan.cancellation_id,
      quote,
      // Still going back: retried until Stripe confirms.
      pending: work.failed > 0,
      fee: fee && plan.booker_fee ? { amountCents: plan.booker_fee.amount_cents, ...fee } : null,
    },
  };
}

/** Bookings made before P4a: today's rules and money handling. */
async function cancelLegacyBooking(deps: Deps, callerId: string, bookingId: string, scope: Scope): Promise<Result> {
  if (scope !== 'whole_team') return { status: 400, body: { error: 'legacy_booking' } };
  try {
    await rpc<string>(deps.db, 'cancel_booking_for', { p_booking_id: bookingId, p_profile_id: callerId });
  } catch (err) {
    return refusal(err);
  }
  const money = await releaseBookingMoney(deps, bookingId, 'booking_cancelled');
  return {
    status: 200,
    body: { cancelled: true, refunded: money.refunded > 0, released: money.cancelled > 0, pending: money.queued > 0 },
  };
}

function refusal(err: unknown): Result {
  if (!(err instanceof DbError)) throw err;
  return { status: ERROR_STATUS[err.message] ?? 400, body: { error: err.message } };
}
