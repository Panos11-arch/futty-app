// S10B: run-payment-jobs' tournament step (spec 13 "Tournament entry
// (S10B)"). The deadline is handled in the database (dropping unpaid subs,
// releasing teams, the waiting list); every refund it makes due is sent to
// Stripe in full, keyed by the payment row, and recorded. Futty absorbs
// Stripe's fee: the refund is the whole amount paid.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from './db-fake.ts';
import { createStripeFake, stripeError } from './stripe-fake.ts';
import { runTournamentEntryJobs } from './tournament-entry.ts';

const due = (id: string, amount = 1200) => ({ payment_id: id, stripe_intent_id: `pi_${id}`, amount_cents: amount });

function setup(refunds: unknown[] = []) {
  const db = createDbFake();
  db.respond('tournament_deadline_tick', { tournaments: 1, dropped: 1, released: 1, moved_up: 1 });
  db.respond('tournament_entry_refunds_due', refunds);
  db.respond('tournament_entry_refunded', true);
  db.respond('tournament_entry_refund_failed', null);
  const stripe = createStripeFake();
  stripe.respond('refunds.create', (call: { params?: Record<string, unknown> }) =>
    ({ id: `re_${String(call.params?.payment_intent).slice(3)}`, status: 'succeeded', amount: call.params?.amount }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('the deadline step runs first, then every refund it made due goes back in full', async () => {
  const { db, stripe, deps } = setup([due('tp1'), due('tp2')]);
  const summary = await runTournamentEntryJobs(deps);

  strictEqual(db.calls[0].fn, 'tournament_deadline_tick', 'deadline first');
  const [first, second] = stripe.callsTo('refunds.create');
  deepStrictEqual(first.params, { payment_intent: 'pi_tp1', amount: 1200, metadata: { kind: 'tournament_entry_refund', payment_id: 'tp1' } });
  strictEqual(first.idempotencyKey, 'tournament-entry-refund-tp1');
  strictEqual(second.idempotencyKey, 'tournament-entry-refund-tp2');
  deepStrictEqual(db.callsTo('tournament_entry_refunded').map((c) => c.args), [
    { p_payment_id: 'tp1', p_refund_id: 're_tp1' },
    { p_payment_id: 'tp2', p_refund_id: 're_tp2' },
  ]);
  deepStrictEqual(summary, { tournamentsAtDeadline: 1, entryRefunds: 2, entryRefundsFailed: 0 });
});

Deno.test('a refund Stripe refuses is recorded and tried again next run; the others still go', async () => {
  const { db, stripe, deps } = setup([due('tp1'), due('tp2')]);
  let n = 0;
  stripe.respond('refunds.create', (call: { params?: Record<string, unknown> }) => {
    n += 1;
    if (n === 1) throw stripeError({ type: 'StripeAPIError', message: 'Stripe is down', statusCode: 500 });
    return { id: 're_tp2', status: 'succeeded', amount: call.params?.amount };
  });
  const summary = await runTournamentEntryJobs(deps);

  deepStrictEqual(db.callsTo('tournament_entry_refund_failed')[0].args, { p_payment_id: 'tp1', p_error: 'Stripe is down' });
  deepStrictEqual(db.callsTo('tournament_entry_refunded').map((c) => c.args), [{ p_payment_id: 'tp2', p_refund_id: 're_tp2' }]);
  deepStrictEqual(summary, { tournamentsAtDeadline: 1, entryRefunds: 1, entryRefundsFailed: 1 });
});

Deno.test('the deadline step failing doesn\'t stop the refunds already due', async () => {
  const { db, stripe, deps } = setup([due('tp1')]);
  db.fail('tournament_deadline_tick', 'boom');
  const summary = await runTournamentEntryJobs(deps);
  strictEqual(stripe.callsTo('refunds.create').length, 1);
  deepStrictEqual(summary, { tournamentsAtDeadline: 0, entryRefunds: 1, entryRefundsFailed: 0 });
});

Deno.test('nothing due: no Stripe call', async () => {
  const { stripe, deps } = setup([]);
  deepStrictEqual(await runTournamentEntryJobs(deps), { tournamentsAtDeadline: 1, entryRefunds: 0, entryRefundsFailed: 0 });
  strictEqual(stripe.callsTo('refunds.create').length, 0);
});
