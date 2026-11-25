// Personal Premium's two plans (P1, decided by Panos on 22 November; spec 13
// "Premium"). Both are in one App Store subscription group ("Futty Premium
// Monthly"), Premium Plus ranked above Premium, so an upgrade or a downgrade
// keeps the subscription's original transaction and changes its product.
// The database works out the tier (apply_premium_subscription); this file
// only reads Apple's answer.

export const PREMIUM_PRODUCT = 'premium_monthly_v2';
export const PREMIUM_PLUS_PRODUCT = 'premium_plus_monthly';

export function isPersonalPremiumProduct(productId: string | null | undefined): boolean {
  return productId === PREMIUM_PRODUCT || productId === PREMIUM_PLUS_PRODUCT;
}

/** One subscription's state as Apple reports it now. productId is the
 *  product it's on (after an upgrade, the new one); null when Apple has data
 *  but nothing for this subscription. */
export type SubscriptionState = { active: boolean; productId: string | null; expiresAt: number | null };

/** An entry of Get All Subscription Statuses, with its signedTransactionInfo already decoded. */
export type StatusEntry = {
  originalTransactionId: string;
  status: number;
  info: { productId?: string; expiresDate?: number };
};

/**
 * The subscription's current state from Apple's groups: the entry for this
 * original transaction, whatever product it's on now. Status 1 is active
 * and 4 is the billing grace period (Apple's guidance: keep access); 2
 * expired, 3 billing retry and 5 revoked (a refund) are not. No data at all
 * is null: Apple can take a few seconds to index a new purchase.
 */
export function subscriptionStateFrom(
  groups: { lastTransactions?: StatusEntry[] }[] | undefined,
  originalTransactionId: string,
): SubscriptionState | null {
  if (!groups || groups.length === 0) return null;
  for (const group of groups) {
    for (const last of group.lastTransactions ?? []) {
      if (last.originalTransactionId !== originalTransactionId) continue;
      return {
        active: last.status === 1 || last.status === 4,
        productId: last.info.productId ?? null,
        expiresAt: last.info.expiresDate ?? null,
      };
    }
  }
  return { active: false, productId: null, expiresAt: null };
}
