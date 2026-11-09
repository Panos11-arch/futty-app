import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake, stripeError } from '../_shared/stripe-fake.ts';
import { runPaymentJobs } from './handler.ts';

const dueGuarantee = {
  guarantee_id: 'g1',
  booking_id: 'b1',
  profile_id: 'p1',
  amount_cents: 6000,
  stripe_customer_id: 'cus_1',
  stripe_payment_method_id: 'pm_1',
  attempts: 0,
};

function setup({ shares = [] as unknown[], guarantees = [] as unknown[] } = {}) {
  const db = createDbFake();
  db.respond('shares_due_for_capture', shares);
  db.respond('share_captured', { result: 'captured' });
  db.respond('guarantees_due_for_hold', guarantees);
  db.respond('guarantee_hold_placed', { result: 'held' });
  db.respond('guarantee_hold_failed', { result: 'failed', attempts: 1, notified: true });
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.capture', (call: { id?: string }) => ({ id: call.id, status: 'succeeded', amount_received: 680 }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('takes every share the database says is due (60 minutes after its hold)', async () => {
  const { db, stripe, deps } = setup({
    shares: [
      { share_id: 's1', booking_id: 'b1', stripe_payment_intent_id: 'pi_1', amount_cents: 680 },
      { share_id: 's2', booking_id: 'b1', stripe_payment_intent_id: 'pi_2', amount_cents: 680 },
    ],
  });

  const summary = await runPaymentJobs(deps);

  deepStrictEqual(
    stripe.callsTo('paymentIntents.capture').map((c) => [c.id, c.params, c.idempotencyKey]),
    [['pi_1', {}, 'capture-share-s1'], ['pi_2', {}, 'capture-share-s2']],
  );
  deepStrictEqual(db.callsTo('share_captured').map((c) => c.args), [
    { p_share_id: 's1', p_amount_cents: 680 },
    { p_share_id: 's2', p_amount_cents: 680 },
  ]);
  deepStrictEqual(summary, { captured: 2, captureFailed: 0, held: 0, holdFailed: 0 });
});

Deno.test('nothing due: nothing taken', async () => {
  const { stripe, deps } = setup();
  deepStrictEqual(await runPaymentJobs(deps), { captured: 0, captureFailed: 0, held: 0, holdFailed: 0 });
  strictEqual(stripe.calls.length, 0);
});

Deno.test('a failed capture is left for the next run, with the same key (no double charge)', async () => {
  const share = { share_id: 's1', booking_id: 'b1', stripe_payment_intent_id: 'pi_1', amount_cents: 680 };
  const first = setup({ shares: [share] });
  first.stripe.fail('paymentIntents.capture', stripeError({ type: 'StripeConnectionError', statusCode: 500 }));

  deepStrictEqual(await runPaymentJobs(first.deps), { captured: 0, captureFailed: 1, held: 0, holdFailed: 0 });
  strictEqual(first.db.callsTo('share_captured').length, 0);

  const retry = setup({ shares: [share] });
  await runPaymentJobs(retry.deps);
  strictEqual(retry.stripe.calls[0].idempotencyKey, first.stripe.calls[0].idempotencyKey);
});

Deno.test('places a due guarantee hold off-session for the full pitch price', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.respond('paymentIntents.create', { id: 'pi_g', status: 'requires_capture', amount_capturable: 6000 });

  const summary = await runPaymentJobs(deps);

  const [create] = stripe.callsTo('paymentIntents.create');
  deepStrictEqual(create.params, {
    amount: 6000,
    currency: 'eur',
    customer: 'cus_1',
    payment_method: 'pm_1',
    off_session: true,
    confirm: true,
    capture_method: 'manual',
    metadata: { kind: 'guarantee', guarantee_id: 'g1', booking_id: 'b1' },
  });
  strictEqual(create.idempotencyKey, 'guarantee-g1-attempt-1');
  deepStrictEqual(db.callsTo('guarantee_hold_placed')[0].args, { p_guarantee_id: 'g1', p_intent_id: 'pi_g', p_amount_cents: 6000 });
  deepStrictEqual(summary, { captured: 0, captureFailed: 0, held: 1, holdFailed: 0 });
});

Deno.test('a declined guarantee hold is recorded as failed and never cancels anything', async () => {
  const { db, stripe, deps } = setup({ guarantees: [{ ...dueGuarantee, attempts: 1 }] });
  stripe.fail('paymentIntents.create', Object.assign(stripeError({ type: 'StripeCardError', code: 'card_declined' }), {
    raw: { type: 'StripeCardError', code: 'card_declined', payment_intent: { id: 'pi_declined' } },
  }));

  const summary = await runPaymentJobs(deps);

  strictEqual(stripe.callsTo('paymentIntents.create')[0].idempotencyKey, 'guarantee-g1-attempt-2', 'a retry is a new attempt');
  deepStrictEqual(db.callsTo('guarantee_hold_failed')[0].args, {
    p_guarantee_id: 'g1', p_intent_id: 'pi_declined', p_error: 'card_declined',
  });
  strictEqual(stripe.callsTo('paymentIntents.cancel').length, 0);
  strictEqual(stripe.callsTo('refunds.create').length, 0);
  deepStrictEqual(summary, { captured: 0, captureFailed: 0, held: 0, holdFailed: 1 });
});

Deno.test('a hold that needs the booker (3-D Secure) counts as failed', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.respond('paymentIntents.create', { id: 'pi_auth', status: 'requires_action' });

  await runPaymentJobs(deps);

  deepStrictEqual(db.callsTo('guarantee_hold_failed')[0].args, {
    p_guarantee_id: 'g1', p_intent_id: 'pi_auth', p_error: 'requires_action',
  });
});

Deno.test('a network error is not a failed attempt: the next run retries with the same key', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.fail('paymentIntents.create', stripeError({ type: 'StripeConnectionError', statusCode: 500 }));

  const summary = await runPaymentJobs(deps);

  // Stripe may have placed the hold before the connection dropped; a new
  // attempt number would place a second one.
  strictEqual(db.callsTo('guarantee_hold_failed').length, 0);
  strictEqual(db.callsTo('guarantee_hold_placed').length, 0);
  deepStrictEqual(summary, { captured: 0, captureFailed: 0, held: 0, holdFailed: 0 });
});
