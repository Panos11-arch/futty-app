// create-tournament-payment (S10B; spec 13 "Tournament entry (S10B)"): the
// caller pays the tournament's entry fee for himself. The amount comes from
// the database (the tournament's fee); the app never sends one. Charged at
// once, all to Futty: no Connect transfer, no application fee, no hold.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { createTournamentPayment } from './handler.ts';

const caller = { id: 'p1', email: 'p1@futty.test' };
const plan = {
  payment_id: 'tp1', tournament_id: 't1', amount_cents: 1200,
  stripe_payment_intent_id: null, stripe_customer_id: 'cus_1',
};

function setup(planOverrides: Record<string, unknown> = {}) {
  const db = createDbFake();
  db.respond('plan_tournament_entry', { ...plan, ...planOverrides });
  db.respond('attach_tournament_entry_intent', null);
  db.respond('set_stripe_customer', null);
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.create', (call: { params?: Record<string, unknown> }) =>
    ({ id: 'pi_new', status: 'requires_payment_method', amount: call.params?.amount, client_secret: 'pi_new_secret' }));
  stripe.respond('customers.create', { id: 'cus_new' });
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('plans the entry as the caller, then charges the fee at once to Futty, keyed by the payment row', async () => {
  const { db, stripe, deps } = setup();
  const result = await createTournamentPayment(deps, caller, { tournamentId: 't1' });

  deepStrictEqual(result, { status: 200, body: { clientSecret: 'pi_new_secret', customerId: 'cus_1', amountCents: 1200 } });
  deepStrictEqual(db.callsTo('plan_tournament_entry')[0].args, { p_tournament_id: 't1', p_profile_id: 'p1' });

  const create = stripe.callsTo('paymentIntents.create')[0];
  strictEqual(create.params?.amount, 1200);
  strictEqual(create.params?.currency, 'eur');
  strictEqual(create.params?.customer, 'cus_1');
  strictEqual(create.params?.capture_method, undefined, 'charged at once, not held');
  deepStrictEqual(create.params?.automatic_payment_methods, { enabled: true }, 'card, Apple Pay or Google Pay');
  strictEqual(create.params?.transfer_data, undefined, 'no Connect transfer');
  strictEqual(create.params?.application_fee_amount, undefined, 'no venue part');
  strictEqual(create.params?.on_behalf_of, undefined);
  deepStrictEqual(create.params?.metadata, { kind: 'tournament_entry', payment_id: 'tp1', tournament_id: 't1', profile_id: 'p1' });
  strictEqual(create.idempotencyKey, 'tournament-entry-tp1');

  deepStrictEqual(db.callsTo('attach_tournament_entry_intent')[0].args, {
    p_payment_id: 'tp1', p_profile_id: 'p1', p_intent_id: 'pi_new',
  });
});

Deno.test('an amount sent by the app is ignored: the fee comes from the database', async () => {
  const { stripe, deps } = setup();
  await createTournamentPayment(deps, caller, { tournamentId: 't1', amountCents: 1 } as never);
  strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.amount, 1200);
});

Deno.test('a player without a Stripe customer gets one first', async () => {
  const { db, stripe, deps } = setup({ stripe_customer_id: null });
  const result = await createTournamentPayment(deps, caller, { tournamentId: 't1' });
  strictEqual(stripe.callsTo('customers.create')[0].idempotencyKey, 'customer-p1');
  deepStrictEqual(db.callsTo('set_stripe_customer')[0].args, { p_profile_id: 'p1', p_customer_id: 'cus_new' });
  strictEqual((result.body as { customerId: string }).customerId, 'cus_new');
});

Deno.test('a payment already started is reused; one going through or done is refused', async () => {
  const open = setup({ stripe_payment_intent_id: 'pi_open' });
  open.stripe.respond('paymentIntents.retrieve', { id: 'pi_open', status: 'requires_payment_method', amount: 1200, client_secret: 'pi_open_secret' });
  const reused = await createTournamentPayment(open.deps, caller, { tournamentId: 't1' });
  deepStrictEqual(reused, { status: 200, body: { clientSecret: 'pi_open_secret', customerId: 'cus_1', amountCents: 1200 } });
  strictEqual(open.stripe.callsTo('paymentIntents.create').length, 0);

  for (const status of ['processing', 'succeeded']) {
    const paying = setup({ stripe_payment_intent_id: 'pi_paying' });
    paying.stripe.respond('paymentIntents.retrieve', { id: 'pi_paying', status, amount: 1200 });
    deepStrictEqual(await createTournamentPayment(paying.deps, caller, { tournamentId: 't1' }), { status: 409, body: { error: 'already_paid' } });
  }

  // A cancelled one is replaced by a new payment.
  const gone = setup({ stripe_payment_intent_id: 'pi_gone' });
  gone.stripe.respond('paymentIntents.retrieve', { id: 'pi_gone', status: 'canceled', amount: 1200 });
  await createTournamentPayment(gone.deps, caller, { tournamentId: 't1' });
  strictEqual(gone.stripe.callsTo('paymentIntents.create').length, 1);
});

Deno.test('the database\'s refusals are passed on, with no payment made', async () => {
  const cases: [string, number][] = [
    ['tournament_not_found', 404],
    ['not_in_squad', 403],
    ['deadline_passed', 409],
    ['already_paid', 409],
    ['player_in_debt', 409],
    ['no_fee', 409],
  ];
  for (const [error, status] of cases) {
    const { db, stripe, deps } = setup();
    db.fail('plan_tournament_entry', error);
    deepStrictEqual(await createTournamentPayment(deps, caller, { tournamentId: 't1' }), { status, body: { error } }, error);
    strictEqual(stripe.callsTo('paymentIntents.create').length, 0, error);
  }
});

Deno.test('if the entry changed meanwhile (the deadline passed), the new payment is cancelled before anyone can pay it', async () => {
  const { db, stripe, deps } = setup();
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  db.fail('attach_tournament_entry_intent', 'deadline_passed');
  deepStrictEqual(await createTournamentPayment(deps, caller, { tournamentId: 't1' }), { status: 409, body: { error: 'deadline_passed' } });
  const cancel = stripe.callsTo('paymentIntents.cancel')[0];
  strictEqual(cancel.id, 'pi_new');
  strictEqual(cancel.idempotencyKey, 'cancel-pi_new');
});

Deno.test('a tournament is required', async () => {
  const { stripe, deps } = setup();
  deepStrictEqual(await createTournamentPayment(deps, caller, {}), { status: 400, body: { error: 'tournament_required' } });
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});
