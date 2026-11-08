import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { createStripeFake, stripeError } from './stripe-fake.ts';

Deno.test('records the method, params and idempotency key of each call', async () => {
  const fake = createStripeFake();
  fake.respond('refunds.create', { id: 're_1', status: 'succeeded' });

  const refund = await fake.stripe.refunds.create(
    { payment_intent: 'pi_1' },
    { idempotencyKey: 'refund-share-s1' },
  );

  strictEqual(refund.id, 're_1');
  deepStrictEqual(fake.calls, [{
    method: 'refunds.create',
    params: { payment_intent: 'pi_1' },
    idempotencyKey: 'refund-share-s1',
    options: { idempotencyKey: 'refund-share-s1' },
  }]);
});

Deno.test('records the id of id-first methods', async () => {
  const fake = createStripeFake();
  fake.respond('paymentIntents.capture', (call: { id?: string }) => ({ id: call.id, status: 'succeeded' }));

  const intent = await fake.stripe.paymentIntents.capture(
    'pi_2',
    { amount_to_capture: 680 },
    { idempotencyKey: 'capture-pi_2' },
  );

  strictEqual(intent.status, 'succeeded');
  deepStrictEqual(
    fake.callsTo('paymentIntents.capture').map(({ id, idempotencyKey, params }) => ({ id, idempotencyKey, params })),
    [{ id: 'pi_2', idempotencyKey: 'capture-pi_2', params: { amount_to_capture: 680 } }],
  );
});

Deno.test('throws scripted Stripe errors', async () => {
  const fake = createStripeFake();
  fake.fail('paymentIntents.capture', stripeError({ type: 'StripeCardError', code: 'card_declined' }));

  await rejects(fake.stripe.paymentIntents.capture('pi_3'), { type: 'StripeCardError', code: 'card_declined' });
  strictEqual(fake.calls.length, 1);
});

Deno.test('rejects calls with nothing scripted', async () => {
  const fake = createStripeFake();

  await rejects(fake.stripe.customers.create({ email: 'a@futty.test' }), /no response scripted for customers\.create/);
});
