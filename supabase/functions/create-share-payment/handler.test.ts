import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { createSharePayment } from './handler.ts';

const caller = { id: 'p1', email: 'p1@futty.test' };

/** What prepare_share_payment returns for a EUR 60 5 v 5 share, each pays. */
function prepared(overrides: Record<string, unknown> = {}) {
  return {
    share_id: 's1',
    booking_id: 'b1',
    is_booker: false,
    payment_mode: 'each_pays_own_spot',
    status: 'pending',
    payment_method: 'card',
    amount_cents: 680,
    pitch_cents: 600,
    fee_cents: 80,
    cash_cents: 0,
    capture_method: 'manual',
    non_refundable: false,
    stripe_payment_intent_id: null,
    stripe_customer_id: 'cus_1',
    needs_saved_card: false,
    ...overrides,
  };
}

function setup(share: Record<string, unknown>) {
  const db = createDbFake();
  db.respond('prepare_share_payment', share);
  db.respond('set_share_payment_intent', null);
  db.respond('set_stripe_customer', null);
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.create', (call: { params?: Record<string, unknown> }) => ({
    id: 'pi_new',
    client_secret: 'pi_new_secret',
    amount: call.params?.amount,
  }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('EUR 60 5 v 5, each pays: holds 680, saves the card, keyed on the share', async () => {
  const { db, stripe, deps } = setup(prepared());

  const res = await createSharePayment(deps, caller, { shareId: 's1' });

  strictEqual(res.status, 200);
  deepStrictEqual(res.body, { clientSecret: 'pi_new_secret', customerId: 'cus_1', amountCents: 680, cashCents: 0, nonRefundable: false });
  deepStrictEqual(db.callsTo('prepare_share_payment')[0].args, {
    p_share_id: 's1', p_profile_id: 'p1', p_method: 'card', p_accept_non_refundable: false,
  });
  const [create] = stripe.callsTo('paymentIntents.create');
  deepStrictEqual(create.params, {
    amount: 680,
    currency: 'eur',
    customer: 'cus_1',
    setup_future_usage: 'off_session',
    capture_method: 'manual',
    automatic_payment_methods: { enabled: true },
    metadata: { share_id: 's1', booking_id: 'b1', profile_id: 'p1' },
  });
  strictEqual(create.idempotencyKey, 'share-s1-after-none');
  deepStrictEqual(db.callsTo('set_share_payment_intent')[0].args, { p_share_id: 's1', p_intent_id: 'pi_new' });
});

Deno.test('the Stripe amount is the server\'s amount for every worked example', async () => {
  const cases = [
    { pitch_cents: 612, fee_cents: 80, amount_cents: 692 },
    { pitch_cents: 611, fee_cents: 80, amount_cents: 691 },
    { pitch_cents: 500, fee_cents: 80, amount_cents: 580 },
    { pitch_cents: 6000, fee_cents: 550, amount_cents: 6550, payment_mode: 'pay_all', is_booker: true },
    { pitch_cents: 6000, fee_cents: 660, amount_cents: 6660, payment_mode: 'pay_all', is_booker: true },
    { pitch_cents: 6000, fee_cents: 495, amount_cents: 6495, payment_mode: 'pay_all', is_booker: true },
    { pitch_cents: 600, fee_cents: 0, amount_cents: 600 },
  ];
  for (const share of cases) {
    const { stripe, deps } = setup(prepared(share));
    await createSharePayment(deps, caller, { shareId: 's1' });
    strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.amount, share.amount_cents);
  }
});

Deno.test('a cash player pays 80 by card', async () => {
  const { db, stripe, deps } = setup(prepared({ payment_method: 'cash', amount_cents: 80, cash_cents: 600 }));

  const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });

  strictEqual(res.body.amountCents, 80);
  strictEqual(res.body.cashCents, 600);
  strictEqual(db.callsTo('prepare_share_payment')[0].args.p_method, 'cash');
  strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.amount, 80);
});

Deno.test('less than 6 hours before kickoff: taken at once, only with the acknowledgement', async () => {
  const { db, stripe, deps } = setup(prepared({ capture_method: 'immediate', non_refundable: true }));

  const res = await createSharePayment(deps, caller, { shareId: 's1', acceptNonRefundable: true });

  strictEqual(db.callsTo('prepare_share_payment')[0].args.p_accept_non_refundable, true);
  strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.capture_method, 'automatic');
  strictEqual(res.body.nonRefundable, true);
});

Deno.test('refused without the acknowledgement: no Stripe call', async () => {
  const { db, stripe, deps } = setup(prepared());
  db.fail('prepare_share_payment', 'non_refundable_not_accepted');

  const res = await createSharePayment(deps, caller, { shareId: 's1' });

  deepStrictEqual(res, { status: 409, body: { error: 'non_refundable_not_accepted' } });
  strictEqual(stripe.calls.length, 0);
});

Deno.test('someone else\'s share is refused', async () => {
  const { db, deps } = setup(prepared());
  db.fail('prepare_share_payment', 'not_your_share');
  deepStrictEqual(await createSharePayment(deps, caller, { shareId: 's1' }), { status: 403, body: { error: 'not_your_share' } });

  db.fail('prepare_share_payment', 'share_not_found');
  strictEqual((await createSharePayment(deps, caller, { shareId: 's1' })).status, 404);
});

Deno.test('bad requests', async () => {
  const { deps } = setup(prepared());
  strictEqual((await createSharePayment(deps, caller, {})).status, 400);
  strictEqual((await createSharePayment(deps, caller, { shareId: 's1', method: 'cheque' as never })).status, 400);
});

Deno.test('an amount that doesn\'t match its breakdown is never sent to Stripe', async () => {
  const { stripe, deps } = setup(prepared({ amount_cents: 1 }));

  const res = await createSharePayment(deps, caller, { shareId: 's1' });

  strictEqual(res.status, 500);
  strictEqual(stripe.calls.length, 0);
});

Deno.test('retrying reuses the open intent: no second hold', async () => {
  const { stripe, deps } = setup(prepared({ stripe_payment_intent_id: 'pi_open' }));
  stripe.respond('paymentIntents.retrieve', {
    id: 'pi_open', status: 'requires_payment_method', amount: 680, capture_method: 'manual', client_secret: 'pi_open_secret',
  });

  const res = await createSharePayment(deps, caller, { shareId: 's1' });

  strictEqual(res.body.clientSecret, 'pi_open_secret');
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('the same request twice sends the same idempotency key', async () => {
  const first = setup(prepared());
  await createSharePayment(first.deps, caller, { shareId: 's1' });
  const second = setup(prepared());
  await createSharePayment(second.deps, caller, { shareId: 's1' });

  strictEqual(first.stripe.calls[0].idempotencyKey, second.stripe.calls[0].idempotencyKey);
});

Deno.test('switching to cash cancels the open card intent and starts a new one', async () => {
  const { stripe, deps } = setup(prepared({ payment_method: 'cash', amount_cents: 80, cash_cents: 600, stripe_payment_intent_id: 'pi_card' }));
  stripe.respond('paymentIntents.retrieve', {
    id: 'pi_card', status: 'requires_payment_method', amount: 680, capture_method: 'manual', client_secret: 'x',
  });
  stripe.respond('paymentIntents.cancel', { id: 'pi_card', status: 'canceled' });

  await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });

  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => [c.id, c.idempotencyKey]), [['pi_card', 'cancel-pi_card']]);
  const [create] = stripe.callsTo('paymentIntents.create');
  strictEqual(create.params?.amount, 80);
  strictEqual(create.idempotencyKey, 'share-s1-after-pi_card');
});

Deno.test('an intent that already went through is not paid again', async () => {
  const { stripe, deps } = setup(prepared({ stripe_payment_intent_id: 'pi_done' }));
  stripe.respond('paymentIntents.retrieve', { id: 'pi_done', status: 'requires_capture', amount: 680, capture_method: 'manual' });

  const res = await createSharePayment(deps, caller, { shareId: 's1' });

  deepStrictEqual(res, { status: 409, body: { error: 'already_paid' } });
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('a player without a Stripe customer gets one, keyed on their profile', async () => {
  const { db, stripe, deps } = setup(prepared({ stripe_customer_id: null }));
  stripe.respond('customers.create', { id: 'cus_new' });

  await createSharePayment(deps, caller, { shareId: 's1' });

  const [customer] = stripe.callsTo('customers.create');
  deepStrictEqual(customer.params, { email: 'p1@futty.test', metadata: { profile_id: 'p1' } });
  strictEqual(customer.idempotencyKey, 'customer-p1');
  deepStrictEqual(db.callsTo('set_stripe_customer')[0].args, { p_profile_id: 'p1', p_customer_id: 'cus_new' });
  strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.customer, 'cus_new');
});

Deno.test('nothing to pay by card: no Stripe call', async () => {
  const { stripe, deps } = setup(prepared({ status: 'paid', amount_cents: 0, cash_cents: 600, payment_method: 'cash', fee_cents: 0 }));

  const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });

  deepStrictEqual(res, { status: 200, body: { paid: true, amountCents: 0, cashCents: 600 } });
  strictEqual(stripe.calls.length, 0);
});

Deno.test('a Premium cash booker in responsible mode saves a card with a SetupIntent', async () => {
  const { stripe, deps } = setup(prepared({
    is_booker: true, payment_mode: 'each_pays_responsible', payment_method: 'cash',
    amount_cents: 0, fee_cents: 0, cash_cents: 600, needs_saved_card: true,
  }));
  stripe.respond('setupIntents.create', { id: 'seti_1', client_secret: 'seti_secret' });

  const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });

  deepStrictEqual(res.body, { setupIntentClientSecret: 'seti_secret', customerId: 'cus_1', amountCents: 0, cashCents: 600 });
  const [setupCall] = stripe.callsTo('setupIntents.create');
  deepStrictEqual(setupCall.params, {
    customer: 'cus_1',
    usage: 'off_session',
    automatic_payment_methods: { enabled: true },
    metadata: { kind: 'share_card', share_id: 's1', booking_id: 'b1' },
  });
  strictEqual(setupCall.idempotencyKey, 'setup-share-s1');
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('a booking from before P4a keeps the old hold-only intent', async () => {
  const { stripe, deps } = setup(prepared({ payment_mode: null, amount_cents: 680, pitch_cents: null, fee_cents: null }));

  await createSharePayment(deps, caller, { shareId: 's1' });

  const [create] = stripe.callsTo('paymentIntents.create');
  deepStrictEqual(create.params, {
    amount: 680,
    currency: 'eur',
    capture_method: 'manual',
    automatic_payment_methods: { enabled: true },
    metadata: { share_id: 's1', booking_id: 'b1', profile_id: 'p1' },
  });
  strictEqual(create.idempotencyKey, 'share-s1-after-none');
});
