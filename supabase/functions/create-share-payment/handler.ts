// Starts the payment of ONE player's share, for the exact amount the
// database computed. A player can only pay their own share.
//
// Bookings made since P4a (docs/specs/13-payments-bookings.md, "When money
// is held and taken"):
//   - the player chooses card or cash (each_pays modes); a cash player pays
//     only the service fee by card;
//   - the card is saved with the player's consent (setup_future_usage =
//     off_session) so top-ups and debts can be charged later;
//   - the share is held (manual capture) and run-payment-jobs takes it when
//     its free hour ends; less than 6 hours before kickoff it is taken at
//     once (automatic capture), and only after the player accepted "This
//     booking is non-refundable". Whether a payment counts as non-refundable
//     is checked again when Stripe reports it (stripe-webhook), so a hold
//     confirmed after the 6-hour line without the notice is refused;
//   - the player can pay the pitch part with their venue credit there
//     (useCredit, P4b): no service fee when it covers it all, otherwise the
//     rest by card plus the normal fee; the database sets the credit aside
//     with the intent and spends it when the money is held;
//   - nothing to pay by card: a SetupIntent saves the card (the each-pays
//     booker, or credit covering the pitch part); a Premium cash player who
//     isn't the booker is refused until P4c (saved_card_required).
// Bookings from before P4a keep the old hold-only intent.
//
// A share's amounts never change under an intent the player could still
// pay: the open intent is checked at Stripe (one already confirmed is never
// touched), cancelled if it doesn't match, and only then is the new intent
// put on the share together with its amounts (attach_share_intent), which
// the database refuses if anything changed meanwhile. A refused intent is
// cancelled at once (or queued).
//
// This only creates the intent. The share changes state only when the
// verified Stripe webhook says the money was held or taken.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { cardChargeCents, idempotencyKeys, type PaymentMethod } from '../_shared/money.ts';
import { releaseOrQueue } from '../_shared/release.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Caller = { id: string; email?: string | null };
export type Body = { shareId?: string; method?: PaymentMethod; acceptNonRefundable?: boolean; useCredit?: boolean };
export type Result = { status: number; body: Record<string, unknown> };

/** What public.plan_share_payment returns. */
type Plan = {
  share_id: string;
  booking_id: string;
  is_booker: boolean;
  payment_mode: string | null;
  status: string;
  payment_method: PaymentMethod;
  amount_cents: number;
  pitch_cents: number;
  fee_cents: number;
  cash_cents: number;
  credit_cents: number;
  capture_method: 'manual' | 'immediate' | null;
  non_refundable: boolean;
  stripe_payment_intent_id: string | null;
  /** The share's last SetupIntent (saving a card with nothing to charge). */
  stripe_setup_intent_id?: string | null;
  stripe_customer_id: string | null;
  needs_saved_card: boolean;
};

const ERROR_STATUS: Record<string, number> = { share_not_found: 404, not_your_share: 403 };

// An intent the player confirmed (or is confirming): never cancelled or replaced.
const SETTLED_INTENT = new Set(['requires_capture', 'processing', 'succeeded']);
// A SetupIntent the player can still confirm.
const OPEN_SETUP = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

export async function createSharePayment(deps: Deps, caller: Caller, body: Body): Promise<Result> {
  const method = body.method ?? 'card';
  if (!body.shareId || (method !== 'card' && method !== 'cash')) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
  const accept = body.acceptNonRefundable === true;
  const useCredit = body.useCredit === true;

  let plan: Plan;
  try {
    plan = await rpc<Plan>(deps.db, 'plan_share_payment', {
      p_share_id: body.shareId,
      p_profile_id: caller.id,
      p_method: method,
      p_accept_non_refundable: accept,
      p_use_credit: useCredit,
    });
  } catch (err) {
    return dbRefusal(err);
  }

  if (plan.payment_mode === null) return await legacySharePayment(deps, caller, plan);

  const customerId = plan.stripe_customer_id ?? await createCustomer(deps, caller);
  const captureMethod = plan.capture_method === 'immediate' ? 'automatic' : 'manual';
  const previous = plan.stripe_payment_intent_id;

  if (previous) {
    const existing = await deps.stripe.paymentIntents.retrieve(previous);
    if (SETTLED_INTENT.has(existing.status)) return { status: 409, body: { error: 'already_paid' } };
    if (existing.status !== 'canceled') {
      const same = !plan.needs_saved_card && existing.amount === plan.amount_cents &&
        existing.capture_method === captureMethod && existing.metadata?.method === plan.payment_method;
      if (same) {
        // Pressing "Pay" again: the same intent (the acceptance is updated).
        try {
          await attach(deps, caller, plan, accept, useCredit, previous, previous, captureMethod);
        } catch (err) {
          return dbRefusal(err);
        }
        return success(plan, customerId, existing.client_secret);
      }
      try {
        await deps.stripe.paymentIntents.cancel(previous, {}, { idempotencyKey: idempotencyKeys.cancelIntent(previous) });
      } catch (err) {
        // Confirmed just now: that payment stands, on the share's old amounts.
        const now = await deps.stripe.paymentIntents.retrieve(previous);
        if (SETTLED_INTENT.has(now.status)) return { status: 409, body: { error: 'already_paid' } };
        throw err;
      }
    }
  }

  if (plan.needs_saved_card) {
    // The share's last SetupIntent: still open, it's the same one again
    // (pressing "Pay" twice). Cancelled (credit set aside and given back
    // after 15 minutes) or refused, the new one is keyed on it, so Stripe
    // can't replay the old one.
    const previousSetup = plan.stripe_setup_intent_id ?? null;
    let reused: Stripe.SetupIntent | null = null;
    if (previousSetup) {
      const existing = await deps.stripe.setupIntents.retrieve(previousSetup);
      if (existing.status === 'processing') return { status: 409, body: { error: 'already_paid' } };
      if (OPEN_SETUP.has(existing.status)) reused = existing;
    }
    const setupIntent = reused ?? await deps.stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
      metadata: { kind: 'share_card', share_id: plan.share_id, booking_id: plan.booking_id },
    }, { idempotencyKey: idempotencyKeys.shareCardSetup(plan.share_id, plan.payment_method, previous, previousSetup) });
    try {
      await rpc(deps.db, 'attach_share_setup', {
        p_share_id: plan.share_id,
        p_profile_id: caller.id,
        p_method: plan.payment_method,
        p_setup_intent_id: setupIntent.id,
        p_expected_intent_id: previous,
        p_use_credit: useCredit,
        p_accept_non_refundable: accept,
      });
    } catch (err) {
      if (!reused) {
        await deps.stripe.setupIntents.cancel(setupIntent.id).catch((cancelErr: unknown) =>
          console.error(`create-share-payment: orphaned SetupIntent ${setupIntent.id} left open:`, cancelErr)
        );
      }
      return dbRefusal(err);
    }
    return {
      status: 200,
      body: {
        setupIntentClientSecret: setupIntent.client_secret,
        customerId,
        amountCents: 0,
        cashCents: plan.cash_cents,
        creditCents: plan.credit_cents ?? 0,
      },
    };
  }

  if (cardChargeCents(plan) !== plan.amount_cents) {
    console.error(`create-share-payment: share ${plan.share_id} amount ${plan.amount_cents} doesn't match its breakdown`);
    return { status: 500, body: { error: 'amount_mismatch' } };
  }

  const intent = await deps.stripe.paymentIntents.create({
    amount: plan.amount_cents,
    currency: 'eur',
    customer: customerId,
    setup_future_usage: 'off_session',
    capture_method: captureMethod,
    automatic_payment_methods: { enabled: true },
    metadata: {
      kind: 'share',
      share_id: plan.share_id,
      booking_id: plan.booking_id,
      profile_id: caller.id,
      method: plan.payment_method,
      fee_cents: String(plan.fee_cents),
    },
  }, {
    idempotencyKey: idempotencyKeys.shareIntent({
      shareId: plan.share_id,
      amountCents: plan.amount_cents,
      method: plan.payment_method,
      captureMethod,
      previousIntentId: previous,
    }),
  });

  try {
    await attach(deps, caller, plan, accept, useCredit, intent.id, previous, captureMethod);
  } catch (err) {
    if (!(err instanceof DbError)) throw err;
    // Something changed meanwhile (another device paid or switched): this
    // intent must never be paid.
    await releaseOrQueue(deps, { booking_id: plan.booking_id, share_id: plan.share_id, intent_id: intent.id, reason: 'orphaned_intent' });
    return dbRefusal(err);
  }
  return success(plan, customerId, intent.client_secret);
}

function attach(
  deps: Deps,
  caller: Caller,
  plan: Plan,
  accept: boolean,
  useCredit: boolean,
  intentId: string,
  previous: string | null,
  captureMethod: string,
) {
  return rpc(deps.db, 'attach_share_intent', {
    p_share_id: plan.share_id,
    p_profile_id: caller.id,
    p_method: plan.payment_method,
    p_accept_non_refundable: accept,
    p_intent_id: intentId,
    p_intent_amount_cents: plan.amount_cents,
    p_intent_capture_method: captureMethod === 'automatic' ? 'immediate' : 'manual',
    p_expected_intent_id: previous,
    p_use_credit: useCredit,
  });
}

function success(plan: Plan, customerId: string, clientSecret: string | null): Result {
  return {
    status: 200,
    body: {
      clientSecret,
      customerId,
      amountCents: plan.amount_cents,
      cashCents: plan.cash_cents,
      creditCents: plan.credit_cents ?? 0,
      nonRefundable: plan.non_refundable,
    },
  };
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

/** Bookings made before P4a: a hold-only intent, captured by the webhook
 *  once the whole roster has paid, as before. */
async function legacySharePayment(deps: Deps, caller: Caller, plan: Plan): Promise<Result> {
  if (plan.stripe_payment_intent_id) {
    const existing = await deps.stripe.paymentIntents.retrieve(plan.stripe_payment_intent_id);
    if (existing.status !== 'canceled') return { status: 200, body: { clientSecret: existing.client_secret } };
  }

  const intent = await deps.stripe.paymentIntents.create({
    amount: plan.amount_cents,
    currency: 'eur',
    capture_method: 'manual',
    automatic_payment_methods: { enabled: true },
    metadata: { share_id: plan.share_id, booking_id: plan.booking_id, profile_id: caller.id },
  }, { idempotencyKey: idempotencyKeys.legacyShareIntent(plan.share_id, plan.stripe_payment_intent_id) });

  await rpc(deps.db, 'set_share_payment_intent', { p_share_id: plan.share_id, p_intent_id: intent.id });
  return { status: 200, body: { clientSecret: intent.client_secret } };
}
