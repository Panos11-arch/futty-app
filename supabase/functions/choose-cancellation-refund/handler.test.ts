import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { chooseCancellationRefund } from './handler.ts';

function setup() {
  const db = createDbFake();
  for (const fn of ['record_intent_capture', 'record_intent_refund', 'cancellation_line_refunded', 'cancellation_claim_refund']) {
    db.respond(fn, true);
  }
  db.respond('money_release_done', null);
  db.respond('cancellation_line_failed', { result: 'failed' });
  db.respond('cancellation_line_work', [{
    line_id: 'l1', kind: 'refund', booking_id: 'b1', share_id: 's1', guarantee_id: null, stripe_intent_id: 'pi_1',
    amount_cents: 680, reason: 'venue_refund_choice', attempts: 0,
  }]);
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'succeeded'));
  stripe.respond('refunds.create', (c: { params?: Record<string, unknown> }) => ({ id: 're_1', status: 'succeeded', amount: c.params?.amount }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('credit: issued by the database at once, nothing at Stripe', async () => {
  const { db, stripe, deps } = setup();
  db.respond('choose_cancellation_refund', { result: 'credited', credit_cents: 680 });
  const res = await chooseCancellationRefund(deps, 'p1', { lineId: 'l1', choice: 'credit' });
  deepStrictEqual(res, { status: 200, body: { choice: 'credit', creditCents: 680 } });
  deepStrictEqual(db.callsTo('choose_cancellation_refund')[0].args, { p_line_id: 'l1', p_profile_id: 'p1', p_choice: 'credit' });
  strictEqual(stripe.calls.length, 0);
});

Deno.test('card: the refund is sent now, keyed on the intent', async () => {
  const { db, stripe, deps } = setup();
  db.respond('choose_cancellation_refund', { result: 'refund', refund_cents: 680 });
  const res = await chooseCancellationRefund(deps, 'p1', { lineId: 'l1', choice: 'card' });
  deepStrictEqual(res, { status: 200, body: { choice: 'card', refundCents: 680, pending: false } });
  deepStrictEqual(stripe.callsTo('refunds.create').map((c) => c.idempotencyKey), ['refund-pi_1-680']);
  strictEqual(db.callsTo('cancellation_line_refunded').length, 1);
});

Deno.test('card, Stripe down: chosen, and the job sends it later', async () => {
  const { db, stripe, deps } = setup();
  db.respond('choose_cancellation_refund', { result: 'refund', refund_cents: 680 });
  stripe.fail('refunds.create', new Error('down'));
  const res = await chooseCancellationRefund(deps, 'p1', { lineId: 'l1', choice: 'card' });
  strictEqual(res.body.pending, true);
  strictEqual(db.callsTo('cancellation_line_failed').length, 1);
});

Deno.test('refusals move no money', async () => {
  for (const [error, status] of [['not_your_refund', 403], ['choice_closed', 409], ['refund_not_found', 404]] as const) {
    const { db, stripe, deps } = setup();
    db.fail('choose_cancellation_refund', error);
    deepStrictEqual(await chooseCancellationRefund(deps, 'p2', { lineId: 'l1', choice: 'card' }), { status, body: { error } });
    strictEqual(stripe.calls.length, 0);
  }
  const { deps } = setup();
  deepStrictEqual(await chooseCancellationRefund(deps, 'p1', { lineId: 'l1', choice: 'cash' as never }),
    { status: 400, body: { error: 'invalid_request' } });
});
