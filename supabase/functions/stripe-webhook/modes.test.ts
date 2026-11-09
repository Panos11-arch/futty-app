import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import type Stripe from 'npm:stripe@^22';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { handlePaymentModeEvent } from './modes.ts';

// 2026-11-09 12:00:00 UTC
const CREATED = 1794225600;
const AT = new Date(CREATED * 1000).toISOString();

function event(type: string, object: Record<string, unknown>) {
  return { id: 'evt_1', type, created: CREATED, data: { object } } as unknown as Stripe.Event;
}

const dueGuarantee = {
  guarantee_id: 'g1', booking_id: 'b1', profile_id: 'p1', amount_cents: 6000,
  stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_1', attempts: 0,
};

function setup() {
  const db = createDbFake();
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund']) db.respond(fn, true);
  db.respond('money_release_done', null);
  db.respond('queue_money_release', 'r1');
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  stripe.respond('refunds.create', (call: { params?: Record<string, unknown> }) => ({ id: 're_1', status: 'succeeded', amount: call.params?.amount }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('a held share is found by its metadata share id, with the event time, amount and card', async () => {
  const { db, deps } = setup();
  db.respond('share_payment_held', { result: 'held', guarantee_due: false });

  const handled = await handlePaymentModeEvent(
    event('payment_intent.amount_capturable_updated', intent('pi_1', 'requires_capture')),
    deps,
  );

  strictEqual(handled, true);
  deepStrictEqual(db.callsTo('share_payment_held')[0].args, {
    p_share_id: 's1', p_intent_id: 'pi_1', p_amount_cents: 680, p_payment_method_id: 'pm_1', p_at: AT,
  });
});

Deno.test('kickoff under 72 hours: the booker\'s guarantee hold is placed as soon as their card is saved', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'held', guarantee_id: 'g1', guarantee_due: true });
  db.respond('guarantees_due_for_hold', [dueGuarantee]);
  db.respond('guarantee_hold_placed', { result: 'held' });
  stripe.respond('paymentIntents.create', intent('pi_g', 'requires_capture', { amount: 6000 }));

  await handlePaymentModeEvent(event('payment_intent.amount_capturable_updated', intent('pi_1', 'requires_capture')), deps);

  deepStrictEqual(db.callsTo('guarantees_due_for_hold')[0].args, { p_guarantee_id: 'g1' });
  strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.amount, 6000);
});

Deno.test('a share taken at once is recorded with its fee and Stripe\'s actual fee', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_captured', { result: 'captured', guarantee_due: false });
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'succeeded', { stripeFee: 34 }));

  await handlePaymentModeEvent(event('payment_intent.succeeded', intent('pi_1', 'succeeded')), deps);

  deepStrictEqual(db.callsTo('share_payment_captured')[0].args, {
    p_share_id: 's1', p_intent_id: 'pi_1', p_amount_cents: 680, p_payment_method_id: 'pm_1',
    p_fee_cents: 80, p_stripe_fee_cents: 34, p_at: AT,
  });
});

Deno.test('a webhook for a replaced intent: a hold on it is released and recorded', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'release', reason: 'replaced_intent', booking_id: 'b1', share_id: 's1' });
  stripe.respond('paymentIntents.retrieve', intent('pi_old', 'requires_capture'));

  await handlePaymentModeEvent(event('payment_intent.amount_capturable_updated', intent('pi_old', 'requires_capture')), deps);

  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_old');
  deepStrictEqual(db.callsTo('record_money_movement')[0].args.p_reason, 'replaced_intent');
});

Deno.test('a webhook for a replaced intent: money taken on it is refunded and recorded', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_captured', { result: 'refund', reason: 'replaced_intent', booking_id: 'b1', share_id: 's1' });
  stripe.respond('paymentIntents.retrieve', intent('pi_old', 'succeeded'));

  await handlePaymentModeEvent(event('payment_intent.succeeded', intent('pi_old', 'succeeded')), deps);

  strictEqual(stripe.callsTo('refunds.create')[0].idempotencyKey, 'refund-pi_old-replaced_intent-680');
  deepStrictEqual(db.callsTo('record_intent_refund')[0].args, {
    p_intent_id: 'pi_old', p_refund_id: 're_1', p_amount_cents: 680, p_reason: 'replaced_intent',
  });
});

Deno.test('a refused hold whose release fails goes on the retry queue; the webhook still succeeds', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'release', reason: 'booking_cancelled', booking_id: 'b1', share_id: 's1' });
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'requires_capture'));
  stripe.fail('paymentIntents.cancel', new Error('network'));

  strictEqual(await handlePaymentModeEvent(event('payment_intent.amount_capturable_updated', intent('pi_1', 'requires_capture')), deps), true);
  strictEqual(db.callsTo('queue_money_release')[0].args.p_intent_id, 'pi_1');
});

Deno.test('the booker paid after the 15-minute window: everything on the booking goes back', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'expired', booking_id: 'b1', share_id: 's1' });
  db.respond('booking_money_to_release', [{ kind: 'share', id: 's1', status: 'pending', stripe_payment_intent_id: 'pi_1', amount_cents: 6550 }]);
  stripe.respond('paymentIntents.retrieve', intent('pi_1', 'requires_capture', { amount: 6550 }));

  await handlePaymentModeEvent(event('payment_intent.amount_capturable_updated', intent('pi_1', 'requires_capture', { amount: 6550 })), deps);

  strictEqual(db.callsTo('booking_money_to_release')[0].args.p_booking_id, 'b1');
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_1');
  strictEqual(db.callsTo('record_money_movement')[0].args.p_reason, 'payment_window_expired');
});

Deno.test('a card saved by SetupIntent settles a zero-card share', async () => {
  const { db, deps } = setup();
  db.respond('share_card_saved', { result: 'saved', guarantee_due: false });
  await handlePaymentModeEvent(event('setup_intent.succeeded', {
    id: 'seti_1', payment_method: 'pm_9', metadata: { kind: 'share_card', share_id: 's1' },
  }), deps);
  deepStrictEqual(db.callsTo('share_card_saved')[0].args, {
    p_share_id: 's1', p_setup_intent_id: 'seti_1', p_payment_method_id: 'pm_9', p_at: AT,
  });
});

Deno.test('a booker\'s new guarantee card replaces the old one and the hold is retried at once', async () => {
  const { db, stripe, deps } = setup();
  db.respond('guarantee_card_replaced', { result: 'replaced', guarantee_id: 'g1', guarantee_due: true });
  db.respond('guarantees_due_for_hold', [{ ...dueGuarantee, stripe_payment_method_id: 'pm_new', attempts: 1 }]);
  db.respond('guarantee_hold_placed', { result: 'held' });
  stripe.respond('paymentIntents.create', intent('pi_g2', 'requires_capture', { amount: 6000 }));

  await handlePaymentModeEvent(event('setup_intent.succeeded', {
    id: 'seti_g', payment_method: 'pm_new', metadata: { kind: 'guarantee_card', guarantee_id: 'g1', profile_id: 'p1' },
  }), deps);

  deepStrictEqual(db.callsTo('guarantee_card_replaced')[0].args, { p_guarantee_id: 'g1', p_profile_id: 'p1', p_payment_method_id: 'pm_new' });
  const [create] = stripe.callsTo('paymentIntents.create');
  strictEqual(create.params?.payment_method, 'pm_new');
  strictEqual(create.idempotencyKey, 'guarantee-g1-attempt-2', 'a new attempt, not the failed one');
});

Deno.test('other SetupIntents (Payment methods screen) are not ours', async () => {
  const { db, deps } = setup();
  strictEqual(await handlePaymentModeEvent(event('setup_intent.succeeded', { id: 'seti_2', metadata: {} }), deps), false);
  strictEqual(db.calls.length, 0);
});

Deno.test('guarantee intents are recorded by whoever placed them, not here', async () => {
  const { db, deps } = setup();
  strictEqual(await handlePaymentModeEvent(
    event('payment_intent.amount_capturable_updated', intent('pi_g', 'requires_capture', { metadata: { kind: 'guarantee' } })),
    deps,
  ), true);
  strictEqual(db.calls.length, 0);
});

Deno.test('bookings from before P4a fall through to the old handling', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_captured', { result: 'legacy' });
  const legacy = { id: 'pi_l', status: 'succeeded', amount_received: 680, metadata: { share_id: 's1', booking_id: 'b1' } };
  strictEqual(await handlePaymentModeEvent(event('payment_intent.succeeded', legacy), deps), false);
  strictEqual(stripe.calls.length, 0, 'no fee lookup for the old flow');
  strictEqual(await handlePaymentModeEvent(event('payment_intent.succeeded', { id: 'pi_b', metadata: {} }), deps), false,
    'a whole-booking intent has no share');
  strictEqual(await handlePaymentModeEvent(event('payment_intent.canceled', { id: 'pi_c', metadata: {} }), deps), false);
});
