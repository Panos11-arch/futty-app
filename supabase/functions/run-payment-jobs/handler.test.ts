import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
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

const dueShare = { share_id: 's1', booking_id: 'b1', stripe_payment_intent_id: 'pi_1', amount_cents: 680 };

function setup({ shares = [] as unknown[], guarantees = [] as unknown[], expiring = [] as unknown[] } = {}) {
  const db = createDbFake();
  db.respond('shares_due_for_capture', shares);
  db.respond('share_captured', { result: 'captured' });
  db.respond('bookings_past_payment_window', expiring);
  db.respond('expire_unpaid_booking', true);
  db.respond('booking_money_to_release', []);
  db.respond('guarantees_due_for_hold', guarantees);
  db.respond('guarantee_hold_placed', { result: 'held' });
  db.respond('guarantee_hold_failed', { result: 'failed', attempts: 1, notified: true });
  db.respond('money_releases_due', []);
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund']) db.respond(fn, true);
  db.respond('money_release_done', null);
  db.respond('queue_money_release', 'r1');
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.capture', (call: { id?: string }) => intent(call.id!, 'succeeded'));
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('takes every share whose free hour is over, recording Stripe\'s actual fee', async () => {
  const { db, stripe, deps } = setup({ shares: [dueShare] });

  const summary = await runPaymentJobs(deps);

  strictEqual(summary.captured, 1);
  const [capture] = stripe.callsTo('paymentIntents.capture');
  strictEqual(capture.id, 'pi_1');
  deepStrictEqual(capture.params, { expand: ['latest_charge.balance_transaction'] });
  strictEqual(capture.idempotencyKey, 'capture-share-s1');
  deepStrictEqual(db.callsTo('share_captured')[0].args, { p_share_id: 's1', p_amount_cents: 680, p_stripe_fee_cents: 35 });
});

Deno.test('a failed capture is left for the next run, with the same key (no double charge)', async () => {
  const { db, stripe, deps } = setup({ shares: [dueShare] });
  stripe.fail('paymentIntents.capture', stripeError({ code: 'api_connection_error' }));
  strictEqual((await runPaymentJobs(deps)).captureFailed, 1);
  strictEqual(db.callsTo('share_captured').length, 0);
  await runPaymentJobs(deps);
  const keys = stripe.callsTo('paymentIntents.capture').map((c) => c.idempotencyKey);
  deepStrictEqual(keys, ['capture-share-s1', 'capture-share-s1']);
});

Deno.test('a share taken just as its booking was cancelled is refunded at once', async () => {
  const { db, stripe, deps } = setup({ shares: [dueShare] });
  db.respond('share_captured', { result: 'refund', reason: 'booking_cancelled' });
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'succeeded'));
  stripe.respond('refunds.create', { id: 're_1', status: 'succeeded', amount: 680 });

  strictEqual((await runPaymentJobs(deps)).refunded, 1);
  strictEqual(stripe.callsTo('refunds.create')[0].idempotencyKey, 'refund-pi_1-booking_cancelled-680');
  strictEqual(db.callsTo('record_intent_refund')[0].args.p_refund_id, 're_1');
});

Deno.test('15-minute window expiring: the open intent is cancelled, the booking expired and its money released', async () => {
  const { db, stripe, deps } = setup({ expiring: [{ booking_id: 'b1', booker_intent_id: 'pi_open' }, { booking_id: 'b2', booker_intent_id: null }] });
  stripe.respond('paymentIntents.retrieve', intent('pi_open', 'requires_payment_method'));
  db.respond('booking_money_to_release', [{ kind: 'share', id: 's1', status: 'pending', stripe_payment_intent_id: 'pi_open', amount_cents: 680 }]);

  strictEqual((await runPaymentJobs(deps)).expired, 2);
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_open', 'cancelled so it can\'t be paid after the window');
  deepStrictEqual(db.callsTo('expire_unpaid_booking').map((c) => c.args.p_booking_id), ['b1', 'b2']);
  deepStrictEqual(db.callsTo('booking_money_to_release').map((c) => c.args.p_booking_id), ['b1', 'b2']);
});

Deno.test('15-minute window: a booker whose payment went through is left to its webhook', async () => {
  for (const status of ['requires_capture', 'processing', 'succeeded'] as const) {
    const { db, stripe, deps } = setup({ expiring: [{ booking_id: 'b1', booker_intent_id: 'pi_paid' }] });
    stripe.respond('paymentIntents.retrieve', intent('pi_paid', status));
    strictEqual((await runPaymentJobs(deps)).expired, 0, status);
    strictEqual(stripe.callsTo('paymentIntents.cancel').length, 0);
    strictEqual(db.callsTo('expire_unpaid_booking').length, 0);
  }
});

Deno.test('places a due guarantee hold off-session for the full pitch price', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.respond('paymentIntents.create', intent('pi_g', 'requires_capture', { amount: 6000 }));

  strictEqual((await runPaymentJobs(deps)).held, 1);
  const [create] = stripe.callsTo('paymentIntents.create');
  deepStrictEqual(create.params, {
    amount: 6000, currency: 'eur', customer: 'cus_1', payment_method: 'pm_1', off_session: true, confirm: true,
    capture_method: 'manual', metadata: { kind: 'guarantee', guarantee_id: 'g1', booking_id: 'b1' },
  });
  strictEqual(create.idempotencyKey, 'guarantee-g1-attempt-1');
  deepStrictEqual(db.callsTo('guarantee_hold_placed')[0].args, { p_guarantee_id: 'g1', p_intent_id: 'pi_g', p_amount_cents: 6000 });
});

Deno.test('a guarantee placed after its booking was cancelled is released at once', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.respond('paymentIntents.create', intent('pi_g', 'requires_capture', { amount: 6000 }));
  stripe.respond('paymentIntents.retrieve', intent('pi_g', 'requires_capture', { amount: 6000 }));
  db.respond('guarantee_hold_placed', { result: 'release', reason: 'booking_cancelled' });

  strictEqual((await runPaymentJobs(deps)).held, 0);
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_g');
  deepStrictEqual(db.callsTo('record_money_movement')[0].args.p_kind, 'cancel');
  deepStrictEqual(db.callsTo('money_release_done')[0].args.p_guarantee_id, 'g1');
});

Deno.test('a declined guarantee hold is recorded as failed; the intent it left is cancelled', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.fail('paymentIntents.create', Object.assign(
    stripeError({ type: 'StripeCardError', code: 'card_declined', statusCode: 402 }),
    { raw: { payment_intent: { id: 'pi_declined' } } },
  ));
  stripe.respond('paymentIntents.retrieve', intent('pi_declined', 'requires_payment_method'));

  strictEqual((await runPaymentJobs(deps)).holdFailed, 1);
  deepStrictEqual(db.callsTo('guarantee_hold_failed')[0].args, {
    p_guarantee_id: 'g1', p_intent_id: 'pi_declined', p_error: 'card_declined', p_needs_action: false,
  });
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_declined');
});

Deno.test('a hold that needs the booker (3-D Secure) fails, is cancelled, and asks them to confirm in the app', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.respond('paymentIntents.create', intent('pi_3ds', 'requires_action', { amount: 6000 }));
  stripe.respond('paymentIntents.retrieve', intent('pi_3ds', 'requires_action', { amount: 6000 }));

  strictEqual((await runPaymentJobs(deps)).holdFailed, 1);
  deepStrictEqual(db.callsTo('guarantee_hold_failed')[0].args, {
    p_guarantee_id: 'g1', p_intent_id: 'pi_3ds', p_error: 'requires_action', p_needs_action: true,
  });
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_3ds');
});

Deno.test('authentication_required off-session counts as 3-D Secure', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.fail('paymentIntents.create', stripeError({ type: 'StripeCardError', code: 'authentication_required', statusCode: 402 }));
  await runPaymentJobs(deps);
  strictEqual(db.callsTo('guarantee_hold_failed')[0].args.p_needs_action, true);
});

Deno.test('a network error is not a failed attempt: the next run retries with the same key', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.fail('paymentIntents.create', stripeError({ type: 'StripeConnectionError' }));
  await runPaymentJobs(deps);
  await runPaymentJobs(deps);
  strictEqual(db.callsTo('guarantee_hold_failed').length, 0);
  deepStrictEqual(stripe.callsTo('paymentIntents.create').map((c) => c.idempotencyKey),
    ['guarantee-g1-attempt-1', 'guarantee-g1-attempt-1']);
});

Deno.test('retries every queued release that is due', async () => {
  const { db, stripe, deps } = setup();
  db.respond('money_releases_due', [{ release_id: 'r1', booking_id: 'b1', share_id: 's1', guarantee_id: null, stripe_intent_id: 'pi_q', reason: 'booking_cancelled', attempts: 1 }]);
  db.respond('money_release_attempted', null);
  stripe.respond('paymentIntents.retrieve', intent('pi_q', 'requires_capture'));
  const summary = await runPaymentJobs(deps);
  strictEqual(summary.released, 1);
  deepStrictEqual(db.callsTo('money_release_attempted')[0].args, { p_release_id: 'r1', p_succeeded: true, p_outcome: 'cancelled', p_error: null });
});
