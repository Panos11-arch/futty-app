import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { DISABLED_OPACITY } from '@/components/ui/foundation';
import { FuttyLogo } from '@/components/ui/futty-logo';
import type { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { isPremiumPlayer, personalPremiumPriceLabel, TEAM_PREMIUM_ENABLED } from '@/lib/premium';
import { usePremiumStorePrice } from '@/lib/use-premium-store-price';
import { hasTeamPremium, PREMIUM_FORMAT_PRICES } from '@/lib/teams';
import { useMyTeams } from '@/lib/use-my-teams';
import { useRules } from '@/lib/use-rules';
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
  const styles = useStyles();
  const profile = useProfile();
  const myTeams = useMyTeams();
  // The Premium price label is a rule (P10); blank until the rules are loaded.
  const rulesState = useRules().state;
  const rules = rulesState.status === 'ready' ? rulesState.rules : null;
  // The store's live price once it loads, as on the plan sheet (F6).
  const storePrice = usePremiumStorePrice(rules?.premium_price_label);

  if (profile.status === 'loading' || myTeams.status === 'loading') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <Card testID="premium-skeleton">
            <SkeletonText lines={4} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  // Team Premium is per-team; a captain of more than one team manages the
  // rest from that team's own screen (Team tab) — this list only surfaces
  // the first, same simplification the Home screen's TeamPremiumBox makes.
  const myCaptainedTeam =
    myTeams.status === 'ready' ? myTeams.teams.find((t) => t.role === 'captain')?.team ?? null : null;

  const allRows: PlanRow[] = [
    {
      plan: 'personal',
      icon: 'star.fill',
      title: 'Personal Premium',
      priceLabel: personalPremiumPriceLabel(rules, storePrice),
      active: isPremiumPlayer(profile) === true,
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
  // Team Premium is off for the release (lib/premium.ts).
  const rows = allRows.filter((row) => row.plan === 'personal' || TEAM_PREMIUM_ENABLED);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.logo}>
          <FuttyLogo size={space.xxl * 2} />
        </View>
        <Card padded={false}>
          {rows.map((row, i) => {
            const status = (
              <Text variant="callout" tone={row.active ? 'success' : 'inkMuted'}>
                {row.active ? 'Active' : 'Off'}
              </Text>
            );
            return (
              <View key={row.plan} testID={`plan-${row.plan}`} style={row.disabledNote ? styles.disabled : undefined}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <ListRow
                  title={row.title}
                  accessibilityLabel={`${row.title}, ${row.disabledNote ?? row.priceLabel}, ${row.active ? 'Active' : 'Off'}`}
                  subtitle={row.disabledNote ?? row.priceLabel}
                  leading={{ icon: row.icon }}
                  trailing={status}
                  chevron={!row.disabledNote}
                  onPress={
                    row.disabledNote
                      ? undefined
                      : () =>
                          router.push({
                            pathname: '/premium-plan',
                            params: { plan: row.plan, teamId: myCaptainedTeam?.id ?? '' },
                          })
                  }
                />
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg },
  logo: { alignItems: 'center', paddingVertical: space.sm },
  disabled: { opacity: DISABLED_OPACITY },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
