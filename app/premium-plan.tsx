import { deepLinkToSubscriptions, ErrorCode, useIAP } from 'expo-iap';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ICON } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import { describeFunctionError } from '@/lib/edge-functions';
import { syncPremiumIconAfterPurchase } from '@/lib/premium-icon';
import {
  openablePlan,
  personalPremiumPerks,
  personalPremiumPriceLabel,
  warnIfPremiumPriceDiffers,
  PERSONAL_PREMIUM_SKU,
  verifyPurchaseOnServer,
} from '@/lib/premium';
import { PREMIUM_FORMAT_PRICES, TEAM_PREMIUM_SKUS, verifyTeamPurchaseOnServer } from '@/lib/teams';
import { useMyTeams } from '@/lib/use-my-teams';
import { useRules } from '@/lib/use-rules';
import { useProfile } from '@/lib/use-profile';

type Plan = 'personal' | 'team-9-a-side' | 'team-11-a-side';

const PLAN_COPY: Record<Plan, { title: string; perks: string[] }> = {
  personal: {
    title: 'Personal Premium',
    // From spec 13's rules at render time: personalPremiumPerks (lib/premium.ts).
    perks: [],
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

/** Full-page activation popup for any of the three plans (item 11): one
 *  Card with the plan, the price (the App Store's live price for Personal,
 *  via personalPremiumPriceLabel), the perks in plain words and one primary
 *  button. No badges or decoration (U5, docs/specs/15-design.md). Personal is an auto-renewing subscription; both team plans are
 *  one-time non-consumable purchases — see PLAN_COPY/useIAP config below for
 *  where that split actually matters. */
export default function PremiumPlanScreen() {
  const { plan: rawPlan, teamId } = useLocalSearchParams<{ plan: Plan; teamId?: string }>();
  const plan: Plan = openablePlan(rawPlan === 'team-9-a-side' || rawPlan === 'team-11-a-side' ? rawPlan : 'personal');
  const format = plan === 'team-9-a-side' ? '9-a-side' : plan === 'team-11-a-side' ? '11-a-side' : null;

  const profile = useProfile();
  const myTeams = useMyTeams();
  const rulesState = useRules().state;
  const rules = rulesState.status === 'ready' ? rulesState.rules : null;
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
      // The Premium app icon, from the server's is_premium. Last, once the
      // purchase is finished: on Android switching the icon may end the app.
      if (plan === 'personal') void syncPremiumIconAfterPurchase();
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

  const livePrice = plan === 'personal' ? subscriptions.find((s) => s.id === sku)?.displayPrice ?? null : null;
  useEffect(() => {
    if (plan === 'personal') warnIfPremiumPriceDiffers(livePrice, rules?.premium_price_label);
  }, [plan, livePrice, rules?.premium_price_label]);

  const priceLabel =
    plan === 'personal'
      ? personalPremiumPriceLabel(rules, livePrice)
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

  const copy = plan === 'personal' ? { ...PLAN_COPY.personal, perks: personalPremiumPerks(rules) } : PLAN_COPY[plan];
  const missingTeam = format && !team;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Text variant="title" accessibilityRole="header">
            {copy.title}
          </Text>
          {priceLabel ? (
            <Text variant="headline" tabular testID="premium-price">
              {priceLabel}
            </Text>
          ) : null}

          <View style={styles.perks}>
            {copy.perks.map((perk) => (
              <View key={perk} style={styles.perkRow}>
                <IconSymbol name="checkmark.circle.fill" size={ICON.small} color={colors.inkMuted} />
                <Text variant="body" style={styles.flex}>
                  {perk}
                </Text>
              </View>
            ))}
          </View>

          {missingTeam ? (
            <Banner tone="info" message="You need to be a team’s captain to buy Team Premium for it." />
          ) : null}

          {error ? (
            <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          {!iosAvailable ? (
            <Text variant="callout" tone="inkMuted">
              Purchasing is available on iOS only for now.
            </Text>
          ) : isActive ? (
            <Button
              label={plan === 'personal' ? 'Manage or cancel subscription' : 'Request a refund'}
              variant="secondary"
              fullWidth
              onPress={manage}
            />
          ) : (
            <Button
              label={plan === 'personal' ? 'Subscribe' : 'Buy Team Premium'}
              fullWidth
              onPress={buy}
              loading={busy}
              disabled={!connected || !!missingTeam}
            />
          )}

          {iosAvailable && plan === 'personal' && !isActive ? (
            <View style={styles.center}>
              <Button
                label="Restore purchases"
                variant="plain"
                onPress={() => restorePurchases()}
                disabled={busy || !connected}
              />
            </View>
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.sm },
  content: { flexGrow: 1, justifyContent: 'center', padding: space.lg, paddingBottom: space.xxl },
  card: { gap: space.lg },
  perks: { gap: space.md },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  center: { alignItems: 'center' },
});
