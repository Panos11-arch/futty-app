// "Pay the whole pitch and play" (docs/specs/13-payments-bookings.md,
// "Invites, after payment"; Booking v2, B1c part 2b): with no side B 24
// hours before kickoff, the captain left on his own pays the other half in
// the app, in Stripe's payment sheet (decided 23 November): one payment, the
// other half plus that half's players at his way to pay's fee, exactly what
// the database says (plan_other_half_payment).
//
// This only creates the payment (on-session; the app confirms it). The
// choice counts only when the verified webhook says the money was taken
// (stripe-webhook/modes.ts: other_half_paid). An open payment is reused when
// it's for the same amount, cancelled and replaced when not; one already
// going through is never touched.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { idempotencyKeys } from '../_shared/money.ts';
import { releaseOrQueue } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Caller = { id: string; email?: string | null };
export type Body = { bookingId?: string };
export type Result = { status: number; body: Record<string, unknown> };

/** What public.plan_other_half_payment returns. */
type Plan = {
  payment_id: string;
  booking_id: string;
  pitch_cents: number;
  fee_cents: number;
  amount_cents: number;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
};

const ERROR_STATUS: Record<string, number> = {
  not_your_booking: 403,
  payment_not_found: 404,
};

// A payment going through, or already through: never replaced.
const PAYING = new Set(['processing', 'requires_capture', 'succeeded']);

export async function payOtherHalf(deps: Deps, caller: Caller, body: Body): Promise<Result> {
  if (!body.bookingId) return { status: 400, body: { error: 'booking_required' } };

  let plan: Plan;
  try {
    plan = await rpc<Plan>(deps.db, 'plan_other_half_payment', { p_booking_id: body.bookingId, p_profile_id: caller.id });
  } catch (err) {
    return dbRefusal(err);
  }
  const customerId = plan.stripe_customer_id ?? await createCustomer(deps, caller);

  const previous = plan.stripe_payment_intent_id;
  if (previous) {
    const existing = await deps.stripe.paymentIntents.retrieve(previous);
    if (PAYING.has(existing.status)) return { status: 409, body: { error: 'already_paid' } };
    if (existing.status !== 'canceled') {
      if (existing.amount === plan.amount_cents) {
        return { status: 200, body: { clientSecret: existing.client_secret, customerId, amountCents: plan.amount_cents } };
      }
      await deps.stripe.paymentIntents.cancel(previous, {}, { idempotencyKey: idempotencyKeys.cancelIntent(previous) });
    }
  }

  const intent = await deps.stripe.paymentIntents.create({
    amount: plan.amount_cents,
    currency: 'eur',
    customer: customerId,
    automatic_payment_methods: { enabled: true },
    // fee_cents is Futty's part: the other half's players' service fees.
    metadata: {
      kind: 'other_half',
      other_half_id: plan.payment_id,
      booking_id: plan.booking_id,
      profile_id: caller.id,
      fee_cents: String(plan.fee_cents),
    },
  }, { idempotencyKey: idempotencyKeys.otherHalf(plan.payment_id, plan.amount_cents, previous) });

  try {
    await rpc(deps.db, 'attach_other_half_intent', {
      p_payment_id: plan.payment_id,
      p_profile_id: caller.id,
      p_intent_id: intent.id,
      p_amount_cents: plan.amount_cents,
      p_expected_intent_id: previous,
    });
  } catch (err) {
    if (!(err instanceof DbError)) throw err;
    // Something changed meanwhile: this payment must never be paid.
    await releaseOrQueue(deps, { booking_id: plan.booking_id, intent_id: intent.id, reason: 'orphaned_intent' });
    return dbRefusal(err);
  }
  return { status: 200, body: { clientSecret: intent.client_secret, customerId, amountCents: plan.amount_cents } };
}

function dbRefusal(err: unknown): Result {
  if (!(err instanceof DbError)) throw err;
  return { status: ERROR_STATUS[err.message] ?? 409, body: { error: err.message } };
}

async function createCustomer(deps: Deps, caller: Caller): Promise<string> {
  const customer = await deps.stripe.customers.create({
    email: caller.email ?? undefined,
    metadata: { profile_id: caller.id },
  }, { idempotencyKey: idempotencyKeys.customer(caller.id) });
  await rpc(deps.db, 'set_stripe_customer', { p_profile_id: caller.id, p_customer_id: customer.id });
  return customer.id;
}
