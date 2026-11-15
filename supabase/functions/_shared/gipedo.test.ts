// Gipedo Pano settlement at Stripe (docs/specs/13-payments-bookings.md,
// "Gipedo Pano"; P8): the database decides what each hold pays; these check
// what goes to Stripe, with which keys, and what is reported back.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from './db-fake.ts';
import { type DueSettlement, runGipedoJobs } from './gipedo.ts';
import { intent } from './intent-fixtures.ts';
import { createStripeFake, stripeError } from './stripe-fake.ts';

function due(n: number, captureCents: number, overrides: Partial<DueSettlement> = {}): DueSettlement {
  return {
    settlement_id: `g${n}`,
    booking_id: 'b1',
    share_id: `s${n}`,
    stripe_payment_intent_id: `pi_${n}`,
    capture_cents: captureCents,
    hold_live: true,
    ...overrides,
  };
}

function setup(settlements: DueSettlement[] = []) {
  const db = createDbFake();
  db.respond('gipedo_lapse_offers', 0);
  db.respond('gipedo_no_opponent_due', 0);
  db.respond('gipedo_auto_cancel_due', 0);
  db.respond('gipedo_settle_from_results', settlements.length);
  db.respond('gipedo_settlements_due', settlements);
  db.respond('gipedo_settlement_done', (args: Record<string, unknown>) => ({ result: args.p_outcome }));
  db.respond('gipedo_settlement_failed', { result: 'failed', attempts: 1 });
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.capture', (call: { id?: string; params?: Record<string, unknown> }) =>
    intent(call.id!, 'succeeded', { amount: call.params?.amount_to_capture as number, stripeFee: 74 }));
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('a draw: 3275 taken from each 6550 hold with amount_to_capture, keyed on the settlement', async () => {
  const { db, stripe, deps } = setup([due(1, 3275), due(2, 3275)]);
  const summary = await runGipedoJobs(deps);

  const captures = stripe.callsTo('paymentIntents.capture');
  strictEqual(captures.length, 2);
  deepStrictEqual(captures[0].params, { amount_to_capture: 3275, expand: ['latest_charge.balance_transaction'] });
  strictEqual(captures[0].id, 'pi_1');
  strictEqual(captures[0].idempotencyKey, 'gipedo-capture-g1-3275');
  deepStrictEqual(db.callsTo('gipedo_settlement_done')[0].args, {
    p_settlement_id: 'g1', p_outcome: 'captured', p_amount_cents: 3275, p_stripe_fee_cents: 74,
  });
  strictEqual(summary.captured, 2);
  strictEqual(summary.settled, 2);
});

Deno.test('a win: the loser pays 6550, the winner\'s hold is released', async () => {
  const { db, stripe, deps } = setup([due(1, 6550), due(2, 0)]);
  const summary = await runGipedoJobs(deps);

  strictEqual(stripe.callsTo('paymentIntents.capture')[0].params?.amount_to_capture, 6550);
  const cancels = stripe.callsTo('paymentIntents.cancel');
  strictEqual(cancels.length, 1);
  strictEqual(cancels[0].id, 'pi_2');
  strictEqual(cancels[0].idempotencyKey, 'gipedo-release-g2');
  deepStrictEqual(db.callsTo('gipedo_settlement_done').map((c) => c.args.p_outcome), ['captured', 'released']);
  deepStrictEqual([summary.captured, summary.released], [1, 1]);
});

Deno.test('a pull-out at 7 hours takes 1000 from the hold', async () => {
  const { stripe, deps } = setup([due(1, 1000)]);
  await runGipedoJobs(deps);
  strictEqual(stripe.callsTo('paymentIntents.capture')[0].params?.amount_to_capture, 1000);
  strictEqual(stripe.callsTo('paymentIntents.capture')[0].idempotencyKey, 'gipedo-capture-g1-1000');
});

Deno.test('a hold that expired: reported gone, no call to Stripe (the database makes it a debt)', async () => {
  const { db, stripe, deps } = setup([due(1, 6550, { hold_live: false }), due(2, 0, { hold_live: false })]);
  const summary = await runGipedoJobs(deps);
  strictEqual(stripe.calls.length, 0);
  deepStrictEqual(db.callsTo('gipedo_settlement_done').map((c) => c.args.p_outcome), ['gone', 'gone']);
  strictEqual(summary.gone, 2);
});

Deno.test('a hold Stripe cancelled when the capture is tried: gone', async () => {
  const { db, stripe, deps } = setup([due(1, 6550)]);
  stripe.fail('paymentIntents.capture', stripeError({ code: 'payment_intent_unexpected_state' }));
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'canceled', { amount: 6550 }));
  await runGipedoJobs(deps);
  deepStrictEqual(db.callsTo('gipedo_settlement_done')[0].args, {
    p_settlement_id: 'g1', p_outcome: 'gone', p_amount_cents: null, p_stripe_fee_cents: null,
  });
});

Deno.test('a run that died after Stripe took the money records the capture it finds', async () => {
  const { db, stripe, deps } = setup([due(1, 3275)]);
  stripe.fail('paymentIntents.capture', stripeError({ code: 'payment_intent_unexpected_state' }));
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'succeeded', { amount: 3275, stripeFee: 74 }));
  await runGipedoJobs(deps);
  deepStrictEqual(db.callsTo('gipedo_settlement_done')[0].args.p_outcome, 'captured');
  strictEqual(db.callsTo('gipedo_settlement_done')[0].args.p_amount_cents, 3275);
});

Deno.test('running the settlement twice moves no money twice: the same key, and the database ignores a repeat', async () => {
  const first = setup([due(1, 6550)]);
  await runGipedoJobs(first.deps);
  const second = setup([due(1, 6550)]);
  await runGipedoJobs(second.deps);
  strictEqual(first.stripe.calls[0].idempotencyKey, second.stripe.calls[0].idempotencyKey);
});

Deno.test('a Stripe error is retried later; the other settlements still run', async () => {
  const { db, stripe, deps } = setup([due(1, 6550), due(2, 0)]);
  stripe.fail('paymentIntents.capture', stripeError({ type: 'StripeAPIError', code: 'api_error', statusCode: 500 }));
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'requires_capture', { amount: 6550 }));
  const summary = await runGipedoJobs(deps);
  strictEqual(db.callsTo('gipedo_settlement_failed')[0].args.p_settlement_id, 'g1');
  deepStrictEqual(db.callsTo('gipedo_settlement_done').map((c) => c.args.p_settlement_id), ['g2']);
  deepStrictEqual([summary.failed, summary.released], [1, 1]);
});

Deno.test('a Stripe error that moved nothing lets the claim go', async () => {
  const { db, stripe, deps } = setup([due(1, 6550)]);
  stripe.fail('paymentIntents.capture', stripeError({ type: 'StripeAPIError', code: 'api_error', statusCode: 500 }));
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'requires_capture', { amount: 6550 }));
  await runGipedoJobs(deps);
  strictEqual(db.callsTo('gipedo_settlement_failed')[0].args.p_keep_claim, false);
});

Deno.test('Stripe took the money but recording it failed: the claim is kept, and the next run records it once', async () => {
  // Run 1: the capture goes through, gipedo_settlement_done fails.
  const first = setup([due(1, 6550)]);
  first.db.fail('gipedo_settlement_done', 'db_unavailable');
  const summary = await runGipedoJobs(first.deps);
  strictEqual(first.stripe.callsTo('paymentIntents.capture').length, 1);
  deepStrictEqual(first.db.callsTo('gipedo_settlement_failed')[0].args, {
    p_settlement_id: 'g1', p_error: 'db_unavailable', p_keep_claim: true,
  });
  strictEqual(summary.failed, 1);

  // Run 2 (the database kept the claim, so a cancel waited): the same
  // idempotency key, so Stripe replays the capture, and it is recorded.
  const second = setup([due(1, 6550)]);
  await runGipedoJobs(second.deps);
  strictEqual(
    second.stripe.callsTo('paymentIntents.capture')[0].idempotencyKey,
    first.stripe.callsTo('paymentIntents.capture')[0].idempotencyKey,
  );
  deepStrictEqual(second.db.callsTo('gipedo_settlement_done')[0].args, {
    p_settlement_id: 'g1', p_outcome: 'captured', p_amount_cents: 6550, p_stripe_fee_cents: 74,
  });
  strictEqual(second.db.callsTo('gipedo_settlement_failed').length, 0);
});

Deno.test('a capture whose outcome can\'t be looked up keeps the claim', async () => {
  const { db, stripe, deps } = setup([due(1, 6550)]);
  stripe.fail('paymentIntents.capture', stripeError({ type: 'StripeConnectionError', code: 'connection_error' }));
  stripe.fail('paymentIntents.retrieve', stripeError({ type: 'StripeConnectionError', code: 'connection_error' }));
  await runGipedoJobs(deps);
  strictEqual(db.callsTo('gipedo_settlement_failed')[0].args.p_keep_claim, true);
});

Deno.test('a release whose intent is already cancelled is still recorded', async () => {
  const { db, stripe, deps } = setup([due(2, 0)]);
  stripe.fail('paymentIntents.cancel', stripeError({ code: 'payment_intent_unexpected_state' }));
  stripe.respond('paymentIntents.retrieve', intent('pi_2', 'canceled'));
  await runGipedoJobs(deps);
  strictEqual(db.callsTo('gipedo_settlement_done')[0].args.p_outcome, 'released');
});

Deno.test('a capture Stripe reports for another amount is never recorded as settled', async () => {
  const { db, stripe, deps } = setup([due(1, 3275)]);
  stripe.respond('paymentIntents.capture', intent('pi_1', 'succeeded', { amount: 6550 }));
  await runGipedoJobs(deps);
  strictEqual(db.callsTo('gipedo_settlement_done').length, 0);
  strictEqual(db.callsTo('gipedo_settlement_failed').length, 1);
  strictEqual(db.callsTo('gipedo_settlement_failed')[0].args.p_keep_claim, true, 'money moved: the claim stays');
});

Deno.test('lapsed offers, no-opponent notices and automatic cancels run first; one failing never stops the rest', async () => {
  const { db, deps } = setup([due(1, 0)]);
  db.fail('gipedo_lapse_offers', 'boom');
  db.respond('gipedo_no_opponent_due', 2);
  db.respond('gipedo_auto_cancel_due', 1);
  const summary = await runGipedoJobs(deps);
  deepStrictEqual([summary.lapsed, summary.noOpponent, summary.autoCancelled], [0, 2, 1]);
  strictEqual(summary.released, 1);
});
