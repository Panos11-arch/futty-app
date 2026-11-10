// A cancellation whose release run dies part-way (docs/specs/13-payments-
// bookings.md, "Server-side checks": every money movement happens once).
// The database and Stripe here keep state across runs, so these check the
// whole story: cancel-booking releases the first of three shares and dies;
// run-payment-jobs finds the booking again and finishes the other two; each
// hold is cancelled at Stripe once and its release recorded once.
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import type Stripe from 'npm:stripe@^22';
import { cancelBooking } from '../cancel-booking/handler.ts';
import { createDbFake } from '../_shared/db-fake.ts';
import type { Db } from '../_shared/db.ts';
import { intent } from '../_shared/intent-fixtures.ts';
import { createStripeFake } from '../_shared/stripe-fake.ts';
import { runPaymentJobs } from './handler.ts';

type Share = { id: string; status: string; intent: string; amount: number };

function world(dies: 'db_error' | 'crash') {
  const shares: Share[] = [
    { id: 's1', status: 'authorized', intent: 'pi_1', amount: 680 },
    { id: 's2', status: 'authorized', intent: 'pi_2', amount: 680 },
    { id: 's3', status: 'paid', intent: 'pi_3', amount: 680 },
  ];
  // The holds the webhook recorded when each card was held.
  const ledger = new Set<string>(['hold:pi_1', 'hold:pi_2', 'hold:pi_3']);
  let down = false;

  const fake = createDbFake();
  const active = () => shares.filter((s) => ['pending', 'authorized', 'paid'].includes(s.status));
  // A booking from before P4a: the old cancellation releases all its money.
  fake.respond('cancel_booking_internal', { legacy: true });
  fake.respond('cancel_booking_for', 'confirmed');
  fake.respond('booking_money_to_release', () =>
    active().map((s) => ({ kind: 'share', id: s.id, status: s.status, stripe_payment_intent_id: s.intent, amount_cents: s.amount }))
  );
  fake.respond('bookings_with_money_to_release', () => (active().length ? [{ booking_id: 'b1' }] : []));
  const record = (key: string) => {
    const added = !ledger.has(key);
    ledger.add(key);
    return added;
  };
  fake.respond('record_money_movement', (a: Record<string, unknown>) => record(`${a.p_kind}:${a.p_stripe_id}`));
  // As in SQL: a release is recorded from the hold in the ledger, once.
  fake.respond('record_intent_cancelled', (a: Record<string, unknown>) =>
    ledger.has(`hold:${a.p_intent_id}`) ? record(`cancel:${a.p_intent_id}`) : false
  );
  fake.respond('record_intent_capture', (a: Record<string, unknown>) => record(`capture:${a.p_intent_id}`));
  fake.respond('record_intent_refund', (a: Record<string, unknown>) => record(`refund:${a.p_refund_id}`));
  fake.respond('money_release_done', (a: Record<string, unknown>) => {
    const share = shares.find((s) => s.id === a.p_share_id && s.intent === a.p_intent_id && active().includes(s));
    if (share) share.status = a.p_outcome === 'refunded' ? 'refunded' : 'cancelled';
    // The run dies right after the first share is done.
    if (share?.id === 's1') down = true;
    return null;
  });
  fake.respond('queue_money_release', 'r1');
  fake.respond('expire_venue_credits', 0);
  for (const fn of ['shares_due_for_capture', 'bookings_past_payment_window', 'guarantees_due_for_hold', 'money_releases_due',
                    'cancellation_work', 'cancellation_fees_due', 'credit_reservations_to_release']) {
    fake.respond(fn, []);
  }

  // The database goes away: an error answer, or the connection itself dies.
  const db: Db = {
    rpc(fn, args) {
      if (down && dies === 'crash') return Promise.reject(new Error('connection reset'));
      if (down) return Promise.resolve({ data: null, error: { message: 'could not connect to server' } });
      return fake.db.rpc(fn, args);
    },
  };

  const stripeFake = createStripeFake();
  const state: Record<string, Stripe.PaymentIntent.Status> = { pi_1: 'requires_capture', pi_2: 'requires_capture', pi_3: 'succeeded' };
  const refunded: Record<string, number> = {};
  stripeFake.respond('paymentIntents.retrieve', (c: { id?: string }) => intent(c.id!, state[c.id!], { refunded: refunded[c.id!] ?? 0 }));
  stripeFake.respond('paymentIntents.cancel', (c: { id?: string }) => {
    state[c.id!] = 'canceled';
    return { id: c.id, status: 'canceled' };
  });
  const refundsByKey = new Map<string, unknown>();
  stripeFake.respond('refunds.create', (c: { params?: Record<string, unknown>; idempotencyKey?: string }) => {
    // Stripe answers a repeated key with the same refund.
    if (!refundsByKey.has(c.idempotencyKey!)) {
      const pi = c.params?.payment_intent as string;
      refunded[pi] = (refunded[pi] ?? 0) + (c.params?.amount as number);
      refundsByKey.set(c.idempotencyKey!, { id: `re_${pi}_${refundsByKey.size}`, status: 'succeeded', amount: c.params?.amount });
    }
    return refundsByKey.get(c.idempotencyKey!);
  });
  stripeFake.respond('refunds.list', (c: { params?: Record<string, unknown> }) => ({
    data: [...refundsByKey.values()].filter((r) => (r as { id: string }).id.startsWith(`re_${c.params?.payment_intent}_`)),
  }));

  return {
    shares, ledger, stripe: stripeFake, refundsByKey,
    deps: { db, stripe: stripeFake.stripe },
    recover: () => (down = false),
  };
}

for (const dies of ['db_error', 'crash'] as const) {
  Deno.test(`cancel dies after the first of three shares (${dies}): the job releases the other two, each once`, async () => {
    const w = world(dies);

    await rejects(() => cancelBooking(w.deps, 'p1', { bookingId: 'b1' }), 'the run dies, money still on the booking');
    deepStrictEqual(w.shares.map((s) => s.status), ['cancelled', 'authorized', 'paid']);

    w.recover();
    const summary = await runPaymentJobs(w.deps);
    strictEqual(summary.resumed, 1);
    deepStrictEqual(w.shares.map((s) => s.status), ['cancelled', 'cancelled', 'refunded'], 'every share released');

    // Run it again: nothing left, nothing moves twice.
    await runPaymentJobs(w.deps);
    const cancels = w.stripe.callsTo('paymentIntents.cancel').map((c) => c.id);
    deepStrictEqual(cancels.sort(), ['pi_1', 'pi_2'], 'each hold cancelled at Stripe once');
    strictEqual(w.refundsByKey.size, 1, 'the paid share refunded once');
    deepStrictEqual([...w.ledger].filter((k) => k.startsWith('cancel:')).sort(), ['cancel:pi_1', 'cancel:pi_2'],
      'each release recorded, even one Stripe made just before the run died');
    strictEqual([...w.ledger].filter((k) => k.startsWith('refund:')).length, 1);
  });
}

Deno.test('two runs at once on the same cancelled booking: one refund, one release each', async () => {
  const w = world('db_error');
  w.shares[0].status = 'cancelled'; // only s2 (held) and s3 (paid) left
  await Promise.all([runPaymentJobs(w.deps), runPaymentJobs(w.deps)]);
  deepStrictEqual(w.shares.map((s) => s.status), ['cancelled', 'cancelled', 'refunded']);
  strictEqual(w.refundsByKey.size, 1, 'the same refund request both times');
  strictEqual([...w.ledger].filter((k) => k.startsWith('refund:')).length, 1);
});
