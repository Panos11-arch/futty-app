import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { createDbFake } from './db-fake.ts';
import { intent } from './intent-fixtures.ts';
import { releaseBookingMoney, releaseIntent, releaseOrQueue, runReleaseQueue } from './release.ts';
import { createStripeFake, stripeError } from './stripe-fake.ts';

const item = { booking_id: 'b1', share_id: 's1', intent_id: 'pi_1', reason: 'booking_cancelled' };

function setup(found: unknown) {
  const db = createDbFake();
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund']) db.respond(fn, true);
  db.respond('money_release_done', null);
  db.respond('queue_money_release', 'r1');
  db.respond('money_release_attempted', null);
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.retrieve', found);
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  stripe.respond('refunds.create', (call: { params?: Record<string, unknown> }) => ({
    id: 're_1', status: 'succeeded', amount: call.params?.amount,
  }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('a hold is cancelled and the release recorded', async () => {
  const { db, stripe, deps } = setup(intent('pi_1', 'requires_capture'));
  strictEqual(await releaseIntent(deps, item), 'cancelled');
  const [cancel] = stripe.callsTo('paymentIntents.cancel');
  strictEqual(cancel.idempotencyKey, 'cancel-pi_1');
  deepStrictEqual(db.callsTo('record_money_movement')[0].args, {
    p_booking_id: 'b1', p_share_id: 's1', p_guarantee_id: null, p_kind: 'cancel', p_amount_cents: 680,
    p_stripe_intent_id: 'pi_1', p_stripe_id: 'pi_1', p_reason: 'booking_cancelled',
  });
  deepStrictEqual(db.callsTo('money_release_done')[0].args.p_outcome, 'cancelled');
});

Deno.test('money already taken is recorded with Stripe\'s fee, refunded, and the refund recorded by its re_ id', async () => {
  const { db, stripe, deps } = setup(intent('pi_1', 'succeeded'));
  strictEqual(await releaseIntent(deps, item), 'refunded');
  deepStrictEqual(stripe.callsTo('paymentIntents.retrieve')[0].params, { expand: ['latest_charge.balance_transaction'] });
  deepStrictEqual(db.callsTo('record_intent_capture')[0].args, {
    p_booking_id: 'b1', p_share_id: 's1', p_guarantee_id: null, p_intent_id: 'pi_1', p_amount_cents: 680,
    p_fee_cents: 80, p_stripe_fee_cents: 35, p_reason: 'taken',
  });
  const [refund] = stripe.callsTo('refunds.create');
  deepStrictEqual(refund.params, { payment_intent: 'pi_1', amount: 680, metadata: { booking_id: 'b1' } });
  strictEqual(refund.idempotencyKey, 'refund-pi_1-680');
  deepStrictEqual(db.callsTo('record_intent_refund')[0].args, {
    p_intent_id: 'pi_1', p_refund_id: 're_1', p_amount_cents: 680, p_reason: 'booking_cancelled',
  });
  strictEqual(db.callsTo('money_release_done')[0].args.p_outcome, 'refunded');
});

Deno.test('two partial refunds on one intent: the second refunds only what is left, with its own key', async () => {
  const { db, stripe, deps } = setup(intent('pi_1', 'succeeded', { refunded: 300 }));
  await releaseIntent(deps, item);
  const [refund] = stripe.callsTo('refunds.create');
  strictEqual(refund.params?.amount, 380);
  strictEqual(refund.idempotencyKey, 'refund-pi_1-380');
  strictEqual(db.callsTo('record_intent_refund')[0].args.p_amount_cents, 380);
});

Deno.test('a refund Stripe made but the ledger missed (a run that died) is recorded, not repeated', async () => {
  const { db, stripe, deps } = setup(intent('pi_1', 'succeeded', { refunded: 680 }));
  stripe.respond('refunds.list', { data: [{ id: 're_lost', status: 'succeeded', amount: 680 }, { id: 're_failed', status: 'failed', amount: 680 }] });
  strictEqual(await releaseIntent(deps, item), 'refunded');
  strictEqual(stripe.callsTo('refunds.create').length, 0, 'no second refund');
  deepStrictEqual(db.callsTo('record_intent_refund').map((c) => c.args.p_refund_id), ['re_lost']);
});

Deno.test('an open intent nobody paid is cancelled so it can\'t be paid later; nothing to record', async () => {
  const { db, stripe, deps } = setup(intent('pi_1', 'requires_payment_method'));
  strictEqual(await releaseIntent(deps, item), 'nothing');
  strictEqual(stripe.callsTo('paymentIntents.cancel').length, 1);
  strictEqual(db.callsTo('record_money_movement').length, 0);
});

Deno.test('an intent already cancelled needs no Stripe call; a release a dead run never recorded is recorded once', async () => {
  const { db, stripe, deps } = setup(intent('pi_1', 'canceled'));
  db.respond('record_intent_cancelled', true);
  strictEqual(await releaseIntent(deps, item), 'nothing');
  strictEqual(stripe.callsTo('paymentIntents.cancel').length, 0);
  deepStrictEqual(db.callsTo('record_intent_cancelled')[0].args, {
    p_booking_id: 'b1', p_share_id: 's1', p_guarantee_id: null, p_intent_id: 'pi_1', p_reason: 'booking_cancelled',
  });
  strictEqual(db.callsTo('money_release_done')[0].args.p_outcome, 'nothing');
});

Deno.test('a processing intent can\'t be released yet: it is queued, never dropped', async () => {
  const { db, deps } = setup(intent('pi_1', 'processing'));
  await rejects(() => releaseIntent(deps, item), /intent_processing/);
  strictEqual(await releaseOrQueue(deps, item), 'queued');
  deepStrictEqual(db.callsTo('queue_money_release')[0].args, {
    p_booking_id: 'b1', p_share_id: 's1', p_guarantee_id: null, p_intent_id: 'pi_1', p_reason: 'booking_cancelled',
    p_error: 'intent_processing: pi_1',
  });
});

Deno.test('a failed refund is queued, then retried by the job until it succeeds, each attempt logged', async () => {
  const { db, stripe, deps } = setup(intent('pi_1', 'succeeded'));
  stripe.fail('refunds.create', stripeError({ type: 'StripeAPIError', code: 'api_error', statusCode: 500 }));
  strictEqual(await releaseOrQueue(deps, item), 'queued');
  strictEqual(db.callsTo('queue_money_release')[0].args.p_error, 'api_error: Fake Stripe error');

  const due = { release_id: 'r1', booking_id: 'b1', share_id: 's1', guarantee_id: null, stripe_intent_id: 'pi_1', reason: 'booking_cancelled', attempts: 1 };
  db.respond('money_releases_due', [due]);
  deepStrictEqual(await runReleaseQueue(deps), { released: 0, failed: 1 }, 'still failing: logged, left queued');

  stripe.respond('refunds.create', { id: 're_2', status: 'succeeded', amount: 680 });
  deepStrictEqual(await runReleaseQueue(deps), { released: 1, failed: 0 });
  deepStrictEqual(db.callsTo('money_release_attempted').map((c) => [c.args.p_succeeded, c.args.p_outcome]), [
    [false, null],
    [true, 'refunded'],
  ]);
  const keys = stripe.callsTo('refunds.create').map((c) => c.idempotencyKey);
  deepStrictEqual(new Set(keys).size, 1, 'every retry is the same refund request');
});

Deno.test('a cancelled booking: every intent is released, shares and guarantees without one are closed', async () => {
  const { db, deps } = setup(intent('pi_1', 'requires_capture'));
  db.respond('booking_money_to_release', [
    { kind: 'share', id: 's1', status: 'authorized', stripe_payment_intent_id: 'pi_1', amount_cents: 680 },
    { kind: 'share', id: 's2', status: 'pending', stripe_payment_intent_id: null, amount_cents: 680 },
    { kind: 'guarantee', id: 'g1', status: 'awaiting_card', stripe_payment_intent_id: null, amount_cents: 6000 },
  ]);
  db.respond('share_released', true);
  db.respond('guarantee_released', true);
  deepStrictEqual(await releaseBookingMoney(deps, 'b1', 'booking_cancelled'), { cancelled: 1, refunded: 0, nothing: 0, queued: 0 });
  deepStrictEqual(db.callsTo('share_released')[0].args, { p_share_id: 's2', p_new_status: 'cancelled' });
  deepStrictEqual(db.callsTo('guarantee_released')[0].args, { p_guarantee_id: 'g1' });
});
