import { deepLinkToSubscriptions, ErrorCode, useIAP } from 'expo-iap';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ICON } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { PlansView } from '@/components/premium/plans-view';
import { space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';
import { describeFunctionError } from '@/lib/edge-functions';
import { syncPremiumIconAfterPurchase } from '@/lib/premium-icon';
import {
  openablePlan,
  PERSONAL_PREMIUM_SKU,
  PERSONAL_PREMIUM_SKUS,
  premiumPlans,
  premiumTier,
  verifyPurchaseOnServer,
  warnIfPremiumPriceDiffers,
} from '@/lib/premium';
import { PREMIUM_FORMAT_PRICES, TEAM_PREMIUM_SKUS, verifyTeamPurchaseOnServer } from '@/lib/teams';
import { useMyTeams } from '@/lib/use-my-teams';
import { useRules } from '@/lib/use-rules';
import { useProfile } from '@/lib/use-profile';

type Plan = 'personal' | 'team-9-a-side' | 'team-11-a-side';
type TeamPlan = Exclude<Plan, 'personal'>;

const PLAN_COPY: Record<TeamPlan, { title: string; perks: string[] }> = {
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

/** The Premium screen. Personal Premium (P1): Basic, Premium and Premium
 *  Plus (image 22; PersonalPlans below). Team Premium, off for the
 *  release (lib/premium.ts), keeps its one-card page (item 11). */
export default function PremiumPlanScreen() {
  const { plan: rawPlan, teamId } = useLocalSearchParams<{ plan: Plan; teamId?: string }>();
  const plan: Plan = openablePlan(rawPlan === 'team-9-a-side' || rawPlan === 'team-11-a-side' ? rawPlan : 'personal');
  return plan === 'personal' ? <PersonalPlans /> : <TeamPlanScreen plan={plan} teamId={teamId} />;
}

/** Premium and Premium Plus: one subscription group, so buying the higher
 *  plan upgrades at once and a lower one (from the store's settings) takes
 *  effect at the next renewal. The server sets the tier only after Apple
 *  confirms (verify-purchase); the app never decides it. */
function PersonalPlans() {
  const profile = useProfile();
  const rulesState = useRules().state;
  const rules = rulesState.status === 'ready' ? rulesState.rules : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { connected, subscriptions, fetchProducts, requestPurchase, finishTransaction, restorePurchases } = useIAP({
    onError: (connectionError) => setError(`Connection error: ${connectionError.message}`),
    onPurchaseSuccess: async (purchase) => {
      if (!PERSONAL_PREMIUM_SKUS.includes(purchase.productId) || !purchase.transactionId) return;
      setBusy(true);
      setError(null);
      const result = await verifyPurchaseOnServer(purchase.transactionId, purchase.productId);
      if (result.error || !result.data?.active) {
        // Left unfinished on purpose: StoreKit replays an unfinished
        // transaction on the next launch, so a transient verify failure
        // gets a free retry instead of silently losing the purchase.
        setBusy(false);
        setError(result.error ? await describeFunctionError(result.error) : 'Apple could not verify this purchase.');
        return;
      }
      await finishTransaction({ purchase, isConsumable: false });
      setBusy(false);
      profile.reload();
      router.back();
      // The Premium app icon, from the server's is_premium (both paid
      // plans). Last, once the purchase is finished: on Android switching
      // the icon may end the app.
      void syncPremiumIconAfterPurchase();
    },
    onPurchaseError: (purchaseError) => {
      setBusy(false);
      if (purchaseError.code === ErrorCode.UserCancelled) return;
      setError(purchaseError.message);
    },
  });

  useEffect(() => {
    if (connected) fetchProducts({ skus: PERSONAL_PREMIUM_SKUS, type: 'subs' });
  }, [connected, fetchProducts]);

  // The store's live prices (F6): a plan the store didn't return has none.
  const prices: Record<string, string | null> = Object.fromEntries(subscriptions.map((s) => [s.id, s.displayPrice ?? null]));
  const livePremium = prices[PERSONAL_PREMIUM_SKU] ?? null;
  useEffect(() => {
    warnIfPremiumPriceDiffers(livePremium, rules?.premium_price_label);
  }, [livePremium, rules?.premium_price_label]);

  const tier = premiumTier(profile);

  async function upgrade(sku: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestPurchase({ request: { apple: { sku } }, type: 'subs' });
      // Outcome arrives via onPurchaseSuccess/onPurchaseError above.
    } catch (requestError) {
      setBusy(false);
      setError(requestError instanceof Error ? requestError.message : 'Could not start purchase.');
    }
  }

  async function manage() {
    try {
      await deepLinkToSubscriptions();
    } catch {
      setError('Could not open subscriptions. Use Settings > Apple ID > Subscriptions.');
    }
  }

  return (
    <PlansView
      plans={premiumPlans({ rules, prices, tier })}
      tier={tier}
      busy={busy}
      error={error}
      purchasable={Platform.OS === 'ios'}
      connected={connected}
      onUpgrade={upgrade}
      onManage={manage}
      onRestore={() => restorePurchases()}
      onClose={() => router.back()}
    />
  );
}

/** Team Premium for one team: one Card with the plan, the price, the perks
 *  in plain words and one primary button (item 11; U5). A one-time
 *  non-consumable purchase. */
function TeamPlanScreen({ plan, teamId }: { plan: TeamPlan; teamId?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const format = plan === 'team-9-a-side' ? '9-a-side' : '11-a-side';

  const myTeams = useMyTeams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const team = teamId ? myTeams.status === 'ready' ? myTeams.teams.find((t) => t.team.id === teamId)?.team ?? null : null : null;

  const sku = TEAM_PREMIUM_SKUS[format];

  const { connected, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    onError: (connectionError) => setError(`Connection error: ${connectionError.message}`),
    onPurchaseSuccess: async (purchase) => {
      if (purchase.productId !== sku || !purchase.transactionId) return;

      setBusy(true);
      setError(null);

      if (!team) {
        setBusy(false);
        setError('No team to apply this purchase to — the transaction was not verified.');
        return;
      }

      const result = await verifyTeamPurchaseOnServer(purchase.transactionId, purchase.productId, team.id);

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
    if (connected) fetchProducts({ skus: [sku], type: 'in-app' });
  }, [connected, sku, fetchProducts]);

  const iosAvailable = Platform.OS === 'ios';
  const isActive = !!team && (format === '9-a-side' ? team.premium_9aside : team.premium_11aside);
  const priceLabel = `€${PREMIUM_FORMAT_PRICES[format]}/season`;

  async function buy() {
    setBusy(true);
    setError(null);
    try {
      await requestPurchase({
        request: { apple: { sku } },
        type: 'in-app',
      });
      // Outcome arrives via onPurchaseSuccess/onPurchaseError above.
    } catch (requestError) {
      setBusy(false);
      setError(requestError instanceof Error ? requestError.message : 'Could not start purchase.');
    }
  }

  async function manage() {
    await Linking.openURL('https://reportaproblem.apple.com/');
  }

  const copy = PLAN_COPY[plan];
  const missingTeam = !team;

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
            <Button label="Request a refund" variant="secondary" fullWidth onPress={manage} />
          ) : (
            <Button label="Buy Team Premium" fullWidth onPress={buy} loading={busy} disabled={!connected || missingTeam} />
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.sm },
  content: { flexGrow: 1, justifyContent: 'center', padding: space.lg, paddingBottom: space.xxl },
  card: { gap: space.lg },
  perks: { gap: space.md },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  center: { alignItems: 'center' },
}));
