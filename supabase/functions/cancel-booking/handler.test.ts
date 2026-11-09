import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake, stripeError } from '../_shared/stripe-fake.ts';
import { cancelBooking } from './handler.ts';

function setup(rows: unknown[], intents: Record<string, unknown>) {
  const db = createDbFake();
  db.respond('cancel_booking_for', 'confirmed');
  db.respond('booking_money_to_release', rows);
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund', 'share_released', 'guarantee_released']) {
    db.respond(fn, true);
  }
  db.respond('money_release_done', null);
  db.respond('queue_money_release', 'r1');
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.retrieve', (call: { id?: string }) => intents[call.id!]);
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  stripe.respond('refunds.create', (call: { params?: Record<string, unknown> }) => ({
    id: `re_${call.params?.payment_intent}`, status: 'succeeded', amount: call.params?.amount,
  }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

const row = (kind: string, id: string, status: string, pi: string | null, amount = 680) =>
  ({ kind, id, status, stripe_payment_intent_id: pi, amount_cents: amount });

Deno.test('releases holds, refunds payments and records each in the ledger', async () => {
  const { db, stripe, deps } = setup(
    [
      row('share', 's1', 'authorized', 'pi_held'),
      row('share', 's2', 'paid', 'pi_paid'),
      row('share', 's3', 'pending', null),
      row('guarantee', 'g1', 'held', 'pi_g', 6000),
    ],
    {
      pi_held: intent('pi_held', 'requires_capture'),
      pi_paid: intent('pi_paid', 'succeeded'),
      pi_g: intent('pi_g', 'requires_capture', { amount: 6000, metadata: { kind: 'guarantee' } }),
    },
  );

  const res = await cancelBooking(deps, 'p1', 'b1');

  deepStrictEqual(res, { status: 200, body: { cancelled: true, refunded: true, released: true, pending: false } });
  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.id), ['pi_held', 'pi_g']);
  deepStrictEqual(stripe.callsTo('refunds.create').map((c) => c.idempotencyKey), ['refund-pi_paid-booking_cancelled-680']);
  deepStrictEqual(db.callsTo('record_intent_refund')[0].args.p_refund_id, 're_pi_paid', 'the refund is keyed on its re_ id');
  deepStrictEqual(db.callsTo('share_released')[0].args, { p_share_id: 's3', p_new_status: 'cancelled' });
});

Deno.test('cancelling as an immediate payment lands: money already taken is refunded, never left', async () => {
  // The share still said 'pending' when it was read; Stripe had taken it.
  const { db, stripe, deps } = setup(
    [row('share', 's1', 'pending', 'pi_racing')],
    { pi_racing: intent('pi_racing', 'succeeded', { captureMethod: 'automatic' }) },
  );

  const res = await cancelBooking(deps, 'p1', 'b1');

  strictEqual(res.body.refunded, true);
  strictEqual(stripe.callsTo('paymentIntents.cancel').length, 0, 'not a cancel: a refund');
  strictEqual(db.callsTo('record_intent_capture')[0].args.p_amount_cents, 680, 'the capture is recorded');
  strictEqual(db.callsTo('record_intent_refund')[0].args.p_amount_cents, 680, 'and so is the refund');
});

Deno.test('a Stripe failure is never swallowed: it goes on the retry queue and the others still go back', async () => {
  const { db, stripe, deps } = setup(
    [row('share', 's1', 'paid', 'pi_bad'), row('share', 's2', 'authorized', 'pi_ok')],
    { pi_bad: intent('pi_bad', 'succeeded'), pi_ok: intent('pi_ok', 'requires_capture') },
  );
  stripe.fail('refunds.create', stripeError({ type: 'StripeConnectionError', code: 'api_connection_error' }));

  const res = await cancelBooking(deps, 'p1', 'b1');

  deepStrictEqual(res.body, { cancelled: true, refunded: false, released: true, pending: true });
  deepStrictEqual(db.callsTo('queue_money_release')[0].args, {
    p_booking_id: 'b1', p_share_id: 's1', p_guarantee_id: null, p_intent_id: 'pi_bad', p_reason: 'booking_cancelled',
    p_error: 'api_connection_error: Fake Stripe error',
  });
});

Deno.test('a pre-split booking paid as one intent is refunded once', async () => {
  const { stripe, deps } = setup(
    [row('booking', 'b1', 'confirmed', 'pi_legacy', 6000)],
    { pi_legacy: intent('pi_legacy', 'succeeded', { amount: 6000, metadata: {} }) },
  );
  const res = await cancelBooking(deps, 'p1', 'b1');
  strictEqual(res.body.refunded, true);
  strictEqual(stripe.callsTo('refunds.create').length, 1);
});

Deno.test('a refused cancellation moves no money', async () => {
  const { db, stripe, deps } = setup([], {});
  db.fail('cancel_booking_for', 'not_your_booking');
  const res = await cancelBooking(deps, 'p2', 'b1');
  deepStrictEqual(res, { status: 400, body: { error: 'not_your_booking' } });
  strictEqual(stripe.calls.length, 0);
  strictEqual(db.callsTo('booking_money_to_release').length, 0);
});
