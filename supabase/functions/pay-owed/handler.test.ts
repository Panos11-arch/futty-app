// pay-owed: "Pay what I owe" (docs/specs/13-payments-bookings.md, "Debt":
// paying a debt adds no fee) and "Pay €6.00 by card now" for an unticked
// cash player after the match ("Cash at the venue").
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { payOwed } from './handler.ts';

const caller = { id: 'p1', email: 'p1@futty.test' };

const debtPlan = {
  kind: 'debt', debt_id: 'd1', booking_id: 'b1', owed_to: 'venue', venue_id: 'v1',
  amount_cents: 680, venue_cents: 600, futty_cents: 80, stripe_payment_intent_id: null, stripe_customer_id: 'cus_1',
};
const cashPlan = {
  kind: 'cash', share_id: 's1', booking_id: 'b1', venue_id: 'v1', amount_cents: 600,
  stripe_payment_intent_id: null, stripe_customer_id: 'cus_1',
};

function setup() {
  const db = createDbFake();
  db.respond('plan_debt_payment', debtPlan);
  db.respond('plan_cash_payment', cashPlan);
  db.respond('attach_debt_intent', null);
  db.respond('attach_cash_intent', null);
  db.respond('set_stripe_customer', null);
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund', 'record_intent_cancelled']) {
    db.respond(fn, true);
  }
  db.respond('money_release_done', null);
  db.respond('queue_money_release', 'r1');
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.create', (call: { params?: Record<string, unknown> }) =>
    ({ id: 'pi_new', status: 'requires_payment_method', amount: call.params?.amount, client_secret: 'pi_new_secret' }));
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  stripe.respond('customers.create', { id: 'cus_new' });
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('a debt is paid for exactly what is owed, with no fee added, on the player\'s customer', async () => {
  const { db, stripe, deps } = setup();

  const result = await payOwed(deps, caller, { debtId: 'd1' });

  deepStrictEqual(result, { status: 200, body: { clientSecret: 'pi_new_secret', customerId: 'cus_1', amountCents: 680 } });
  deepStrictEqual(db.callsTo('plan_debt_payment')[0].args, { p_debt_id: 'd1', p_profile_id: 'p1' });
  const [create] = stripe.callsTo('paymentIntents.create');
  deepStrictEqual(create.params, {
    amount: 680,
    currency: 'eur',
    customer: 'cus_1',
    automatic_payment_methods: { enabled: true },
    metadata: { kind: 'debt', debt_id: 'd1', booking_id: 'b1', profile_id: 'p1', fee_cents: '80' },
  });
  strictEqual(create.idempotencyKey, 'owed-debt-d1-680-after-none');
  deepStrictEqual(db.callsTo('attach_debt_intent')[0].args, {
    p_debt_id: 'd1', p_profile_id: 'p1', p_intent_id: 'pi_new', p_amount_cents: 680, p_expected_intent_id: null,
  });
});

Deno.test('the cash part after the match: 600 by card, no fee, all of it the venue\'s', async () => {
  const { db, stripe, deps } = setup();
  const result = await payOwed(deps, caller, { shareId: 's1' });
  strictEqual(result.status, 200);
  strictEqual(result.body.amountCents, 600);
  const [create] = stripe.callsTo('paymentIntents.create');
  strictEqual(create.params?.amount, 600);
  deepStrictEqual(create.params?.metadata, { kind: 'cash_part', cash_share_id: 's1', booking_id: 'b1', profile_id: 'p1', fee_cents: '0' });
  strictEqual(create.idempotencyKey, 'owed-cash-s1-600-after-none');
  deepStrictEqual(db.callsTo('attach_cash_intent')[0].args, {
    p_share_id: 's1', p_profile_id: 'p1', p_intent_id: 'pi_new', p_amount_cents: 600, p_expected_intent_id: null,
  });
});

Deno.test('pressing Pay twice gives the same open payment back', async () => {
  const { db, stripe, deps } = setup();
  db.respond('plan_debt_payment', { ...debtPlan, stripe_payment_intent_id: 'pi_open' });
  stripe.respond('paymentIntents.retrieve', { id: 'pi_open', status: 'requires_payment_method', amount: 680, client_secret: 'pi_open_secret' });
  const result = await payOwed(deps, caller, { debtId: 'd1' });
  strictEqual(result.body.clientSecret, 'pi_open_secret');
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('an open payment for another amount is cancelled and replaced (keyed on it)', async () => {
  const { db, stripe, deps } = setup();
  db.respond('plan_cash_payment', { ...cashPlan, amount_cents: 750, stripe_payment_intent_id: 'pi_old' });
  stripe.respond('paymentIntents.retrieve', { id: 'pi_old', status: 'requires_payment_method', amount: 600, client_secret: 'x' });
  const result = await payOwed(deps, caller, { shareId: 's1' });
  strictEqual(result.status, 200);
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_old');
  strictEqual(stripe.callsTo('paymentIntents.create')[0].idempotencyKey, 'owed-cash-s1-750-after-pi_old');
  deepStrictEqual(db.callsTo('attach_cash_intent')[0].args.p_expected_intent_id, 'pi_old');
});

Deno.test('a payment already going through is never replaced', async () => {
  const { db, stripe, deps } = setup();
  db.respond('plan_debt_payment', { ...debtPlan, stripe_payment_intent_id: 'pi_paying' });
  stripe.respond('paymentIntents.retrieve', intent('pi_paying', 'processing', { amount: 680 }));
  deepStrictEqual(await payOwed(deps, caller, { debtId: 'd1' }), { status: 409, body: { error: 'already_paid' } });
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('someone else\'s debt, a settled debt, or a missing one is refused before any Stripe call', async () => {
  for (const [code, status] of [['not_your_debt', 403], ['debt_settled', 409], ['debt_not_found', 404],
                                ['collection_started', 409], ['not_your_share', 403]] as const) {
    const { db, stripe, deps } = setup();
    db.fail('plan_debt_payment', code);
    db.fail('plan_cash_payment', code);
    const body = code === 'not_your_share' || code === 'collection_started' ? { shareId: 's1' } : { debtId: 'd1' };
    deepStrictEqual(await payOwed(deps, caller, body), { status, body: { error: code } });
    strictEqual(stripe.calls.length, 0);
  }
});

Deno.test('exactly one of debtId or shareId', async () => {
  const { stripe, deps } = setup();
  deepStrictEqual(await payOwed(deps, caller, {}), { status: 400, body: { error: 'debt_or_share_required' } });
  deepStrictEqual(await payOwed(deps, caller, { debtId: 'd1', shareId: 's1' }),
    { status: 400, body: { error: 'debt_or_share_required' } });
  strictEqual(stripe.calls.length, 0);
});

Deno.test('the debt changed meanwhile: the new payment is cancelled, never left payable', async () => {
  const { db, stripe, deps } = setup();
  db.fail('attach_debt_intent', 'debt_changed');
  stripe.respond('paymentIntents.retrieve', { id: 'pi_new', status: 'requires_payment_method', amount: 680 });
  deepStrictEqual(await payOwed(deps, caller, { debtId: 'd1' }), { status: 409, body: { error: 'debt_changed' } });
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_new');
});

Deno.test('a first-time payer gets a Stripe customer, created once', async () => {
  const { db, stripe, deps } = setup();
  db.respond('plan_debt_payment', { ...debtPlan, stripe_customer_id: null });
  const result = await payOwed(deps, caller, { debtId: 'd1' });
  strictEqual(result.body.customerId, 'cus_new');
  strictEqual(stripe.callsTo('customers.create')[0].idempotencyKey, 'customer-p1');
  deepStrictEqual(db.callsTo('set_stripe_customer')[0].args, { p_profile_id: 'p1', p_customer_id: 'cus_new' });
});
