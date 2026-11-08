import { supabase } from '@/lib/supabase';

/** How many days ahead a standard account can book. Premium unlocks the full
 *  21-day picker (lib/days.ts's DAY_PICKER_LENGTH). */
export const STANDARD_ADVANCE_DAYS = 2;

export function isDayLocked(dayIndex: number, isPremium: boolean) {
  return dayIndex >= STANDARD_ADVANCE_DAYS && !isPremium;
}

// Must match the auto-renewable subscription's Product ID created in App
// Store Connect (Features > Subscriptions — NOT the In-App Purchases
// section, that's for consumables/non-consumables only). premium_monthly
// (no suffix) was accidentally created as a Non-Consumable and is
// permanently stuck that way — premium_monthly_v2 is the real subscription.
export const PERSONAL_PREMIUM_SKU = 'premium_monthly_v2';

// Static fallback shown before the real App Store/Play price has loaded (or
// on screens like the Go Premium list that don't open a StoreKit connection
// just to show a price) — app/premium-plan.tsx still prefers the live price
// from useIAP once it's mounted.
export const PERSONAL_PREMIUM_PRICE_LABEL = '€4.99';

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
