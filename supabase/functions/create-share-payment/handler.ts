// Starts the payment of ONE player's share, for the exact amount the
// database computed. A player can only pay their own share.
//
// Bookings made since P4a (docs/specs/13-payments-bookings.md, "When money
// is held and taken"):
//   - the player chooses card or cash (each_pays modes); a cash player pays
//     only the service fee by card;
//   - the card is saved with the player's consent (setup_future_usage =
//     off_session) so top-ups and debts can be charged later;
//   - the share is held (manual capture) and run-payment-jobs takes it 60
//     minutes later; less than 6 hours before kickoff it is taken at once
//     (automatic capture), and only after the player accepted "This booking
//     is non-refundable";
//   - nothing to pay by card settles the share at once, unless the booker's
//     guarantee still needs a card: then a SetupIntent saves one.
// Bookings from before P4a keep the old hold-only intent.
//
// This only creates the intent. The share changes state only when the
// verified Stripe webhook says the money was held or taken.
import type Stripe from 'npm:stripe@^22';
import { type Db, DbError, rpc } from '../_shared/db.ts';
import { cardChargeCents, idempotencyKeys, type PaymentMethod } from '../_shared/money.ts';

export type Deps = { stripe: Stripe; db: Db };
export type Caller = { id: string; email?: string | null };
export type Body = { shareId?: string; method?: PaymentMethod; acceptNonRefundable?: boolean };
export type Result = { status: number; body: Record<string, unknown> };

/** What public.prepare_share_payment returns. */
type PreparedShare = {
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
  capture_method: 'manual' | 'immediate' | null;
  non_refundable: boolean;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  needs_saved_card: boolean;
};

const ERROR_STATUS: Record<string, number> = { share_not_found: 404, not_your_share: 403 };

// An open intent can be cancelled and replaced; one in these states can't.
const SETTLED_INTENT = new Set(['requires_capture', 'processing', 'succeeded']);

export async function createSharePayment(deps: Deps, caller: Caller, body: Body): Promise<Result> {
  const method = body.method ?? 'card';
  if (!body.shareId || (method !== 'card' && method !== 'cash')) {
    return { status: 400, body: { error: 'invalid_request' } };
  }

  let share: PreparedShare;
  try {
    share = await rpc<PreparedShare>(deps.db, 'prepare_share_payment', {
      p_share_id: body.shareId,
      p_profile_id: caller.id,
      p_method: method,
      p_accept_non_refundable: body.acceptNonRefundable === true,
    });
  } catch (err) {
    if (!(err instanceof DbError)) throw err;
    return { status: ERROR_STATUS[err.message] ?? 409, body: { error: err.message } };
  }

  if (share.payment_mode === null) return await legacySharePayment(deps, caller, share);

  if (share.status === 'paid') {
    return { status: 200, body: { paid: true, amountCents: 0, cashCents: share.cash_cents } };
  }

  const customerId = share.stripe_customer_id ?? await createCustomer(deps, caller);

  if (share.needs_saved_card) {
    const setupIntent = await deps.stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
      metadata: { kind: 'share_card', share_id: share.share_id, booking_id: share.booking_id },
    }, { idempotencyKey: idempotencyKeys.shareCardSetup(share.share_id) });
    return {
      status: 200,
      body: { setupIntentClientSecret: setupIntent.client_secret, customerId, amountCents: 0, cashCents: share.cash_cents },
    };
  }

  if (cardChargeCents(share) !== share.amount_cents) {
    console.error(`create-share-payment: share ${share.share_id} amount ${share.amount_cents} doesn't match its breakdown`);
    return { status: 500, body: { error: 'amount_mismatch' } };
  }

  const captureMethod = share.capture_method === 'immediate' ? 'automatic' : 'manual';
  const success = (clientSecret: string | null) => ({
    status: 200,
    body: {
      clientSecret,
      customerId,
      amountCents: share.amount_cents,
      cashCents: share.cash_cents,
      nonRefundable: share.non_refundable,
    },
  });

  // Pressing "Pay" again reuses the open intent; if the amount or timing
  // changed (card -> cash, or kickoff is now under 6 hours) it is replaced.
  if (share.stripe_payment_intent_id) {
    const existing = await deps.stripe.paymentIntents.retrieve(share.stripe_payment_intent_id);
    if (SETTLED_INTENT.has(existing.status)) return { status: 409, body: { error: 'already_paid' } };
    if (existing.status !== 'canceled') {
      if (existing.amount === share.amount_cents && existing.capture_method === captureMethod) {
        return success(existing.client_secret);
      }
      await deps.stripe.paymentIntents.cancel(existing.id, {}, {
        idempotencyKey: idempotencyKeys.cancelIntent(existing.id),
      });
    }
  }

  const intent = await deps.stripe.paymentIntents.create({
    amount: share.amount_cents,
    currency: 'eur',
    customer: customerId,
    setup_future_usage: 'off_session',
    capture_method: captureMethod,
    automatic_payment_methods: { enabled: true },
    metadata: { share_id: share.share_id, booking_id: share.booking_id, profile_id: caller.id },
  }, { idempotencyKey: idempotencyKeys.shareIntent(share.share_id, share.stripe_payment_intent_id) });

  await rpc(deps.db, 'set_share_payment_intent', { p_share_id: share.share_id, p_intent_id: intent.id });
  return success(intent.client_secret);
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
async function legacySharePayment(deps: Deps, caller: Caller, share: PreparedShare): Promise<Result> {
  if (share.stripe_payment_intent_id) {
    const existing = await deps.stripe.paymentIntents.retrieve(share.stripe_payment_intent_id);
    if (existing.status !== 'canceled') return { status: 200, body: { clientSecret: existing.client_secret } };
  }

  const intent = await deps.stripe.paymentIntents.create({
    amount: share.amount_cents,
    currency: 'eur',
    capture_method: 'manual',
    automatic_payment_methods: { enabled: true },
    metadata: { share_id: share.share_id, booking_id: share.booking_id, profile_id: caller.id },
  }, { idempotencyKey: idempotencyKeys.shareIntent(share.share_id, share.stripe_payment_intent_id) });

  await rpc(deps.db, 'set_share_payment_intent', { p_share_id: share.share_id, p_intent_id: intent.id });
  return { status: 200, body: { clientSecret: intent.client_secret } };
}
