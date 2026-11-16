// run-payouts (P4d): one Stripe transfer per payout the database prepared,
// to the venue's Express account, keyed on the payout row, oldest first
// while they fit in Futty's available balance; a shortage is waiting (no
// attempt, no alert); any other error is recorded for a retry and never
// stops the others; only accounts of the key's mode.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake, stripeError } from '../_shared/stripe-fake.ts';
import { isLiveKey } from '../_shared/stripe-mode.ts';
import { runPayouts } from './handler.ts';

// Oldest first, as payouts_due returns them.
const due = [
  { payout_id: 'po1', venue_id: 'v1', booking_id: 'b1', amount_cents: 6000, stripe_account_id: 'acct_v1', attempts: 0 },
  { payout_id: 'po2', venue_id: 'v2', booking_id: 'b2', amount_cents: 5895, stripe_account_id: 'acct_v2', attempts: 1 },
  { payout_id: 'po3', venue_id: 'v3', booking_id: 'b3', amount_cents: 100, stripe_account_id: 'acct_v3', attempts: 0 },
];

function setup(available = 100_000) {
  const db = createDbFake();
  db.respond('prepare_payouts', 'run1');
  db.respond('payouts_due', due);
  db.respond('payout_sent', { result: 'sent' });
  db.respond('payout_errored', null);
  db.respond('payout_waiting', null);
  db.respond('finish_payout_run', null);
  const stripe = createStripeFake();
  stripe.setBalance({ available, pending: 50_000 });
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe, livemode: false } };
}

Deno.test('each prepared payout: one transfer to the venue, keyed on the payout row, recorded', async () => {
  const { db, stripe, deps } = setup();
  const summary = await runPayouts(deps);
  deepStrictEqual(summary, { sent: 3, waiting: 0, retry: 0 });

  strictEqual(stripe.callsTo('balance.retrieve').length, 1, 'the balance is read once');
  const transfers = stripe.callsTo('transfers.create');
  deepStrictEqual(transfers[0].params, {
    amount: 6000,
    currency: 'eur',
    destination: 'acct_v1',
    transfer_group: 'booking-b1',
    description: 'Futty: pitch money for a booking',
    metadata: { payout_id: 'po1', booking_id: 'b1', venue_id: 'v1' },
  });
  deepStrictEqual(transfers.map((t) => t.idempotencyKey), ['payout-po1', 'payout-po2', 'payout-po3']);
  strictEqual(transfers[1].params?.amount, 5895, "the database's amount, as it is");

  deepStrictEqual(db.callsTo('payout_sent').map((c) => c.args), [
    { p_payout_id: 'po1', p_transfer_id: 'tr_fake_1', p_amount_cents: 6000 },
    { p_payout_id: 'po2', p_transfer_id: 'tr_fake_2', p_amount_cents: 5895 },
    { p_payout_id: 'po3', p_transfer_id: 'tr_fake_3', p_amount_cents: 100 },
  ]);
  deepStrictEqual(db.callsTo('prepare_payouts')[0].args, { p_livemode: false });
  deepStrictEqual(db.callsTo('payouts_due')[0].args, { p_livemode: false });
  deepStrictEqual(db.callsTo('finish_payout_run')[0].args, { p_run_id: 'run1' });
});

Deno.test('a balance that covers only some: the oldest that fit are sent, the rest wait', async () => {
  // 6000 fits; 5895 doesn't fit in the 1000 left, so it and every payout
  // after it wait, even the 100 that would fit (oldest first).
  const { db, stripe, deps } = setup(7000);
  const summary = await runPayouts(deps);
  deepStrictEqual(summary, { sent: 1, waiting: 2, retry: 0 });
  deepStrictEqual(stripe.callsTo('transfers.create').map((t) => t.params?.amount), [6000], 'only what fits is tried');
  deepStrictEqual(db.callsTo('payout_sent').map((c) => c.args.p_payout_id), ['po1']);
  deepStrictEqual(db.callsTo('payout_waiting').map((c) => c.args), [{ p_payout_id: 'po2' }, { p_payout_id: 'po3' }]);
  strictEqual(db.callsTo('payout_errored').length, 0, 'waiting is not a failure: no attempt counted, no alert');
  strictEqual(stripe.available(), 1000);
});

Deno.test('balance_insufficient from Stripe: waiting, no attempt counted, no alert; the rest wait too', async () => {
  const { db, stripe, deps } = setup();
  stripe.respond('transfers.create', () => {
    throw stripeError({ code: 'balance_insufficient', message: 'You have insufficient available funds.' });
  });
  const summary = await runPayouts(deps);
  deepStrictEqual(summary, { sent: 0, waiting: 3, retry: 0 });
  strictEqual(stripe.callsTo('transfers.create').length, 1, 'no more tries once Stripe says the balance is short');
  deepStrictEqual(db.callsTo('payout_waiting').map((c) => c.args.p_payout_id), ['po1', 'po2', 'po3']);
  strictEqual(db.callsTo('payout_errored').length, 0, 'no attempt counted');
  strictEqual(db.callsTo('finish_payout_run').length, 1, 'the run finishes');
});

Deno.test('any other Stripe error is recorded for a retry; the other transfers still go', async () => {
  const { db, stripe, deps } = setup();
  stripe.respond('transfers.create', (call: { params?: Record<string, unknown> }) => {
    const id = (call.params?.metadata as Record<string, string>).payout_id;
    if (id === 'po1') throw stripeError({ code: 'account_invalid', message: 'No such destination' });
    return { id: `tr_${id}`, amount: call.params?.amount };
  });
  const summary = await runPayouts(deps);
  deepStrictEqual(summary, { sent: 2, waiting: 0, retry: 1 });
  deepStrictEqual(db.callsTo('payout_errored')[0].args, { p_payout_id: 'po1', p_error: 'account_invalid: No such destination' });
  deepStrictEqual(db.callsTo('payout_sent').map((c) => c.args.p_payout_id), ['po2', 'po3']);
});

Deno.test('the database refusing the answer (wrong amount) is a failure to retry, not a crash', async () => {
  const { db, deps } = setup();
  db.fail('payout_sent', 'amount_mismatch');
  db.respond('payouts_due', [due[0]]);
  deepStrictEqual(await runPayouts(deps), { sent: 0, waiting: 0, retry: 1 });
  strictEqual(db.callsTo('payout_errored')[0].args.p_error, 'amount_mismatch');
});

Deno.test('recording a failure or a wait failing too: logged, and the run still finishes', async () => {
  const { db, stripe, deps } = setup();
  stripe.fail('transfers.create', stripeError({ code: 'api_connection_error' }));
  db.fail('payout_errored', 'database down');
  deepStrictEqual(await runPayouts(deps), { sent: 0, waiting: 0, retry: 3 });
  strictEqual(db.callsTo('finish_payout_run').length, 1);

  const short = setup(0);
  short.db.fail('payout_waiting', 'database down');
  deepStrictEqual(await runPayouts(short.deps), { sent: 0, waiting: 3, retry: 0 });
  strictEqual(short.db.callsTo('finish_payout_run').length, 1);
});

Deno.test("the balance can't be read: nothing sent, nothing marked, the run finishes", async () => {
  const { db, stripe, deps } = setup();
  stripe.fail('balance.retrieve', stripeError({ code: 'api_connection_error' }));
  deepStrictEqual(await runPayouts(deps), { sent: 0, waiting: 0, retry: 0 });
  strictEqual(stripe.callsTo('transfers.create').length, 0);
  strictEqual(db.callsTo('payout_waiting').length + db.callsTo('payout_errored').length, 0);
  strictEqual(db.callsTo('finish_payout_run').length, 1);
});

Deno.test('the balance is EUR only', async () => {
  const { stripe, deps } = setup();
  stripe.respond('balance.retrieve', {
    available: [{ amount: 6000, currency: 'eur' }, { amount: 999_999, currency: 'gbp' }],
  });
  stripe.respond('transfers.create', (call: { params?: Record<string, unknown> }) => ({ id: 'tr_x', amount: call.params?.amount }));
  deepStrictEqual(await runPayouts(deps), { sent: 1, waiting: 2, retry: 0 });
});

Deno.test('nothing due: no Stripe call, the run finishes', async () => {
  const { db, stripe, deps } = setup();
  db.respond('payouts_due', []);
  deepStrictEqual(await runPayouts(deps), { sent: 0, waiting: 0, retry: 0 });
  strictEqual(stripe.calls.length, 0);
  strictEqual(db.callsTo('finish_payout_run').length, 1);
});

Deno.test('live keys pay only live accounts: the mode goes to the database', async () => {
  const { db, deps } = setup();
  db.respond('payouts_due', []);
  await runPayouts({ ...deps, livemode: true });
  deepStrictEqual(db.callsTo('prepare_payouts')[0].args, { p_livemode: true });
  deepStrictEqual(db.callsTo('payouts_due')[0].args, { p_livemode: true });
  strictEqual(isLiveKey('sk_live_abc'), true);
  strictEqual(isLiveKey('rk_live_abc'), true);
  strictEqual(isLiveKey('sk_test_abc'), false);
  strictEqual(isLiveKey(''), false);
});
