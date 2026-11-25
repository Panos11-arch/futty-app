// The Premium screen's plans (P1; image 22-premium-plans): Basic, Premium
// and Premium Plus, labels only, the current plan marked, and one button for
// the plan picked: Upgrade (buy a higher plan) or Manage (the store's
// subscription settings, for the current or a lower plan). Restore purchases
// at the top. Prices are the store's own (F6); the plans come from
// premiumPlans (lib/premium.ts), which leaves Premium Plus out until the
// store returns it.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, IconButton, IconSymbol, SkeletonBlock, Text } from '@/components/ui';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { hairline, radius, space } from '@/constants/futty-theme';
import { defaultPlan, planAction, type PremiumPlanCard, type PremiumTier } from '@/lib/premium';
import { makeStyles, useTheme } from '@/lib/theme';

export type PlansViewProps = {
  plans: PremiumPlanCard[];
  /** The player's plan from the server; null while it loads. */
  tier: PremiumTier | null;
  busy: boolean;
  error: string | null;
  /** Purchases work on iOS only (no Google Play billing yet). */
  purchasable: boolean;
  /** The store is connected. */
  connected: boolean;
  onUpgrade: (sku: string) => void;
  onManage: () => void;
  onRestore: () => void;
  onClose: () => void;
};

export function PlansView(props: PlansViewProps) {
  const styles = useStyles();
  const { plans, tier } = props;
  const [picked, setPicked] = useState<PremiumTier | null>(null);
  // Picked again when the player's plan or the store's plans change.
  useEffect(() => setPicked(null), [tier, plans.length]);

  const selected = tier ? (picked ?? defaultPlan(plans, tier)) : null;
  const plan = plans.find((p) => p.id === selected) ?? null;
  const action = tier && selected ? planAction(selected, tier) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="xmark" accessibilityLabel="Close" onPress={props.onClose} />
        {props.purchasable ? (
          <Pressable
            testID="premium-restore"
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
            accessibilityState={{ disabled: props.busy || !props.connected }}
            disabled={props.busy || !props.connected}
            onPress={props.onRestore}
            style={styles.restore}>
            <Text variant="callout" tone="onNightMuted">
              Restore purchases
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="display" tone="onNight" accessibilityRole="header">
          Choose your plan
        </Text>
        {tier === null ? (
          <View testID="premium-plans-loading" style={styles.cards}>
            {plans.map((p) => (
              <SkeletonBlock key={p.id} width="100%" height={MIN_TOUCH * 3} />
            ))}
          </View>
        ) : (
          <View style={styles.cards}>
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} selected={p.id === selected} onPress={() => setPicked(p.id)} />
            ))}
          </View>
        )}
        {props.error ? (
          <Text variant="callout" tone="onNight" accessibilityLiveRegion="polite">
            {props.error}
          </Text>
        ) : null}
        {!props.purchasable ? (
          <Text variant="callout" tone="onNightMuted">
            Purchasing is available on iOS only for now.
          </Text>
        ) : null}
      </ScrollView>

      {props.purchasable && action && plan ? (
        <View style={styles.footer}>
          <Button
            testID="premium-action"
            label={action === 'upgrade' ? 'Upgrade' : 'Manage'}
            fullWidth
            loading={props.busy && action === 'upgrade'}
            disabled={action === 'upgrade' && (!props.connected || props.busy)}
            onPress={() => {
              if (action === 'manage') props.onManage();
              else if (plan.sku && props.connected && !props.busy) props.onUpgrade(plan.sku);
            }}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function PlanCard({ plan, selected, onPress }: { plan: PremiumPlanCard; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={`premium-plan-${plan.id}`}
      accessibilityRole="radio"
      accessibilityLabel={[plan.title, plan.price, plan.current ? 'Current' : null].filter(Boolean).join(', ')}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={[styles.card, selected && styles.cardSelected]}>
      <View style={styles.titleRow}>
        <View style={styles.title}>
          <Text variant="title" tone="onNight">
            {plan.title}
          </Text>
          {plan.current ? (
            <View style={styles.tag}>
              <Text variant="caption" tone="greenInk">
                Current
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="headline" tone="onNight" tabular testID={plan.id === 'premium' ? 'premium-price' : undefined}>
          {plan.price}
        </Text>
      </View>
      {plan.perks.map((perk) => (
        <View key={perk} style={styles.perk}>
          {/* Green on night only, never on white (S1). */}
          <IconSymbol name="checkmark" size={ICON.small} color={colors.green} />
          <Text variant="body" tone="onNight" style={styles.flex}>
            {perk}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.night },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.sm,
  },
  restore: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: space.md },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  cards: { gap: space.md },
  card: {
    padding: space.lg,
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.onNightMuted,
  },
  cardSelected: { borderWidth: 2, borderColor: colors.green, backgroundColor: colors.greenSoft },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  tag: { paddingHorizontal: space.sm, paddingVertical: space.xs / 2, borderRadius: radius.pill, backgroundColor: colors.green },
  perk: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.lg },
}));
