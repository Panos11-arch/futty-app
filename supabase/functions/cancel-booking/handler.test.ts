// cancel-booking keeps today's rules (P4b replaces them); P4a adds an
// idempotency key to every Stripe call, writes every release and refund to
// the money ledger, and releases the booker's guarantee hold.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake, stripeError } from '../_shared/stripe-fake.ts';
import { cancelBooking } from './handler.ts';

function setup(rows: unknown[], previousStatus = 'confirmed') {
  const db = createDbFake();
  db.respond('cancel_booking_for', previousStatus);
  db.respond('booking_money_to_release', rows);
  db.respond('record_money_movement', true);
  db.respond('share_released', true);
  db.respond('guarantee_released', true);
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  stripe.respond('refunds.create', { id: 're_1', status: 'succeeded' });
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('releases holds, refunds payments and records each in the ledger', async () => {
  const { db, stripe, deps } = setup([
    { kind: 'share', id: 's_held', status: 'authorized', stripe_payment_intent_id: 'pi_held', amount_cents: 680 },
    { kind: 'share', id: 's_paid', status: 'paid', stripe_payment_intent_id: 'pi_paid', amount_cents: 680 },
    { kind: 'share', id: 's_open', status: 'pending', stripe_payment_intent_id: 'pi_open', amount_cents: 680 },
    { kind: 'share', id: 's_none', status: 'pending', stripe_payment_intent_id: null, amount_cents: 680 },
    { kind: 'guarantee', id: 'g1', status: 'held', stripe_payment_intent_id: 'pi_g', amount_cents: 6000 },
  ]);

  const res = await cancelBooking(deps, 'p1', 'b1');

  deepStrictEqual(res, { status: 200, body: { cancelled: true, refunded: true, released: true } });
  deepStrictEqual(db.callsTo('cancel_booking_for')[0].args, { p_booking_id: 'b1', p_profile_id: 'p1' });
  deepStrictEqual(
    stripe.callsTo('paymentIntents.cancel').map((c) => [c.id, c.idempotencyKey]),
    [['pi_held', 'cancel-pi_held'], ['pi_open', 'cancel-pi_open'], ['pi_g', 'cancel-pi_g']],
  );
  deepStrictEqual(
    stripe.callsTo('refunds.create').map((c) => [c.params, c.idempotencyKey]),
    [[{ payment_intent: 'pi_paid' }, 'refund-share-s_paid']],
  );
  deepStrictEqual(db.callsTo('record_money_movement').map((c) => c.args), [
    { p_booking_id: 'b1', p_share_id: 's_held', p_guarantee_id: null, p_kind: 'cancel', p_amount_cents: 680, p_stripe_id: 'pi_held', p_reason: 'booking_cancelled' },
    { p_booking_id: 'b1', p_share_id: 's_paid', p_guarantee_id: null, p_kind: 'refund', p_amount_cents: 680, p_stripe_id: 'pi_paid', p_reason: 'booking_cancelled' },
    { p_booking_id: 'b1', p_share_id: null, p_guarantee_id: 'g1', p_kind: 'cancel', p_amount_cents: 6000, p_stripe_id: 'pi_g', p_reason: 'booking_cancelled' },
  ]);
  deepStrictEqual(db.callsTo('share_released').map((c) => c.args), [
    { p_share_id: 's_held', p_new_status: 'cancelled' },
    { p_share_id: 's_paid', p_new_status: 'refunded' },
    { p_share_id: 's_open', p_new_status: 'cancelled' },
    { p_share_id: 's_none', p_new_status: 'cancelled' },
  ]);
  deepStrictEqual(db.callsTo('guarantee_released').map((c) => c.args), [{ p_guarantee_id: 'g1' }]);
});

Deno.test('a guarantee that was never held is just closed', async () => {
  const { db, stripe, deps } = setup([
    { kind: 'guarantee', id: 'g1', status: 'failed', stripe_payment_intent_id: 'pi_failed', amount_cents: 6000 },
  ]);

  const res = await cancelBooking(deps, 'p1', 'b1');

  deepStrictEqual(res.body, { cancelled: true, refunded: false, released: false });
  strictEqual(stripe.calls.length, 0);
  strictEqual(db.callsTo('record_money_movement').length, 0);
  strictEqual(db.callsTo('guarantee_released').length, 1);
});

Deno.test('a Stripe failure on one share doesn\'t stop the others', async () => {
  const { db, stripe, deps } = setup([
    { kind: 'share', id: 's1', status: 'authorized', stripe_payment_intent_id: 'pi_1', amount_cents: 680 },
    { kind: 'share', id: 's2', status: 'paid', stripe_payment_intent_id: 'pi_2', amount_cents: 680 },
  ]);
  stripe.fail('paymentIntents.cancel', stripeError({ code: 'payment_intent_unexpected_state' }));

  const res = await cancelBooking(deps, 'p1', 'b1');

  deepStrictEqual(res.body, { cancelled: true, refunded: true, released: false });
  deepStrictEqual(db.callsTo('share_released').map((c) => c.args.p_share_id), ['s2'], 'the failed one stays for follow-up');
});

Deno.test('a pre-split booking paid as one intent is refunded once', async () => {
  const { db, stripe, deps } = setup([
    { kind: 'booking', id: 'b1', status: 'confirmed', stripe_payment_intent_id: 'pi_whole', amount_cents: 6000 },
  ]);

  const res = await cancelBooking(deps, 'p1', 'b1');

  deepStrictEqual(res.body, { cancelled: true, refunded: true, released: false });
  deepStrictEqual(stripe.callsTo('refunds.create').map((c) => c.idempotencyKey), ['refund-booking-b1']);
  strictEqual(db.callsTo('record_money_movement')[0].args.p_kind, 'refund');
});

Deno.test('a pre-split booking that was never confirmed has nothing to refund', async () => {
  const { stripe, deps } = setup([
    { kind: 'booking', id: 'b1', status: 'pending_payment', stripe_payment_intent_id: 'pi_whole', amount_cents: 6000 },
  ], 'pending_payment');

  await cancelBooking(deps, 'p1', 'b1');

  strictEqual(stripe.calls.length, 0);
});

Deno.test('a refused cancellation moves no money', async () => {
  const { db, stripe, deps } = setup([]);
  db.fail('cancel_booking_for', 'too_late_to_cancel');

  deepStrictEqual(await cancelBooking(deps, 'p1', 'b1'), { status: 400, body: { error: 'too_late_to_cancel' } });
  strictEqual(stripe.calls.length, 0);
});
