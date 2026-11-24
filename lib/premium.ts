import { type AppRules, daysText, eurosText } from '@/lib/rules';
import { supabase } from '@/lib/supabase';
import { isPremiumFormat } from '@/lib/teams';

/** Team Premium is switched off for the first App Store release (P7,
 *  decided 17 November): nothing offers it, and the leagues that need it
 *  (9-a-side, 11-a-side) say they're coming soon instead of selling it. A
 *  team that already has it keeps its league place. The server's checks
 *  (verify-team-purchase, league registration) are unchanged. */
export const TEAM_PREMIUM_ENABLED = false;

/** Whether a team can register for a league of this format in the app. */
export function leagueFormatOpen(format: string, teamPremiumEnabled: boolean = TEAM_PREMIUM_ENABLED): boolean {
  return teamPremiumEnabled || !isPremiumFormat(format);
}

/** The plan a /premium-plan link may open: a Team Premium link opens
 *  Personal Premium while Team Premium is off. */
export function openablePlan<P extends string>(plan: P, teamPremiumEnabled: boolean = TEAM_PREMIUM_ENABLED): P | 'personal' {
  return !teamPremiumEnabled && plan.startsWith('team-') ? 'personal' : plan;
}

type ProfileState = { status: string; profile?: { is_premium?: boolean | null } };

/**
 * Whether the signed-in player is on Premium, from the server's
 * profiles.is_premium (read through useProfile()): null until it has loaded.
 * The Card button, the Futty logo and the Premium screen all ask here, so a
 * new plan (Premium Plus) changes one function. Team Premium belongs to a
 * team, not the player, and doesn't count.
 */
export function isPremiumPlayer(state: ProfileState): boolean | null {
  if (state.status !== 'ready') return null;
  return state.profile?.is_premium === true;
}

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

/** "€4.99/mo": the store's live price once it has loaded, otherwise the
 *  label in the rules; empty (a placeholder) when neither is there yet. */
export function personalPremiumPriceLabel(rules: AppRules | null, livePrice?: string | null): string {
  const price = livePrice ?? rules?.premium_price_label;
  return price ? `${price}/mo` : '';
}

/** Whether the store's live price and the rules' label are different
 *  amounts. Only the digits are compared, so "4,99 €" and "€4.99" match. */
export function premiumPriceMismatch(livePrice: string | null | undefined, rulesLabel: string | null | undefined): boolean {
  if (!livePrice || !rulesLabel) return false;
  const digits = (price: string) => price.replace(/\D/g, '');
  return digits(livePrice) !== digits(rulesLabel);
}

/** In development builds only: a console warning when App Store Connect's
 *  price and app_rules.premium_price_label disagree (they did: €3.99 vs
 *  5,99 €), so the founders fix one of them. Players always see the store's
 *  price once it loads (personalPremiumPriceLabel). */
export function warnIfPremiumPriceDiffers(
  livePrice: string | null | undefined,
  rulesLabel: string | null | undefined,
  isDev: boolean = __DEV__
): void {
  if (isDev && premiumPriceMismatch(livePrice, rulesLabel)) {
    console.warn(
      `Personal Premium: the store's price (${livePrice}) differs from app_rules.premium_price_label (${rulesLabel}). Fix App Store Connect or the rule.`
    );
  }
}

/** What Personal Premium gives, from the rules: the booking window and the
 *  service fee on the player's own spot (spec 13), and nothing else. Without
 *  rules yet, none: both perks carry a number from the rules. */
export function personalPremiumPerks(rules: AppRules | null): string[] {
  // Only perks that exist: nothing "coming soon" is sold with the subscription (App Review 3.1.2, 2.3.1).
  return rules
    ? [
        `Book up to ${daysText(rules.window_premium_days)} ahead, not just ${rules.window_standard_days}`,
        rules.fee_premium_cents === 0
          ? 'No service fee on your own spot'
          : `A ${eurosText(rules.fee_premium_cents)} service fee on your own spot, not ${eurosText(rules.fee_each_pays_cents)}`,
      ]
    : [];
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
