// What one App Store Server Notification changes (P1). The payload is only
// a lookup key (its original transaction id): the subscription's real,
// current product and state are re-read from Apple's API before anything
// changes, as before. Renewals, upgrades, downgrades, expiries, refunds and
// revocations all land here and end in apply_premium_subscription, which
// sets the tier. Team Premium purchases are handled as before.
import { isPersonalPremiumProduct, type SubscriptionState } from '../_shared/premium.ts';
import { type ApplyArgs, toApplyArgs } from '../verify-purchase/handler.ts';

export type NotificationDeps = {
  /** A personal subscription on file for this original transaction. */
  findSubscription: (originalTransactionId: string) => Promise<{ profileId: string; productId: string } | null>;
  fetchSubscription: (originalTransactionId: string) => Promise<SubscriptionState | null>;
  apply: (args: ApplyArgs) => Promise<{ tier: string | null; error: string | null }>;
  /** Team Premium (non-consumable refunds), unchanged; true when it knew the transaction. */
  handleTeamPurchase: (originalTransactionId: string) => Promise<boolean>;
};

export async function handleNotification(
  deps: NotificationDeps,
  originalTransactionId: string | null,
): Promise<'ok' | 'ignored' | 'unknown transaction'> {
  if (!originalTransactionId) return 'ignored';

  const existing = await deps.findSubscription(originalTransactionId);
  if (!existing) return (await deps.handleTeamPurchase(originalTransactionId)) ? 'ok' : 'unknown transaction';

  const state = await deps.fetchSubscription(originalTransactionId);
  if (!state) return 'ok'; // recognised, but Apple can't answer now: leave it as it is

  const product = isPersonalPremiumProduct(state.productId) ? state.productId! : existing.productId;
  await deps.apply(toApplyArgs(existing.profileId, originalTransactionId, product, state));
  return 'ok';
}
