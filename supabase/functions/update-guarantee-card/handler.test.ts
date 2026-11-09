import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { updateGuaranteeCard } from './handler.ts';

function setup() {
  const db = createDbFake();
  db.respond('guarantee_for_card_update', { guarantee_id: 'g1', stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_old' });
  const stripe = createStripeFake();
  stripe.respond('setupIntents.create', { id: 'seti_1', client_secret: 'seti_secret' });
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('the booker gets an on-session SetupIntent for a new guarantee card', async () => {
  const { db, stripe, deps } = setup();
  const res = await updateGuaranteeCard(deps, 'p1', { bookingId: 'b1' });
  deepStrictEqual(res, { status: 200, body: { setupIntentClientSecret: 'seti_secret', customerId: 'cus_1' } });
  deepStrictEqual(db.callsTo('guarantee_for_card_update')[0].args, { p_booking_id: 'b1', p_profile_id: 'p1' });
  const [create] = stripe.callsTo('setupIntents.create');
  deepStrictEqual(create.params, {
    customer: 'cus_1',
    usage: 'off_session',
    automatic_payment_methods: { enabled: true },
    metadata: { kind: 'guarantee_card', guarantee_id: 'g1', profile_id: 'p1', booking_id: 'b1' },
  });
  strictEqual(create.idempotencyKey, 'guarantee-card-g1-after-pm_old');
});

Deno.test('only the booker, before kickoff: refusals make no Stripe call', async () => {
  for (const [code, status] of [['not_your_booking', 403], ['not_found', 404], ['guarantee_closed', 409], ['no_guarantee_to_update', 409]] as const) {
    const { db, stripe, deps } = setup();
    db.fail('guarantee_for_card_update', code);
    deepStrictEqual(await updateGuaranteeCard(deps, 'p2', { bookingId: 'b1' }), { status, body: { error: code } });
    strictEqual(stripe.calls.length, 0);
  }
});

Deno.test('bad requests', async () => {
  const { db, deps } = setup();
  strictEqual((await updateGuaranteeCard(deps, 'p1', {})).status, 400);
  db.respond('guarantee_for_card_update', { guarantee_id: 'g1', stripe_customer_id: null, stripe_payment_method_id: null });
  deepStrictEqual(await updateGuaranteeCard(deps, 'p1', { bookingId: 'b1' }), { status: 409, body: { error: 'no_saved_card' } });
});
