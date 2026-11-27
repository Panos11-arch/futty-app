// The competition page's night header (image 13; SofaScore 07): back, the
// pin star (S9's competition_pins row, the same one the Leagues screen
// pins), the badge, name and "area · format", the season ▾ when there is
// more than one season, and the scrollable tabs. No bell, no followers and
// no Share (decided by Panos, 26 November; Share waits for a futty.app
// league page).
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompetitionBadge } from '@/components/match/night-header';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

export type CompetitionTab = 'overview' | 'matches' | 'standings' | 'player-stats' | 'knockout' | 'stats' | 'power';

export type CompetitionTabOption = { value: CompetitionTab; label: string; premium?: boolean };

/** A league's tabs. */
export const COMPETITION_TABS: CompetitionTabOption[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'matches', label: 'Matches' },
  { value: 'standings', label: 'Standings' },
  { value: 'player-stats', label: 'Player stats', premium: true },
  { value: 'stats', label: 'Stats' },
  { value: 'power', label: 'Power rankings' },
];

/** S10A: a tournament's tabs (image 13): Knockout after Player stats. */
export const TOURNAMENT_TABS: CompetitionTabOption[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'matches', label: 'Matches' },
  { value: 'standings', label: 'Standings' },
  { value: 'player-stats', label: 'Player stats', premium: true },
  { value: 'knockout', label: 'Knockout' },
  { value: 'stats', label: 'Stats' },
  { value: 'power', label: 'Power rankings' },
];

export type CompetitionHeaderProps = {
  name: string;
  subtitle: string;
  badge: string;
  onBack: () => void;
  pin: { pinned: boolean; onToggle: () => void } | null;
  /** "Season 2": shown with ▾ only when there is more than one season. */
  season: { label: string; onPress: () => void } | null;
  tab: CompetitionTab;
  onTab: (tab: CompetitionTab) => void;
  /** A league's tabs unless given (a tournament's, S10A). */
  tabs?: CompetitionTabOption[];
};

export function CompetitionHeader({ name, subtitle, badge, onBack, pin, season, tab, onTab, tabs = COMPETITION_TABS }: CompetitionHeaderProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.xs }]}>
      <View style={styles.actions}>
        <Pressable
          testID="league-page-back"
          accessibilityRole="button"
          accessibilityLabel="Back to Leagues"
          onPress={onBack}
          style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
          <IconSymbol name="chevron.left" size={ICON.regular} color={colors.onNight} />
        </Pressable>
        {pin ? (
          <Pressable
            testID="competition-pin"
            accessibilityRole="button"
            accessibilityLabel={pin.pinned ? `Unpin ${name}` : `Pin ${name}`}
            accessibilityState={{ selected: pin.pinned }}
            onPress={pin.onToggle}
            style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
            {/* Green only ever on night. */}
            <IconSymbol name="star.fill" size={ICON.regular} color={pin.pinned ? colors.green : colors.onNightMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.titleRow}>
        <CompetitionBadge label={badge} tone="green" size="large" />
        <View style={styles.titles}>
          <Text variant="display" tone="onNight" numberOfLines={2} accessibilityRole="header">
            {name}
          </Text>
          <Text variant="callout" tone="onNightMuted" numberOfLines={1}>
            {subtitle}
          </Text>
          {season ? (
            <Pressable
              testID="competition-season"
              accessibilityRole="button"
              accessibilityLabel={`${season.label}. Change season`}
              onPress={season.onPress}
              style={({ pressed }) => [styles.season, pressed && styles.pressed]}>
              <Text variant="headline" tone="onNight">
                {season.label}
              </Text>
              <IconSymbol name="chevron.down" size={ICON.small} color={colors.onNight} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" contentContainerStyle={styles.tabs}>
        {tabs.map((t) => {
          const selected = t.value === tab;
          return (
            <Pressable
              key={t.value}
              testID={`competition-tab-${t.value}`}
              accessibilityRole="tab"
              accessibilityLabel={t.premium ? `${t.label}, Premium` : t.label}
              accessibilityState={{ selected }}
              onPress={() => onTab(t.value)}
              style={[styles.tab, selected && styles.tabSelected]}>
              <Text variant="headline" tone={selected ? 'onNight' : 'onNightMuted'}>
                {t.label}
              </Text>
              {t.premium ? <IconSymbol name="crown.fill" size={ICON.small} color={colors.onNightMuted} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  bar: { backgroundColor: colors.night, paddingHorizontal: space.lg, gap: space.sm },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  icon: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  titles: { flex: 1, gap: space.xs },
  season: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH, alignSelf: 'flex-start' },
  tabs: { gap: space.xl, paddingTop: space.sm },
  tab: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: space.xs - 1,
    borderBottomColor: colors.night,
  },
  tabSelected: { borderBottomColor: colors.green },
}));
