import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import type Stripe from 'npm:stripe@^22';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { handlePaymentModeEvent } from './modes.ts';

function event(type: string, object: Record<string, unknown>) {
  return { id: 'evt_1', type, data: { object } } as unknown as Stripe.Event;
}

const dueGuarantee = {
  guarantee_id: 'g1', booking_id: 'b1', profile_id: 'p1', amount_cents: 6000,
  stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_1', attempts: 0,
};

function setup() {
  const db = createDbFake();
  const stripe = createStripeFake();
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('a held share is recorded from the verified event, amount and card included', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'held', guarantee_due: false });

  const handled = await handlePaymentModeEvent(
    event('payment_intent.amount_capturable_updated', { id: 'pi_1', amount_capturable: 680, payment_method: 'pm_1', metadata: {} }),
    deps,
  );

  strictEqual(handled, true);
  deepStrictEqual(db.callsTo('share_payment_held')[0].args, { p_intent_id: 'pi_1', p_amount_cents: 680, p_payment_method_id: 'pm_1' });
  strictEqual(stripe.calls.length, 0, 'nothing is captured here: the job takes it 60 minutes later');
});

Deno.test('kickoff under 72 hours: the booker\'s guarantee hold is placed as soon as their card is saved', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'held', guarantee_id: 'g1', guarantee_due: true });
  db.respond('guarantees_due_for_hold', [dueGuarantee]);
  db.respond('guarantee_hold_placed', { result: 'held' });
  stripe.respond('paymentIntents.create', { id: 'pi_g', status: 'requires_capture', amount_capturable: 6000 });

  await handlePaymentModeEvent(
    event('payment_intent.amount_capturable_updated', { id: 'pi_1', amount_capturable: 680, payment_method: 'pm_1', metadata: {} }),
    deps,
  );

  deepStrictEqual(db.callsTo('guarantees_due_for_hold')[0].args, { p_guarantee_id: 'g1' });
  const [hold] = stripe.callsTo('paymentIntents.create');
  strictEqual(hold.params?.amount, 6000);
  strictEqual(hold.params?.off_session, true);
  strictEqual(hold.idempotencyKey, 'guarantee-g1-attempt-1');
});

Deno.test('a guarantee that is no longer due is left alone', async () => {
  const { db, stripe, deps } = setup();
  db.respond('share_payment_held', { result: 'held', guarantee_id: 'g1', guarantee_due: true });
  db.respond('guarantees_due_for_hold', []);

  await handlePaymentModeEvent(
    event('payment_intent.amount_capturable_updated', { id: 'pi_1', amount_capturable: 680, payment_method: 'pm_1', metadata: {} }),
    deps,
  );

  strictEqual(stripe.calls.length, 0);
});

Deno.test('a share taken at once (under 6 hours) is recorded as captured', async () => {
  const { db, deps } = setup();
  db.respond('share_payment_captured', { result: 'captured', guarantee_due: false });

  const handled = await handlePaymentModeEvent(
    event('payment_intent.succeeded', { id: 'pi_2', amount_received: 680, payment_method: { id: 'pm_2' }, metadata: {} }),
    deps,
  );

  strictEqual(handled, true);
  deepStrictEqual(db.callsTo('share_payment_captured')[0].args, { p_intent_id: 'pi_2', p_amount_cents: 680, p_payment_method_id: 'pm_2' });
});

Deno.test('a card saved by SetupIntent settles a zero-card share', async () => {
  const { db, deps } = setup();
  db.respond('share_card_saved', { result: 'saved', guarantee_due: false });

  const handled = await handlePaymentModeEvent(
    event('setup_intent.succeeded', { id: 'seti_1', payment_method: 'pm_3', metadata: { kind: 'share_card', share_id: 's1' } }),
    deps,
  );

  strictEqual(handled, true);
  deepStrictEqual(db.callsTo('share_card_saved')[0].args, { p_share_id: 's1', p_setup_intent_id: 'seti_1', p_payment_method_id: 'pm_3' });
});

Deno.test('other SetupIntents (Payment methods screen) are not ours', async () => {
  const { db, deps } = setup();
  strictEqual(await handlePaymentModeEvent(event('setup_intent.succeeded', { id: 'seti_2', metadata: {} }), deps), false);
  strictEqual(db.calls.length, 0);
});

Deno.test('guarantee intents are recorded by whoever placed them, not here', async () => {
  const { db, deps } = setup();
  for (const type of ['payment_intent.amount_capturable_updated', 'payment_intent.succeeded']) {
    strictEqual(await handlePaymentModeEvent(event(type, { id: 'pi_g', metadata: { kind: 'guarantee' } }), deps), true);
  }
  strictEqual(db.calls.length, 0);
});

Deno.test('bookings from before P4a fall through to the old handling', async () => {
  const { db, deps } = setup();
  db.respond('share_payment_held', { result: 'legacy' });
  db.respond('share_payment_captured', { result: 'unknown' });

  strictEqual(await handlePaymentModeEvent(
    event('payment_intent.amount_capturable_updated', { id: 'pi_old', amount_capturable: 690, payment_method: null, metadata: {} }),
    deps,
  ), false);
  strictEqual(await handlePaymentModeEvent(
    event('payment_intent.succeeded', { id: 'pi_old', amount_received: 690, payment_method: null, metadata: {} }),
    deps,
  ), false);
  strictEqual(await handlePaymentModeEvent(event('payment_intent.canceled', { id: 'pi_old', metadata: {} }), deps), false);
});
