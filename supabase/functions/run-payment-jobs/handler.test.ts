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
  api_errors: 0,
  created_at: '2026-11-09T10:00:00.000Z',
  check_only: false,
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
  db.respond('bookings_with_money_to_release', []);
  db.respond('share_capture_failed', { result: 'failed', attempts: 1, alerted: false });
  db.respond('guarantee_hold_errored', { result: 'retry', api_errors: 1 });
  db.respond('guarantee_hold_check_cleared', null);
  db.respond('cancellation_work', []);
  db.respond('cancellation_fees_due', []);
  db.respond('expire_venue_credits', 0);
  db.respond('credit_reservations_to_release', []);
  for (const fn of ['record_money_movement', 'record_intent_capture', 'record_intent_refund', 'record_intent_cancelled']) {
    db.respond(fn, true);
  }
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
  strictEqual(stripe.callsTo('refunds.create')[0].idempotencyKey, 'refund-pi_1-680');
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
  strictEqual(create.idempotencyKey, 'guarantee-g1-pm_1-attempt-1');
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

Deno.test('a network or Stripe API error is not a failed hold: backed off, the booker not told', async () => {
  for (const type of ['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError']) {
    const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
    stripe.fail('paymentIntents.create', stripeError({ type, code: 'api_error', message: 'no answer' }));
    strictEqual((await runPaymentJobs(deps)).holdRetry, 1, type);
    strictEqual(db.callsTo('guarantee_hold_failed').length, 0, `${type}: not a failed hold`);
    deepStrictEqual(db.callsTo('guarantee_hold_errored')[0].args, { p_guarantee_id: 'g1', p_error: 'api_error: no answer' });
  }
});

// H2: the card behind the guarantee was removed, detached or doesn't match
// the customer. That's a failed hold like a decline: recorded, the booker
// told once, retried in 6 hours.
Deno.test('card removed: a failed hold, recorded and the booker told, never retried every minute', async () => {
  const cases = [
    { param: 'payment_method', code: 'resource_missing', error: 'payment_method: resource_missing' },
    { param: 'payment_method', code: undefined, error: 'payment_method: The PaymentMethod does not belong to the Customer' },
    { param: 'customer', code: 'resource_missing', error: 'customer: resource_missing' },
    { param: undefined, code: 'payment_method_unexpected_state', error: 'payment_method_unexpected_state' },
  ];
  for (const c of cases) {
    const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
    stripe.fail('paymentIntents.create', Object.assign(
      stripeError({ code: c.code, message: 'The PaymentMethod does not belong to the Customer' }),
      { param: c.param },
    ));
    strictEqual((await runPaymentJobs(deps)).holdFailed, 1, c.error);
    deepStrictEqual(db.callsTo('guarantee_hold_failed')[0].args, {
      p_guarantee_id: 'g1', p_intent_id: null, p_error: c.error, p_needs_action: false,
    });
    strictEqual(db.callsTo('guarantee_hold_errored').length, 0, 'not treated as no answer');
  }
});

Deno.test('an invalid request about something else is no answer, not the booker\'s card', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee] });
  stripe.fail('paymentIntents.create', Object.assign(stripeError({ code: 'parameter_unknown' }), { param: 'foo' }));
  await runPaymentJobs(deps);
  strictEqual(db.callsTo('guarantee_hold_failed').length, 0);
  strictEqual(db.callsTo('guarantee_hold_errored').length, 1);
});

/** guarantees_due_for_hold as the database would answer across runs: an
 *  unanswered try shows up again with api_errors, the card as it is now. */
function unansweredGuarantee(db: ReturnType<typeof createDbFake>, card: () => string) {
  let apiErrors = 0;
  db.respond('guarantees_due_for_hold', () => [{ ...dueGuarantee, api_errors: apiErrors, stripe_payment_method_id: card() }]);
  db.respond('guarantee_hold_errored', () => ({ result: 'retry', api_errors: ++apiErrors }));
}

Deno.test('network error, but the first call went through: found at Stripe, recorded, no second hold', async () => {
  const { db, stripe, deps } = setup();
  unansweredGuarantee(db, () => 'pm_1');
  stripe.fail('paymentIntents.create', stripeError({ type: 'StripeConnectionError', code: 'api_connection_error' }));
  await runPaymentJobs(deps);

  // Stripe did place it: listed on the customer with the guarantee's id.
  const placed = intent('pi_g_lost', 'requires_capture', { amount: 6000, metadata: { kind: 'guarantee', guarantee_id: 'g1' } });
  const someoneElses = intent('pi_other', 'requires_capture', { amount: 6000, metadata: { kind: 'guarantee', guarantee_id: 'g9' } });
  stripe.respond('paymentIntents.list', { data: [someoneElses, placed], has_more: false });
  strictEqual((await runPaymentJobs(deps)).held, 1);

  strictEqual(stripe.callsTo('paymentIntents.create').length, 1, 'never a second hold');
  deepStrictEqual(stripe.callsTo('paymentIntents.list')[0].params, {
    customer: 'cus_1', created: { gte: 1794218400 }, limit: 100,
  });
  deepStrictEqual(db.callsTo('guarantee_hold_placed')[0].args, { p_guarantee_id: 'g1', p_intent_id: 'pi_g_lost', p_amount_cents: 6000 });
});

Deno.test('network error, then the booker changes card: checked at Stripe, then a new key for the new card', async () => {
  const { db, stripe, deps } = setup();
  let card = 'pm_1';
  unansweredGuarantee(db, () => card);
  stripe.fail('paymentIntents.create', stripeError({ type: 'StripeConnectionError', code: 'api_connection_error' }));
  await runPaymentJobs(deps);

  card = 'pm_2';
  // The first try never reached Stripe; a requires_action left-over of an
  // earlier attempt is cancelled so it can't hold money later.
  const leftOver = intent('pi_g_old', 'requires_action', { amount: 6000, metadata: { kind: 'guarantee', guarantee_id: 'g1' } });
  stripe.respond('paymentIntents.list', { data: [leftOver], has_more: false });
  stripe.respond('paymentIntents.retrieve', leftOver);
  stripe.respond('paymentIntents.create', intent('pi_g_new', 'requires_capture', { amount: 6000 }));
  strictEqual((await runPaymentJobs(deps)).held, 1);

  deepStrictEqual(stripe.callsTo('paymentIntents.create').map((c) => [c.params?.payment_method, c.idempotencyKey]), [
    ['pm_1', 'guarantee-g1-pm_1-attempt-1'],
    ['pm_2', 'guarantee-g1-pm_2-attempt-1'],
  ]);
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_g_old');
  deepStrictEqual(db.callsTo('guarantee_hold_placed')[0].args.p_intent_id, 'pi_g_new');
});

Deno.test('after kickoff an unanswered try is only looked up: nothing found, nothing placed', async () => {
  const { db, stripe, deps } = setup({ guarantees: [{ ...dueGuarantee, api_errors: 2, check_only: true }] });
  stripe.respond('paymentIntents.list', { data: [], has_more: false });
  await runPaymentJobs(deps);
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
  deepStrictEqual(db.callsTo('guarantee_hold_check_cleared')[0].args, { p_guarantee_id: 'g1' });
});

Deno.test('after kickoff a hold found at Stripe is recorded (and released if the booking was cancelled)', async () => {
  const { db, stripe, deps } = setup({ guarantees: [{ ...dueGuarantee, api_errors: 1, check_only: true }] });
  const found = intent('pi_g_found', 'requires_capture', { amount: 6000, metadata: { kind: 'guarantee', guarantee_id: 'g1' } });
  stripe.respond('paymentIntents.list', { data: [found], has_more: false });
  stripe.respond('paymentIntents.retrieve', found);
  db.respond('guarantee_hold_placed', { result: 'release', reason: 'booking_cancelled' });
  await runPaymentJobs(deps);
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
  strictEqual(stripe.callsTo('paymentIntents.cancel')[0].id, 'pi_g_found');
});

Deno.test('one guarantee that throws doesn\'t stop the others or the rest of the job', async () => {
  const { db, stripe, deps } = setup({ guarantees: [dueGuarantee, { ...dueGuarantee, guarantee_id: 'g2' }] });
  stripe.fail('paymentIntents.create', stripeError({ type: 'StripeConnectionError' }));
  db.fail('guarantee_hold_errored', 'db down');
  await runPaymentJobs(deps);
  strictEqual(stripe.callsTo('paymentIntents.create').length, 2);
  strictEqual(db.callsTo('money_releases_due').length, 1, 'the release queue still runs');
});

// Failed captures back off in the database (1, 5, 15, 60 minutes, then
// hourly; an admin alert at the third), so the job records every failure.
Deno.test('a failed capture is recorded with its error, for the back-off and the founders\' alert', async () => {
  const { db, stripe, deps } = setup({ shares: [dueShare] });
  stripe.fail('paymentIntents.capture', stripeError({ type: 'StripeCardError', code: 'charge_expired_for_capture' }));
  db.respond('share_capture_failed', { result: 'failed', attempts: 3, alerted: true });
  strictEqual((await runPaymentJobs(deps)).captureFailed, 1);
  deepStrictEqual(db.callsTo('share_capture_failed')[0].args, {
    p_share_id: 's1', p_error: 'charge_expired_for_capture: Fake Stripe error',
  });
});

// The 15-minute window and a card saved with a SetupIntent (a Premium cash
// booker): asked at Stripe before cancelling, judged by Stripe's event time.
const setupBooking = {
  booking_id: 'b1', booker_share_id: 's1', booker_intent_id: null, booker_setup_intent_id: 'seti_1',
  booked_at: '2026-11-09T12:00:00.000Z',
};
const BOOKED = 1794225600; // 2026-11-09 12:00:00 UTC

function savedCardEvent(setupIntentId: string, created: number) {
  return { id: `evt_${setupIntentId}`, type: 'setup_intent.succeeded', created, data: { object: { id: setupIntentId } } };
}

Deno.test('15-minute window: a card saved in time counts, by Stripe\'s event time', async () => {
  const { db, stripe, deps } = setup({ expiring: [setupBooking] });
  stripe.respond('setupIntents.retrieve', { id: 'seti_1', status: 'succeeded', payment_method: 'pm_saved' });
  stripe.respond('events.list', {
    data: [savedCardEvent('seti_other', BOOKED + 60), savedCardEvent('seti_1', BOOKED + 14 * 60)], has_more: false,
  });
  db.respond('share_card_saved', { result: 'saved', share_id: 's1', guarantee_due: false });

  strictEqual((await runPaymentJobs(deps)).expired, 0);
  deepStrictEqual(stripe.callsTo('events.list')[0].params, {
    type: 'setup_intent.succeeded', created: { gte: BOOKED }, limit: 100,
  });
  deepStrictEqual(db.callsTo('share_card_saved')[0].args, {
    p_share_id: 's1', p_setup_intent_id: 'seti_1', p_payment_method_id: 'pm_saved', p_at: '2026-11-09T12:14:00.000Z',
  });
  strictEqual(db.callsTo('expire_unpaid_booking').length, 0, 'not cancelled');
});

Deno.test('15-minute window: a card saved too late expires the booking and gives its money back', async () => {
  const { db, stripe, deps } = setup({ expiring: [setupBooking] });
  stripe.respond('setupIntents.retrieve', { id: 'seti_1', status: 'succeeded', payment_method: 'pm_saved' });
  stripe.respond('events.list', { data: [savedCardEvent('seti_1', BOOKED + 16 * 60)], has_more: false });
  db.respond('share_card_saved', { result: 'expired', booking_id: 'b1', share_id: 's1' });

  strictEqual((await runPaymentJobs(deps)).expired, 1);
  strictEqual(db.callsTo('booking_money_to_release')[0].args.p_booking_id, 'b1');
});

Deno.test('15-minute window: a saved card whose event Stripe hasn\'t listed yet waits for the next run', async () => {
  const { db, stripe, deps } = setup({ expiring: [setupBooking] });
  stripe.respond('setupIntents.retrieve', { id: 'seti_1', status: 'succeeded', payment_method: 'pm_saved' });
  stripe.respond('events.list', { data: [], has_more: false });
  await runPaymentJobs(deps);
  strictEqual(db.callsTo('share_card_saved').length, 0);
  strictEqual(db.callsTo('expire_unpaid_booking').length, 0);
});

Deno.test('15-minute window: a card still being saved waits; one never saved is cancelled and the booking expired', async () => {
  for (const [status, expired] of [['processing', 0], ['requires_action', 1], ['requires_payment_method', 1], ['canceled', 1]] as const) {
    const { db, stripe, deps } = setup({ expiring: [setupBooking] });
    stripe.respond('setupIntents.retrieve', { id: 'seti_1', status });
    stripe.respond('setupIntents.cancel', { id: 'seti_1', status: 'canceled' });
    strictEqual((await runPaymentJobs(deps)).expired, expired, status);
    const cancels = stripe.callsTo('setupIntents.cancel');
    strictEqual(cancels.length, status === 'processing' || status === 'canceled' ? 0 : 1, `${status}: cancelled so it can't complete late`);
    if (cancels.length) strictEqual(cancels[0].idempotencyKey, 'cancel-seti_1');
    strictEqual(db.callsTo('expire_unpaid_booking').length, expired, status);
  }
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

// P4b: cancellations.
const refundLine = {
  line_id: 'l1', kind: 'refund', booking_id: 'b1', share_id: 's1', guarantee_id: null,
  stripe_intent_id: 'pi_r', amount_cents: 680, reason: 'whole_team_refund_choice', attempts: 0,
};

Deno.test('48 hours with no choice: the card refund goes out, keyed on the intent', async () => {
  const { db, stripe, deps } = setup();
  db.respond('cancellation_work', [refundLine]);
  db.respond('cancellation_line_refunded', true);
  stripe.respond('paymentIntents.retrieve', intent('pi_r', 'succeeded'));
  stripe.respond('refunds.create', (c: { params?: Record<string, unknown> }) => ({ id: 're_r', status: 'succeeded', amount: c.params?.amount }));

  const summary = await runPaymentJobs(deps);

  strictEqual(summary.cancellationDone, 1);
  deepStrictEqual(db.callsTo('cancellation_work')[0].args, { p_cancellation_id: null }, 'everything due');
  deepStrictEqual(stripe.callsTo('refunds.create').map((c) => [c.params?.amount, c.idempotencyKey]), [[680, 'refund-pi_r-680']]);
  deepStrictEqual(db.callsTo('cancellation_line_refunded')[0].args, { p_line_id: 'l1', p_outcome: 'refunded' });
});

Deno.test("the booker's whole-team charge is retried off-session, and credit is expired", async () => {
  const { db, stripe, deps } = setup();
  db.respond('cancellation_fees_due', [{ fee_id: 'f1' }]);
  db.respond('cancellation_fee_to_charge', [{
    fee_id: 'f1', booking_id: 'b1', cancellation_id: 'c1', profile_id: 'p1', amount_cents: 900,
    stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_1', attempt: 2, off_session: true, previous_intent_id: null,
  }]);
  db.respond('cancellation_fee_paid', { result: 'paid' });
  db.respond('expire_venue_credits', 2);
  stripe.respond('paymentIntents.create', () => intent('pi_fee', 'succeeded', { amount: 900, stripeFee: 39 }));

  const summary = await runPaymentJobs(deps);

  strictEqual(summary.feePaid, 1);
  strictEqual(summary.creditExpired, 2);
  const [create] = stripe.callsTo('paymentIntents.create');
  strictEqual(create.params?.off_session, true);
  strictEqual(create.idempotencyKey, 'cancel-fee-f1-attempt-2');
  deepStrictEqual(db.callsTo('cancellation_fee_paid')[0].args, {
    p_fee_id: 'f1', p_intent_id: 'pi_fee', p_amount_cents: 900, p_stripe_fee_cents: 39,
  });
});

Deno.test('a failing cancellation step never stops the others', async () => {
  const { db, deps } = setup();
  db.fail('cancellation_work', 'boom');
  db.fail('cancellation_fees_due', 'boom');
  db.respond('expire_venue_credits', 1);
  const summary = await runPaymentJobs(deps);
  strictEqual(summary.creditExpired, 1);
});

Deno.test('credit set aside for a payment not completed within 15 minutes goes back', async () => {
  const { db, stripe, deps } = setup();
  db.respond('credit_reservations_to_release', [
    { share_id: 's9', booking_id: 'b1', stripe_payment_intent_id: 'pi_unfinished', stripe_setup_intent_id: null },
  ]);
  db.respond('release_share_credit_reservation', true);
  stripe.respond('paymentIntents.retrieve', intent('pi_unfinished', 'requires_payment_method', { amount: 180 }));
  const summary = await runPaymentJobs(deps);
  strictEqual(summary.creditReleased, 1);
  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.id), ['pi_unfinished'], 'cancelled first');
});
