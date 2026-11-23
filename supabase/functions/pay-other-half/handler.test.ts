// pay-other-half: "Pay the whole pitch and play" (spec 13, "Invites, after
// payment"; examples 6a and 6b): the captain's one payment for the other
// half, for exactly the server's amount.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { payOtherHalf } from './handler.ts';

const caller = { id: 'p1', email: 'p1@futty.test' };

// Example 6a: side A paid for everyone, €20.00 + 5 × €0.55.
const plan = {
  payment_id: 'o1', booking_id: 'b1', pitch_cents: 2000, fee_cents: 275, amount_cents: 2275,
  stripe_payment_intent_id: null, stripe_customer_id: 'cus_1',
};

function setup(planned: Record<string, unknown> = plan) {
  const db = createDbFake();
  db.respond('plan_other_half_payment', planned);
  db.respond('attach_other_half_intent', null);
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

Deno.test('the other half is paid for exactly the server\'s amount, marked as the other half, once', async () => {
  const { db, stripe, deps } = setup();

  const result = await payOtherHalf(deps, caller, { bookingId: 'b1' });

  deepStrictEqual(result, { status: 200, body: { clientSecret: 'pi_new_secret', customerId: 'cus_1', amountCents: 2275 } });
  deepStrictEqual(db.callsTo('plan_other_half_payment')[0].args, { p_booking_id: 'b1', p_profile_id: 'p1' });
  const [create] = stripe.callsTo('paymentIntents.create');
  deepStrictEqual(create.params, {
    amount: 2275,
    currency: 'eur',
    customer: 'cus_1',
    automatic_payment_methods: { enabled: true },
    metadata: { kind: 'other_half', other_half_id: 'o1', booking_id: 'b1', profile_id: 'p1', fee_cents: '275' },
  });
  strictEqual(create.idempotencyKey, 'other-half-o1-2275-after-none');
  deepStrictEqual(db.callsTo('attach_other_half_intent')[0].args, {
    p_payment_id: 'o1', p_profile_id: 'p1', p_intent_id: 'pi_new', p_amount_cents: 2275, p_expected_intent_id: null,
  });
});

Deno.test('paying for myself: €24.00 (example 6b)', async () => {
  const { stripe, deps } = setup({ ...plan, fee_cents: 400, amount_cents: 2400 });

  const result = await payOtherHalf(deps, caller, { bookingId: 'b1' });

  strictEqual(result.body.amountCents, 2400);
  strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.amount, 2400);
});

Deno.test('an open payment for the same amount is reused; a different amount replaces it', async () => {
  const same = setup({ ...plan, stripe_payment_intent_id: 'pi_open' });
  same.stripe.respond('paymentIntents.retrieve', { id: 'pi_open', status: 'requires_payment_method', amount: 2275, client_secret: 'pi_open_secret' });
  const reused = await payOtherHalf(same.deps, caller, { bookingId: 'b1' });
  deepStrictEqual(reused, { status: 200, body: { clientSecret: 'pi_open_secret', customerId: 'cus_1', amountCents: 2275 } });
  strictEqual(same.stripe.callsTo('paymentIntents.create').length, 0, 'no second payment');

  const other = setup({ ...plan, stripe_payment_intent_id: 'pi_old' });
  other.stripe.respond('paymentIntents.retrieve', { id: 'pi_old', status: 'requires_payment_method', amount: 2000 });
  await payOtherHalf(other.deps, caller, { bookingId: 'b1' });
  strictEqual(other.stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_old', 'the old one is cancelled first');
  strictEqual(other.stripe.callsTo('paymentIntents.create')[0].idempotencyKey, 'other-half-o1-2275-after-pi_old');
});

Deno.test('a payment already going through is never replaced', async () => {
  const { stripe, deps } = setup({ ...plan, stripe_payment_intent_id: 'pi_paying' });
  stripe.respond('paymentIntents.retrieve', { id: 'pi_paying', status: 'processing', amount: 2275 });

  const result = await payOtherHalf(deps, caller, { bookingId: 'b1' });

  deepStrictEqual(result, { status: 409, body: { error: 'already_paid' } });
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('the database\'s refusals are passed on, with no payment made', async () => {
  for (const [error, status] of [['not_your_booking', 403], ['choice_closed', 409], ['already_chosen', 409]] as const) {
    const { db, stripe, deps } = setup();
    db.fail('plan_other_half_payment', error);

    const result = await payOtherHalf(deps, caller, { bookingId: 'b1' });

    deepStrictEqual(result, { status, body: { error } });
    strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
  }
});

Deno.test('a booking is required', async () => {
  const { deps } = setup();
  deepStrictEqual(await payOtherHalf(deps, caller, {}), { status: 400, body: { error: 'booking_required' } });
});

Deno.test('a player without a Stripe customer gets one first', async () => {
  const { db, stripe, deps } = setup({ ...plan, stripe_customer_id: null });

  await payOtherHalf(deps, caller, { bookingId: 'b1' });

  strictEqual(stripe.callsTo('customers.create')[0].idempotencyKey, 'customer-p1');
  deepStrictEqual(db.callsTo('set_stripe_customer')[0].args, { p_profile_id: 'p1', p_customer_id: 'cus_new' });
  strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.customer, 'cus_new');
});

Deno.test('when the choice changed meanwhile, the new payment is cancelled and never paid', async () => {
  const { db, stripe, deps } = setup();
  db.fail('attach_other_half_intent', 'payment_changed');
  stripe.respond('paymentIntents.retrieve', { id: 'pi_new', status: 'requires_payment_method', amount: 2275 });

  const result = await payOtherHalf(deps, caller, { bookingId: 'b1' });

  deepStrictEqual(result, { status: 409, body: { error: 'payment_changed' } });
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_new');
});
