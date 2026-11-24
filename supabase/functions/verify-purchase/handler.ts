// Personal Premium, after the app reports a purchase (P1: Premium and
// Premium Plus). Nothing the app says is trusted: the transaction is read
// from Apple, then the subscription's CURRENT product and state from
// Apple's subscription-status API (after an upgrade or downgrade it is on
// another product with the same original transaction), and only then does
// the database set the tier (apply_premium_subscription, service role).
// The caller is always the signed-in player, never an id from the body.
import { isPersonalPremiumProduct, type SubscriptionState } from '../_shared/premium.ts';

export type ApplyArgs = {
  profileId: string;
  productId: string;
  originalTransactionId: string;
  active: boolean;
  expiresAt: string | null;
};

export type AppleTransactionInfo = { transactionId: string; originalTransactionId: string; bundleId: string; productId: string };

export type VerifyPurchaseDeps = {
  bundleId: string;
  fetchTransaction: (transactionId: string) => Promise<AppleTransactionInfo | null>;
  fetchSubscription: (originalTransactionId: string) => Promise<SubscriptionState | null>;
  /** apply_premium_subscription: the tier, or the database's refusal. */
  apply: (args: ApplyArgs) => Promise<{ tier: string | null; error: string | null }>;
};

export type HandlerResult = { status: number; body: Record<string, unknown> };

export function toApplyArgs(profileId: string, originalTransactionId: string, productId: string, state: SubscriptionState): ApplyArgs {
  return {
    profileId,
    productId,
    originalTransactionId,
    active: state.active,
    expiresAt: state.expiresAt ? new Date(state.expiresAt).toISOString() : null,
  };
}

export async function verifyPurchase(
  deps: VerifyPurchaseDeps,
  profileId: string,
  body: { transactionId?: unknown; productId?: unknown },
): Promise<HandlerResult> {
  const transactionId = typeof body.transactionId === 'string' ? body.transactionId : null;
  const productId = typeof body.productId === 'string' ? body.productId : null;
  if (!transactionId || !productId) return { status: 400, body: { error: 'Missing transactionId/productId' } };
  if (!isPersonalPremiumProduct(productId)) return { status: 400, body: { error: 'Not a Premium plan' } };

  const transaction = await deps.fetchTransaction(transactionId);
  if (!transaction) return { status: 402, body: { error: 'Apple could not verify this transaction' } };
  if (transaction.bundleId !== deps.bundleId || transaction.productId !== productId) {
    return { status: 400, body: { error: 'Transaction does not match this app/product' } };
  }

  const state = await deps.fetchSubscription(transaction.originalTransactionId);
  // Apple can take a few seconds to index a new purchase: report inactive
  // and write nothing; the app leaves the transaction unfinished and retries.
  if (!state) return { status: 200, body: { active: false, tier: null } };

  // The product the subscription is on now (a downgrade waits for the
  // renewal, so it can still be Plus); the one bought if Apple has none.
  const current = isPersonalPremiumProduct(state.productId) ? state.productId! : productId;
  const { tier, error } = await deps.apply(toApplyArgs(profileId, transaction.originalTransactionId, current, state));
  if (error) {
    return error.includes('subscription_belongs_to_another_player')
      ? { status: 409, body: { error: 'This subscription belongs to another Futty account' } }
      : { status: 502, body: { error: 'Could not save the subscription' } };
  }
  return { status: 200, body: { active: state.active, tier } };
}
