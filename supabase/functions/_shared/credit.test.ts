// Credit set aside for a payment not completed within 15 minutes goes back,
// and the payment is cancelled at Stripe first so it can't be paid with it.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { releaseUnfinishedCreditReservations } from './credit.ts';
import { createDbFake } from './db-fake.ts';
import { intent } from './intent-fixtures.ts';
import { createStripeFake } from './stripe-fake.ts';

const row = (pi: string | null, seti: string | null = null) => ({
  share_id: 's1', booking_id: 'b1', stripe_payment_intent_id: pi, stripe_setup_intent_id: seti,
});

function setup(rows: unknown[]) {
  const db = createDbFake();
  db.respond('credit_reservations_to_release', rows);
  db.respond('release_share_credit_reservation', true);
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.cancel', (c: { id?: string }) => ({ id: c.id, status: 'canceled' }));
  stripe.respond('setupIntents.cancel', (c: { id?: string }) => ({ id: c.id, status: 'canceled' }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('an unfinished payment is cancelled at Stripe, keyed on its id, then the credit goes back', async () => {
  const { db, stripe, deps } = setup([row('pi_open')]);
  stripe.respond('paymentIntents.retrieve', intent('pi_open', 'requires_payment_method', { amount: 180 }));
  deepStrictEqual(await releaseUnfinishedCreditReservations(deps), { released: 1, left: 0, failed: 0 });
  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.idempotencyKey), ['cancel-pi_open']);
  deepStrictEqual(db.callsTo('release_share_credit_reservation')[0].args, { p_share_id: 's1', p_intent_id: 'pi_open' });
});

Deno.test('a payment that went through (or is going through) keeps its credit', async () => {
  for (const status of ['requires_capture', 'processing', 'succeeded'] as const) {
    const { db, stripe, deps } = setup([row('pi_paying')]);
    stripe.respond('paymentIntents.retrieve', intent('pi_paying', status, { amount: 180 }));
    deepStrictEqual(await releaseUnfinishedCreditReservations(deps), { released: 0, left: 1, failed: 0 }, status);
    strictEqual(stripe.callsTo('paymentIntents.cancel').length, 0, status);
    strictEqual(db.callsTo('release_share_credit_reservation').length, 0, status);
  }
});

Deno.test('an intent already cancelled: just released', async () => {
  const { stripe, deps } = setup([row('pi_gone')]);
  stripe.respond('paymentIntents.retrieve', intent('pi_gone', 'canceled'));
  deepStrictEqual(await releaseUnfinishedCreditReservations(deps), { released: 1, left: 0, failed: 0 });
  strictEqual(stripe.callsTo('paymentIntents.cancel').length, 0);
});

Deno.test('a SetupIntent never finished: cancelled, then released; one that saved the card is left', async () => {
  const open = setup([row(null, 'seti_open')]);
  open.stripe.respond('setupIntents.retrieve', { id: 'seti_open', status: 'requires_payment_method' });
  deepStrictEqual(await releaseUnfinishedCreditReservations(open.deps), { released: 1, left: 0, failed: 0 });
  deepStrictEqual(open.stripe.callsTo('setupIntents.cancel').map((c) => c.idempotencyKey), ['cancel-seti_open']);
  strictEqual(open.db.callsTo('release_share_credit_reservation')[0].args.p_intent_id, 'seti_open');

  const saved = setup([row(null, 'seti_done')]);
  saved.stripe.respond('setupIntents.retrieve', { id: 'seti_done', status: 'succeeded' });
  deepStrictEqual(await releaseUnfinishedCreditReservations(saved.deps), { released: 0, left: 1, failed: 0 });

  const gone = setup([row(null, 'seti_gone')]);
  gone.stripe.respond('setupIntents.retrieve', { id: 'seti_gone', status: 'canceled' });
  deepStrictEqual(await releaseUnfinishedCreditReservations(gone.deps), { released: 1, left: 0, failed: 0 });
  strictEqual(gone.stripe.callsTo('setupIntents.cancel').length, 0);
});

Deno.test('credit set aside with no payment started: released', async () => {
  const { db, stripe, deps } = setup([row(null)]);
  deepStrictEqual(await releaseUnfinishedCreditReservations(deps), { released: 1, left: 0, failed: 0 });
  strictEqual(stripe.calls.length, 0);
  strictEqual(db.callsTo('release_share_credit_reservation')[0].args.p_intent_id, null);
});

Deno.test('Stripe failing: the credit stays set aside and is tried next run', async () => {
  const { db, stripe, deps } = setup([row('pi_x')]);
  stripe.fail('paymentIntents.retrieve', new Error('down'));
  deepStrictEqual(await releaseUnfinishedCreditReservations(deps), { released: 0, left: 0, failed: 1 });
  strictEqual(db.callsTo('release_share_credit_reservation').length, 0);
});
