import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import type Stripe from 'npm:stripe@^22';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { releaseUnfinishedCreditReservations } from '../_shared/credit.ts';
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

  strictEqual(stripe.callsTo('refunds.create')[0].idempotencyKey, 'refund-pi_old-680');
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

// H1: the cancellation's own run may have died before releasing the rest,
// so a late webhook on a cancelled booking runs the release loop for the
// whole booking, not just its own intent.
Deno.test('a late hold on a cancelled booking releases everything on the booking, not just its own intent', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'release', reason: 'booking_cancelled', booking_id: 'b1', share_id: 's1' });
  db.respond('booking_money_to_release', [
    { kind: 'share', id: 's1', status: 'pending', stripe_payment_intent_id: 'pi_late', amount_cents: 680 },
    { kind: 'share', id: 's2', status: 'authorized', stripe_payment_intent_id: 'pi_2', amount_cents: 680 },
    { kind: 'guarantee', id: 'g1', status: 'held', stripe_payment_intent_id: 'pi_g', amount_cents: 6000 },
  ]);
  const state: Record<string, string> = { pi_late: 'requires_capture', pi_2: 'requires_capture', pi_g: 'requires_capture' };
  stripe.respond('paymentIntents.retrieve', (c: { id?: string }) => intent(c.id!, state[c.id!] as 'requires_capture'));
  stripe.respond('paymentIntents.cancel', (c: { id?: string }) => {
    state[c.id!] = 'canceled';
    return { id: c.id, status: 'canceled' };
  });
  db.respond('record_intent_cancelled', false);

  await handlePaymentModeEvent(event('payment_intent.amount_capturable_updated', intent('pi_late', 'requires_capture')), deps);

  strictEqual(db.callsTo('booking_money_to_release')[0].args.p_booking_id, 'b1');
  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.id), ['pi_late', 'pi_2', 'pi_g'],
    'its own hold, then the rest of the booking, each once');
});

Deno.test('money taken late on a cancelled booking is refunded, and the rest of the booking released', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_captured', { result: 'refund', reason: 'booking_cancelled', booking_id: 'b1', share_id: 's1' });
  db.respond('booking_money_to_release', [
    { kind: 'share', id: 's2', status: 'authorized', stripe_payment_intent_id: 'pi_2', amount_cents: 680 },
  ]);
  stripe.respond('paymentIntents.retrieve', (c: { id?: string }) =>
    c.id === 'pi_late' ? intent('pi_late', 'succeeded') : intent('pi_2', 'requires_capture')
  );

  await handlePaymentModeEvent(event('payment_intent.succeeded', intent('pi_late', 'succeeded')), deps);

  strictEqual(stripe.callsTo('refunds.create')[0].params?.payment_intent, 'pi_late');
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_2');
});

Deno.test('a replaced intent on a live booking releases only that intent', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'release', reason: 'replaced_intent', booking_id: 'b1', share_id: 's1' });
  stripe.respond('paymentIntents.retrieve', intent('pi_old', 'requires_capture'));
  await handlePaymentModeEvent(event('payment_intent.amount_capturable_updated', intent('pi_old', 'requires_capture')), deps);
  strictEqual(db.callsTo('booking_money_to_release').length, 0);
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
  strictEqual(create.idempotencyKey, 'guarantee-g1-pm_new-attempt-2', 'a new attempt, not the failed one');
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

// P4b: the booker's whole-team cancellation charge.
Deno.test("the booker's cancellation charge is recorded when Stripe says it was taken", async () => {
  const { db, stripe, deps } = setup();
  const fee = intent('pi_fee', 'succeeded', { amount: 900, stripeFee: 39, metadata: { kind: 'cancel_fee', fee_id: 'f1', booking_id: 'b1' } });
  stripe.respond('paymentIntents.retrieve', fee);
  db.respond('cancellation_fee_paid', { result: 'paid' });

  strictEqual(await handlePaymentModeEvent(event('payment_intent.succeeded', fee), deps), true);
  deepStrictEqual(db.callsTo('cancellation_fee_paid')[0].args, { p_fee_id: 'f1', p_intent_id: 'pi_fee', p_amount_cents: 900, p_stripe_fee_cents: 39 });
  strictEqual(db.callsTo('share_payment_captured').length, 0, 'not a share');
});

Deno.test('a second payment for the same cancellation charge is given back', async () => {
  const { db, stripe, deps } = setup();
  const fee = intent('pi_fee2', 'succeeded', { amount: 900, metadata: { kind: 'cancel_fee', fee_id: 'f1', booking_id: 'b1' } });
  stripe.respond('paymentIntents.retrieve', fee);
  db.respond('cancellation_fee_paid', { result: 'refund', booking_id: 'b1', reason: 'duplicate_cancellation_fee' });
  await handlePaymentModeEvent(event('payment_intent.succeeded', fee), deps);
  deepStrictEqual(stripe.callsTo('refunds.create').map((c) => c.idempotencyKey), ['refund-pi_fee2-900']);
});

Deno.test('other events for a cancellation charge are acknowledged and ignored', async () => {
  const { db, deps } = setup();
  const fee = intent('pi_fee3', 'requires_action', { metadata: { kind: 'cancel_fee', fee_id: 'f1' } });
  strictEqual(await handlePaymentModeEvent(event('payment_intent.amount_capturable_updated', fee), deps), true);
  strictEqual(db.calls.length, 0);
});

// P4b: credit set aside for a payment that's cancelled goes back.
Deno.test("a share's cancelled payment is handled here: the old handling never asks to pay again", async () => {
  // Whatever the database did (nothing, on a cancelled booking), index.ts's
  // old "confirm your payment again" handling must not run for it.
  for (const released of [true, false]) {
    const { db, deps } = setup();
    db.respond('release_share_credit_reservation', released);
    const canceled = { ...intent('pi_c', 'canceled'), cancellation_reason: 'automatic' };
    const handled = await handlePaymentModeEvent(event('payment_intent.canceled', canceled), deps);
    strictEqual(handled, true, 'index.ts stops here');
    deepStrictEqual(db.callsTo('release_share_credit_reservation')[0].args, {
      p_share_id: 's1', p_intent_id: 'pi_c', p_hold_released: true,
    });
  }
});

Deno.test('a cancelled intent from before P4a (no kind) still goes to the old handling', async () => {
  const { db, deps } = setup();
  const legacy = { ...intent('pi_old', 'canceled'), metadata: { share_id: 's1', booking_id: 'b1' } };
  strictEqual(await handlePaymentModeEvent(event('payment_intent.canceled', legacy), deps), false);
  strictEqual(db.calls.length, 0);
});

// Re-review Medium: a cancelled event means the hold is really gone, so the
// webhook undoes a held share too (pay-cancellations-13-undo.test.sql has
// the database side).
Deno.test('the release job cancels at Stripe and dies before the database call: the webhook finishes it', async () => {
  const { db, stripe, deps } = setup();
  db.respond('credit_reservations_to_release', [
    { share_id: 's1', booking_id: 'b1', stripe_payment_intent_id: 'pi_c', stripe_setup_intent_id: null },
  ]);
  db.respond('credit_release_started', true);
  stripe.respond('paymentIntents.retrieve', intent('pi_c', 'requires_confirmation'));
  db.fail('release_share_credit_reservation', 'connection lost');
  deepStrictEqual(await releaseUnfinishedCreditReservations(deps), { released: 0, left: 0, failed: 1 });
  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.id), ['pi_c'], 'cancelled at Stripe');

  // Stripe then sends payment_intent.canceled.
  db.respond('release_share_credit_reservation', true);
  await handlePaymentModeEvent(event('payment_intent.canceled', intent('pi_c', 'canceled')), deps);
  const calls = db.callsTo('release_share_credit_reservation');
  deepStrictEqual(calls[calls.length - 1].args, { p_share_id: 's1', p_intent_id: 'pi_c', p_hold_released: true });
});

Deno.test('a cancelled SetupIntent for a credit-covered share releases its credit', async () => {
  const { db, deps } = setup();
  db.respond('release_share_credit_reservation', true);
  const handled = await handlePaymentModeEvent(
    event('setup_intent.canceled', { id: 'seti_1', status: 'canceled', metadata: { kind: 'share_card', share_id: 's1' } }),
    deps,
  );
  strictEqual(handled, true);
  deepStrictEqual(db.callsTo('release_share_credit_reservation')[0].args, { p_share_id: 's1', p_intent_id: 'seti_1' });
  strictEqual(await handlePaymentModeEvent(event('setup_intent.canceled', { id: 'seti_2', metadata: {} }), deps), false);
});

// P4c: paying what you owe, and top-ups.
Deno.test('a debt paid in the app: recorded with Stripe\'s actual fee, and the debt settled', async () => {
  const { db, stripe, deps } = setup();
  const paid = intent('pi_debt', 'succeeded', { amount: 680, stripeFee: 35, metadata: { kind: 'debt', debt_id: 'd1', booking_id: 'b1', fee_cents: '80' } });
  stripe.respond('paymentIntents.retrieve', paid);
  db.respond('debt_paid', { result: 'settled' });

  strictEqual(await handlePaymentModeEvent(event('payment_intent.succeeded', paid), deps), true);

  deepStrictEqual(db.callsTo('debt_paid')[0].args, { p_debt_id: 'd1', p_intent_id: 'pi_debt', p_amount_cents: 680, p_stripe_fee_cents: 35 });
  strictEqual(db.callsTo('share_payment_captured').length, 0, 'never treated as a share');
  strictEqual(stripe.callsTo('refunds.create').length, 0);
});

Deno.test('a debt paid after it was already settled is given back', async () => {
  const { db, stripe, deps } = setup();
  const paid = intent('pi_debt2', 'succeeded', { amount: 600, metadata: { kind: 'debt', debt_id: 'd1', booking_id: 'b1', fee_cents: '0' } });
  stripe.respond('paymentIntents.retrieve', paid);
  db.respond('debt_paid', { result: 'refund', booking_id: 'b1', reason: 'debt_already_settled' });
  await handlePaymentModeEvent(event('payment_intent.succeeded', paid), deps);
  strictEqual(stripe.callsTo('refunds.create')[0].params?.payment_intent, 'pi_debt2');
});

Deno.test('a cash part paid by card after the match counts as paid in cash', async () => {
  const { db, stripe, deps } = setup();
  const paid = intent('pi_cashpart', 'succeeded', {
    amount: 600, stripeFee: 34, metadata: { kind: 'cash_part', cash_share_id: 's7', booking_id: 'b1', fee_cents: '0' },
  });
  stripe.respond('paymentIntents.retrieve', paid);
  db.respond('cash_paid_by_card', { result: 'paid' });
  strictEqual(await handlePaymentModeEvent(event('payment_intent.succeeded', paid), deps), true);
  deepStrictEqual(db.callsTo('cash_paid_by_card')[0].args, { p_share_id: 's7', p_intent_id: 'pi_cashpart', p_amount_cents: 600, p_stripe_fee_cents: 34 });
});

Deno.test('top-ups are recorded by run-collection, which charged them: the webhook leaves them alone', async () => {
  const { db, stripe, deps } = setup();
  const topUp = intent('pi_top', 'succeeded', { amount: 150, metadata: { kind: 'top_up', item_id: 'i1', booking_id: 'b1' } });
  strictEqual(await handlePaymentModeEvent(event('payment_intent.succeeded', topUp), deps), true);
  strictEqual(db.calls.length, 0);
  strictEqual(stripe.calls.length, 0);
});

Deno.test('a cancelled debt, cash-part or top-up payment needs nothing (the next "Pay" starts a new one)', async () => {
  const { db, deps } = setup();
  for (const kind of ['debt', 'cash_part', 'top_up']) {
    strictEqual(await handlePaymentModeEvent(event('payment_intent.canceled', intent('pi_x', 'canceled', { metadata: { kind } })), deps), true);
  }
  strictEqual(db.calls.length, 0);
});
