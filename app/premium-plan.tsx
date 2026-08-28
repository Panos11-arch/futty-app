import { deepLinkToSubscriptions, ErrorCode, useIAP } from 'expo-iap';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { describeFunctionError } from '@/lib/edge-functions';
import { PERSONAL_PREMIUM_PRICE_LABEL, PERSONAL_PREMIUM_SKU, verifyPurchaseOnServer } from '@/lib/premium';
import { PREMIUM_FORMAT_PRICES, TEAM_PREMIUM_SKUS, verifyTeamPurchaseOnServer } from '@/lib/teams';
import { useMyTeams } from '@/lib/use-my-teams';
import { useProfile } from '@/lib/use-profile';

type Plan = 'personal' | 'team-9-a-side' | 'team-11-a-side';

const PLAN_COPY: Record<Plan, { title: string; perks: string[] }> = {
  personal: {
    title: 'Personal Premium',
    perks: [
      'Book up to 21 days ahead, not just 2',
      'Verified badge on your profile',
      'No booking fees (coming soon)',
      'Priority evening slots (coming soon)',
    ],
  },
  'team-9-a-side': {
    title: 'Team Premium — 9-a-side',
    perks: [
      'Unlocks 9-a-side league registration for your team',
      'One-time purchase — covers the whole season',
      'Applies to every player on the roster',
    ],
  },
  'team-11-a-side': {
    title: 'Team Premium — 11-a-side',
    perks: [
      'Unlocks 11-a-side league registration for your team',
      'One-time purchase — covers the whole season',
      'Applies to every player on the roster',
    ],
  },
};

/** Full-page activation popup for any of the three plans (item 11) — replaces
 *  the old inline app/premium.tsx layout with a single Playtomic-style
 *  screen: dark background, plan/price prominent, bullets, one subscribe
 *  button. Personal is an auto-renewing subscription; both team plans are
 *  one-time non-consumable purchases — see PLAN_COPY/useIAP config below for
 *  where that split actually matters. */
export default function PremiumPlanScreen() {
  const { plan: rawPlan, teamId } = useLocalSearchParams<{ plan: Plan; teamId?: string }>();
  const plan: Plan = rawPlan === 'team-9-a-side' || rawPlan === 'team-11-a-side' ? rawPlan : 'personal';
  const format = plan === 'team-9-a-side' ? '9-a-side' : plan === 'team-11-a-side' ? '11-a-side' : null;

  const profile = useProfile();
  const myTeams = useMyTeams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const team = format && teamId ? myTeams.status === 'ready' ? myTeams.teams.find((t) => t.team.id === teamId)?.team ?? null : null : null;

  const sku = plan === 'personal' ? PERSONAL_PREMIUM_SKU : format ? TEAM_PREMIUM_SKUS[format] : null;

  const { connected, subscriptions, fetchProducts, requestPurchase, finishTransaction, restorePurchases } = useIAP({
    onError: (connectionError) => setError(`Connection error: ${connectionError.message}`),
    onPurchaseSuccess: async (purchase) => {
      if (purchase.productId !== sku || !purchase.transactionId) return;

      setBusy(true);
      setError(null);

      if (plan !== 'personal' && !team) {
        setBusy(false);
        setError('No team to apply this purchase to — the transaction was not verified.');
        return;
      }

      const result =
        plan === 'personal'
          ? await verifyPurchaseOnServer(purchase.transactionId, purchase.productId)
          : await verifyTeamPurchaseOnServer(purchase.transactionId, purchase.productId, team!.id);

      if (result.error || !result.data?.active) {
        // Left unfinished on purpose, same reasoning as the old
        // app/premium.tsx: StoreKit replays an unfinished transaction on the
        // next launch, so a transient verify failure gets a free retry
        // instead of silently losing the purchase.
        setBusy(false);
        setError(result.error ? await describeFunctionError(result.error) : 'Apple could not verify this purchase.');
        return;
      }

      await finishTransaction({ purchase, isConsumable: false });
      setBusy(false);
      profile.reload();
      myTeams.reload();
      router.back();
    },
    onPurchaseError: (purchaseError) => {
      setBusy(false);
      if (purchaseError.code === ErrorCode.UserCancelled) return;
      setError(purchaseError.message);
    },
  });

  useEffect(() => {
    if (connected && sku) fetchProducts({ skus: [sku], type: plan === 'personal' ? 'subs' : 'in-app' });
  }, [connected, sku, plan, fetchProducts]);

  const iosAvailable = Platform.OS === 'ios';
  const isActive =
    plan === 'personal' ? profile.status === 'ready' && profile.profile.is_premium : !!team && (format === '9-a-side' ? team.premium_9aside : team.premium_11aside);

  const priceLabel =
    plan === 'personal'
      ? `${subscriptions.find((s) => s.id === sku)?.displayPrice ?? PERSONAL_PREMIUM_PRICE_LABEL}/mo`
      : format
        ? `€${PREMIUM_FORMAT_PRICES[format]}/season`
        : '';

  async function buy() {
    if (!sku) return;
    setBusy(true);
    setError(null);
    try {
      await requestPurchase({
        request: { apple: { sku } },
        type: plan === 'personal' ? 'subs' : 'in-app',
      });
      // Outcome arrives via onPurchaseSuccess/onPurchaseError above.
    } catch (requestError) {
      setBusy(false);
      setError(requestError instanceof Error ? requestError.message : 'Could not start purchase.');
    }
  }

  async function manage() {
    if (plan === 'personal') {
      try {
        await deepLinkToSubscriptions();
      } catch {
        setError('Could not open subscription settings — manage it from Settings > Apple ID > Subscriptions.');
      }
    } else {
      await Linking.openURL('https://reportaproblem.apple.com/');
    }
  }

  const copy = PLAN_COPY[plan];
  const missingTeam = format && !team;

  return (
    <View style={styles.screen}>
      {/* Dark backdrop stands in for a real hero photo — this app has no
          image-asset pipeline for premium marketing art yet; swap
          styles.backdrop's backgroundColor for an ImageBackground once one
          exists. */}
      <View style={styles.backdrop} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => router.back()}
        hitSlop={10}
        style={styles.closeButton}>
        <IconSymbol name="xmark" size={20} color={FuttyColors.white} />
      </Pressable>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.badge}>
          <IconSymbol name="crown.fill" size={14} color={FuttyColors.amber400} />
          <ThemedText style={styles.badgeText}>FUTTY PREMIUM</ThemedText>
        </View>

        <ThemedText style={styles.title}>{copy.title}</ThemedText>
        {priceLabel ? <ThemedText style={styles.price}>{priceLabel}</ThemedText> : null}

        <View style={styles.perks}>
          {copy.perks.map((perk) => (
            <View key={perk} style={styles.perkRow}>
              <IconSymbol name="checkmark.circle.fill" size={16} color={FuttyColors.emerald600} />
              <ThemedText style={styles.perkText}>{perk}</ThemedText>
            </View>
          ))}
        </View>

        {missingTeam ? (
          <IconLabel icon="info.circle.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            You need to be a team&apos;s captain to buy Team Premium for it.
          </IconLabel>
        ) : null}

        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

        {!iosAvailable ? (
          <IconLabel icon="wrench.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            Purchasing is available on iOS only for now.
          </IconLabel>
        ) : isActive ? (
          <Pressable accessibilityRole="button" onPress={manage} style={styles.secondaryButton}>
            <ThemedText style={styles.secondaryButtonText}>
              {plan === 'personal' ? 'Manage or cancel subscription' : 'Request a refund'}
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={buy}
            disabled={busy || !connected || !!missingTeam}
            style={[styles.subscribeButton, (busy || !connected || missingTeam) && styles.subscribeButtonDisabled]}>
            {busy ? (
              <ActivityIndicator color={FuttyColors.emerald950} />
            ) : (
              <ThemedText style={styles.subscribeButtonText}>
                {plan === 'personal' ? 'Subscribe' : 'Buy Team Premium'}
              </ThemedText>
            )}
          </Pressable>
        )}

        {iosAvailable && plan === 'personal' && !isActive ? (
          <Pressable accessibilityRole="button" onPress={() => restorePurchases()} disabled={busy || !connected}>
            <ThemedText style={styles.restoreText}>Restore purchases</ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: FuttyColors.emerald950,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: FuttyColors.emerald950,
  },
  closeButton: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 120,
    paddingBottom: 48,
    gap: 14,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: FuttyColors.amber400,
  },
  title: {
    fontFamily: FuttyFonts.display,
    fontSize: 30,
    color: FuttyColors.white,
    marginTop: 4,
  },
  price: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 18,
    color: FuttyColors.emerald200,
  },
  perks: {
    gap: 10,
    marginTop: 10,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  perkText: {
    flex: 1,
    fontFamily: FuttyFonts.sans,
    fontSize: 14,
    color: FuttyColors.white,
  },
  note: {
    fontSize: 12,
    color: FuttyColors.emerald200,
  },
  error: {
    fontSize: 13,
    color: '#fca5a5',
  },
  subscribeButton: {
    marginTop: 12,
    backgroundColor: FuttyColors.white,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  subscribeButtonDisabled: {
    opacity: 0.5,
  },
  subscribeButtonText: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 16,
    color: FuttyColors.emerald950,
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 14,
    color: FuttyColors.white,
  },
  restoreText: {
    marginTop: 8,
    textAlign: 'center',
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 13,
    color: FuttyColors.emerald200,
  },
});
