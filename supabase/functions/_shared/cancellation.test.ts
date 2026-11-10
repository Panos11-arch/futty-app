// The Stripe side of a cancellation: refunds after the card-or-credit
// choice, and the booker's whole-team charge across retries.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { chargeCancellationFee, runCancellationFees, runCancellationLine } from './cancellation.ts';
import { createDbFake } from './db-fake.ts';
import { intent } from './intent-fixtures.ts';
import { createStripeFake, stripeError } from './stripe-fake.ts';

function setup() {
  const db = createDbFake();
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund', 'cancellation_line_refunded']) {
    db.respond(fn, true);
  }
  db.respond('money_release_done', null);
  db.respond('queue_money_release', 'r1');
  db.respond('cancellation_line_failed', { result: 'failed' });
  db.respond('cancellation_fee_paid', { result: 'paid' });
  db.respond('cancellation_fee_attempted', { result: 'failed' });
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.cancel', (c: { id?: string }) => ({ id: c.id, status: 'canceled' }));
  stripe.respond('refunds.create', (c: { params?: Record<string, unknown> }) => ({ id: 're_1', status: 'succeeded', amount: c.params?.amount }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

const refund = (pi: string | null, amount = 680) => ({
  line_id: 'l1', kind: 'refund' as const, booking_id: 'b1', share_id: 's1', guarantee_id: null, stripe_intent_id: pi,
  amount_cents: amount, reason: 'venue_refund_choice', attempts: 0,
});

const fee = (extra: Record<string, unknown> = {}) => ({
  fee_id: 'f1', booking_id: 'b1', cancellation_id: 'c1', profile_id: 'p1', amount_cents: 600,
  stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_1', attempt: 2, off_session: true, previous_intent_id: null,
  ...extra,
});

Deno.test('a card refund gives back what was taken, keyed on the intent, then closes the line', async () => {
  const { db, stripe, deps } = setup();
  stripe.respond('paymentIntents.retrieve', intent('pi_r', 'succeeded'));
  strictEqual(await runCancellationLine(deps, refund('pi_r')), true);
  deepStrictEqual(stripe.callsTo('refunds.create').map((c) => [c.params?.amount, c.idempotencyKey]), [[680, 'refund-pi_r-680']]);
  strictEqual(db.callsTo('record_intent_refund')[0].args.p_reason, 'venue_refund_choice');
  deepStrictEqual(db.callsTo('cancellation_line_refunded')[0].args, { p_line_id: 'l1', p_outcome: 'refunded' });
});

Deno.test('a share paid only with credit: nothing at Stripe, the credit goes back in the database', async () => {
  const { db, stripe, deps } = setup();
  await runCancellationLine(deps, refund(null, 0));
  strictEqual(stripe.calls.length, 0);
  deepStrictEqual(db.callsTo('cancellation_line_refunded')[0].args, { p_line_id: 'l1', p_outcome: 'nothing' });
});

Deno.test('nothing to charge (paid, or past kickoff): no Stripe call', async () => {
  const { db, stripe, deps } = setup();
  db.respond('cancellation_fee_to_charge', []);
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'none' });
  strictEqual(stripe.calls.length, 0);
});

Deno.test('a retry first checks the last try: paid after 3-D Secure, it is recorded, not charged again', async () => {
  const { db, stripe, deps } = setup();
  db.respond('cancellation_fee_to_charge', [fee({ previous_intent_id: 'pi_3ds' })]);
  stripe.respond('paymentIntents.retrieve', intent('pi_3ds', 'succeeded', { amount: 600, stripeFee: 34 }));
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'paid' });
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
  deepStrictEqual(db.callsTo('cancellation_fee_paid')[0].args, {
    p_fee_id: 'f1', p_intent_id: 'pi_3ds', p_amount_cents: 600, p_stripe_fee_cents: 34,
  });
});

Deno.test('a retry cancels the unfinished last try first, so it can never be paid as well', async () => {
  const { stripe, deps, db } = setup();
  db.respond('cancellation_fee_to_charge', [fee({ previous_intent_id: 'pi_open' })]);
  stripe.respond('paymentIntents.retrieve', intent('pi_open', 'requires_action', { amount: 600 }));
  stripe.respond('paymentIntents.create', () => intent('pi_new', 'succeeded', { amount: 600 }));
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'paid' });
  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.idempotencyKey), ['cancel-pi_open']);
  const [create] = stripe.callsTo('paymentIntents.create');
  strictEqual(create.params?.off_session, true);
  strictEqual(create.idempotencyKey, 'cancel-fee-f1-attempt-2');
});

Deno.test('the last try went through while it was being cancelled: recorded as paid', async () => {
  const { stripe, deps, db } = setup();
  db.respond('cancellation_fee_to_charge', [fee({ previous_intent_id: 'pi_race' })]);
  let retrieves = 0;
  stripe.respond('paymentIntents.retrieve', () =>
    intent('pi_race', retrieves++ === 0 ? 'requires_action' : 'succeeded', { amount: 600 }));
  stripe.fail('paymentIntents.cancel', stripeError({ code: 'payment_intent_unexpected_state' }));
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'paid' });
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('a second payment for the same charge is refunded', async () => {
  const { stripe, deps, db } = setup();
  db.respond('cancellation_fee_to_charge', [fee({ previous_intent_id: 'pi_old' })]);
  db.respond('cancellation_fee_paid', { result: 'refund', reason: 'duplicate_cancellation_fee' });
  stripe.respond('paymentIntents.retrieve', intent('pi_old', 'succeeded', { amount: 600 }));
  await chargeCancellationFee(deps, 'f1');
  deepStrictEqual(stripe.callsTo('refunds.create').map((c) => c.idempotencyKey), ['refund-pi_old-600']);
});

Deno.test('off-session, a bank asking for 3-D Secure is a failed try', async () => {
  const { stripe, deps, db } = setup();
  db.respond('cancellation_fee_to_charge', [fee()]);
  stripe.respond('paymentIntents.create', () => intent('pi_auth', 'requires_action', { amount: 600 }));
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'failed' });
  deepStrictEqual(db.callsTo('cancellation_fee_attempted')[0].args, {
    p_fee_id: 'f1', p_intent_id: 'pi_auth', p_outcome: 'failed', p_error: 'requires_action',
  });
});

Deno.test('no saved card: a failed try, theirs to fix', async () => {
  const { stripe, deps, db } = setup();
  db.respond('cancellation_fee_to_charge', [fee({ stripe_payment_method_id: null })]);
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'failed' });
  strictEqual(stripe.calls.length, 0);
  strictEqual(db.callsTo('cancellation_fee_attempted')[0].args.p_error, 'no_saved_card');
});

Deno.test('a payment still processing waits for its webhook', async () => {
  const { stripe, deps, db } = setup();
  db.respond('cancellation_fee_to_charge', [fee()]);
  stripe.respond('paymentIntents.create', () => intent('pi_proc', 'processing', { amount: 600 }));
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'processing' });
  strictEqual(db.callsTo('cancellation_fee_attempted')[0].args.p_outcome, 'error');
  db.respond('cancellation_fee_to_charge', [fee({ previous_intent_id: 'pi_proc' })]);
  stripe.respond('paymentIntents.retrieve', intent('pi_proc', 'processing', { amount: 600 }));
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'processing' });
});

Deno.test('Stripe unreachable while checking the last try: retried soon', async () => {
  const { stripe, deps, db } = setup();
  db.respond('cancellation_fee_to_charge', [fee({ previous_intent_id: 'pi_x' })]);
  stripe.fail('paymentIntents.retrieve', stripeError({ type: 'StripeConnectionError', code: 'api_connection_error' }));
  deepStrictEqual(await chargeCancellationFee(deps, 'f1'), { status: 'retry' });
});

Deno.test('the job counts every outcome', async () => {
  const { stripe, deps, db } = setup();
  db.respond('cancellation_fees_due', [{ fee_id: 'f1' }, { fee_id: 'f2' }, { fee_id: 'f3' }]);
  db.respond('cancellation_fee_to_charge', (a: Record<string, unknown>) => [fee({ fee_id: a.p_fee_id })]);
  stripe.respond('paymentIntents.create', (c: { idempotencyKey?: string }) => {
    if (c.idempotencyKey!.includes('f2')) throw stripeError({ type: 'StripeCardError', code: 'card_declined' });
    if (c.idempotencyKey!.includes('f3')) throw stripeError({ type: 'StripeAPIError' });
    return intent('pi_ok', 'succeeded', { amount: 600 });
  });
  deepStrictEqual(await runCancellationFees(deps), { paid: 1, failed: 1, retry: 1 });
});
