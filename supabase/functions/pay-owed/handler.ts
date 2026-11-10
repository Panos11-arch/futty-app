// "Pay what I owe" (docs/specs/13-payments-bookings.md, "Debt"; 14, P4c):
// starts the card payment of ONE of the caller's debts (to a venue or to
// Futty), or, after the match, of their unticked cash part ("Pay €6.00 by
// card now, or remain in debt to [venue]", "Cash at the venue"). Paying a
// debt is always allowed, even for a player blocked by it, and adds no fee:
// the amount is exactly what the database says is owed, and Futty absorbs
// Stripe's fee.
//
// This only creates the payment (on-session; the app confirms it). The debt
// or the cash part is settled only when the verified webhook says the money
// was taken (stripe-webhook/modes.ts: debt_paid, cash_paid_by_card). An open
// payment is reused when it's for the same amount, cancelled and replaced
// when not; one already going through is never touched.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { idempotencyKeys } from '../_shared/money.ts';
import { releaseOrQueue } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Caller = { id: string; email?: string | null };
export type Body = { debtId?: string; shareId?: string };
export type Result = { status: number; body: Record<string, unknown> };

/** What public.plan_debt_payment / plan_cash_payment return. */
type Plan = {
  kind: 'debt' | 'cash';
  debt_id?: string;
  share_id?: string;
  booking_id: string;
  amount_cents: number;
  futty_cents?: number;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
};

const ERROR_STATUS: Record<string, number> = {
  debt_not_found: 404,
  share_not_found: 404,
  not_your_debt: 403,
  not_your_share: 403,
};

// A payment going through, or already through: never replaced.
const PAYING = new Set(['processing', 'requires_capture', 'succeeded']);

export async function payOwed(deps: Deps, caller: Caller, body: Body): Promise<Result> {
  if (!body.debtId === !body.shareId) return { status: 400, body: { error: 'debt_or_share_required' } };
  const kind: 'debt' | 'cash' = body.debtId ? 'debt' : 'cash';
  const id = (body.debtId ?? body.shareId)!;

  let plan: Plan;
  try {
    plan = kind === 'debt'
      ? await rpc<Plan>(deps.db, 'plan_debt_payment', { p_debt_id: id, p_profile_id: caller.id })
      : await rpc<Plan>(deps.db, 'plan_cash_payment', { p_share_id: id, p_profile_id: caller.id });
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
    // fee_cents is Futty's part (all of a debt to Futty; a venue debt's
    // service fee; nothing of a cash part). No share_id: the webhook must
    // never take a cash part for a share payment.
    metadata: kind === 'debt'
      ? { kind: 'debt', debt_id: id, booking_id: plan.booking_id, profile_id: caller.id, fee_cents: String(plan.futty_cents ?? 0) }
      : { kind: 'cash_part', cash_share_id: id, booking_id: plan.booking_id, profile_id: caller.id, fee_cents: '0' },
  }, { idempotencyKey: idempotencyKeys.owed(kind, id, plan.amount_cents, previous) });

  try {
    if (kind === 'debt') {
      await rpc(deps.db, 'attach_debt_intent', {
        p_debt_id: id, p_profile_id: caller.id, p_intent_id: intent.id, p_amount_cents: plan.amount_cents,
        p_expected_intent_id: previous,
      });
    } else {
      await rpc(deps.db, 'attach_cash_intent', {
        p_share_id: id, p_profile_id: caller.id, p_intent_id: intent.id, p_amount_cents: plan.amount_cents,
        p_expected_intent_id: previous,
      });
    }
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
