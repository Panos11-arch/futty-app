import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake, stripeError } from '../_shared/stripe-fake.ts';
import { createSharePayment } from './handler.ts';

const caller = { id: 'p1', email: 'p1@futty.test' };

/** What plan_share_payment returns for a EUR 60 5 v 5 share, each pays. */
function plan(overrides: Record<string, unknown> = {}) {
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

function setup(planned: Record<string, unknown>, existing?: Record<string, unknown>) {
  const db = createDbFake();
  db.respond('plan_share_payment', planned);
  db.respond('attach_share_intent', planned);
  db.respond('attach_share_setup', planned);
  db.respond('set_share_payment_intent', null);
  db.respond('set_stripe_customer', null);
  db.respond('money_release_done', null);
  const stripe = createStripeFake();
  stripe.respond('paymentIntents.create', (call: { params?: Record<string, unknown> }) => ({
    id: 'pi_new',
    client_secret: 'pi_new_secret',
    amount: call.params?.amount,
  }));
  stripe.respond('paymentIntents.retrieve', (call: { id?: string }) =>
    call.id === 'pi_new' ? intent('pi_new', 'requires_payment_method') : existing);
  stripe.respond('paymentIntents.cancel', (call: { id?: string }) => ({ id: call.id, status: 'canceled' }));
  return { db, stripe, deps: { db: db.db, stripe: stripe.stripe } };
}

Deno.test('EUR 60 5 v 5, each pays: holds 680, saves the card, keyed on the share, amount and method', async () => {
  const { db, stripe, deps } = setup(plan());

  const res = await createSharePayment(deps, caller, { shareId: 's1' });

  strictEqual(res.status, 200);
  deepStrictEqual(res.body, { clientSecret: 'pi_new_secret', customerId: 'cus_1', amountCents: 680, cashCents: 0, nonRefundable: false });
  deepStrictEqual(db.callsTo('plan_share_payment')[0].args, {
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
    metadata: { kind: 'share', share_id: 's1', booking_id: 'b1', profile_id: 'p1', method: 'card', fee_cents: '80' },
  });
  strictEqual(create.idempotencyKey, 'share-s1-680-card-manual-after-none');
  deepStrictEqual(db.callsTo('attach_share_intent')[0].args, {
    p_share_id: 's1', p_profile_id: 'p1', p_method: 'card', p_accept_non_refundable: false,
    p_intent_id: 'pi_new', p_intent_amount_cents: 680, p_intent_capture_method: 'manual', p_expected_intent_id: null,
  });
});

Deno.test('the Stripe amount is the server\'s amount for every worked example', async () => {
  const cases = [
    { pitch_cents: 612, fee_cents: 80, amount_cents: 692 },
    { pitch_cents: 500, fee_cents: 80, amount_cents: 580 },
    { pitch_cents: 6000, fee_cents: 550, amount_cents: 6550, payment_mode: 'pay_all', is_booker: true },
    { pitch_cents: 6000, fee_cents: 660, amount_cents: 6660, payment_mode: 'pay_all', is_booker: true },
    { pitch_cents: 6000, fee_cents: 495, amount_cents: 6495, payment_mode: 'pay_all', is_booker: true },
    { pitch_cents: 600, fee_cents: 0, amount_cents: 600 },
  ];
  for (const share of cases) {
    const { stripe, deps } = setup(plan(share));
    await createSharePayment(deps, caller, { shareId: 's1' });
    strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.amount, share.amount_cents);
  }
});

Deno.test('a cash player pays 80 by card', async () => {
  const { stripe, deps } = setup(plan({ payment_method: 'cash', amount_cents: 80, cash_cents: 600 }));
  const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });
  strictEqual(res.body.amountCents, 80);
  strictEqual(res.body.cashCents, 600);
  strictEqual(stripe.callsTo('paymentIntents.create')[0].idempotencyKey, 'share-s1-80-cash-manual-after-none');
});

Deno.test('less than 6 hours before kickoff: taken at once, only with the acknowledgement', async () => {
  const { db, stripe, deps } = setup(plan({ capture_method: 'immediate', non_refundable: true }));
  const res = await createSharePayment(deps, caller, { shareId: 's1', acceptNonRefundable: true });
  strictEqual(res.body.nonRefundable, true);
  strictEqual(stripe.callsTo('paymentIntents.create')[0].params?.capture_method, 'automatic');
  strictEqual(db.callsTo('attach_share_intent')[0].args.p_intent_capture_method, 'immediate');
  strictEqual(db.callsTo('attach_share_intent')[0].args.p_accept_non_refundable, true);
});

Deno.test('refusals from the database: no Stripe call', async () => {
  for (const [code, status] of [['non_refundable_not_accepted', 409], ['not_your_share', 403], ['saved_card_required', 409],
                                ['payment_window_closed', 409]] as const) {
    const { db, stripe, deps } = setup(plan());
    db.fail('plan_share_payment', code);
    const res = await createSharePayment(deps, caller, { shareId: 's1' });
    deepStrictEqual(res, { status, body: { error: code } });
    strictEqual(stripe.calls.length, 0);
  }
});

Deno.test('bad requests', async () => {
  const { deps } = setup(plan());
  strictEqual((await createSharePayment(deps, caller, {})).status, 400);
  strictEqual((await createSharePayment(deps, caller, { shareId: 's1', method: 'cheque' as 'card' })).status, 400);
});

Deno.test('an amount that doesn\'t match its breakdown is never sent to Stripe', async () => {
  const { stripe, deps } = setup(plan({ amount_cents: 1 }));
  const res = await createSharePayment(deps, caller, { shareId: 's1' });
  strictEqual(res.status, 500);
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('pressing Pay again reuses the open intent: no second hold', async () => {
  const { db, stripe, deps } = setup(plan({ stripe_payment_intent_id: 'pi_old' }), intent('pi_old', 'requires_payment_method'));
  const res = await createSharePayment(deps, caller, { shareId: 's1' });
  strictEqual(res.body.clientSecret, 'pi_old_secret');
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
  strictEqual(stripe.callsTo('paymentIntents.cancel').length, 0);
  deepStrictEqual([db.callsTo('attach_share_intent')[0].args.p_intent_id, db.callsTo('attach_share_intent')[0].args.p_expected_intent_id],
    ['pi_old', 'pi_old']);
});

Deno.test('double Pay with a method change: the open card intent is cancelled first, the cash one has its own key', async () => {
  const { db, stripe, deps } = setup(
    plan({ stripe_payment_intent_id: 'pi_old', payment_method: 'cash', amount_cents: 80, cash_cents: 600 }),
    intent('pi_old', 'requires_payment_method'),
  );
  const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });
  strictEqual(res.status, 200);
  deepStrictEqual(stripe.calls.map((c) => c.method), [
    'paymentIntents.retrieve', 'paymentIntents.cancel', 'paymentIntents.create',
  ], 'cancelled before the new one exists');
  strictEqual(stripe.callsTo('paymentIntents.create')[0].idempotencyKey, 'share-s1-80-cash-manual-after-pi_old');
  strictEqual(db.callsTo('attach_share_intent')[0].args.p_expected_intent_id, 'pi_old');
});

Deno.test('double Pay with a method change after the first was confirmed: nothing changes', async () => {
  for (const status of ['requires_capture', 'processing', 'succeeded'] as const) {
    const { db, stripe, deps } = setup(
      plan({ stripe_payment_intent_id: 'pi_old', payment_method: 'cash', amount_cents: 80 }),
      intent('pi_old', status),
    );
    const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });
    deepStrictEqual(res, { status: 409, body: { error: 'already_paid' } });
    deepStrictEqual(stripe.calls.map((c) => c.method), ['paymentIntents.retrieve'], `${status}: never cancelled or replaced`);
    strictEqual(db.callsTo('attach_share_intent').length, 0, 'and the share is never changed');
  }
});

Deno.test('confirmed between the check and the cancel: the payment stands, nothing changes', async () => {
  const { db, stripe, deps } = setup(plan({ stripe_payment_intent_id: 'pi_old', payment_method: 'cash', amount_cents: 80 }));
  let retrieves = 0;
  stripe.respond('paymentIntents.retrieve', () =>
    (retrieves++ === 0 ? intent('pi_old', 'requires_payment_method') : intent('pi_old', 'requires_capture')));
  stripe.fail('paymentIntents.cancel', stripeError({ code: 'payment_intent_unexpected_state' }));
  const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });
  deepStrictEqual(res, { status: 409, body: { error: 'already_paid' } });
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
  strictEqual(db.callsTo('attach_share_intent').length, 0);
});

Deno.test('a share that changed meanwhile: the new intent is cancelled at once, never left to be paid', async () => {
  const { db, stripe, deps } = setup(plan());
  db.fail('attach_share_intent', 'share_changed');
  const res = await createSharePayment(deps, caller, { shareId: 's1' });
  deepStrictEqual(res, { status: 409, body: { error: 'share_changed' } });
  deepStrictEqual(stripe.callsTo('paymentIntents.cancel').map((c) => c.id), ['pi_new']);
  strictEqual(db.callsTo('money_release_done')[0].args.p_intent_id, 'pi_new');
});

Deno.test('a player without a Stripe customer gets one, keyed on their profile', async () => {
  const { db, stripe, deps } = setup(plan({ stripe_customer_id: null }));
  stripe.respond('customers.create', { id: 'cus_new' });
  const res = await createSharePayment(deps, caller, { shareId: 's1' });
  strictEqual(res.body.customerId, 'cus_new');
  strictEqual(stripe.callsTo('customers.create')[0].idempotencyKey, 'customer-p1');
  deepStrictEqual(db.callsTo('set_stripe_customer')[0].args, { p_profile_id: 'p1', p_customer_id: 'cus_new' });
});

Deno.test('a Premium cash booker saves a card with a SetupIntent', async () => {
  const { db, stripe, deps } = setup(plan({
    is_booker: true, payment_mode: 'each_pays_responsible', payment_method: 'cash', amount_cents: 0, fee_cents: 0,
    cash_cents: 600, needs_saved_card: true,
  }));
  stripe.respond('setupIntents.create', { id: 'seti_1', client_secret: 'seti_secret' });
  const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });
  deepStrictEqual(res.body, { setupIntentClientSecret: 'seti_secret', customerId: 'cus_1', amountCents: 0, cashCents: 600 });
  const [setup1] = stripe.callsTo('setupIntents.create');
  deepStrictEqual(setup1.params?.metadata, { kind: 'share_card', share_id: 's1', booking_id: 'b1' });
  strictEqual(setup1.idempotencyKey, 'setup-share-s1-cash-after-none');
  deepStrictEqual(db.callsTo('attach_share_setup')[0].args, {
    p_share_id: 's1', p_profile_id: 'p1', p_method: 'cash', p_setup_intent_id: 'seti_1', p_expected_intent_id: null,
  });
  strictEqual(stripe.callsTo('paymentIntents.create').length, 0);
});

Deno.test('a SetupIntent the share no longer wants is cancelled', async () => {
  const { db, stripe, deps } = setup(plan({ needs_saved_card: true, amount_cents: 0, payment_method: 'cash', is_booker: true }));
  stripe.respond('setupIntents.create', { id: 'seti_1', client_secret: 'seti_secret' });
  stripe.respond('setupIntents.cancel', { id: 'seti_1', status: 'canceled' });
  db.fail('attach_share_setup', 'share_changed');
  const res = await createSharePayment(deps, caller, { shareId: 's1', method: 'cash' });
  deepStrictEqual(res, { status: 409, body: { error: 'share_changed' } });
  strictEqual(stripe.callsTo('setupIntents.cancel')[0].id, 'seti_1');
});

Deno.test('a booking from before P4a keeps the old hold-only intent', async () => {
  const { db, stripe, deps } = setup(plan({ payment_mode: null, amount_cents: 680 }));
  const res = await createSharePayment(deps, caller, { shareId: 's1' });
  deepStrictEqual(res.body, { clientSecret: 'pi_new_secret' });
  const [create] = stripe.callsTo('paymentIntents.create');
  strictEqual(create.params?.capture_method, 'manual');
  strictEqual(create.idempotencyKey, 'share-s1-after-none');
  deepStrictEqual(db.callsTo('set_share_payment_intent')[0].args, { p_share_id: 's1', p_intent_id: 'pi_new' });
});
