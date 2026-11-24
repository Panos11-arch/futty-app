import { deepStrictEqual as assertEquals } from 'node:assert/strict';

import { isPersonalPremiumProduct, PREMIUM_PLUS_PRODUCT, PREMIUM_PRODUCT, subscriptionStateFrom } from './premium.ts';

Deno.test('the two personal plans, and nothing else', () => {
  assertEquals(PREMIUM_PRODUCT, 'premium_monthly_v2');
  assertEquals(PREMIUM_PLUS_PRODUCT, 'premium_plus_monthly');
  assertEquals(isPersonalPremiumProduct('premium_monthly_v2'), true);
  assertEquals(isPersonalPremiumProduct('premium_plus_monthly'), true);
  assertEquals(isPersonalPremiumProduct('team_premium_9aside'), false);
  assertEquals(isPersonalPremiumProduct(undefined), false);
});

const entry = (originalTransactionId: string, status: number, productId: string, expiresDate?: number) => ({
  originalTransactionId,
  status,
  info: { productId, expiresDate },
});

Deno.test("Apple's statuses: the subscription's current product, active on 1 (active) and 4 (grace period)", () => {
  for (const [status, active] of [[1, true], [2, false], [3, false], [4, true], [5, false]] as const) {
    assertEquals(subscriptionStateFrom([{ lastTransactions: [entry('otx', status, 'premium_plus_monthly', 1700)] }], 'otx'), {
      active,
      productId: 'premium_plus_monthly',
      expiresAt: 1700,
    });
  }
});

Deno.test('an upgrade or downgrade is the same original transaction on another product', () => {
  const groups = [
    { lastTransactions: [entry('other', 1, 'premium_monthly_v2')] },
    { lastTransactions: [entry('otx', 1, 'premium_plus_monthly')] },
  ];
  assertEquals(subscriptionStateFrom(groups, 'otx'), { active: true, productId: 'premium_plus_monthly', expiresAt: null });
});

Deno.test("data but nothing for this subscription: a real answer, inactive; no data at all: unknown (Apple still indexing)", () => {
  assertEquals(subscriptionStateFrom([{ lastTransactions: [entry('other', 1, 'premium_monthly_v2')] }], 'otx'), {
    active: false,
    productId: null,
    expiresAt: null,
  });
  assertEquals(subscriptionStateFrom([], 'otx'), null);
  assertEquals(subscriptionStateFrom(undefined, 'otx'), null);
});
