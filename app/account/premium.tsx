import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { PERSONAL_PREMIUM_PRICE_LABEL } from '@/lib/premium';
import { hasTeamPremium, PREMIUM_FORMAT_PRICES } from '@/lib/teams';
import { useMyTeams } from '@/lib/use-my-teams';
import { useProfile } from '@/lib/use-profile';

type PlanRow = {
  plan: 'personal' | 'team-9-a-side' | 'team-11-a-side';
  icon: React.ComponentProps<typeof IconSymbol>['name'];
  title: string;
  priceLabel: string;
  active: boolean;
  disabledNote?: string;
};

/** Every premium option in one place, each showing its current status —
 *  tapping any row opens the full activation page (app/premium-plan.tsx,
 *  item 11) rather than doing anything inline here. */
export default function GoPremiumScreen() {
  const profile = useProfile();
  const myTeams = useMyTeams();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  if (profile.status === 'loading' || myTeams.status === 'loading') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  // Team Premium is per-team; a captain of more than one team manages the
  // rest from that team's own screen (Team tab) — this list only surfaces
  // the first, same simplification the Home screen's TeamPremiumBox makes.
  const myCaptainedTeam =
    myTeams.status === 'ready' ? myTeams.teams.find((t) => t.role === 'captain')?.team ?? null : null;

  const rows: PlanRow[] = [
    {
      plan: 'personal',
      icon: 'star.fill',
      title: 'Personal Premium',
      priceLabel: `${PERSONAL_PREMIUM_PRICE_LABEL}/mo`,
      active: profile.status === 'ready' && profile.profile.is_premium,
    },
    {
      plan: 'team-9-a-side',
      icon: 'shield.fill',
      title: 'Team Premium — 9-a-side',
      priceLabel: `€${PREMIUM_FORMAT_PRICES['9-a-side']}/season`,
      active: !!myCaptainedTeam && hasTeamPremium(myCaptainedTeam, '9-a-side'),
      disabledNote: myCaptainedTeam ? undefined : 'Captain a team to unlock',
    },
    {
      plan: 'team-11-a-side',
      icon: 'shield.fill',
      title: 'Team Premium — 11-a-side',
      priceLabel: `€${PREMIUM_FORMAT_PRICES['11-a-side']}/season`,
      active: !!myCaptainedTeam && hasTeamPremium(myCaptainedTeam, '11-a-side'),
      disabledNote: myCaptainedTeam ? undefined : 'Captain a team to unlock',
    },
  ];

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {rows.map((row) => (
          <Pressable
            key={row.plan}
            accessibilityRole="button"
            disabled={!!row.disabledNote}
            onPress={() =>
              router.push({
                pathname: '/premium-plan',
                params: { plan: row.plan, teamId: myCaptainedTeam?.id ?? '' },
              })
            }>
            <ThemedView style={[styles.card, { borderColor: border }, row.disabledNote && styles.cardDisabled]}>
              <View style={[styles.iconCircle, row.active && styles.iconCircleActive]}>
                <IconSymbol name={row.icon} size={18} color={row.active ? FuttyColors.white : FuttyColors.stone500} />
              </View>
              <View style={styles.textBlock}>
                <ThemedText type="defaultSemiBold" style={styles.title}>
                  {row.title}
                </ThemedText>
                <ThemedText style={styles.price}>{row.disabledNote ?? row.priceLabel}</ThemedText>
              </View>
              <View style={[styles.statusPill, row.active ? styles.statusPillActive : styles.statusPillInactive]}>
                <ThemedText style={[styles.statusText, row.active && styles.statusTextActive]}>
                  {row.active ? 'Active' : 'Off'}
                </ThemedText>
              </View>
            </ThemedView>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: 10,
    padding: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: FuttyColors.stone50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleActive: {
    backgroundColor: FuttyColors.emerald950,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
  },
  price: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillActive: {
    backgroundColor: FuttyColors.emerald950,
  },
  statusPillInactive: {
    backgroundColor: FuttyColors.stone200,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: FuttyColors.stone500,
  },
  statusTextActive: {
    color: FuttyColors.white,
  },
});
