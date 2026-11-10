// run-collection (docs/specs/13-payments-bookings.md, step 9, "Short games";
// 14, P4c): the database decides what is owed; these check what goes to
// Stripe, with which keys, and what is reported back.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake, stripeError } from '../_shared/stripe-fake.ts';
import { runCollection } from './handler.ts';

function topUp(n: number, amount: number) {
  return {
    item_id: `i${n}`,
    collection_id: 'c1',
    booking_id: 'b1',
    share_id: `s${n}`,
    profile_id: `p${n}`,
    amount_cents: amount,
    stripe_customer_id: `cus_${n}`,
    stripe_payment_method_id: `pm_${n}`,
    previous_intent_id: null,
    attempts: 0,
  };
}

function setup({ due = [{ booking_id: 'b1', collection_id: null }] as unknown[], topUps = [] as unknown[], open = [] as unknown[],
                 settle = { result: 'done', collection_id: 'c1' } as unknown } = {}) {
  const db = createDbFake();
  db.respond('send_short_game_warnings', 0);
  db.respond('send_cash_prompts', 0);
  db.respond('cancellation_fees_to_debts', 0);
  db.respond('collections_due', due);
  db.respond('collection_open_intents', open);
  db.respond('start_collection', { collection_id: 'c1', booking_id: 'b1', status: 'top_ups' });
  db.respond('collection_top_ups_due', topUps);
  db.respond('collection_top_up_paid', { result: 'paid' });
  db.respond('collection_top_up_failed', { result: 'unpaid' });
  db.respond('collection_top_up_errored', { result: 'retry', attempts: 1 });
  db.respond('settle_collection', settle);
  db.respond('collection_guarantee_done', { result: 'captured' });
  db.respond('collection_failed', { result: 'retry', attempts: 1 });
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund', 'record_intent_cancelled']) {
    db.respond(fn, true);
  }
  db.respond('money_release_done', null);
  db.respond('queue_money_release', 'r1');
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.create', (call: { params?: Record<string, unknown> }) =>
    intent(`pi_${(call.params?.metadata as Record<string, string>).item_id}`, 'succeeded', {
      amount: call.params?.amount as number,
      stripeFee: 27,
      captureMethod: 'automatic',
    }));
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('€60 5 v 5 played 4 v 4: a 150 top-up for each of the 8, off-session on their saved card, no fee', async () => {
  const items = Array.from({ length: 8 }, (_, n) => topUp(n, 150));
  const { db, stripe, deps } = setup({ topUps: items });

  const summary = await runCollection(deps);

  strictEqual(summary.collected, 1);
  deepStrictEqual(db.callsTo('start_collection')[0].args, { p_booking_id: 'b1' });
  const creates = stripe.callsTo('paymentIntents.create');
  strictEqual(creates.length, 8);
  creates.forEach((call, n) => {
    deepStrictEqual(call.params, {
      amount: 150,
      currency: 'eur',
      customer: `cus_${n}`,
      payment_method: `pm_${n}`,
      off_session: true,
      confirm: true,
      expand: ['latest_charge.balance_transaction'],
      metadata: { kind: 'top_up', item_id: `i${n}`, collection_id: 'c1', booking_id: 'b1', fee_cents: '0' },
    });
    strictEqual(call.idempotencyKey, `top-up-i${n}`);
  });
  deepStrictEqual(db.callsTo('collection_top_up_paid')[0].args, {
    p_item_id: 'i0', p_intent_id: 'pi_i0', p_amount_cents: 150, p_stripe_fee_cents: 27,
  });
  strictEqual(db.callsTo('collection_top_up_paid').length, 8);
  deepStrictEqual(db.callsTo('settle_collection')[0].args, { p_collection_id: 'c1' });
});

Deno.test('9 players: 72 for the booker and 66 for each of the others, as the database says', async () => {
  const items = [topUp(0, 72), ...Array.from({ length: 8 }, (_, n) => topUp(n + 1, 66))];
  const { stripe, deps } = setup({ topUps: items });
  await runCollection(deps);
  deepStrictEqual(stripe.callsTo('paymentIntents.create').map((c) => c.params?.amount), [72, 66, 66, 66, 66, 66, 66, 66, 66]);
});

Deno.test('a declined top-up is reported unpaid (not retried) and its left-over payment cancelled', async () => {
  const { db, stripe, deps } = setup({ topUps: [topUp(0, 150)] });
  stripe.fail('paymentIntents.create', Object.assign(
    stripeError({ type: 'StripeCardError', code: 'card_declined' }),
    { raw: { type: 'card_error', code: 'card_declined', payment_intent: { id: 'pi_left' } } },
  ));
  stripe.respond('paymentIntents.retrieve', intent('pi_left', 'requires_payment_method'));

  await runCollection(deps);

  deepStrictEqual(db.callsTo('collection_top_up_failed')[0].args, {
    p_item_id: 'i0', p_intent_id: 'pi_left', p_error: 'card_declined',
  });
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_left');
  strictEqual(db.callsTo('collection_top_up_paid').length, 0);
});

Deno.test('the bank wants the player present (3-D Secure off-session): unpaid, the intent cancelled', async () => {
  const { db, stripe, deps } = setup({ topUps: [topUp(0, 150)] });
  stripe.respond('paymentIntents.create', intent('pi_3ds', 'requires_action', { amount: 150 }));
  stripe.respond('paymentIntents.retrieve', intent('pi_3ds', 'requires_action', { amount: 150 }));
  await runCollection(deps);
  deepStrictEqual(db.callsTo('collection_top_up_failed')[0].args, {
    p_item_id: 'i0', p_intent_id: 'pi_3ds', p_error: 'requires_action',
  });
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_3ds');
});

Deno.test('no saved card: the top-up is unpaid without calling Stripe', async () => {
  const { db, stripe, deps } = setup({ topUps: [{ ...topUp(0, 150), stripe_payment_method_id: null }] });
  await runCollection(deps);
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
  deepStrictEqual(db.callsTo('collection_top_up_failed')[0].args, { p_item_id: 'i0', p_intent_id: null, p_error: 'no_saved_card' });
});

Deno.test('no answer from Stripe: retried later with the same key, so never charged twice', async () => {
  const { db, stripe, deps } = setup({ topUps: [topUp(0, 150)], settle: { result: 'waiting', collection_id: 'c1' } });
  stripe.fail('paymentIntents.create', stripeError({ type: 'StripeConnectionError', code: 'api_connection_error' }));
  const summary = await runCollection(deps);
  strictEqual(summary.retry, 1);
  strictEqual(db.callsTo('collection_top_up_errored').length, 1);
  strictEqual(db.callsTo('collection_top_up_failed').length, 0);
  await runCollection(deps);
  deepStrictEqual(stripe.callsTo('paymentIntents.create').map((c) => c.idempotencyKey), ['top-up-i0', 'top-up-i0']);
});

Deno.test('a top-up still processing is looked up on the next run and recorded when it lands', async () => {
  const { db, stripe, deps } = setup({ topUps: [{ ...topUp(0, 150), previous_intent_id: 'pi_slow' }] });
  stripe.respond('paymentIntents.retrieve', intent('pi_slow', 'succeeded', { amount: 150, stripeFee: 27 }));
  await runCollection(deps);
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0, 'not charged again');
  deepStrictEqual(db.callsTo('collection_top_up_paid')[0].args, {
    p_item_id: 'i0', p_intent_id: 'pi_slow', p_amount_cents: 150, p_stripe_fee_cents: 27,
  });
});

Deno.test('responsible: what is unpaid is taken from the booker\'s hold (partial capture), the rest released by Stripe', async () => {
  const { db, stripe, deps } = setup({
    settle: { result: 'guarantee', collection_id: 'c1', booking_id: 'b1', guarantee_id: 'g1', stripe_intent_id: 'pi_g',
              action: 'capture', capture_cents: 150, futty_cents: 0 },
  });
  stripe.respond('paymentIntents.retrieve', intent('pi_g', 'requires_capture', { amount: 6000 }));
  stripe.respond('paymentIntents.capture', intent('pi_g', 'succeeded', { amount: 150, stripeFee: 27 }));

  const summary = await runCollection(deps);

  strictEqual(summary.collected, 1);
  const [capture] = stripe.callsTo('paymentIntents.capture');
  strictEqual(capture.id, 'pi_g');
  deepStrictEqual(capture.params, { amount_to_capture: 150, expand: ['latest_charge.balance_transaction'] });
  strictEqual(capture.idempotencyKey, 'collect-guarantee-c1');
  deepStrictEqual(db.callsTo('collection_guarantee_done')[0].args, {
    p_collection_id: 'c1', p_outcome: 'captured', p_amount_cents: 150, p_stripe_fee_cents: 27,
  });
});

Deno.test('responsible, nothing owed: the whole hold is released', async () => {
  const { db, stripe, deps } = setup({
    settle: { result: 'guarantee', collection_id: 'c1', booking_id: 'b1', guarantee_id: 'g1', stripe_intent_id: 'pi_g',
              action: 'release', capture_cents: 0, futty_cents: 0 },
  });
  stripe.respond('paymentIntents.retrieve', intent('pi_g', 'requires_capture', { amount: 6000 }));
  await runCollection(deps);
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_g');
  strictEqual(stripe.callsTo('paymentIntents.capture').length, 0);
  deepStrictEqual(db.callsTo('collection_guarantee_done')[0].args, {
    p_collection_id: 'c1', p_outcome: 'released', p_amount_cents: 0, p_stripe_fee_cents: 0,
  });
});

Deno.test('the hold was gone (expired or cancelled): reported, so the booker owes it as debt', async () => {
  const { db, stripe, deps } = setup({
    settle: { result: 'guarantee', collection_id: 'c1', booking_id: 'b1', guarantee_id: 'g1', stripe_intent_id: 'pi_g',
              action: 'capture', capture_cents: 680, futty_cents: 80 },
  });
  stripe.respond('paymentIntents.retrieve', intent('pi_g', 'canceled', { amount: 6000 }));
  await runCollection(deps);
  strictEqual(stripe.callsTo('paymentIntents.capture').length, 0);
  strictEqual(db.callsTo('record_intent_cancelled').length, 1);
  deepStrictEqual(db.callsTo('collection_guarantee_done')[0].args, {
    p_collection_id: 'c1', p_outcome: 'gone', p_amount_cents: 0, p_stripe_fee_cents: 0,
  });
});

Deno.test('a capture Stripe doesn\'t answer is retried after a back-off, with the same key', async () => {
  const { db, stripe, deps } = setup({
    due: [{ booking_id: 'b1', collection_id: 'c1' }],
    settle: { result: 'guarantee', collection_id: 'c1', booking_id: 'b1', guarantee_id: 'g1', stripe_intent_id: 'pi_g',
              action: 'capture', capture_cents: 150, futty_cents: 0 },
  });
  stripe.respond('paymentIntents.retrieve', intent('pi_g', 'requires_capture', { amount: 6000 }));
  stripe.fail('paymentIntents.capture', stripeError({ type: 'StripeAPIError', code: 'api_error', statusCode: 500 }));
  const summary = await runCollection(deps);
  strictEqual(summary.retry, 1);
  strictEqual(db.callsTo('collection_failed')[0].args.p_collection_id, 'c1');
  strictEqual(db.callsTo('collection_guarantee_done').length, 0);
  strictEqual(db.callsTo('start_collection').length, 0, 'an unfinished collection carries on, never starts again');
});

Deno.test('a payment still going through on an unpaid share: collection waits for its webhook', async () => {
  const { db, stripe, deps } = setup({ open: [{ share_id: 's9', kind: 'payment', intent_id: 'pi_open' }] });
  stripe.respond('paymentIntents.retrieve', intent('pi_open', 'processing'));
  const summary = await runCollection(deps);
  strictEqual(summary.waiting, 1);
  strictEqual(db.callsTo('start_collection').length, 0);
  strictEqual(stripe.callsTo('paymentIntents.cancel').length, 0);
});

Deno.test('an unfinished payment on an unpaid share is cancelled first, so it can never be paid as well', async () => {
  const { db, stripe, deps } = setup({
    open: [{ share_id: 's9', kind: 'payment', intent_id: 'pi_open' }, { share_id: 's8', kind: 'setup', intent_id: 'seti_open' }],
  });
  stripe.respond('paymentIntents.retrieve', intent('pi_open', 'requires_payment_method'));
  stripe.respond('setupIntents.retrieve', { id: 'seti_open', status: 'requires_payment_method' });
  stripe.respond('setupIntents.cancel', { id: 'seti_open', status: 'canceled' });
  await runCollection(deps);
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].idempotencyKey, 'cancel-pi_open');
  strictEqual(stripe.callsTo('setupIntents.cancel')[0].idempotencyKey, 'cancel-seti_open');
  strictEqual(db.callsTo('start_collection').length, 1);
});

Deno.test('a payment refunded after it went through doesn\'t hold collection up', async () => {
  const { db, stripe, deps } = setup({ open: [{ share_id: 's9', kind: 'cash', intent_id: 'pi_cash' }] });
  stripe.respond('paymentIntents.retrieve', intent('pi_cash', 'succeeded', { amount: 600, refunded: 600 }));
  await runCollection(deps);
  strictEqual(db.callsTo('start_collection').length, 1);
});

Deno.test('the short-game warnings, cash prompts and debts to Futty run on every tick; nothing due, nothing else', async () => {
  const { db, stripe, deps } = setup({ due: [] });
  db.respond('send_short_game_warnings', 2);
  db.respond('send_cash_prompts', 3);
  db.respond('cancellation_fees_to_debts', 1);
  const summary = await runCollection(deps);
  deepStrictEqual(summary, { warned: 2, prompted: 3, futtyDebts: 1, collected: 0, waiting: 0, retry: 0, failed: 0 });
  strictEqual(stripe.calls.length, 0);
});

Deno.test('one booking failing never stops the others', async () => {
  const { db, deps } = setup({ due: [{ booking_id: 'b1', collection_id: null }, { booking_id: 'b2', collection_id: null }] });
  db.respond('start_collection', (args: Record<string, unknown>) => {
    if (args.p_booking_id === 'b1') throw new Error('boom');
    return { collection_id: 'c2', booking_id: 'b2' };
  });
  const summary = await runCollection(deps);
  strictEqual(summary.failed, 1);
  strictEqual(summary.collected, 1);
});
