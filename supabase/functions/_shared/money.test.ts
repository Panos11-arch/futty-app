// Money helpers for Edge Functions. The money maths and spec 13's worked
// examples are tested in the database (supabase/tests/pay-modes-1-amounts.test.sql,
// pay-booking-screens-1-quote.test.sql), where every fee comes from app_rules.
import { strictEqual } from 'node:assert/strict';
import { cardChargeCents, idempotencyKeys } from './money.ts';

Deno.test('the card charge follows from a share\'s breakdown', () => {
  strictEqual(cardChargeCents({ pitch_cents: 600, fee_cents: 80, payment_method: 'card' }), 680);
  strictEqual(cardChargeCents({ pitch_cents: 600, fee_cents: 80, payment_method: 'cash' }), 80);
  strictEqual(cardChargeCents({ pitch_cents: 6000, fee_cents: 495, payment_method: 'card' }), 6495);
  strictEqual(cardChargeCents({ pitch_cents: 600, fee_cents: 80, payment_method: 'card', credit_cents: 500 }), 180,
    'credit pays part of the pitch');
  strictEqual(cardChargeCents({ pitch_cents: 600, fee_cents: 0, payment_method: 'card', credit_cents: 600 }), 0);
});

// The same examples as supabase/tests/pay-cancellations-7-credit.test.sql.
Deno.test('idempotency keys are built from our ids and stable on retry', () => {
  const card = { shareId: 's1', amountCents: 680, method: 'card', captureMethod: 'manual', previousIntentId: null } as const;
  strictEqual(idempotencyKeys.shareIntent(card), 'share-s1-680-card-manual-after-none');
  strictEqual(idempotencyKeys.shareIntent(card), idempotencyKeys.shareIntent({ ...card }), 'the same request, the same key');
  strictEqual(idempotencyKeys.shareIntent({ ...card, previousIntentId: 'pi_old' }), 'share-s1-680-card-manual-after-pi_old');
  strictEqual(idempotencyKeys.legacyShareIntent('s1', null), 'share-s1-after-none');
  strictEqual(idempotencyKeys.capture('s1'), 'capture-share-s1');
  strictEqual(idempotencyKeys.cancelIntent('pi_1'), 'cancel-pi_1');
  strictEqual(idempotencyKeys.refund('pi_1', 680), 'refund-pi_1-680');
  strictEqual(idempotencyKeys.guaranteeHold('g1', 'pm_1', 1), 'guarantee-g1-pm_1-attempt-1');
  strictEqual(idempotencyKeys.guaranteeCard('g1', 'pm_1'), 'guarantee-card-g1-after-pm_1');
  strictEqual(idempotencyKeys.guaranteeCard('g1', null), 'guarantee-card-g1-after-none');
  strictEqual(idempotencyKeys.customer('p1'), 'customer-p1');
  strictEqual(idempotencyKeys.shareCardSetup('s1', 'cash', null), 'setup-share-s1-cash-after-none');
  strictEqual(idempotencyKeys.shareCardSetup('s1', 'card', null, 'seti_old'), 'setup-share-s1-card-after-none-setup-seti_old');
  strictEqual(idempotencyKeys.cancelFee('f1', 1), 'cancel-fee-f1-attempt-1');
  strictEqual(idempotencyKeys.cancelFee('f1', 2), 'cancel-fee-f1-attempt-2', 'each retry is a new request');
});

Deno.test('P4c keys: a top-up and the guarantee collection are one request each, retries included', () => {
  strictEqual(idempotencyKeys.topUp('i1'), 'top-up-i1');
  strictEqual(idempotencyKeys.topUp('i1'), idempotencyKeys.topUp('i1'), 'a retry after no answer is the same request');
  strictEqual(idempotencyKeys.collectGuarantee('c1'), 'collect-guarantee-c1');
});

Deno.test('P4c keys: paying a debt or a cash part names the amount and the payment it replaces', () => {
  strictEqual(idempotencyKeys.owed('debt', 'd1', 680, null), 'owed-debt-d1-680-after-none');
  strictEqual(idempotencyKeys.owed('cash', 's1', 600, 'pi_old'), 'owed-cash-s1-600-after-pi_old');
  const keys = new Set([
    idempotencyKeys.owed('debt', 'd1', 680, null),
    idempotencyKeys.owed('debt', 'd1', 680, 'pi_old'),
    idempotencyKeys.owed('debt', 'd1', 750, null),
    idempotencyKeys.owed('cash', 'd1', 680, null),
  ]);
  strictEqual(keys.size, 4);
});

Deno.test('a retry with a different amount, method or timing gets a new key', () => {
  const card = { shareId: 's1', amountCents: 680, method: 'card', captureMethod: 'manual', previousIntentId: null } as const;
  const keys = new Set([
    idempotencyKeys.shareIntent(card),
    idempotencyKeys.shareIntent({ ...card, amountCents: 80, method: 'cash' }),
    idempotencyKeys.shareIntent({ ...card, captureMethod: 'automatic' }),
    idempotencyKeys.shareIntent({ ...card, amountCents: 600 }),
  ]);
  strictEqual(keys.size, 4);
});

Deno.test('a guarantee hold on a new card, or a new attempt, gets a new key', () => {
  const keys = new Set([
    idempotencyKeys.guaranteeHold('g1', 'pm_1', 1),
    idempotencyKeys.guaranteeHold('g1', 'pm_2', 1),
    idempotencyKeys.guaranteeHold('g1', 'pm_1', 2),
  ]);
  strictEqual(keys.size, 3);
});

Deno.test('a refund is keyed on the intent and what is left, whatever the reason, so two runs make one refund', () => {
  strictEqual(idempotencyKeys.refund('pi_1', 680), idempotencyKeys.refund('pi_1', 680));
  strictEqual(idempotencyKeys.refund('pi_1', 380), 'refund-pi_1-380', 'a later partial refund is a new request');
});

Deno.test('P8 key: a Gipedo Pano settlement takes one amount once, retries included', () => {
  strictEqual(idempotencyKeys.gipedoCapture('g1', 3275), 'gipedo-capture-g1-3275');
  strictEqual(idempotencyKeys.gipedoCapture('g1', 3275), idempotencyKeys.gipedoCapture('g1', 3275));
});

Deno.test('P8 review: a Gipedo Pano offer made again is a new attempt with its own key', () => {
  const hold = { shareId: 's1', amountCents: 6550, method: 'card' as const, captureMethod: 'manual' as const, previousIntentId: null };
  strictEqual(idempotencyKeys.shareIntent({ ...hold, offerAttempt: 1 }), 'share-s1-6550-card-manual-after-none',
    'the first offer keeps the usual key');
  strictEqual(idempotencyKeys.shareIntent({ ...hold, offerAttempt: null }), 'share-s1-6550-card-manual-after-none');
  strictEqual(idempotencyKeys.shareIntent({ ...hold, offerAttempt: 2 }), 'share-s1-offer-2-6550-card-manual-after-none');
  strictEqual(idempotencyKeys.gipedoRelease('g1'), 'gipedo-release-g1', 'a settlement releasing a hold: keyed on our row');
});

Deno.test('P4d: a transfer and a Connect account are keyed on our row ids', () => {
  strictEqual(idempotencyKeys.payout('po1'), 'payout-po1', 'one payout row, one transfer');
  strictEqual(idempotencyKeys.connectAccount('v1', false), 'connect-account-v1-test', 'one Express account per venue and mode');
  strictEqual(idempotencyKeys.connectAccount('v1', true), 'connect-account-v1-live');
});
