import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake, stripeError } from '../_shared/stripe-fake.ts';
import { cancelBooking } from './handler.ts';

// P4b: a booking made since P4a. The database decides (cancel_booking_internal)
// and lists the Stripe work; these check the money moves exactly as listed.

const plan = (extra: Record<string, unknown> = {}) => ({
  booking_id: 'b1', scope: 'my_spot', lines: [], booker_fee: null, quote: 'q1', cancellation_id: 'c1', fee_id: null,
  ...extra,
});

const line = (kind: string, id: string, pi: string | null, amount = 680, share: string | null = 's1') => ({
  line_id: id, kind, booking_id: 'b1', share_id: share, guarantee_id: share ? null : 'g1', stripe_intent_id: pi,
  amount_cents: amount, reason: `my_spot_${kind}`, attempts: 0,
});

const feeRow = (extra: Record<string, unknown> = {}) => ({
  fee_id: 'f1', booking_id: 'b1', cancellation_id: 'c1', profile_id: 'p1', amount_cents: 900,
  stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_1', attempt: 1, off_session: false, previous_intent_id: null,
  ...extra,
});

function setupP4b(result: unknown, work: unknown[] = []) {
  const db = createDbFake();
  db.respond('cancel_booking_internal', result);
  db.respond('cancellation_work', work);
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund', 'cancellation_line_done',
                    'cancellation_line_captured', 'cancellation_line_refunded']) {
    db.respond(fn, true);
  }
  db.respond('money_release_done', null);
  db.respond('cancellation_line_failed', { result: 'failed', attempts: 1 });
  db.respond('cancellation_fee_to_charge', [feeRow()]);
  db.respond('cancellation_fee_paid', { result: 'paid' });
  db.respond('cancellation_fee_attempted', { result: 'failed' });
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('the caller, scope and the quote they confirmed go to the database first', async () => {
  const { db, stripe, deps } = setupP4b(plan());
  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'my_spot', quote: 'q1' });
  strictEqual(res.status, 200);
  deepStrictEqual(db.callsTo('cancel_booking_internal')[0].args, {
    p_booking_id: 'b1', p_scope: 'my_spot', p_profile_id: 'p1', p_expected_quote: 'q1',
  });
  deepStrictEqual(db.callsTo('cancellation_work')[0].args, { p_cancellation_id: 'c1' }, 'this cancellation\'s work');
  strictEqual(stripe.calls.length, 0, 'nothing to do at Stripe');
  strictEqual(res.body.cancelled, true);
  strictEqual(res.body.fee, null);
});

Deno.test('free hour: the hold is cancelled at Stripe, keyed on the intent, and the line closed', async () => {
  const { db, stripe, deps } = setupP4b(plan(), [line('release', 'l1', 'pi_held')]);
  stripe.respond('paymentIntents.retrieve', intent('pi_held', 'requires_capture'));

  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'my_spot', quote: 'q1' });

  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.idempotencyKey), ['cancel-pi_held']);
  strictEqual(db.callsTo('record_money_movement')[0].args.p_kind, 'cancel');
  strictEqual(db.callsTo('record_money_movement')[0].args.p_amount_cents, 680);
  deepStrictEqual(db.callsTo('cancellation_line_done')[0].args, { p_line_id: 'l1', p_outcome: 'cancelled' });
  strictEqual(res.body.pending, false);
});

Deno.test('a held share whose money is kept is taken first, with the capture job\'s own key, then credited', async () => {
  const { db, stripe, deps } = setupP4b(plan(), [line('capture', 'l1', 'pi_over')]);
  stripe.respond('paymentIntents.retrieve', intent('pi_over', 'requires_capture'));
  stripe.respond('paymentIntents.capture', (c: { id?: string }) => intent(c.id!, 'succeeded'));

  await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'my_spot', quote: 'q1' });

  deepStrictEqual(stripe.callsTo('paymentIntents.capture').map((c) => c.idempotencyKey), ['capture-share-s1'],
    'the same key as run-payment-jobs: never taken twice');
  deepStrictEqual(db.callsTo('cancellation_line_captured')[0].args, { p_line_id: 'l1', p_amount_cents: 680, p_stripe_fee_cents: 35 });
});

Deno.test('a share the job already took is not taken again', async () => {
  const { db, stripe, deps } = setupP4b(plan(), [line('capture', 'l1', 'pi_taken')]);
  stripe.respond('paymentIntents.retrieve', intent('pi_taken', 'succeeded'));
  await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'my_spot', quote: 'q1' });
  strictEqual(stripe.callsTo('paymentIntents.capture').length, 0);
  strictEqual(db.callsTo('cancellation_line_captured').length, 1);
});

Deno.test('a hold that expired before it could be taken: recorded, the credit part settled, not retried', async () => {
  const { db, stripe, deps } = setupP4b(plan(), [line('capture', 'l1', 'pi_gone')]);
  db.respond('record_intent_cancelled', true);
  db.respond('cancellation_line_not_taken', true);
  stripe.respond('paymentIntents.retrieve', intent('pi_gone', 'canceled'));
  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'my_spot', quote: 'q1' });
  strictEqual(stripe.callsTo('paymentIntents.capture').length, 0);
  strictEqual(db.callsTo('cancellation_line_captured').length, 0);
  strictEqual(db.callsTo('record_intent_cancelled')[0].args.p_intent_id, 'pi_gone');
  deepStrictEqual(db.callsTo('cancellation_line_not_taken')[0].args, { p_line_id: 'l1' });
  strictEqual(db.callsTo('cancellation_line_failed').length, 0, 'not retried');
  strictEqual(res.body.pending, false);
});

Deno.test('a Stripe failure is never swallowed: the line is retried later and the others still go back', async () => {
  const { db, stripe, deps } = setupP4b(plan(), [line('release', 'l1', 'pi_bad'), line('release', 'l2', 'pi_ok', 680, 's2')]);
  stripe.respond('paymentIntents.retrieve', (c: { id?: string }) => intent(c.id!, 'requires_capture'));
  stripe.respond('paymentIntents.cancel', (c: { id?: string }) => {
    if (c.id === 'pi_bad') throw stripeError({ type: 'StripeConnectionError', code: 'api_connection_error' });
    return { id: c.id, status: 'canceled' };
  });

  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'whole_team', quote: 'q1' });

  deepStrictEqual(db.callsTo('cancellation_line_failed')[0].args, { p_line_id: 'l1', p_error: 'api_connection_error: Fake Stripe error' });
  deepStrictEqual(db.callsTo('cancellation_line_done').map((c) => c.args.p_line_id), ['l2']);
  strictEqual(res.body.pending, true);
});

Deno.test('a guarantee with no hold yet: nothing at Stripe, the line closed', async () => {
  const { db, stripe, deps } = setupP4b(plan(), [line('release', 'l1', null, 0, null)]);
  await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'whole_team', quote: 'q1' });
  strictEqual(stripe.calls.length, 0);
  deepStrictEqual(db.callsTo('cancellation_line_done')[0].args, { p_line_id: 'l1', p_outcome: 'nothing' });
});

Deno.test('whole team: the booker\'s 900 is taken on-session on their saved card, Futty\'s, keyed on the charge', async () => {
  const { db, stripe, deps } = setupP4b(plan({ scope: 'whole_team', fee_id: 'f1', booker_fee: { players: 9, amount_cents: 900 } }));
  stripe.respond('paymentIntents.create', () => intent('pi_fee', 'succeeded', { amount: 900, stripeFee: 39, captureMethod: 'automatic' }));

  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'whole_team', quote: 'q1' });

  const [create] = stripe.callsTo('paymentIntents.create');
  strictEqual(create.idempotencyKey, 'cancel-fee-f1-attempt-1');
  strictEqual(create.params?.amount, 900);
  strictEqual(create.params?.payment_method, 'pm_1');
  strictEqual(create.params?.customer, 'cus_1');
  strictEqual(create.params?.off_session, false, 'on-session: the booker just confirmed it');
  strictEqual(create.params?.confirm, true);
  deepStrictEqual(create.params?.metadata, { kind: 'cancel_fee', fee_id: 'f1', booking_id: 'b1', cancellation_id: 'c1', fee_cents: '900' });
  deepStrictEqual(db.callsTo('cancellation_fee_paid')[0].args, {
    p_fee_id: 'f1', p_intent_id: 'pi_fee', p_amount_cents: 900, p_stripe_fee_cents: 39,
  });
  deepStrictEqual(res.body.fee, { amountCents: 900, status: 'paid' });
});

Deno.test('the bank asks for 3-D Secure: the app gets the client secret, the cancellation stands', async () => {
  const { db, stripe, deps } = setupP4b(plan({ fee_id: 'f1', booker_fee: { players: 9, amount_cents: 900 } }));
  stripe.respond('paymentIntents.create', () => ({ ...intent('pi_fee', 'requires_action', { amount: 900 }) }));

  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'whole_team', quote: 'q1' });

  strictEqual(res.status, 200);
  strictEqual(res.body.cancelled, true);
  deepStrictEqual(res.body.fee, { amountCents: 900, status: 'requires_action', clientSecret: 'pi_fee_secret' });
  deepStrictEqual(db.callsTo('cancellation_fee_attempted')[0].args, {
    p_fee_id: 'f1', p_intent_id: 'pi_fee', p_outcome: 'requires_action', p_error: null,
  });
});

Deno.test('the card is declined: the cancellation stands, the charge is left to retry', async () => {
  const { db, stripe, deps } = setupP4b(plan({ fee_id: 'f1', booker_fee: { players: 9, amount_cents: 900 } }));
  stripe.fail('paymentIntents.create', Object.assign(stripeError({ type: 'StripeCardError', code: 'card_declined', statusCode: 402 }), {
    raw: { type: 'card_error', code: 'card_declined', payment_intent: { id: 'pi_declined' } },
  }));

  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'whole_team', quote: 'q1' });

  strictEqual(res.body.cancelled, true);
  deepStrictEqual(res.body.fee, { amountCents: 900, status: 'failed' });
  deepStrictEqual(db.callsTo('cancellation_fee_attempted')[0].args, {
    p_fee_id: 'f1', p_intent_id: 'pi_declined', p_outcome: 'failed', p_error: 'card_declined',
  });
});

Deno.test('no answer from Stripe on the charge: retried soon, nobody told', async () => {
  const { db, stripe, deps } = setupP4b(plan({ fee_id: 'f1', booker_fee: { players: 9, amount_cents: 900 } }));
  stripe.fail('paymentIntents.create', stripeError({ type: 'StripeConnectionError', code: 'api_connection_error' }));
  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'whole_team', quote: 'q1' });
  deepStrictEqual(res.body.fee, { amountCents: 900, status: 'retry' });
  strictEqual(db.callsTo('cancellation_fee_attempted')[0].args.p_outcome, 'error');
});

Deno.test('a refused cancellation moves no money', async () => {
  for (const [error, status] of [['not_your_booking', 403], ['quote_changed', 409], ['quote_required', 400],
                                 ['not_your_venue', 403], ['booking_started', 400]] as const) {
    const { db, stripe, deps } = setupP4b(null);
    db.fail('cancel_booking_internal', error);
    const res = await cancelBooking(deps, 'p2', { bookingId: 'b1', scope: 'whole_team', quote: 'q1' });
    deepStrictEqual(res, { status, body: { error } }, error);
    strictEqual(stripe.calls.length, 0);
    strictEqual(db.callsTo('cancellation_work').length, 0);
  }
});

Deno.test('a bad request is refused before anything happens', async () => {
  const { db, deps } = setupP4b(plan());
  deepStrictEqual(await cancelBooking(deps, 'p1', { scope: 'my_spot' }), { status: 400, body: { error: 'invalid_request' } });
  deepStrictEqual(await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'everything' as never }),
    { status: 400, body: { error: 'invalid_request' } });
  strictEqual(db.calls.length, 0);
});

// Bookings made before P4a keep the old rules and release all their money.

function setupLegacy(rows: unknown[], intents: Record<string, unknown>) {
  const db = createDbFake();
  db.respond('cancel_booking_internal', { legacy: true });
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

Deno.test('legacy booking: releases holds, refunds payments and records each in the ledger', async () => {
  const { db, stripe, deps } = setupLegacy(
    [
      row('share', 's1', 'authorized', 'pi_held'),
      row('share', 's2', 'paid', 'pi_paid'),
      row('share', 's3', 'pending', null),
    ],
    { pi_held: intent('pi_held', 'requires_capture'), pi_paid: intent('pi_paid', 'succeeded') },
  );

  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1' });

  deepStrictEqual(res, { status: 200, body: { cancelled: true, refunded: true, released: true, pending: false } });
  deepStrictEqual(db.callsTo('cancel_booking_for')[0].args, { p_booking_id: 'b1', p_profile_id: 'p1' });
  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.id), ['pi_held']);
  deepStrictEqual(stripe.callsTo('refunds.create').map((c) => c.idempotencyKey), ['refund-pi_paid-680']);
  deepStrictEqual(db.callsTo('share_released')[0].args, { p_share_id: 's3', p_new_status: 'cancelled' });
});

Deno.test('legacy booking: a pre-split booking paid as one intent is refunded once', async () => {
  const { stripe, deps } = setupLegacy(
    [row('booking', 'b1', 'confirmed', 'pi_legacy', 6000)],
    { pi_legacy: intent('pi_legacy', 'succeeded', { amount: 6000, metadata: {} }) },
  );
  const res = await cancelBooking(deps, 'p1', { bookingId: 'b1' });
  strictEqual(res.body.refunded, true);
  strictEqual(stripe.callsTo('refunds.create').length, 1);
});

Deno.test('legacy booking: only the whole booking can be cancelled, and a refusal moves no money', async () => {
  const { db, stripe, deps } = setupLegacy([], {});
  deepStrictEqual(await cancelBooking(deps, 'p1', { bookingId: 'b1', scope: 'my_spot' }),
    { status: 400, body: { error: 'legacy_booking' } });
  db.fail('cancel_booking_for', 'not_your_booking');
  deepStrictEqual(await cancelBooking(deps, 'p2', { bookingId: 'b1' }), { status: 403, body: { error: 'not_your_booking' } });
  strictEqual(stripe.calls.length, 0);
  strictEqual(db.callsTo('booking_money_to_release').length, 0);
});
