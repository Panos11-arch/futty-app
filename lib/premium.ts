import { type AppRules, daysText, eurosText } from '@/lib/rules';
import { supabase } from '@/lib/supabase';

// Premium's booking window, price and service fee are spec 13's rules
// (public.app_rules, P10): read them through lib/rules.ts, never copy them
// here. book_slot enforces the windows; Premium comes only from
// profiles.is_premium.

// Must match the auto-renewable subscription's Product ID created in App
// Store Connect (Features > Subscriptions — NOT the In-App Purchases
// section, that's for consumables/non-consumables only). premium_monthly
// (no suffix) was accidentally created as a Non-Consumable and is
// permanently stuck that way — premium_monthly_v2 is the real subscription.
export const PERSONAL_PREMIUM_SKU = 'premium_monthly_v2';

/** "€3.99/mo": the store's live price once it has loaded, otherwise the
 *  label in the rules; empty (a placeholder) when neither is there yet. */
export function personalPremiumPriceLabel(rules: AppRules | null, livePrice?: string | null): string {
  const price = livePrice ?? rules?.premium_price_label;
  return price ? `${price}/mo` : '';
}

/** What Personal Premium gives, from the rules: the booking window and the
 *  service fee on the player's own spot (spec 13). Without rules yet, only
 *  the perks that have no number. */
export function personalPremiumPerks(rules: AppRules | null): string[] {
  const fromRules = rules
    ? [
        `Book up to ${daysText(rules.window_premium_days)} ahead, not just ${rules.window_standard_days}`,
        rules.fee_premium_cents === 0
          ? 'No service fee on your own spot'
          : `A ${eurosText(rules.fee_premium_cents)} service fee on your own spot, not ${eurosText(rules.fee_each_pays_cents)}`,
      ]
    : [];
  return [...fromRules, 'Verified badge on your profile', 'Priority evening slots (coming soon)'];
}

// There is deliberately no client-side setPremium() here anymore.
// profiles.is_premium is now locked down (supabase/legacy/premium-payments.sql
// revokes client UPDATE access to that column) and can only be set by the
// verify-purchase / apple-server-notifications Edge Functions after
// confirming a real purchase directly with Apple — this just calls that
// function. supabase.functions.invoke attaches the caller's session token
// automatically, which is what verify-purchase uses to identify who to grant
// Premium to (see supabase/functions/verify-purchase/index.ts).
export async function verifyPurchaseOnServer(transactionId: string, productId: string) {
  return supabase.functions.invoke<{ active: boolean }>('verify-purchase', {
    body: { transactionId, productId },
  });
}
