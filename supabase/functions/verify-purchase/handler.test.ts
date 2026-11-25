import { deepStrictEqual } from 'node:assert/strict';

import type { SubscriptionState } from '../_shared/premium.ts';
import { type ApplyArgs, verifyPurchase, type VerifyPurchaseDeps } from './handler.ts';

const BUNDLE = 'com.panosalepis.futtyapp';

function deps(over: {
  transaction?: { transactionId: string; originalTransactionId: string; bundleId: string; productId: string } | null;
  state?: SubscriptionState | null;
  apply?: (a: ApplyArgs) => Promise<{ tier: string | null; error: string | null }>;
} = {}) {
  const applied: ApplyArgs[] = [];
  const d: VerifyPurchaseDeps = {
    bundleId: BUNDLE,
    fetchTransaction: async () =>
      over.transaction === undefined
        ? { transactionId: 't1', originalTransactionId: 'otx', bundleId: BUNDLE, productId: 'premium_plus_monthly' }
        : over.transaction,
    fetchSubscription: async () =>
      over.state === undefined ? { active: true, productId: 'premium_plus_monthly', expiresAt: 1_800_000_000_000 } : over.state,
    apply: async (a) => {
      applied.push(a);
      return over.apply ? over.apply(a) : { tier: a.active ? (a.productId === 'premium_plus_monthly' ? 'premium_plus' : 'premium') : 'basic', error: null };
    },
  };
  return { d, applied };
}

Deno.test('a verified Premium Plus purchase sets the tier from what Apple says, for the caller only', async () => {
  const { d, applied } = deps();
  const res = await verifyPurchase(d, 'me', { transactionId: 't1', productId: 'premium_plus_monthly' });
  deepStrictEqual(res, { status: 200, body: { active: true, tier: 'premium_plus' } });
  deepStrictEqual(applied, [
    {
      profileId: 'me',
      productId: 'premium_plus_monthly',
      originalTransactionId: 'otx',
      active: true,
      expiresAt: new Date(1_800_000_000_000).toISOString(),
    },
  ]);
});

Deno.test('a verified Premium purchase gives Premium', async () => {
  const { d } = deps({
    transaction: { transactionId: 't1', originalTransactionId: 'otx', bundleId: BUNDLE, productId: 'premium_monthly_v2' },
    state: { active: true, productId: 'premium_monthly_v2', expiresAt: null },
  });
  const res = await verifyPurchase(d, 'me', { transactionId: 't1', productId: 'premium_monthly_v2' });
  deepStrictEqual(res, { status: 200, body: { active: true, tier: 'premium' } });
});

Deno.test("a downgrade bought from Plus: Apple keeps Plus until the renewal, so the tier stays Plus", async () => {
  const { d, applied } = deps({
    transaction: { transactionId: 't2', originalTransactionId: 'otx', bundleId: BUNDLE, productId: 'premium_monthly_v2' },
    state: { active: true, productId: 'premium_plus_monthly', expiresAt: null },
  });
  const res = await verifyPurchase(d, 'me', { transactionId: 't2', productId: 'premium_monthly_v2' });
  deepStrictEqual(res.body, { active: true, tier: 'premium_plus' });
  deepStrictEqual(applied[0].productId, 'premium_plus_monthly');
});

Deno.test('refused: missing ids, another product, a transaction Apple doesn’t know, another app', async () => {
  deepStrictEqual((await verifyPurchase(deps().d, 'me', { transactionId: 't1' })).status, 400);
  deepStrictEqual((await verifyPurchase(deps().d, 'me', { transactionId: 't1', productId: 'team_premium_9aside' })).status, 400);
  deepStrictEqual((await verifyPurchase(deps({ transaction: null }).d, 'me', { transactionId: 't1', productId: 'premium_plus_monthly' })).status, 402);
  const other = deps({ transaction: { transactionId: 't1', originalTransactionId: 'otx', bundleId: 'com.other', productId: 'premium_plus_monthly' } });
  deepStrictEqual((await verifyPurchase(other.d, 'me', { transactionId: 't1', productId: 'premium_plus_monthly' })).status, 400);
  deepStrictEqual(other.applied, []);
  const mismatch = deps({ transaction: { transactionId: 't1', originalTransactionId: 'otx', bundleId: BUNDLE, productId: 'premium_monthly_v2' } });
  deepStrictEqual((await verifyPurchase(mismatch.d, 'me', { transactionId: 't1', productId: 'premium_plus_monthly' })).status, 400);
});

Deno.test('Apple still indexing the purchase: inactive, nothing written, so the app retries', async () => {
  const { d, applied } = deps({ state: null });
  const res = await verifyPurchase(d, 'me', { transactionId: 't1', productId: 'premium_plus_monthly' });
  deepStrictEqual(res, { status: 200, body: { active: false, tier: null } });
  deepStrictEqual(applied, []);
});

Deno.test("expired or refunded: written as inactive, Basic", async () => {
  const { d, applied } = deps({ state: { active: false, productId: 'premium_plus_monthly', expiresAt: null } });
  const res = await verifyPurchase(d, 'me', { transactionId: 't1', productId: 'premium_plus_monthly' });
  deepStrictEqual(res.body, { active: false, tier: 'basic' });
  deepStrictEqual(applied[0].active, false);
});

Deno.test("someone else's subscription can't be claimed; a database failure is an error", async () => {
  const taken = deps({ apply: async () => ({ tier: null, error: 'subscription_belongs_to_another_player' }) });
  deepStrictEqual((await verifyPurchase(taken.d, 'me', { transactionId: 't1', productId: 'premium_plus_monthly' })).status, 409);
  const broken = deps({ apply: async () => ({ tier: null, error: 'connection lost' }) });
  deepStrictEqual((await verifyPurchase(broken.d, 'me', { transactionId: 't1', productId: 'premium_plus_monthly' })).status, 502);
});
