// stripe-webhook, payout events (P4d): Connect account updates and
// disconnections, a lost transfer answer, and reversals.
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import type Stripe from 'npm:stripe@^22';
import { createDbFake } from '../_shared/db-fake.ts';
import { handlePayoutEvent } from './payouts.ts';

const event = (type: string, object: Record<string, unknown>, account?: string) =>
  ({ id: 'evt_1', type, account, data: { object } }) as unknown as Stripe.Event;

Deno.test('account.updated: what the Express account can do, from Stripe', async () => {
  const db = createDbFake();
  db.respond('connect_account_updated', { result: 'updated' });
  const handled = await handlePayoutEvent(event('account.updated', {
    id: 'acct_1', details_submitted: true, charges_enabled: true, payouts_enabled: false,
    requirements: { currently_due: ['external_account', 'individual.id_number'], disabled_reason: 'requirements.past_due' },
  }), { db: db.db });
  strictEqual(handled, true);
  deepStrictEqual(db.callsTo('connect_account_updated')[0].args, {
    p_account_id: 'acct_1', p_details_submitted: true, p_charges_enabled: true, p_payouts_enabled: false,
    p_requirements_due: 2, p_disabled_reason: 'requirements.past_due',
  });

  await handlePayoutEvent(event('account.updated', { id: 'acct_2' }), { db: db.db });
  deepStrictEqual(db.callsTo('connect_account_updated')[1].args, {
    p_account_id: 'acct_2', p_details_submitted: false, p_charges_enabled: false, p_payouts_enabled: false,
    p_requirements_due: 0, p_disabled_reason: null,
  }, 'missing fields are read as "not yet"');
});

Deno.test("account.application.deauthorized: the connected account is the event's", async () => {
  const db = createDbFake();
  db.respond('connect_account_deauthorized', { result: 'deauthorized' });
  strictEqual(await handlePayoutEvent(event('account.application.deauthorized', { id: 'ca_1' }, 'acct_1'), { db: db.db }), true);
  deepStrictEqual(db.callsTo('connect_account_deauthorized')[0].args, { p_account_id: 'acct_1' });
  strictEqual(await handlePayoutEvent(event('account.application.deauthorized', { id: 'ca_1' }), { db: db.db }), true);
  strictEqual(db.callsTo('connect_account_deauthorized').length, 1, 'no account on the event: nothing');
});

Deno.test('transfer.created: records a transfer whose API answer was lost; already recorded is fine', async () => {
  const db = createDbFake();
  db.respond('payout_sent', { result: 'sent' });
  const transfer = { id: 'tr_1', amount: 6000, metadata: { payout_id: 'po1' } };
  strictEqual(await handlePayoutEvent(event('transfer.created', transfer), { db: db.db }), true);
  deepStrictEqual(db.callsTo('payout_sent')[0].args, { p_payout_id: 'po1', p_transfer_id: 'tr_1', p_amount_cents: 6000 });

  db.fail('payout_sent', 'payout_not_pending');
  strictEqual(await handlePayoutEvent(event('transfer.created', transfer), { db: db.db }), true, 'reversed since: fine');

  db.fail('payout_sent', 'amount_mismatch');
  await rejects(() => handlePayoutEvent(event('transfer.created', transfer), { db: db.db }), /amount_mismatch/,
    'anything else fails the event, so Stripe sends it again');

  const other = createDbFake();
  strictEqual(await handlePayoutEvent(event('transfer.created', { id: 'tr_x', amount: 1, metadata: {} }), { db: other.db }), true);
  strictEqual(other.calls.length, 0, 'not one of ours');
});

Deno.test('transfer.reversed: each reversal recorded, oldest first, with the running total', async () => {
  const db = createDbFake();
  db.respond('payout_reversed', { result: 'partial' });
  await handlePayoutEvent(event('transfer.reversed', {
    id: 'tr_1', amount: 6000, amount_reversed: 6000,
    reversals: { data: [{ id: 'trr_2', amount: 4000, created: 200 }, { id: 'trr_1', amount: 2000, created: 100 }] },
  }), { db: db.db });
  deepStrictEqual(db.callsTo('payout_reversed').map((c) => c.args), [
    { p_transfer_id: 'tr_1', p_reversal_id: 'trr_1', p_amount_cents: 2000, p_reversed_total_cents: 2000 },
    { p_transfer_id: 'tr_1', p_reversal_id: 'trr_2', p_amount_cents: 4000, p_reversed_total_cents: 6000 },
  ]);
  const none = createDbFake();
  strictEqual(await handlePayoutEvent(event('transfer.reversed', { id: 'tr_2' }), { db: none.db }), true);
  strictEqual(none.calls.length, 0, 'no reversals listed: nothing');
});

Deno.test('other events are not payouts', async () => {
  const db = createDbFake();
  strictEqual(await handlePayoutEvent(event('payment_intent.succeeded', { id: 'pi_1' }), { db: db.db }), false);
  strictEqual(db.calls.length, 0);
});
